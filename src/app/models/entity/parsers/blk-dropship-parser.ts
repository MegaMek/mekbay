// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DropShipEntity } from '../entities/aero/dropship-entity';
import { decodeMotiveType } from './motive-type-codec';
import { BuildingBlock } from './building-block';
import { decodeBlkAeroDesignType, decodeBlkDropShipCollarType } from './blk-codec';
import { DS_ARMOR_LOCS, DS_EQUIP_TAGS } from './blk-constants';
import { parseBaseBlk, parseBlkAeroEngine, parseBlkArmor, parseBlkArmorValues, parseBlkCrew, parseBlkEquipment, parseLegacyDockingCollars, resolveBlkStructure } from './blk-base-parser';
import { ParseContext } from './parse-context';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a DropShip entity.
 */
export function parseBlkDropShip(bb: BuildingBlock, ctx: ParseContext): DropShipEntity {
  const entity = new DropShipEntity(ctx.equipmentRegistry);

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

  // ── Design type ──
  if (bb.exists('designtype')) {
    entity.designType.set(decodeBlkAeroDesignType(bb.getFirstInt('designtype')));
  }

  // ── Docking collars ──
  parseLegacyDockingCollars(bb, entity);
  if (bb.exists('collartype')) {
    entity.collarType.set(decodeBlkDropShipCollarType(bb.getFirstInt('collartype')));
  }
  if (bb.exists('kf_boom')) {
    entity.kfBoomAttached.set(bb.getFirstInt('kf_boom') === 1);
  }

  // ── Armor ──
  parseBlkArmor(bb, entity, ctx, { remapStandardTo: 'AEROSPACE' });
  parseBlkArmorValues(bb, entity, DS_ARMOR_LOCS);

  // ── Equipment per location ──
  parseBlkEquipment(bb, entity, ctx, DS_EQUIP_TAGS, { equipmentLineProfile: 'dropship' });

  // ── Crew ──
  parseBlkCrew(bb, entity);

  return entity;
}
