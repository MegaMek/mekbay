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
  AERO_LOCATIONS,
  armorTypeFromCode,
  locationArmor,
  LocationArmor,
  resolveArmorEquipment,
} from '../types';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk, parseBlkEngine } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// BLK equipment location tags per entity type
// ============================================================================

/** Standard ASF / ConvFighter equipment location blocks */
const FIGHTER_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',       'Nose'],
  ['Left Wing Equipment',  'Left Wing'],
  ['Right Wing Equipment', 'Right Wing'],
  ['Aft Equipment',        'Aft'],
  ['Wings Equipment',      'Wings'],
  ['Fuselage Equipment',   'Fuselage'],
];

/** FixedWingSupport uses 'Body' instead of 'Fuselage' */
const FWS_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',       'Nose'],
  ['Left Wing Equipment',  'Left Wing'],
  ['Right Wing Equipment', 'Right Wing'],
  ['Aft Equipment',        'Aft'],
  ['Wings Equipment',      'Wings'],
  ['Body Equipment',       'Body'],
];

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
  if (bb.exists('motion_type'))  entity.motionType.set(bb.getFirstString('motion_type'));

  // ── Engine ──
  {
    const result = parseBlkEngine(bb, entity);
    if (result) {
      entity.mountedEngine.set(result.mountedEngine);
      entity.heatSinkType.set(result.heatSinkType);
      if (bb.exists('heatsinks')) entity.heatSinkCount.set(result.totalHeatSinks);
    }
  }

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
  if (bb.exists('armor_type'))  entity.armorType.set(armorTypeFromCode(bb.getFirstInt('armor_type')));
  if (bb.exists('armor_tech')) {
    const code = bb.getFirstInt('armor_tech');
    if (code === 1) entity.armorTechBase.set('Clan');
    else if (code === 2) entity.armorTechBase.set('Mixed');
  }

  // ── Patchwork armor: per-location armor type / tech / rating ──
  if (entity.armorType() === 'PATCHWORK') {
    const patchLocs = ['Left Wing', 'Right Wing', 'Aft', 'Wings', 'Fuselage'];
    const codes = new Map<string, number>();
    const techs = new Map<string, string>();
    const ratings = new Map<string, number>();
    for (const loc of patchLocs) {
      if (bb.exists(`${loc}_armor_type`)) {
        codes.set(loc, bb.getFirstInt(`${loc}_armor_type`));
      }
      if (bb.exists(`${loc}_armor_tech`)) {
        techs.set(loc, bb.getFirstString(`${loc}_armor_tech`));
      }
      if (bb.exists(`${loc}_armor_tech_rating`)) {
        ratings.set(loc, bb.getFirstInt(`${loc}_armor_tech_rating`));
      }
    }
    entity.patchworkArmorCodes.set(codes);
    entity.patchworkArmorTech.set(techs);
    entity.patchworkArmorTechRating.set(ratings);
  }

  entity.armorEquipment.set(
    resolveArmorEquipment(entity.armorType(), entity.armorTechBase() === 'Clan', ctx.equipmentDb)
  );

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');
    const locs = [...AERO_LOCATIONS];
    const armorMap = new Map<string, LocationArmor>();
    for (let i = 0; i < locs.length && i < ints.length; i++) {
      armorMap.set(locs[i], locationArmor(ints[i]));
    }
    entity.armorValues.set(armorMap);
  }

  // ── Equipment per location ──
  const equipTags = entity instanceof FixedWingSupportEntity ? FWS_EQUIP_TAGS : FIGHTER_EQUIP_TAGS;

  for (const [blkTag, locCode] of equipTags) {
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

  // ── Type-specific fields ──

  if (entity instanceof ConvFighterEntity) {
    if (bb.exists('vstol')) entity.vstol.set(bb.getFirstInt('vstol') === 1);
  }

  if (entity instanceof FixedWingSupportEntity) {
    if (bb.exists('vstol')) entity.vstol.set(bb.getFirstInt('vstol') === 1);
    if (bb.exists('barrating'))               entity.barRating.set(bb.getFirstInt('barrating'));
    if (bb.exists('structural_tech_rating'))   entity.structuralTechRating.set(bb.getFirstInt('structural_tech_rating'));
    if (bb.exists('engine_tech_rating'))       entity.engineTechRating.set(bb.getFirstInt('engine_tech_rating'));
    if (bb.exists('armor_tech_rating'))        entity.armorTechRating.set(bb.getFirstInt('armor_tech_rating'));
    if (bb.exists('baseChassisFireConWeight')) entity.baseChassisFireConWeight.set(bb.getFirstDouble('baseChassisFireConWeight'));
  }

  // ── Internal type (round-trip) ──
  if (bb.exists('internal_type')) {
    const isCode = bb.getFirstInt('internal_type');
    entity.rawInternalTypeCode.set(isCode);
  }

  return entity;
}
