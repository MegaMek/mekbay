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
import { ConvFighterEntity } from '../entities/aero/conv-fighter-entity';
import { FixedWingSupportEntity } from '../entities/aero/fixed-wing-support-entity';
import {
  AERO_LOCATIONS,
  ENGINE_TYPE_TO_CODE,
  EngineType,
  HEAT_SINK_TYPE_TO_CODE,
  HeatSinkType,
} from '../types';
import { BuildingBlockWriter, writeFluffBlocks } from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Equipment location BLK tags
// ============================================================================

const FIGHTER_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',       'Nose'],
  ['Left Wing Equipment',  'Left Wing'],
  ['Right Wing Equipment', 'Right Wing'],
  ['Aft Equipment',        'Aft'],
  ['Wings Equipment',      'Wings'],
  ['Fuselage Equipment',   'Fuselage'],
];

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
 * Serialize an AeroEntity (ASF, ConvFighter, FixedWingSupport) to BLK format.
 */
export function writeBlkAero(entity: AeroEntity): string {
  const w = new BuildingBlockWriter();

  // ── UnitType ──
  let unitType = 'Aero';
  if (entity instanceof FixedWingSupportEntity)  unitType = 'FixedWingSupport';
  else if (entity instanceof ConvFighterEntity)  unitType = 'ConvFighter';
  w.addBlock('UnitType', unitType);

  // ── Identity ──
  w.addBlock('Name', entity.chassis());
  if (entity.model()) w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id:', entity.mulId());

  // ── Year / Source / Tech ──
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  if (entity.techLevel()) w.addBlock('type', entity.techLevel());
  if (entity.role()) w.addBlock('role', entity.role());
  if (entity.motionType()) w.addBlock('motion_type', entity.motionType());

  // ── Transporters ──
  const transporters = entity.transporters();
  if (transporters.length > 0) {
    const tLines = transporters.map(t => `${t.type}:${t.capacity}:${t.doors}` + (t.bayNumber ? `:${t.bayNumber}` : ''));
    w.addBlock('transporters', ...tLines);
  } else {
    w.addBlock('transporters', '');
  }

  // ── Movement ──
  w.addBlock('SafeThrust', entity.walkMP());

  // ── Cockpit / Heat sinks / Fuel / Engine ──
  if (!(entity instanceof FixedWingSupportEntity)) {
    w.addBlock('cockpit_type', 0); // TODO: map cockpit type to code
  }
  w.addBlock('heatsinks', entity.heatSinkCount());
  w.addBlock('sink_type', HEAT_SINK_TYPE_TO_CODE[entity.heatSinkType() as HeatSinkType] ?? 0);
  w.addBlock('fuel', entity.fuel());
  w.addBlock('engine_type', ENGINE_TYPE_TO_CODE[entity.engineType() as EngineType] ?? 0);

  // ── Armor ──
  const armorLocs = [...AERO_LOCATIONS];
  const armorMap = entity.armorValues();
  const armorInts: number[] = armorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
  w.addBlock('armor', ...armorInts);

  // ── Equipment per location ──
  const equipTags = entity instanceof FixedWingSupportEntity ? FWS_EQUIP_TAGS : FIGHTER_EQUIP_TAGS;
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    lines.push(encodeEquipmentLine(m, { blkMode: true }));
  }

  for (const [blkTag, locCode] of equipTags) {
    const lines = mountsByLoc.get(locCode) ?? [];
    w.addBlock(blkTag, ...lines);
  }

  // ── Type-specific fields ──

  if (entity instanceof ConvFighterEntity && entity.vstol()) {
    w.addBlock('vstol', 1);
  }

  if (entity instanceof FixedWingSupportEntity) {
    w.addBlock('barrating', entity.barRating());
    if (entity.structuralTechRating()) w.addBlock('structural_tech_rating', entity.structuralTechRating());
    if (entity.engineTechRating())     w.addBlock('engine_tech_rating', entity.engineTechRating());
    if (entity.armorTechRating())      w.addBlock('armor_tech_rating', entity.armorTechRating());
  }

  if (entity.structuralIntegrity() > 0) {
    w.addBlock('structural_integrity', entity.structuralIntegrity());
  }

  // ── Fluff ──
  writeFluffBlocks(w, entity.fluff());

  // ── Source / Tonnage ──
  if (entity.source()) w.addBlock('source', entity.source());
  w.addBlock('tonnage', entity.tonnage());

  return w.toString();
}
