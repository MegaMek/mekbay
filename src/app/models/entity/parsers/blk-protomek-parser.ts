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
  LocationArmor,
  armorTypeFromCode,
  locationArmor,
  parseMotiveType,
  resolveArmorEquipment,
} from '../types';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk, parseBlkEngine } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// Equipment location tags
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

/** Armor order: Head, Torso, RA, LA, Legs, [MainGun] (no rear armor) */
const PROTO_ARMOR_LOCS = ['Head', 'Torso', 'Right Arm', 'Left Arm', 'Legs', 'Main Gun'] as const;

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a ProtoMek entity.
 */
export function parseBlkProtoMek(bb: BuildingBlock, ctx: ParseContext): ProtoMekEntity {
  resetMountIdCounter();
  const entity = new ProtoMekEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Motive type ──
  if (bb.exists('motion_type')) entity.motiveType.set(parseMotiveType(bb.getFirstString('motion_type')));

  // ── Movement ──
  if (bb.exists('cruiseMP'))  entity.walkMP.set(bb.getFirstInt('cruiseMP'));
  if (bb.exists('jumpingMP')) entity.jumpingMP.set(bb.getFirstInt('jumpingMP'));

  // ── Engine ──
  {
    const result = parseBlkEngine(bb, entity, {
      engineTypeRequired: true,
      includeHeatSinks: false,
    });
    if (result) entity.mountedEngine.set(result.mountedEngine);
  }

  // ── ProtoMek-specific flags ──
  if (bb.exists('interface_cockpit')) {
    const val = bb.getFirstString('interface_cockpit');
    entity.interfaceCockpit.set(val.toLowerCase() === 'true' || val === '1');
  }
  if (bb.exists('isQuad'))   entity.isQuad.set(bb.getFirstInt('isQuad') === 1);
  if (bb.exists('isGlider')) entity.isGlider.set(bb.getFirstInt('isGlider') === 1);

  // ── Armor ──
  if (bb.exists('armor_type')) entity.armorType.set(armorTypeFromCode(bb.getFirstInt('armor_type')));
  if (bb.exists('armor_tech')) {
    const code = bb.getFirstInt('armor_tech');
    if (code === 1) entity.armorTechBase.set('Clan');
    else if (code === 2) entity.armorTechBase.set('Mixed');
  }
  entity.armorEquipment.set(
    resolveArmorEquipment(entity.armorType(), entity.armorTechBase() === 'Clan', ctx.equipmentDb)
  );

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');

    // Determine hasMainGun from armor array length (Java approach).
    // ProtoMek has 7 locations (Body..MainGun); armor skips Body.
    // 6 values = has Main Gun, 5 values = no Main Gun.
    entity.hasMainGun.set(ints.length >= 6);

    const armorMap = new Map<string, LocationArmor>();

    // ProtoMek armor: Head, Torso, RA, LA, Legs, [MainGun]  (NO rear armor)
    if (ints.length >= 1) armorMap.set('Head', locationArmor(ints[0]));
    if (ints.length >= 2) armorMap.set('Torso', locationArmor(ints[1]));
    if (ints.length >= 3) armorMap.set('Right Arm', locationArmor(ints[2]));
    if (ints.length >= 4) armorMap.set('Left Arm', locationArmor(ints[3]));
    if (ints.length >= 5) armorMap.set('Legs', locationArmor(ints[4]));
    if (ints.length >= 6) armorMap.set('Main Gun', locationArmor(ints[5]));

    entity.armorValues.set(armorMap);
  } else {
    // Fallback: detect Main Gun from equipment blocks
    if (bb.exists('Main Gun Equipment')) {
      entity.hasMainGun.set(true);
    }
  }

  // ── Equipment per location ──
  for (const [blkTag, locCode] of PROTO_EQUIP_TAGS) {
    if (!bb.exists(blkTag)) continue;
    const lines = bb.getDataAsString(blkTag);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = ctx.resolveEquipment(parsed.name, blkTag);

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: locCode,
        rearMounted: parsed.rearMounted,
        turretMounted: false,
        omniPodMounted: parsed.omniPod,
        armored: false,
        size: parsed.size,
        facing: parsed.facing,
      });
    }
  }

  return entity;
}
