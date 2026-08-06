// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { LamEntity } from '../entities/mek/lam-entity';
import { MekEntity } from '../entities/mek/mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import { QuadVeeEntity } from '../entities/mek/quad-vee-entity';
import { TripodMekEntity } from '../entities/mek/tripod-mek-entity';
import { MiscEquipment } from '../../equipment.model';
import {
  EntityMountedEquipment,
  LocationArmor,
  locationArmor,
} from '../types';
import { BuildingBlock } from './building-block';
import { decodeBlkCockpitType, decodeBlkGyroType, getBlkMekHeatSinkEquipmentId } from './blk-codec';
import {
  BLK_ARMOR_BIPED,
  BLK_ARMOR_QUAD,
  BLK_CRIT_BIPED,
  BLK_CRIT_QUAD,
} from './blk-constants';
import { getBlkTechBase, parseBaseBlk, parseBlkArmor, parseBlkEngine, resolveBlkStructure } from './blk-base-parser';
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
  // Determine chassis type
  const chassisType = bb.getFirstString('chassis_type').toLowerCase();
  let entity: MekEntity;
  if (chassisType.includes('lam'))          entity = new LamEntity(ctx.equipmentRegistry);
  else if (chassisType.includes('quadvee')) entity = new QuadVeeEntity(ctx.equipmentRegistry);
  else if (chassisType.includes('quad'))    entity = new QuadMekEntity(ctx.equipmentRegistry);
  else if (chassisType.includes('tripod'))  entity = new TripodMekEntity(ctx.equipmentRegistry);
  else                                      entity = new BipedMekEntity(ctx.equipmentRegistry);

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  if (!bb.exists('internal_type')) resolveBlkStructure(entity, 0, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Movement (must precede engine - rating = walkMP x tonnage) ──
  if (bb.exists('walkingMP')) entity.originalWalkMP.set(bb.getFirstInt('walkingMP'));

  // ── Engine ──
  {
    const result = parseBlkEngine(bb, entity, {
      isSuperHeavy: entity.tonnage() > 100,
    });
    if (result) {
      entity.configureEngine(result.mountedEngine);
      const heatSinkEquipment = ctx.resolveEquipment(
        getBlkMekHeatSinkEquipmentId(result.heatSinkType, techBase),
        'sink_type',
      );
      if (heatSinkEquipment instanceof MiscEquipment) {
        entity.heatSinkEquipment.set(heatSinkEquipment);
      }
    }
  }

  // ── Structure / Gyro / Cockpit ──
  if (bb.exists('gyro_type')) {
    const gyroCode = bb.getFirstInt('gyro_type');
    entity.gyroType.set(decodeBlkGyroType(gyroCode));
  }

  if (bb.exists('cockpit_type')) {
    const cockpitCode = bb.getFirstInt('cockpit_type');
    entity.cockpitType.set(decodeBlkCockpitType(cockpitCode));
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

      const parsedMembers = raw.split('|').map(member => parseEquipmentLine(member));
      const omniPod = parsedMembers.some(member => member.omniPod);

      for (const parsedMember of parsedMembers) {
        const parsed = { ...parsedMember, omniPod };
        const resolved = ctx.resolveEquipment(parsed.name, critTag);

        // Spreadable equipment merges all crits into one mount while incomplete
        if (resolved?.isSpreadable) {
          const existingIdx = spreadableMap.get(parsed.name);
          if (existingIdx !== undefined) {
            const existing = equipmentList[existingIdx];
            const expectedCrits = existing.getNumCriticalSlots(entity) ?? Infinity;
            if (existing.placedCriticalSlotCount < expectedCrits) {
              equipmentList[existingIdx] = existing.withAddedPlacement({ location: locCode, slotIndex: slotIdx });
              continue;
            }
          }
        }

        const idx = equipmentList.length;
        equipmentList.push(entity.addEquipment({
          equipmentId: parsed.name,
          equipment: resolved ?? undefined,
          allocation: {
            kind: 'location',
            location: locCode,
            placements: [{ location: locCode, slotIndex: slotIdx }],
          },
          rearMounted: parsed.rearMounted,
          turretMounted: false,
          omniPodMounted: parsed.omniPod,
          armored: false,
          size: parsed.size,
          facing: parsed.facing,
        }));

        if (resolved?.isSpreadable) spreadableMap.set(parsed.name, idx);
      }
    }
  }

  entity.setEquipment(equipmentList);
  const totalHeatSinks = bb.exists('heatsinks') ? bb.getFirstInt('heatsinks') : 10;
  entity.initializeParsedHeatSinkMounts(totalHeatSinks);
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
