// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { JumpShipEntity } from '../entities/largecraft/jumpship-entity';
import { WarShipEntity } from '../entities/largecraft/warship-entity';
import { SpaceStationEntity } from '../entities/largecraft/space-station-entity';
import {
  LARGE_CRAFT_LOCATIONS,
} from '../types';
import { BuildingBlock } from './building-block';
import { decodeBlkAeroDesignType, decodeBlkDriveCoreType } from './blk-codec';
import { JUMPSHIP_EQUIP_TAGS, WARSHIP_EXTRA_EQUIP_TAGS } from './blk-constants';
import { parseBaseBlk, parseBlkAeroEngine, parseBlkArmor, parseBlkArmorValues, parseBlkCrew, parseBlkEquipment, parseLegacyDockingCollars, resolveBlkStructure } from './blk-base-parser';
import { ParseContext } from './parse-context';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a JumpShip, WarShip, or SpaceStation entity.
 */
export function parseBlkLargeCraft(bb: BuildingBlock, ctx: ParseContext): JumpShipEntity {

  // ── Determine entity type ──
  const unitType = bb.getFirstString('UnitType').trim();
  let entity: JumpShipEntity;

  switch (unitType.toLowerCase()) {
    case 'warship':       entity = new WarShipEntity(ctx.equipmentRegistry); break;
    case 'spacestation':  entity = new SpaceStationEntity(ctx.equipmentRegistry); break;
    default:              entity = new JumpShipEntity(ctx.equipmentRegistry); break;
  }

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  if (!bb.exists('internal_type')) resolveBlkStructure(entity, 0, ctx);

  // ── Movement ──
  if (bb.exists('SafeThrust')) entity.originalWalkMP.set(bb.getFirstInt('SafeThrust'));
  if (bb.exists('fuel'))       entity.fuel.set(bb.getFirstInt('fuel'));

  // ── Engine ──
  parseBlkAeroEngine(bb, entity, { defaultTotalHeatSinks: 0 });

  // ── Structural integrity ──
  if (bb.exists('structural_integrity')) {
    entity.structuralIntegrity.set(bb.getFirstInt('structural_integrity'));
  }

  // ── JumpShip specifics ──
  if (bb.exists('designtype'))     entity.designType.set(decodeBlkAeroDesignType(bb.getFirstInt('designtype')));
  if (bb.exists('kf_core'))        entity.driveCoreType.set(decodeBlkDriveCoreType(bb.getFirstInt('kf_core')));
  if (bb.exists('sail'))           entity.sail.set(bb.getFirstInt('sail') === 1);
  parseLegacyDockingCollars(bb, entity);
  if (bb.exists('lithium-fusion')) entity.lithiumFusion.set(bb.getFirstInt('lithium-fusion') === 1);
  if (bb.exists('hpg'))           entity.hpg.set(bb.getFirstInt('hpg') === 1);
  if (bb.exists('jump_range'))    entity.jumpRange.set(bb.getFirstInt('jump_range'));
  if (entity instanceof SpaceStationEntity && bb.exists('modular')) {
    entity.modularOrKFAdapter.set(bb.getFirstInt('modular') === 1);
  }

  if (bb.exists('grav_decks')) {
    entity.gravDecks.set(bb.getDataAsInt('grav_decks'));
  }

  // ── Armor ──
  parseBlkArmor(bb, entity, ctx, { remapStandardTo: 'AEROSPACE' });
  parseBlkArmorValues(bb, entity, LARGE_CRAFT_LOCATIONS);

  // ── Equipment per location ──
  const equipTags = entity instanceof WarShipEntity
    ? [...JUMPSHIP_EQUIP_TAGS, ...WARSHIP_EXTRA_EQUIP_TAGS]
    : JUMPSHIP_EQUIP_TAGS;
  parseBlkEquipment(bb, entity, ctx, equipTags, { equipmentLineProfile: 'large-craft' });

  // ── Crew ──
  parseBlkCrew(bb, entity);

  return entity;
}
