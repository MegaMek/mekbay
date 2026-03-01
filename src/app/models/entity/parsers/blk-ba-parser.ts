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
import {
  ArmorType,
  EntityTechBase,
  EquipmentTechBase,
  LocationArmor,
  armorTypeFromCode,
  locationArmor,
  parseMotiveType,
  resolveArmorEquipment,
} from '../types';
import { createMountedArmor } from '../components';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a BattleArmor entity.
 *
 * BLK layout for BA:
 *   - `Squad Equipment` (or legacy `Point Equipment`) → Squad location (shared equipment)
 *   - `Trooper 1 Equipment` … `Trooper N Equipment` → per-trooper equipment
 *   - Equipment lines may have `:Body`, `:LA`, `:RA`, `:TU` suffixes for BA mount location
 */
export function parseBlkBA(bb: BuildingBlock, ctx: ParseContext): BattleArmorEntity {
  resetMountIdCounter();
  const entity = new BattleArmorEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── BA-specific fields ──
  // Trooper Count can appear as 'Trooper Count' (with space) or 'troopercount'
  if (bb.exists('Trooper Count'))       entity.trooperCount.set(bb.getFirstInt('Trooper Count'));
  else if (bb.exists('troopercount'))   entity.trooperCount.set(bb.getFirstInt('troopercount'));

  if (bb.exists('weightclass'))    entity.weightClass.set(bb.getFirstString('weightclass'));
  if (bb.exists('chassis'))        entity.chassisType.set(bb.getFirstString('chassis'));
  if (bb.exists('turret'))         entity.turretConfig.set(bb.getFirstString('turret'));
  if (bb.exists('exoskeleton'))    entity.isExoskeleton.set(bb.getFirstString('exoskeleton') === 'true');
  if (bb.exists('jumpingMP'))      entity.jumpingMP.set(bb.getFirstInt('jumpingMP'));
  if (bb.exists('motion_type'))    entity.motiveType.set(parseMotiveType(bb.getFirstString('motion_type')));

  // cruiseMP → walkMP (BA movement)
  if (bb.exists('cruiseMP'))       entity.walkMP.set(bb.getFirstInt('cruiseMP'));

  // ── Armor ──
  {
    const type = bb.exists('armor_type') ? armorTypeFromCode(bb.getFirstInt('armor_type')) : 'STANDARD' as ArmorType;
    let techBase: EquipmentTechBase = 'Inner Sphere';
    let rawTechCode = 0;
    if (bb.exists('armor_tech')) {
      rawTechCode = bb.getFirstInt('armor_tech');
      if (rawTechCode >= 5 && rawTechCode <= 8) techBase = 'Clan';
    }
    const armor = resolveArmorEquipment(type, techBase === 'Clan', ctx.equipmentDb);
    const existing = entity.mountedArmor();
    entity.mountedArmor.set(createMountedArmor({ ...existing, type, techBase, armor, rawTechCode }));
  }

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');
    const armorMap = new Map<string, LocationArmor>();
    // BA armor: single value = squad armor (same for all troopers)
    if (ints.length === 1) {
      armorMap.set('Squad', locationArmor(ints[0]));
    } else {
      for (let i = 0; i < ints.length; i++) {
        const loc = i === 0 ? 'Squad' : `Trooper ${i}`;
        armorMap.set(loc, locationArmor(ints[i]));
      }
    }
    entity.armorValues.set(armorMap);
  }

  // ── Squad / Trooper Equipment ──
  parseBaEquipment(bb, entity, techBase, ctx);

  return entity;
}

/**
 * Parse BA squad and trooper equipment blocks.
 */
function parseBaEquipment(
  bb: BuildingBlock,
  entity: BattleArmorEntity,
  techBase: EntityTechBase,
  ctx: ParseContext,
): void {
  // Squad Equipment (or legacy Point Equipment) → Squad
  if (bb.exists('Squad Equipment')) {
    parseLocationEquipment(bb, entity, 'Squad Equipment', 'Squad', techBase, ctx);
  } else if (bb.exists('Point Equipment')) {
    entity.squadEquipmentTag.set('Point');
    parseLocationEquipment(bb, entity, 'Point Equipment', 'Squad', techBase, ctx);
  }

  // Trooper N Equipment
  for (let i = 1; i <= 6; i++) {
    const tag = `Trooper ${i} Equipment`;
    parseLocationEquipment(bb, entity, tag, `Trooper ${i}`, techBase, ctx);
  }

  // Slotless equipment → location 'None' (equipment not assigned to a specific trooper)
  parseLocationEquipment(bb, entity, 'slotless_equipment', 'None', techBase, ctx);
}

function parseLocationEquipment(
  bb: BuildingBlock,
  entity: BattleArmorEntity,
  blkTag: string,
  location: string,
  techBase: EntityTechBase,
  ctx: ParseContext,
): void {
  if (!bb.exists(blkTag)) return;
  const lines = bb.getDataAsString(blkTag);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // parseEquipmentLine handles all colon-separated suffixes in any order:
    // :DWP, :SSWM, :APM, :OMNI, :Body, :LA, :RA, :TU, :ShotsN#, :SIZE:N
    const parsed = parseEquipmentLine(line);
    const resolved = ctx.resolveEquipment(parsed.name, blkTag);

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
      baMountLocation: parsed.baMountLocation,
      isDWP: parsed.isDWP,
      isSSWM: parsed.isSSWM,
      isAPM: parsed.isAPM,
      shotsLeft: parsed.shots,
    });
  }
}
