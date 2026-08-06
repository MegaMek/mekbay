// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MekEntity } from '../entities/mek/mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import {
  CriticalSlotView,
  formatCriticalSlotEquipment,
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
      return formatCriticalSlotEquipment(slot, (mount, isLast) =>
        encodeEquipmentLine(mount, { includeOmniPod: isLast && slot.omniPod }));
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
