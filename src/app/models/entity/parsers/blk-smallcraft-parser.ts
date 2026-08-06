// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { SmallCraftEntity } from '../entities/aero/small-craft-entity';
import {
  SMALL_CRAFT_ARMOR_LOCATIONS,
} from '../types';
import { decodeBlkAeroDesignType } from './blk-codec';
import { BuildingBlock } from './building-block';
import { SC_EQUIP_TAGS } from './blk-constants';
import { parseBaseBlk, parseBlkAeroEngine, parseBlkArmor, parseBlkArmorValues, parseBlkCrew, parseBlkEquipment, resolveBlkStructure } from './blk-base-parser';
import { ParseContext } from './parse-context';
import { decodeMotiveType } from './motive-type-codec';

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
  const entity = new SmallCraftEntity(ctx.equipmentRegistry);

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  if (!bb.exists('internal_type')) resolveBlkStructure(entity, 0, ctx);

  // ── Movement ──
  if (bb.exists('SafeThrust'))   entity.originalWalkMP.set(bb.getFirstInt('SafeThrust'));
  if (bb.exists('fuel'))         entity.fuel.set(bb.getFirstInt('fuel'));
  if (bb.exists('motion_type'))  entity.motiveType.set(decodeMotiveType(bb.getFirstString('motion_type')));

  // ── Engine ──
  parseBlkAeroEngine(bb, entity);

  // ── Structural integrity ──
  if (bb.exists('structural_integrity')) {
    entity.structuralIntegrity.set(bb.getFirstInt('structural_integrity'));
  }

  // ── Design type (Aerodyne / Spheroid) ──
  if (bb.exists('designtype')) {
    entity.designType.set(decodeBlkAeroDesignType(bb.getFirstInt('designtype')));
  }

  // ── Armor ──
  parseBlkArmor(bb, entity, ctx, { remapStandardTo: 'AEROSPACE' });
  parseBlkArmorValues(bb, entity, SMALL_CRAFT_ARMOR_LOCATIONS);

  // ── Equipment per location ──
  parseBlkEquipment(bb, entity, ctx, SC_EQUIP_TAGS);

  // ── Crew ──
  parseBlkCrew(bb, entity);
  entity.reconcileCrewAndQuarters();

  return entity;
}
