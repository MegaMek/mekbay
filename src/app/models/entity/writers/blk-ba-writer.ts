// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import { encodeBlkArmorTechLevel, encodeBlkArmorType } from '../parsers/blk-codec';
import {
  BuildingBlockWriter,
  writeFluffBlocks,
  writeSource,
  writeBlkPreamble,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import { weightClassCode } from '../types';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a BattleArmorEntity to BLK format.
 *
 * Block ordering matches Java BLKFile.encode():
 *   identity → yearTechMeta → motion_type → cruiseMP → armor_type/tech →
 *   Squad Equipment → Trooper N Equipment → slotless_equipment →
 *   fluff → source → chassis → turret → exoskeleton → jumpingMP →
 *   armor → Trooper Count → weightclass
 */
export function writeBlkBA(entity: BattleArmorEntity): string {
  const w = new BuildingBlockWriter();

  // ── Section 1: Identity ──
  writeBlkPreamble(w, entity, 'BattleArmor');

  w.addBlock('cruiseMP', entity.originalWalkMP());

  // ── Section 4: Armor type (BA always writes both blocks) ──
  const armor = entity.uniformArmor();
  if (!armor) throw new Error('Battle armor cannot use patchwork armor');
  w.addBlock('armor_type', encodeBlkArmorType(armor));
  w.addBlock('armor_tech', encodeBlkArmorTechLevel(armor));

  // ── Section 5: Equipment per location ──
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    const line = encodeEquipmentLine(m, { blkMode: true, shotsFormat: 'ba-handheld' });
    lines.push(line);
  }

  // Squad Equipment (always written, even if empty)
  // Preserve original tag: 'Squad Equipment' (modern) or 'Point Equipment' (legacy)
  const squadTag = entity.squadEquipmentTag();
  const squadEquip = mountsByLoc.get('Squad') ?? [];
  w.addBlock(`${squadTag} Equipment`, ...squadEquip);

  // Trooper N Equipment (always written, even if empty)
  for (let i = 1; i <= entity.trooperCount(); i++) {
    const trooperEquip = mountsByLoc.get(`Trooper ${i}`) ?? [];
    w.addBlock(`Trooper ${i} Equipment`, ...trooperEquip);
  }

  // Slotless Equipment
  const slotlessEquip = mountsByLoc.get('None') ?? [];
  if (slotlessEquip.length > 0) {
    w.addBlock('slotless_equipment', ...slotlessEquip);
  }

  // ── Section 6: Fluff ──
  writeFluffBlocks(w, entity.fluff());

  // ── Section 7: Source ──
  writeSource(w, entity);

  // ── Section 8: BA tail fields ──
  if (entity.chassisType()) w.addBlock('chassis', entity.chassisType());
  const turretCfg = entity.turretConfig();
  if (turretCfg) w.addBlock('turret', turretCfg);
  if (entity.isExoskeleton()) w.addBlock('exoskeleton', 'true');

  w.addBlock('jumpingMP', Math.max(entity.baseJumpMP(), entity.umuMP()));

  // Armor - single squad armor value (not per-trooper)
  const armorMap = entity.armorValues();
  const squadArmor = armorMap.get('Squad')?.front ?? 0;
  w.addBlock('armor', squadArmor);

  // Trooper Count (with space, capitalized - matches Java)
  w.addBlock('Trooper Count', entity.trooperCount());

  // Weight class (numeric code)
  w.addBlock('weightclass', weightClassCode(entity.weightClass()));

  // NOTE: No tonnage block for BattleArmor - matches Java reference output

  return w.toString();
}
