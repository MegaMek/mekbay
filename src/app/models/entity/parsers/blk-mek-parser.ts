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
import { cockpitTypeFromCode, gyroTypeFromCode } from '../components';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import {
  BLK_ARMOR_BIPED,
  BLK_ARMOR_QUAD,
  BLK_CRIT_BIPED,
  BLK_CRIT_QUAD,
} from './blk-constants';
import { getBlkTechBase, parseBaseBlk, parseBlkArmor, parseBlkEngine } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a Mek-type entity.
 *
 * Equipment mounts are the single canonical model - crit positions are
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

  // ── Movement (must precede engine - rating = walkMP x tonnage) ──
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
    const gyroCode = bb.getFirstInt('gyro_type');
    entity.gyroType.set(gyroTypeFromCode(gyroCode));
  }

  if (bb.exists('cockpit_type')) {
    const cockpitCode = bb.getFirstInt('cockpit_type');
    entity.cockpitType.set(cockpitTypeFromCode(cockpitCode));
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

  // Track spreadable equipment: equipmentId → index in equipmentList
  const spreadableMap = new Map<string, number>();

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

      // Spreadable equipment merges all crits into one mount while incomplete
      if (resolved?.isSpreadable) {
        const existingIdx = spreadableMap.get(parsed.name);
        if (existingIdx !== undefined) {
          const existing = equipmentList[existingIdx];
          const expectedCrits = existing.equipment?.getNumCriticalSlots(entity, existing.size ?? 0) ?? Infinity;
          if ((existing.criticalSlots ?? 0) < expectedCrits) {
            existing.placements = [...(existing.placements ?? []), { location: locCode, slotIndex: slotIdx }];
            existing.criticalSlots = (existing.criticalSlots ?? 1) + 1;
            continue;
          }
        }
      }

      const idx = equipmentList.length;
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

      if (resolved?.isSpreadable) spreadableMap.set(parsed.name, idx);
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
