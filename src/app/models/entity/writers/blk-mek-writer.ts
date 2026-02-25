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

import { MekEntity } from '../entities/mek/mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import {
  CriticalSlotView,
  ENGINE_TYPE_TO_CODE,
  EntityMountedEquipment,
  EngineType,
  HEAT_SINK_TYPE_TO_CODE,
  HeatSinkType,
} from '../types';
import { BuildingBlockWriter } from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// BLK Armor Array Order (must match parser)
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

const BLK_CRIT_BIPED: [string, string][] = [
  ['hd', 'HD'], ['la', 'LA'], ['ra', 'RA'], ['ll', 'LL'], ['rl', 'RL'],
  ['lt', 'LT'], ['rt', 'RT'], ['ct', 'CT'],
];

const BLK_CRIT_QUAD: [string, string][] = [
  ['hd', 'HD'], ['fll', 'FLL'], ['frl', 'FRL'], ['rll', 'RLL'], ['rrl', 'RRL'],
  ['lt', 'LT'], ['rt', 'RT'], ['ct', 'CT'],
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a MekEntity to BLK format.
 *
 * Crit slots are written from the derived `criticalSlotGrid` computed,
 * and armor from the structured `armorValues` (LocationArmor).
 */
export function writeBlkMek(entity: MekEntity): string {
  const w = new BuildingBlockWriter();
  const isQuad = entity instanceof QuadMekEntity;

  // Build mount lookup for crit output
  const mountMap = new Map<string, EntityMountedEquipment>();
  for (const m of entity.equipment()) {
    mountMap.set(m.mountId, m);
  }

  // ── Identity ──
  w.addBlock('Name', entity.chassis());
  w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id', entity.mulId());

  // ── Year / Source / Tech ──
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  if (entity.source()) w.addBlock('source', entity.source());

  const techCode = entity.techBase() === 'Clan' ? 1 : entity.mixedTech() ? 3 : 2;
  w.addBlock('tonnage', entity.tonnage());

  // ── Chassis / Engine ──
  const chassisType = isQuad ? 'Quad' : 'Biped';
  w.addBlock('chassis_type', chassisType);
  w.addBlock('engine_type', ENGINE_TYPE_TO_CODE[entity.engineType() as EngineType] ?? 0);
  w.addBlock('engine_rating', entity.engineRating());
  w.addBlock('walkingMP', entity.walkMP());

  // ── Structure / Gyro / Cockpit ──
  w.addBlock('internal_type', 0);  // TODO: map structureType to code
  if (entity.gyroType() !== 'Standard') {
    const gyroMap: Record<string, number> = {
      'Standard': 0, 'XL': 1, 'Compact': 2, 'Heavy-Duty': 3, 'None': 4, 'Superheavy': 5,
    };
    w.addBlock('gyro_type', gyroMap[entity.gyroType()] ?? 0);
  }
  if (entity.cockpitType() !== 'Standard') {
    const cpMap: Record<string, number> = {
      'Standard': 0, 'Small': 1, 'Command Console': 2, 'Torso-Mounted': 3,
      'Dual': 4, 'Industrial': 5, 'Primitive': 6, 'Primitive Industrial': 7,
      'Superheavy': 8, 'Superheavy Tripod': 9, 'Tripod': 10,
      'Interface': 11, 'Virtual Reality Piloting Pod': 12, 'QuadVee': 13,
    };
    w.addBlock('cockpit_type', cpMap[entity.cockpitType()] ?? 0);
  }

  // ── Heat sinks ──
  w.addBlock('sink_type', HEAT_SINK_TYPE_TO_CODE[entity.heatSinkType() as HeatSinkType] ?? 0);
  if (entity.baseChassisHeatSinks() >= 0) {
    w.addBlock('base chassis heat sinks', entity.baseChassisHeatSinks());
  }

  // ── Armor ──
  const armorLayout = isQuad ? BLK_ARMOR_QUAD : BLK_ARMOR_BIPED;
  const armorMap = entity.armorValues();
  const armorInts: number[] = armorLayout.map(({ loc, face }) => {
    const la = armorMap.get(loc);
    return la ? la[face] : 0;
  });
  w.addBlock('armor', ...armorInts);

  // ── Critical slots from derived grid ──
  const critLocs = isQuad ? BLK_CRIT_QUAD : BLK_CRIT_BIPED;
  const grid = entity.criticalSlotGrid();

  for (const [blkTag, locCode] of critLocs) {
    const slots = grid.get(locCode) ?? [];
    const slotLines: string[] = [];

    for (const slot of slots) {
      slotLines.push(slotToBlkString(slot, mountMap, entity));
    }

    w.addBlock(`${blkTag} criticalSlots`, ...slotLines);
  }

  return w.toString();
}

// ============================================================================
// Helpers
// ============================================================================

function slotToBlkString(
  slot: CriticalSlotView,
  mountMap: Map<string, EntityMountedEquipment>,
  entity: MekEntity,
): string {
  switch (slot.type) {
    case 'empty':
      return '-1';
    case 'system':
      return slot.systemType === 'Engine'
        ? getBlkEngineName(entity.engineType())
        : slot.systemType ?? '-1';
    case 'equipment': {
      const mount = slot.mountId ? mountMap.get(slot.mountId) : undefined;
      return mount ? encodeEquipmentLine(mount) : '-1';
    }
  }
}

function getBlkEngineName(engineType: string): string {
  switch (engineType) {
    case 'XL': return 'XL Fusion Engine';
    case 'XXL': return 'XXL Fusion Engine';
    case 'Light': return 'Light Fusion Engine';
    case 'Compact': return 'Compact Fusion Engine';
    case 'ICE': return 'I.C.E.';
    case 'Fuel Cell': return 'Fuel Cell Engine';
    case 'Fission': return 'Fission Engine';
    default: return 'Fusion Engine';
  }
}
