// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { HandheldWeaponEntity } from '../entities/misc/handheld-weapon-entity';
import {
  BuildingBlockWriter,
  writeArmorBlocks,
  writeBlkPreamble,
  writeFluffBlocks,
  writeEmbeddedImages,
  writeInternalType,
  writeSource,
  writeTonnage,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a HandheldWeaponEntity to BLK format.
 */
export function writeBlkHandheld(entity: HandheldWeaponEntity): string {
  const w = new BuildingBlockWriter();

  // ── Identity / Year / Tech / Meta ──
  writeBlkPreamble(w, entity, 'HandheldWeapon');

  writeArmorBlocks(w, entity);
  writeInternalType(w, entity);

  // Armor values (single value for the whole unit)
  const armorMap = entity.armorValues();
  const armorVal = armorMap.get('Gun')?.front ?? armorMap.get('None')?.front ?? 0;
  w.addBlock('armor', armorVal);

  // ── Equipment ──
  const equipLines = entity.equipment().map(m => encodeEquipmentLine(m, {
    blkMode: true,
    shotsFormat: 'ba-handheld',
  }));
  if (equipLines.length > 0) {
    w.addBlock('Gun Equipment', ...equipLines);
  }

  // ── Fluff ──
  writeFluffBlocks(w, entity.fluff());

  // ── Source / Tonnage ──
  writeSource(w, entity);
  writeTonnage(w, entity);

  writeEmbeddedImages(w, entity);

  return w.toString(entity.nativeSourceTrailingNewlines || 2);
}
