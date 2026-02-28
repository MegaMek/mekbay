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
import { getArmorTypeCode } from '../components';
import {
  BuildingBlockWriter,
  writeIdentity,
  writeYearTechMeta,
  writeMotiveType,
  writeFluffBlocks,
  writeSource,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

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
  writeIdentity(w, entity, 'BattleArmor');

  // ── Section 2: Year / Tech / Meta (includes quirks) ──
  writeYearTechMeta(w, entity);

  // ── Section 3: Motion / Movement ──
  writeMotiveType(w, entity);
  w.addBlock('cruiseMP', entity.walkMP());

  // ── Section 4: Armor type (BA always writes both blocks) ──
  const armor = entity.mountedArmor();
  w.addBlock('armor_type', getArmorTypeCode(armor));
  w.addBlock('armor_tech', armor.rawTechCode);

  // ── Section 5: Equipment per location ──
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    const line = encodeEquipmentLine(m, { blkMode: true });
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

  w.addBlock('jumpingMP', entity.jumpingMP());

  // Armor — single squad armor value (not per-trooper)
  const armorMap = entity.armorValues();
  const squadArmor = armorMap.get('Squad')?.front ?? 0;
  w.addBlock('armor', squadArmor);

  // Trooper Count (with space, capitalized — matches Java)
  w.addBlock('Trooper Count', entity.trooperCount());

  // Weight class (numeric code)
  w.addBlock('weightclass', entity.weightClass());

  // NOTE: No tonnage block for BattleArmor — matches Java reference output

  return w.toString();
}
