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

import { DropShipEntity } from '../entities/aero/dropship-entity';
import {
    armorTypeToCode,
  DROPSHIP_LOCATIONS,
  ENGINE_TYPE_TO_CODE,
  EngineType,
  HEAT_SINK_TYPE_TO_CODE,
  HeatSinkType,
} from '../types';
import { BuildingBlockWriter, writeFluffBlocks } from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Equipment location tags
// ============================================================================

const DS_EQUIP_TAGS: [string, string][] = [
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
 * Serialize a DropShipEntity to BLK format.
 */
export function writeBlkDropShip(entity: DropShipEntity): string {
  const w = new BuildingBlockWriter();

  // ── Header ──
  w.addBlock('UnitType', 'DropShip');

  // ── Identity ──
  w.addBlock('Name', entity.chassis());
  if (entity.model()) w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id:', entity.mulId());

  // ── Year / Tech / Meta ──
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  if (entity.techLevel()) w.addBlock('type', entity.techLevel());
  if (entity.role()) w.addBlock('role', entity.role());
  if (entity.motionType()) w.addBlock('motion_type', entity.motionType());

  // ── Transporters ──
  const transporters = entity.transporters();
  if (transporters.length > 0) {
    const tLines = transporters.map(t =>
      `${t.type}:${t.capacity}:${t.doors}` + (t.bayNumber ? `:${t.bayNumber}` : '')
    );
    w.addBlock('transporters', ...tLines);
  }

  // ── Movement ──
  w.addBlock('SafeThrust', entity.walkMP());

  // ── Heat sinks / Fuel / Engine ──
  w.addBlock('heatsinks', entity.heatSinkCount());
  w.addBlock('sink_type', HEAT_SINK_TYPE_TO_CODE[entity.heatSinkType() as HeatSinkType] ?? 0);
  w.addBlock('fuel', entity.fuel());
  w.addBlock('engine_type', ENGINE_TYPE_TO_CODE[entity.engineType() as EngineType] ?? 0);

  // ── Structural integrity ──
  w.addBlock('structural_integrity', entity.structuralIntegrity());
  w.addBlock('designtype', entity.designType() === 'Aerodyne' ? 1 : 0);

  // ── Docking ──
  if (entity.dockingCollars() > 0) w.addBlock('docking_collar', entity.dockingCollars());
  if (entity.kfBoomAttached()) w.addBlock('kf_boom', 1);

  // ── Armor ──
  const armorType = entity.armorType();
  if (armorType !== 'Standard') {
    w.addBlock('armor_type', armorTypeToCode(armorType));
    const atb = entity.armorTechBase();
    if (atb === 'Clan') w.addBlock('armor_tech', 1);
    else if (atb === 'Mixed') w.addBlock('armor_tech', 2);
  }

  const armorLocs = [...DROPSHIP_LOCATIONS];
  const armorMap = entity.armorValues();
  const armorInts: number[] = armorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
  w.addBlock('armor', ...armorInts);

  // ── Equipment per location ──
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    lines.push(encodeEquipmentLine(m, { blkMode: true }));
  }

  for (const [blkTag, locCode] of DS_EQUIP_TAGS) {
    const lines = mountsByLoc.get(locCode) ?? [];
    if (lines.length > 0) {
      w.addBlock(blkTag, ...lines);
    }
  }

  // ── Fluff ──
  writeFluffBlocks(w, entity.fluff());

  // ── Source / Tonnage ──
  if (entity.source()) w.addBlock('source', entity.source());
  w.addBlock('tonnage', entity.tonnage());

  // ── Crew ──
  w.addBlock('crew', entity.crew());
  w.addBlock('officers', entity.officers());
  w.addBlock('gunners', entity.gunners());
  w.addBlock('passengers', entity.passengers());
  w.addBlock('marines', entity.marines());
  w.addBlock('battlearmor', entity.battleArmor());
  w.addBlock('life_boat', entity.lifeboats());
  w.addBlock('escape_pod', entity.escapePods());

  return w.toString();
}
