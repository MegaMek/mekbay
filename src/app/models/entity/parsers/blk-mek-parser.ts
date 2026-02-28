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

import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { LamEntity } from '../entities/mek/lam-entity';
import { MekEntity } from '../entities/mek/mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import { QuadVeeEntity } from '../entities/mek/quad-vee-entity';
import { TripodMekEntity } from '../entities/mek/tripod-mek-entity';
import {
  EntityMountedEquipment,
  LocationArmor,
  locationArmor,
  structureTypeFromCode,
} from '../types';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk, parseBlkArmor, parseBlkEngine } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// BLK Armor Array Order
// ============================================================================

const BLK_ARMOR_BIPED: { loc: string; face: 'front' | 'rear' }[] = [
  { loc: 'HD',  face: 'front' },
  { loc: 'LA',  face: 'front' },
  { loc: 'LT',  face: 'front' },
  { loc: 'LT',  face: 'rear'  },
  { loc: 'CT',  face: 'front' },
  { loc: 'CT',  face: 'rear'  },
  { loc: 'RT',  face: 'front' },
  { loc: 'RT',  face: 'rear'  },
  { loc: 'RA',  face: 'front' },
  { loc: 'LL',  face: 'front' },
  { loc: 'RL',  face: 'front' },
];

const BLK_ARMOR_QUAD: { loc: string; face: 'front' | 'rear' }[] = [
  { loc: 'HD',  face: 'front' },
  { loc: 'FLL', face: 'front' },
  { loc: 'LT',  face: 'front' },
  { loc: 'LT',  face: 'rear'  },
  { loc: 'CT',  face: 'front' },
  { loc: 'CT',  face: 'rear'  },
  { loc: 'RT',  face: 'front' },
  { loc: 'RT',  face: 'rear'  },
  { loc: 'FRL', face: 'front' },
  { loc: 'RLL', face: 'front' },
  { loc: 'RRL', face: 'front' },
];

// ============================================================================
// BLK crit location tags
// ============================================================================

const BLK_CRIT_BIPED = [
  ['hd', 'HD'], ['la', 'LA'], ['ra', 'RA'], ['ll', 'LL'], ['rl', 'RL'],
  ['lt', 'LT'], ['rt', 'RT'], ['ct', 'CT'],
] as const;

const BLK_CRIT_QUAD = [
  ['hd', 'HD'], ['fll', 'FLL'], ['frl', 'FRL'], ['rll', 'RLL'], ['rrl', 'RRL'],
  ['lt', 'LT'], ['rt', 'RT'], ['ct', 'CT'],
] as const;

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a Mek-type entity.
 *
 * Equipment mounts are the single canonical model — crit positions are
 * stored as `placements` on each mount.
 */
export function parseBlkMek(bb: BuildingBlock, ctx: ParseContext): MekEntity {
  resetMountIdCounter();

  // Determine chassis type
  const chassisType = bb.getFirstString('chassis_type').toLowerCase();
  let entity: MekEntity;
  if (chassisType.includes('lam'))          entity = new LamEntity();
  else if (chassisType.includes('quadvee')) entity = new QuadVeeEntity();
  else if (chassisType.includes('quad'))    entity = new QuadMekEntity();
  else if (chassisType.includes('tripod'))  entity = new TripodMekEntity();
  else                                      entity = new BipedMekEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Movement (must precede engine — rating = walkMP × tonnage) ──
  if (bb.exists('walkingMP')) entity.walkMP.set(bb.getFirstInt('walkingMP'));

  // ── Engine ──
  {
    const result = parseBlkEngine(bb, entity, {
      isSuperHeavy: entity.tonnage() > 100,
    });
    if (result) entity.mountedEngine.set(result.mountedEngine);
  }

  // ── Structure / Gyro / Cockpit ──
  if (bb.exists('internal_type')) entity.structureType.set(structureTypeFromCode(bb.getFirstInt('internal_type')));

  if (bb.exists('gyro_type')) {
    const gyroNames: Record<number, string> = {
      0: 'Standard', 1: 'XL', 2: 'Compact', 3: 'Heavy Duty', 4: 'None', 5: 'Superheavy',
    };
    entity.gyroType.set(gyroNames[bb.getFirstInt('gyro_type')] ?? 'Standard');
  }

  if (bb.exists('cockpit_type')) {
    const cpNames: Record<number, string> = {
      0: 'Standard', 1: 'Small', 2: 'Command Console', 3: 'Torso-Mounted',
      4: 'Dual', 5: 'Industrial', 6: 'Primitive', 7: 'Primitive Industrial',
      8: 'Superheavy', 9: 'Superheavy Tripod', 10: 'Tripod',
      11: 'Interface', 12: 'Virtual Reality Piloting Pod', 13: 'QuadVee',
    };
    entity.cockpitType.set(cpNames[bb.getFirstInt('cockpit_type')] ?? 'Standard');
  }

  // ── Armor (structured) ──
  parseBlkArmor(bb, entity, ctx);

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');
    const layout = entity instanceof QuadMekEntity ? BLK_ARMOR_QUAD : BLK_ARMOR_BIPED;
    const armorMap = new Map<string, LocationArmor>();

    for (let i = 0; i < layout.length && i < ints.length; i++) {
      const { loc, face } = layout[i];
      const prev = armorMap.get(loc) ?? locationArmor(0);
      armorMap.set(loc, { ...prev, [face]: ints[i] });
    }
    entity.armorValues.set(armorMap);
  }

  // ── Critical slots → equipment with placements ──
  const isQuad = entity instanceof QuadMekEntity;
  const critLocs = isQuad ? BLK_CRIT_QUAD : BLK_CRIT_BIPED;
  const equipmentList: EntityMountedEquipment[] = [];

  for (const [blkLoc, locCode] of critLocs) {
    const critTag = `${blkLoc} criticalSlots`;
    if (!bb.exists(critTag)) continue;

    const slotLines = bb.getDataAsString(critTag);
    for (let slotIdx = 0; slotIdx < slotLines.length; slotIdx++) {
      const raw = slotLines[slotIdx].trim();
      if (!raw || raw === '-1') continue;

      // Skip system slots (they're derived from config)
      if (isSystemSlotName(raw)) continue;

      const parsed = parseEquipmentLine(raw);
      const resolved = ctx.resolveEquipment(parsed.name, critTag);

      equipmentList.push({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: locCode,
        placements: [{ location: locCode, slotIndex: slotIdx }],
        criticalSlots: 1,
        rearMounted: parsed.rearMounted,
        turretMounted: false,
        omniPodMounted: parsed.omniPod,
        armored: false,
        size: parsed.size,
        facing: parsed.facing,
      });
    }
  }

  entity.equipment.set(equipmentList);
  return entity;
}

// ============================================================================
// Helpers
// ============================================================================

const SYSTEM_SLOT_NAMES = new Set([
  'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator',
  'Hip', 'Upper Leg Actuator', 'Lower Leg Actuator', 'Foot Actuator',
  'Life Support', 'Sensors', 'Cockpit', 'Gyro', 'Landing Gear', 'Avionics',
  'Engine',
]);

const ENGINE_PREFIXES = [
  'Fusion Engine', 'XL Engine', 'XXL Engine', 'Light Engine',
  'Compact Engine', 'No Engine',
];

function isSystemSlotName(name: string): boolean {
  if (SYSTEM_SLOT_NAMES.has(name)) return true;
  return ENGINE_PREFIXES.some(p => name.startsWith(p));
}
