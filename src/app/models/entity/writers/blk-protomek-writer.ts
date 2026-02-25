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
  ARMOR_TYPE_TO_CODE,
  ENGINE_TYPE_TO_CODE,
  EngineType,
} from '../types';
import { BuildingBlockWriter, writeFluffBlocks } from './building-block-writer';
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
 */
export function writeBlkProtoMek(entity: ProtoMekEntity): string {
  const w = new BuildingBlockWriter();

  // ── Header ──
  w.addBlock('UnitType', 'ProtoMek');

  // ── Identity ──
  w.addBlock('Name', entity.chassis());
  w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id:', entity.mulId());

  // ── Year / Tech / Meta ──
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  if (entity.techLevel()) w.addBlock('type', entity.techLevel());
  if (entity.role()) w.addBlock('role', entity.role());

  // ── Transporters ──
  const transporters = entity.transporters();
  if (transporters.length > 0) {
    const tLines = transporters.map(t =>
      `${t.type}:${t.capacity}:${t.doors}` + (t.bayNumber >= 0 ? `:${t.bayNumber}` : '')
    );
    w.addBlock('transporters', ...tLines);
  }

  // ── Movement ──
  w.addBlock('cruiseMP', entity.walkMP());

  // ── Engine ──
  w.addBlock('engine_type', ENGINE_TYPE_TO_CODE[entity.engineType() as EngineType] ?? 0);

  // ── ProtoMek-specific flags ──
  if (entity.interfaceCockpit()) w.addBlock('interface_cockpit', 1);
  if (entity.isQuad())   w.addBlock('isQuad', 1);
  if (entity.isGlider()) w.addBlock('isGlider', 1);

  // ── Armor ──
  const armorType = entity.armorType();
  if (armorType !== 'STANDARD') {
    w.addBlock('armor_type', ARMOR_TYPE_TO_CODE[armorType] ?? 0);
    const atb = entity.armorTechBase();
    if (atb === 'Clan') w.addBlock('armor_tech', 1);
    else if (atb === 'Mixed') w.addBlock('armor_tech', 2);
  }

  const armorMap = entity.armorValues();
  // ProtoMek armor order: Head, Torso(front), Torso(rear), RA, LA, Legs, [MainGun]
  const armorInts: number[] = [
    armorMap.get('Head')?.front ?? 0,
    armorMap.get('Torso')?.front ?? 0,
    armorMap.get('Torso')?.rear ?? 0,
    armorMap.get('Right Arm')?.front ?? 0,
    armorMap.get('Left Arm')?.front ?? 0,
    armorMap.get('Legs')?.front ?? 0,
  ];
  if (entity.tonnage() > 9) {
    armorInts.push(armorMap.get('Main Gun')?.front ?? 0);
  }
  w.addBlock('armor', ...armorInts);

  // ── Equipment per location ──
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    lines.push(encodeEquipmentLine(m, { blkMode: true }));
  }

  for (const [blkTag, locCode] of PROTO_EQUIP_TAGS) {
    const lines = mountsByLoc.get(locCode) ?? [];
    if (lines.length > 0) {
      w.addBlock(blkTag, ...lines);
    }
  }

  // ── Fluff ──
  writeFluffBlocks(w, entity.fluff());

  // ── Source / Tonnage ──
  if (entity.source()) w.addBlock('source', entity.source());
  w.addBlock('tonnage', entity.tonnage());

  return w.toString();
}
