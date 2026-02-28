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

import { AeroEntity } from '../entities/aero/aero-entity';
import { AeroSpaceFighterEntity } from '../entities/aero/aero-space-fighter-entity';
import { ConvFighterEntity } from '../entities/aero/conv-fighter-entity';
import { FixedWingSupportEntity } from '../entities/aero/fixed-wing-support-entity';
import {
  AERO_EQUIP_LOCATIONS,
  AERO_LOCATIONS,
  parseMotiveType,
} from '../types';
import { createMountedArmor } from '../components';
import { resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { FIGHTER_EQUIP_TAGS, FWS_EQUIP_TAGS } from './blk-constants';
import { getBlkTechBase, parseBaseBlk, parseBlkAeroEngine, parseBlkArmor, parseBlkArmorValues, parseBlkEquipment } from './blk-base-parser';
import { ParseContext } from './parse-context';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for an AeroSpace Fighter, Conventional Fighter,
 * or Fixed Wing Support entity.
 *
 * Dispatches on `<UnitType>`: `Aero`, `ConvFighter`, `FixedWingSupport`.
 */
export function parseBlkAero(bb: BuildingBlock, ctx: ParseContext): AeroEntity {
  resetMountIdCounter();

  // ── Determine entity type ──
  const unitType = bb.getFirstString('UnitType').trim();
  let entity: AeroEntity;
  if (unitType === 'ConvFighter')       entity = new ConvFighterEntity();
  else if (unitType === 'FixedWingSupport') entity = new FixedWingSupportEntity();
  else                                  entity = new AeroSpaceFighterEntity();

  // ── Base parsing (identity, year, source, transporters, role, etc.) ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Movement ──
  if (bb.exists('SafeThrust'))   entity.walkMP.set(bb.getFirstInt('SafeThrust'));
  if (bb.exists('fuel'))         entity.fuel.set(bb.getFirstInt('fuel'));
  if (bb.exists('motion_type'))  entity.motiveType.set(parseMotiveType(bb.getFirstString('motion_type')));

  // ── Engine ──
  parseBlkAeroEngine(bb, entity);

  // ── Cockpit ──
  if (bb.exists('cockpit_type')) {
    const cpCode = bb.getFirstInt('cockpit_type');
    entity.cockpitType.set(cpCode === 0 ? 'Standard' : `Type ${cpCode}`);
  }

  // ── OmniPod heat sinks ──
  if (bb.exists('omnipodheatsinks')) {
    entity.omnipodHeatSinkCount.set(bb.getFirstInt('omnipodheatsinks'));
  }

  // ── Structural integrity ──
  if (bb.exists('structural_integrity')) {
    entity.structuralIntegrity.set(bb.getFirstInt('structural_integrity'));
  }

  // ── Armor ──
  parseBlkArmor(bb, entity, ctx, {
    patchworkLocs: AERO_EQUIP_LOCATIONS,
  });

  parseBlkArmorValues(bb, entity, AERO_LOCATIONS);

  // ── Equipment per location ──
  const equipTags = entity instanceof FixedWingSupportEntity ? FWS_EQUIP_TAGS : FIGHTER_EQUIP_TAGS;
  parseBlkEquipment(bb, entity, ctx, equipTags);

  // ── Type-specific fields ──

  if (entity instanceof ConvFighterEntity) {
    if (bb.exists('vstol')) entity.vstol.set(bb.getFirstInt('vstol') === 1);
  }

  if (entity instanceof FixedWingSupportEntity) {
    if (bb.exists('vstol')) entity.vstol.set(bb.getFirstInt('vstol') === 1);
    if (bb.exists('barrating'))               entity.barRating.set(bb.getFirstInt('barrating'));
    if (bb.exists('structural_tech_rating'))   entity.structuralTechRating.set(bb.getFirstInt('structural_tech_rating'));
    if (bb.exists('engine_tech_rating'))       entity.engineTechRating.set(bb.getFirstInt('engine_tech_rating'));
    // FWS armor_tech_rating: default 0 for FWS (not the standard -1)
    if (entity.mountedArmor().techRating < 0) {
      const armor = entity.mountedArmor();
      entity.mountedArmor.set(createMountedArmor({ ...armor, techRating: 0 }));
    }
    if (bb.exists('baseChassisFireConWeight')) entity.baseChassisFireConWeight.set(bb.getFirstDouble('baseChassisFireConWeight'));
  }

  // ── Internal type (round-trip) ──
  if (bb.exists('internal_type')) {
    const isCode = bb.getFirstInt('internal_type');
    entity.rawInternalTypeCode.set(isCode);
  }

  return entity;
}
