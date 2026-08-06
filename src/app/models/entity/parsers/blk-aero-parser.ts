// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AeroEntity } from '../entities/aero/aero-entity';
import { AeroSpaceFighterEntity } from '../entities/aero/aero-space-fighter-entity';
import { ConvFighterEntity } from '../entities/aero/conv-fighter-entity';
import { FixedWingSupportEntity } from '../entities/aero/fixed-wing-support-entity';
import {
  AERO_EQUIP_LOCATIONS,
  AERO_LOCATIONS,
} from '../types';
import { BuildingBlock } from './building-block';
import { FIGHTER_EQUIP_TAGS, FWS_EQUIP_TAGS } from './blk-constants';
import { getBlkTechBase, parseBaseBlk, parseBlkAeroEngine, parseBlkArmor, parseBlkArmorValues, parseBlkEquipment, parseBlkSupportArmor, resolveBlkStructure } from './blk-base-parser';
import { ParseContext } from './parse-context';
import { decodeMotiveType } from './motive-type-codec';
import { decodeBlkAeroCockpitType } from './blk-codec';

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

  // ── Determine entity type ──
  const unitType = bb.getFirstString('UnitType').trim();
  let entity: AeroEntity;
  if (unitType === 'ConvFighter')       entity = new ConvFighterEntity(ctx.equipmentRegistry);
  else if (unitType === 'FixedWingSupport') entity = new FixedWingSupportEntity(ctx.equipmentRegistry);
  else                                  entity = new AeroSpaceFighterEntity(ctx.equipmentRegistry);

  // ── Base parsing (identity, year, source, transporters, role, etc.) ──
  parseBaseBlk(bb, entity, ctx);
  if (!bb.exists('internal_type')) resolveBlkStructure(entity, 0, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Movement ──
  if (bb.exists('SafeThrust'))   entity.originalWalkMP.set(bb.getFirstInt('SafeThrust'));
  if (bb.exists('fuel'))         entity.fuel.set(bb.getFirstInt('fuel'));
  if (bb.exists('motion_type'))  entity.motiveType.set(decodeMotiveType(bb.getFirstString('motion_type')));

  // ── Engine ──
  parseBlkAeroEngine(bb, entity, { rating: getAeroEngineRating(bb, entity) });

  // ── Cockpit ──
  if (bb.exists('cockpit_type')) {
    entity.cockpitType.set(decodeBlkAeroCockpitType(bb.getFirstInt('cockpit_type')));
  }

  // ── OmniPod heat sinks ──
  if (bb.exists('omnipodheatsinks')) {
    entity.omnipodHeatSinkCount.set(bb.getFirstInt('omnipodheatsinks'));
  }

  // ── Structural integrity ──
  if (bb.exists('structural_integrity')) {
    entity.structuralIntegrity.set(bb.getFirstInt('structural_integrity'));
  } else {
    entity.autoSetStructuralIntegrity();
  }

  // ── Armor ──
  if (entity instanceof FixedWingSupportEntity) {
    parseBlkSupportArmor(bb, entity, ctx);
  } else {
    parseBlkArmor(bb, entity, ctx, {
      patchworkLocs: AERO_EQUIP_LOCATIONS,
    });
  }

  parseBlkArmorValues(bb, entity, AERO_LOCATIONS);

  // ── Equipment per location ──
  const equipTags = entity instanceof FixedWingSupportEntity ? FWS_EQUIP_TAGS : FIGHTER_EQUIP_TAGS;
  parseBlkEquipment(bb, entity, ctx, equipTags);

  // ── Type-specific fields ──

  if (entity instanceof ConvFighterEntity && bb.exists('vstol')) {
    entity.vstol.set(bb.getFirstInt('vstol') === 1);
  }

  if (entity instanceof FixedWingSupportEntity) {
    if (bb.exists('structural_tech_rating'))   entity.structuralTechRating.set(bb.getFirstInt('structural_tech_rating'));
    if (bb.exists('engine_tech_rating'))       entity.engineTechRating.set(bb.getFirstInt('engine_tech_rating'));
    if (bb.exists('baseChassisFireConWeight')) entity.baseChassisFireConWeight.set(bb.getFirstDouble('baseChassisFireConWeight'));
  }

  return entity;
}

function getAeroEngineRating(bb: BuildingBlock, entity: AeroEntity): number {
  if (entity instanceof FixedWingSupportEntity) return 1;

  const tonnage = Math.trunc(entity.tonnage());
  if (entity instanceof ConvFighterEntity) return entity.safeThrust() * tonnage;

  let rating = (entity.safeThrust() - 2) * tonnage;
  if (bb.getFirstInt('armor_type') === 39) {
    rating = Math.round(rating * 1.2);
    rating = Math.ceil(rating / 5) * 5;
  }
  return rating;
}
