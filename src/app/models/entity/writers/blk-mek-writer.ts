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
  EntityMountedEquipment,
  EngineType,
  HEAT_SINK_TYPE_TO_CODE,
  HeatSinkType,
  structureTypeToCode,
} from '../types';
import { BuildingBlockWriter } from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import {
  BLK_ARMOR_BIPED,
  BLK_ARMOR_QUAD,
  BLK_CRIT_BIPED,
  BLK_CRIT_QUAD,
} from '../parsers/blk-constants';

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
  const me = entity.mountedEngine();
  w.addBlock('engine_type', me?.descriptor().code ?? 0);
  w.addBlock('walkingMP', entity.walkMP());

  // ── Structure / Gyro / Cockpit ──
  w.addBlock('internal_type', structureTypeToCode(entity.structureType()));
  if (entity.gyroType() !== 'Standard') {
    const gyroMap: Record<string, number> = {
      'Standard': 0, 'XL': 1, 'Compact': 2, 'Heavy Duty': 3, 'None': 4, 'Superheavy': 5,
    };
    w.addBlock('gyro_type', gyroMap[entity.gyroType()] ?? 0);
  }
  if (entity.cockpitType() !== 'Standard') {
    w.addBlock('cockpit_type', entity.mountedCockpit().code);
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
        ? getBlkEngineName(entity.mountedEngine()?.type())
        : slot.systemType ?? '-1';
    case 'equipment': {
      const mount = slot.mountId ? mountMap.get(slot.mountId) : undefined;
      return mount ? encodeEquipmentLine(mount) : '-1';
    }
  }
}

function getBlkEngineName(engineType: string | undefined): string {
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
