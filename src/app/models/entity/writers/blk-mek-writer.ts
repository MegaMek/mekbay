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
} from '../types';
import {
  encodeBlkCockpitType,
  encodeBlkEngineType,
  encodeBlkGyroType,
  encodeBlkHeatSinkType,
} from '../parsers/blk-codec';
import { BuildingBlockWriter, writeInternalType, writeSource } from './building-block-writer';
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
  if (entity.hasHybridStructure()) {
    throw new Error('Hybrid per-location structure cannot be represented in BLK format');
  }
  const w = new BuildingBlockWriter();
  const isQuad = entity instanceof QuadMekEntity;

  // ── Identity ──
  w.addBlock('Name', entity.chassis());
  w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id', entity.mulId());

  // ── Year / Source / Tech ──
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  writeSource(w, entity);

  const techCode = entity.techBase() === 'Clan' ? 1 : entity.mixedTech() ? 3 : 2;
  w.addBlock('tonnage', entity.tonnage());

  // ── Chassis / Engine ──
  const chassisType = isQuad ? 'Quad' : 'Biped';
  w.addBlock('chassis_type', chassisType);
  const me = entity.mountedEngine();
  w.addBlock('engine_type', me ? encodeBlkEngineType(me.type()) : 0);
  w.addBlock('walkingMP', entity.originalWalkMP());

  // ── Structure / Gyro / Cockpit ──
  writeInternalType(w, entity);
  if (entity.gyroType() !== 'Standard') {
    w.addBlock('gyro_type', encodeBlkGyroType(entity.gyroType()));
  }
  if (entity.cockpitType() !== 'Standard') {
    w.addBlock('cockpit_type', encodeBlkCockpitType(entity.cockpitType()));
  }

  // ── Heat sinks ──
  w.addBlock('heatsinks', entity.totalHeatSinks());
  w.addBlock('sink_type', encodeBlkHeatSinkType(entity.heatSinkType()));

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
      slotLines.push(slotToBlkString(slot, entity));
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
  entity: MekEntity,
): string {
  switch (slot.type) {
    case 'empty':
      return '-1';
    case 'system':
      return slot.systemType === 'Engine'
        ? getBlkEngineName(entity.mountedEngine()?.type())
        : slot.systemType ?? '-1';
    case 'equipment':
      return encodeEquipmentLine(slot.mount);
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
