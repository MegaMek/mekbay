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

import { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import { armorTypeToCode } from '../types';
import { BuildingBlockWriter, writeFluffBlocks } from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a BattleArmorEntity to BLK format.
 */
export function writeBlkBA(entity: BattleArmorEntity): string {
  const w = new BuildingBlockWriter();

  // ── Header ──
  w.addBlock('UnitType', 'BattleArmor');

  // ── Identity ──
  w.addBlock('Name', entity.chassis());
  if (entity.model()) w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id:', entity.mulId());

  // ── Year / Tech / Meta ──
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  if (entity.techLevel()) w.addBlock('type', entity.techLevel());
  if (entity.role()) w.addBlock('role', entity.role());

  // ── Motion type ──
  if (entity.motionType()) w.addBlock('motion_type', entity.motionType());

  // ── Transporters ──
  const transporters = entity.transporters();
  if (transporters.length > 0) {
    const tLines = transporters.map(t =>
      `${t.type}:${t.capacity}:${t.doors}` + (t.bayNumber ? `:${t.bayNumber}` : '')
    );
    w.addBlock('transporters', ...tLines);
  }

  // ── BA-specific fields ──
  w.addBlock('troopercount', entity.trooperCount());
  w.addBlock('weightclass', entity.weightClass());
  if (entity.chassisType()) w.addBlock('chassis', entity.chassisType());
  if (entity.jumpingMP() > 0) w.addBlock('jumpingMP', entity.jumpingMP());

  // ── Armor ──
  const armorType = entity.armorType();
  if (armorType !== 'Standard') {
    w.addBlock('armor_type', armorTypeToCode(armorType));
    const atb = entity.armorTechBase();
    if (atb === 'Clan') w.addBlock('armor_tech', 1);
    else if (atb === 'Mixed') w.addBlock('armor_tech', 2);
  }

  const armorMap = entity.armorValues();
  const armorInts: number[] = [];
  const squadArmor = armorMap.get('Squad')?.front ?? 0;
  armorInts.push(squadArmor);
  for (let i = 1; i <= entity.trooperCount(); i++) {
    armorInts.push(armorMap.get(`Trooper ${i}`)?.front ?? 0);
  }
  w.addBlock('armor', ...armorInts);

  // ── Equipment per location ──
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    let line = encodeEquipmentLine(m, { blkMode: true });
    // Append BA-specific suffixes
    if (m.isAPM) line += ':APM';
    if (m.isSSWM) line += ':SSWM';
    if (m.isDWP) line += ':DWP';
    if (m.baMountLocation) line += `:${m.baMountLocation}`;
    lines.push(line);
  }

  // Point (Squad) Equipment
  const squadEquip = mountsByLoc.get('Squad') ?? [];
  if (squadEquip.length > 0) {
    w.addBlock('Point Equipment', ...squadEquip);
  }

  // Trooper N Equipment
  for (let i = 1; i <= entity.trooperCount(); i++) {
    const trooperEquip = mountsByLoc.get(`Trooper ${i}`) ?? [];
    if (trooperEquip.length > 0) {
      w.addBlock(`Trooper ${i} Equipment`, ...trooperEquip);
    }
  }

  // ── Slotless Equipment (equipment with no specific trooper) ──
  const slotlessEquip = mountsByLoc.get('None') ?? [];
  if (slotlessEquip.length > 0) {
    w.addBlock('slotless_equipment', ...slotlessEquip);
  }

  // ── Fluff ──
  writeFluffBlocks(w, entity.fluff());

  // ── Source / Tonnage ──
  if (entity.source()) w.addBlock('source', entity.source());
  w.addBlock('tonnage', entity.tonnage());

  return w.toString();
}
