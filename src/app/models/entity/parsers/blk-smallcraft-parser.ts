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
  SMALL_CRAFT_ARMOR_LOCATIONS,
  parseMotiveType,
} from '../types';
import { resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { SC_EQUIP_TAGS } from './blk-constants';
import { getBlkTechBase, parseBaseBlk, parseBlkAeroEngine, parseBlkArmor, parseBlkArmorValues, parseBlkCrew, parseBlkEquipment } from './blk-base-parser';
import { ParseContext } from './parse-context';

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
  parseBlkAeroEngine(bb, entity);

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
  parseBlkArmorValues(bb, entity, SMALL_CRAFT_ARMOR_LOCATIONS);

  // ── Equipment per location ──
  parseBlkEquipment(bb, entity, ctx, SC_EQUIP_TAGS);

  // ── Crew ──
  parseBlkCrew(bb, entity);

  return entity;
}
