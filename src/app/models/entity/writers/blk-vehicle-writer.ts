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

import { VehicleEntity } from '../entities/vehicle/vehicle-entity';
import { NavalEntity } from '../entities/vehicle/naval-entity';
import { VtolEntity } from '../entities/vehicle/vtol-entity';
import { SupportTankEntity } from '../entities/vehicle/support-tank-entity';
import { SupportVtolEntity } from '../entities/vehicle/support-vtol-entity';
import { LargeSupportTankEntity } from '../entities/vehicle/large-support-tank-entity';
import { GunEmplacementEntity } from '../entities/vehicle/gun-emplacement-entity';
import {
  ENGINE_TYPE_TO_CODE,
  EngineType,
  armorTypeToCode,
} from '../types';
import { BuildingBlockWriter, writeFluffBlocks } from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Equipment location BLK tags
// ============================================================================

const VEHICLE_EQUIP_TAGS: [string, string][] = [
  ['Body Equipment',            'Body'],
  ['Front Equipment',           'Front'],
  ['Right Equipment',           'Right'],
  ['Left Equipment',            'Left'],
  ['Rear Equipment',            'Rear'],
  ['Turret Equipment',          'Turret'],
  ['Front Turret Equipment',    'Front Turret'],
  ['Rear Turret Equipment',     'Rear Turret'],
  ['Rotor Equipment',           'Rotor'],
];

const LST_EXTRA_EQUIP_TAGS: [string, string][] = [
  ['Front Right Equipment',     'Front Right'],
  ['Front Left Equipment',      'Front Left'],
  ['Rear Right Equipment',      'Rear Right'],
  ['Rear Left Equipment',       'Rear Left'],
];

const GE_EQUIP_TAGS: [string, string][] = [
  ['Guns Equipment',  'Turret'],
  ['Body Equipment',  'Body'],
];

/** Armor written in this order for vehicles: Front, Right, Left, Rear, Turret, RearTurret */
const VEHICLE_ARMOR_LOCS = ['Front', 'Right', 'Left', 'Rear', 'Turret', 'Rear Turret'] as const;
const VTOL_ARMOR_LOCS = ['Front', 'Right', 'Left', 'Rear', 'Rotor', 'Turret'] as const;

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a VehicleEntity (or subclass) to BLK format.
 */
export function writeBlkVehicle(entity: VehicleEntity): string {
  const w = new BuildingBlockWriter();

  // ── Determine UnitType tag ──
  let unitType: string;
  if (entity instanceof GunEmplacementEntity)        unitType = 'GunEmplacement';
  else if (entity instanceof LargeSupportTankEntity)  unitType = 'LargeSupportTank';
  else if (entity instanceof SupportVtolEntity)      unitType = 'SupportVTOL';
  else if (entity instanceof SupportTankEntity)       unitType = 'SupportTank';
  else if (entity instanceof VtolEntity)              unitType = 'VTOL';
  else if (entity instanceof NavalEntity)             unitType = 'Tank';  // MegaMek compat: naval vehicles use UnitType=Tank
  else                                                unitType = 'Tank';

  // ── Header ──
  w.addBlock('UnitType', unitType);

  // ── Identity ──
  w.addBlock('Name', entity.chassis());
  if (entity.model()) w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id:', entity.mulId());

  // ── Year / Tech / Meta ──
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  if (entity.techLevel()) w.addBlock('type', entity.techLevel());
  if (entity.role()) w.addBlock('role', entity.role());

  // ── Motion type ──
  w.addBlock('motion_type', entity.motionType());

  // ── Transporters ──
  const transporters = entity.transporters();
  if (transporters.length > 0) {
    const tLines = transporters.map(t =>
      `${t.type}:${t.capacity}:${t.doors}` + (t.bayNumber >= 0 ? `:${t.bayNumber}` : '')
    );
    w.addBlock('transporters', ...tLines);
  }

  // ── Movement ──
  w.addBlock('cruiseMP', entity.walkMP());

  // ── Engine ──
  w.addBlock('engine_type', ENGINE_TYPE_TO_CODE[entity.engineType() as EngineType] ?? 0);

  // ── Turret ──
  if (entity.hasDualTurret()) {
    w.addBlock('Turret', 0);
    w.addBlock('Turret2', 0);
    if (entity.baseChassisTurretWeight() > 0) {
      w.addBlock('baseChassisTurretWeight', entity.baseChassisTurretWeight());
    }
    if (entity.baseChassisTurret2Weight() > 0) {
      w.addBlock('baseChassisTurret2Weight', entity.baseChassisTurret2Weight());
    }
  } else if (entity.hasTurret()) {
    w.addBlock('Turret', 0);
    if (entity.baseChassisTurretWeight() > 0) {
      w.addBlock('baseChassisTurretWeight', entity.baseChassisTurretWeight());
    }
  }

  // ── Fuel ──
  if (entity.fuelType()) {
    w.addBlock('fuel_type', entity.fuelType());
  }

  // ── Trailer / No Controls ──
  if (entity.isTrailer()) {
    w.addBlock('trailer', 1);
  }
  if (entity.hasNoControlSystems()) {
    w.addBlock('hasNoControlSystems', 1);
  }
  if (entity.extraSeats() > 0) {
    w.addBlock('extraSeats', entity.extraSeats());
  }

  // ── Armor ──
  const armorType = entity.armorType();
  if (armorType !== 'Standard') {
    w.addBlock('armor_type', armorTypeToCode(armorType));
    const atb = entity.armorTechBase();
    if (atb === 'Clan') w.addBlock('armor_tech', 1);
    else if (atb === 'Mixed') w.addBlock('armor_tech', 2);
  }

  const armorMap = entity.armorValues();
  if (entity instanceof GunEmplacementEntity) {
    const turretArmor = armorMap.get('Turret')?.front ?? 0;
    w.addBlock('armor', turretArmor);
  } else {
    const armorLocs = entity instanceof VtolEntity ? [...VTOL_ARMOR_LOCS] : [...VEHICLE_ARMOR_LOCS];
    const armorInts: number[] = armorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
    w.addBlock('armor', ...armorInts);
  }

  // ── Internal Structure ──
  if (entity.structureType() !== 'Standard') {
    let code = 0;
    if (entity.structureType() === 'Endo Steel') code = 1;
    else if (entity.structureType() === 'Composite') code = 2;
    else if (entity.structureType() === 'Reinforced') code = 3;
    w.addBlock('internal_type', code);
  }

  // ── Gun Emplacement specifics ──
  if (entity instanceof GunEmplacementEntity) {
    w.addBlock('buildingCF', entity.buildingCF());
  }

  // ── BAR rating ──
  if (entity instanceof SupportTankEntity) {
    w.addBlock('barrating', entity.barRating());
  }
  if (entity instanceof SupportVtolEntity) {
    w.addBlock('barrating', entity.barRating());
  }

  // ── Equipment per location ──
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    lines.push(encodeEquipmentLine(m, { blkMode: true }));
  }

  let equipTags: [string, string][];
  if (entity instanceof GunEmplacementEntity) {
    equipTags = GE_EQUIP_TAGS;
  } else if (entity instanceof LargeSupportTankEntity) {
    equipTags = [...VEHICLE_EQUIP_TAGS, ...LST_EXTRA_EQUIP_TAGS];
  } else {
    equipTags = VEHICLE_EQUIP_TAGS;
  }

  for (const [blkTag, locCode] of equipTags) {
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

  return w.toString();
}
