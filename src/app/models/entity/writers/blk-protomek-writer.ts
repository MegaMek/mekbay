/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { ProtoMekEntity } from '../entities/protomek/protomek-entity';
import {
  ENGINE_TYPE_TO_CODE,
} from '../types';
import {
  BuildingBlockWriter,
  writeIdentity,
  writeYearTechMeta,
  writeMotionType,
  writeTransporters,
  writeEngine,
  writeArmorBlocks,
  writeInternalType,
  writeEquipmentByLocation,
  writeFluffBlocks,
  writeSource,
  writeTonnage,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Equipment location BLK tags
// ============================================================================

const PROTO_EQUIP_TAGS: [string, string][] = [
  ['Body Equipment',       'Body'],
  ['Head Equipment',       'Head'],
  ['Torso Equipment',      'Torso'],
  ['Right Arm Equipment',  'Right Arm'],
  ['Left Arm Equipment',   'Left Arm'],
  ['Legs Equipment',       'Legs'],
  ['Main Gun Equipment',   'Main Gun'],
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a ProtoMekEntity to BLK format.
 *
 * Block ordering matches Java BLKFile.encode():
 *   identity → yearTechMeta → motion_type → cruiseMP → jumpingMP →
 *   interface_cockpit → engine_type → clan_engine → armor_type →
 *   armor_tech_rating → armor_tech_level → internal_type →
 *   armor → Equipment per location → slotless_equipment →
 *   fluff → source → tonnage
 */
export function writeBlkProtoMek(entity: ProtoMekEntity): string {
  const w = new BuildingBlockWriter();

  // ── Section 1: Identity ──
  writeIdentity(w, entity, 'ProtoMek');

  // ── Section 2: Year / Tech / Meta (includes quirks) ──
  writeYearTechMeta(w, entity);

  // ── Section 3: Motion type ──
  writeMotionType(w, entity);

  // ── Section 4: Transporters ──
  writeTransporters(w, entity);

  // ── Section 5: Movement ──
  w.addBlock('cruiseMP', entity.walkMP());
  // ProtoMeks always write jumpingMP (even 0)
  w.addBlock('jumpingMP', entity.jumpingMP());
  // ProtoMeks always write interface_cockpit as string
  w.addBlock('interface_cockpit', entity.interfaceCockpit() ? 'true' : 'false');

  // ── Section 6: Engine ──
  writeEngine(w, entity, ENGINE_TYPE_TO_CODE);

  // ── Section 7: Armor ──
  writeArmorBlocks(w, entity);

  // ── Section 8: Internal type ──
  writeInternalType(w, entity);

  // ── Section 9: Armor values array ──
  const armorMap = entity.armorValues();
  // ProtoMek armor order: Head, Torso, RA, LA, Legs, [MainGun]  (NO rear armor)
  const armorInts: number[] = [
    armorMap.get('Head')?.front ?? 0,
    armorMap.get('Torso')?.front ?? 0,
    armorMap.get('Right Arm')?.front ?? 0,
    armorMap.get('Left Arm')?.front ?? 0,
    armorMap.get('Legs')?.front ?? 0,
  ];
  if (entity.hasMainGun()) {
    armorInts.push(armorMap.get('Main Gun')?.front ?? 0);
  }
  w.addBlock('armor', ...armorInts);

  // ── Section 10: Equipment per location (always write all, even empty) ──
  const equipTags = entity.hasMainGun()
    ? PROTO_EQUIP_TAGS
    : PROTO_EQUIP_TAGS.filter(([tag]) => tag !== 'Main Gun Equipment');
  writeEquipmentByLocation(w, entity, equipTags, encodeEquipmentLine, true);

  // ── Section 11: ProtoMek-specific flags ──
  if (entity.isQuad())   w.addBlock('isQuad', 1);
  if (entity.isGlider()) w.addBlock('isGlider', 1);

  // ── Section 12: Fluff ──
  writeFluffBlocks(w, entity.fluff());

  // ── Section 13: Source ──
  writeSource(w, entity);

  // ── Section 14: Tonnage ──
  writeTonnage(w, entity);

  return w.toString();
}
