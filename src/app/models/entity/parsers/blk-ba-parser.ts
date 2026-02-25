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

import { EquipmentMap } from '../../equipment.model';
import { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import {
  EntityTechBase,
  LocationArmor,
  locationArmor,
} from '../types';
import { armorTypeFromCode } from '../utils/armor-type-parser';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk } from './blk-base-parser';
import { parseEquipmentLine, resolveEquipment } from './equipment-resolver';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a BattleArmor entity.
 *
 * BLK layout for BA:
 *   - `Point Equipment` → Squad location (shared equipment)
 *   - `Trooper 1 Equipment` … `Trooper N Equipment` → per-trooper equipment
 *   - Equipment lines may have `:Body`, `:LA`, `:RA`, `:Turret` suffixes for BA mount location
 */
export function parseBlkBA(bb: BuildingBlock, equipmentDb: EquipmentMap): BattleArmorEntity {
  resetMountIdCounter();
  const entity = new BattleArmorEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, equipmentDb);
  const techBase = getBlkTechBase(bb);

  // ── BA-specific fields ──
  if (bb.exists('troopercount'))   entity.trooperCount.set(bb.getFirstInt('troopercount'));
  if (bb.exists('weightclass'))    entity.weightClass.set(bb.getFirstString('weightclass'));
  if (bb.exists('chassis'))        entity.chassisType.set(bb.getFirstString('chassis'));
  if (bb.exists('jumpingMP'))      entity.jumpingMP.set(bb.getFirstInt('jumpingMP'));
  if (bb.exists('motion_type'))    entity.motionType.set(bb.getFirstString('motion_type'));

  // ── Armor ──
  if (bb.exists('armor_type')) entity.armorType.set(armorTypeFromCode(bb.getFirstInt('armor_type')));
  if (bb.exists('armor_tech')) {
    const code = bb.getFirstInt('armor_tech');
    if (code === 1) entity.armorTechBase.set('Clan');
    else if (code === 2) entity.armorTechBase.set('Mixed');
  }

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');
    const armorMap = new Map<string, LocationArmor>();
    // BA armor: one value per trooper, plus possibly one for squad
    for (let i = 0; i < ints.length; i++) {
      const loc = i === 0 ? 'Squad' : `Trooper ${i}`;
      armorMap.set(loc, locationArmor(ints[i]));
    }
    entity.armorValues.set(armorMap);
  }

  // ── Squad / Trooper Equipment ──
  parseBaEquipment(bb, entity, techBase, equipmentDb);

  return entity;
}

/**
 * Parse BA squad and trooper equipment blocks.
 */
function parseBaEquipment(
  bb: BuildingBlock,
  entity: BattleArmorEntity,
  techBase: EntityTechBase,
  equipmentDb: EquipmentMap,
): void {
  // Point Equipment → Squad
  parseLocationEquipment(bb, entity, 'Point Equipment', 'Squad', techBase, equipmentDb);

  // Trooper N Equipment
  for (let i = 1; i <= 6; i++) {
    const tag = `Trooper ${i} Equipment`;
    parseLocationEquipment(bb, entity, tag, `Trooper ${i}`, techBase, equipmentDb);
  }
}

function parseLocationEquipment(
  bb: BuildingBlock,
  entity: BattleArmorEntity,
  blkTag: string,
  location: string,
  techBase: EntityTechBase,
  equipmentDb: EquipmentMap,
): void {
  if (!bb.exists(blkTag)) return;
  const lines = bb.getDataAsString(blkTag);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Check for BA mount location suffix (:Body, :LA, :RA, :Turret)
    let baMountLocation: 'Body' | 'LA' | 'RA' | 'Turret' | undefined;
    let isDWP = false;
    let isSSWM = false;
    let isAPM = false;
    let equipLine = line;

    if (equipLine.endsWith(':Body'))   { baMountLocation = 'Body'; equipLine = equipLine.slice(0, -5); }
    else if (equipLine.endsWith(':LA'))     { baMountLocation = 'LA'; equipLine = equipLine.slice(0, -3); }
    else if (equipLine.endsWith(':RA'))     { baMountLocation = 'RA'; equipLine = equipLine.slice(0, -3); }
    else if (equipLine.endsWith(':Turret')) { baMountLocation = 'Turret'; equipLine = equipLine.slice(0, -7); }

    if (equipLine.endsWith(':DWP'))  { isDWP = true; equipLine = equipLine.slice(0, -4); }
    if (equipLine.endsWith(':SSWM')) { isSSWM = true; equipLine = equipLine.slice(0, -5); }
    if (equipLine.endsWith(':APM'))  { isAPM = true; equipLine = equipLine.slice(0, -4); }

    const parsed = parseEquipmentLine(equipLine);
    const resolved = resolveEquipment(parsed.name, techBase, equipmentDb);

    entity.addEquipment({
      mountId: generateMountId(),
      equipmentId: parsed.name,
      equipment: resolved ?? undefined,
      location,
      rearMounted: parsed.rearMounted,
      turretMounted: false,
      omniPodMounted: parsed.omniPod,
      armored: false,
      size: parsed.size,
      baMountLocation,
      isDWP,
      isSSWM,
      isAPM,
    });
  }
}
