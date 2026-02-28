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

import { SmallCraftEntity } from '../entities/aero/small-craft-entity';
import {
  LocationArmor,
  SMALL_CRAFT_ARMOR_LOCATIONS,
  locationArmor,
  parseMotiveType,
} from '../types';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk, parseBlkArmor, parseBlkEngine } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// SmallCraft equipment location tags
// ============================================================================

const SC_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',        'Nose'],
  ['Left Side Equipment',   'Left Side'],
  ['Right Side Equipment',  'Right Side'],
  ['Aft Equipment',         'Aft'],
  ['Hull Equipment',        'Hull'],
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a SmallCraft entity.
 *
 * SmallCraft uses different location names than fighters:
 * Left Side / Right Side / Hull instead of Left Wing / Right Wing / Fuselage.
 */
export function parseBlkSmallCraft(bb: BuildingBlock, ctx: ParseContext): SmallCraftEntity {
  resetMountIdCounter();
  const entity = new SmallCraftEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Movement ──
  if (bb.exists('SafeThrust'))   entity.walkMP.set(bb.getFirstInt('SafeThrust'));
  if (bb.exists('fuel'))         entity.fuel.set(bb.getFirstInt('fuel'));
  if (bb.exists('motion_type'))  entity.motiveType.set(parseMotiveType(bb.getFirstString('motion_type')));

  // ── Engine ──
  {
    const result = parseBlkEngine(bb, entity);
    if (result) {
      entity.mountedEngine.set(result.mountedEngine);
      entity.heatSinkType.set(result.heatSinkType);
      if (bb.exists('heatsinks')) entity.heatSinkCount.set(result.totalHeatSinks);
    }
  }

  // ── Structural integrity ──
  if (bb.exists('structural_integrity')) {
    entity.structuralIntegrity.set(bb.getFirstInt('structural_integrity'));
  }

  // ── Design type (Aerodyne / Spheroid) ──
  if (bb.exists('designtype')) {
    entity.designType.set(bb.getFirstInt('designtype') === 1 ? 'Aerodyne' : 'Spheroid');
  }

  // ── Armor ──
  parseBlkArmor(bb, entity, ctx);

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');
    const locs = [...SMALL_CRAFT_ARMOR_LOCATIONS];
    const armorMap = new Map<string, LocationArmor>();
    for (let i = 0; i < locs.length && i < ints.length; i++) {
      armorMap.set(locs[i], locationArmor(ints[i]));
    }
    entity.armorValues.set(armorMap);
  }

  // ── Equipment per location ──
  for (const [blkTag, locCode] of SC_EQUIP_TAGS) {
    if (!bb.exists(blkTag)) continue;
    const lines = bb.getDataAsString(blkTag);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = ctx.resolveEquipment(parsed.name, blkTag);

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: locCode,
        rearMounted: parsed.rearMounted,
        turretMounted: false,
        omniPodMounted: parsed.omniPod,
        isNewBay: parsed.isNewBay,
        armored: false,
        size: parsed.size,
        facing: parsed.facing,
      });
    }
  }

  // ── Crew ──
  if (bb.exists('crew'))            entity.crew.set(bb.getFirstInt('crew'));
  if (bb.exists('officers'))        entity.officers.set(bb.getFirstInt('officers'));
  if (bb.exists('gunners'))         entity.gunners.set(bb.getFirstInt('gunners'));
  if (bb.exists('passengers'))      entity.passengers.set(bb.getFirstInt('passengers'));
  if (bb.exists('marines'))         entity.marines.set(bb.getFirstInt('marines'));
  if (bb.exists('battlearmor'))     entity.battleArmor.set(bb.getFirstInt('battlearmor'));
  if (bb.exists('otherpassenger'))  entity.otherPassenger.set(bb.getFirstInt('otherpassenger'));
  if (bb.exists('life_boat'))       entity.lifeboats.set(bb.getFirstInt('life_boat'));
  if (bb.exists('escape_pod'))      entity.escapePods.set(bb.getFirstInt('escape_pod'));

  return entity;
}
