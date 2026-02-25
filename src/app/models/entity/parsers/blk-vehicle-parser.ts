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
import { TankEntity } from '../entities/vehicle/tank-entity';
import { NavalEntity } from '../entities/vehicle/naval-entity';
import { VtolEntity } from '../entities/vehicle/vtol-entity';
import { SupportTankEntity } from '../entities/vehicle/support-tank-entity';
import { SupportVtolEntity } from '../entities/vehicle/support-vtol-entity';
import { LargeSupportTankEntity } from '../entities/vehicle/large-support-tank-entity';
import { GunEmplacementEntity } from '../entities/vehicle/gun-emplacement-entity';
import {
  ARMOR_TYPE_FROM_CODE,
  ENGINE_TYPE_FROM_CODE,
  LocationArmor,
  VALID_FUEL_TYPES,
  VALID_VEHICLE_MOTION_TYPES,
  armorTypeFromCode,
  engineTypeFromCode,
  locationArmor,
  resolveArmorEquipment,
} from '../types';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// Equipment location tags for vehicles
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

/** Large Support Tank additional locations */
const LST_EXTRA_EQUIP_TAGS: [string, string][] = [
  ['Front Right Equipment',     'Front Right'],
  ['Front Left Equipment',      'Front Left'],
  ['Rear Right Equipment',      'Rear Right'],
  ['Rear Left Equipment',       'Rear Left'],
];

/** Gun Emplacement uses a specific tag */
const GE_EQUIP_TAGS: [string, string][] = [
  ['Guns Equipment',  'Turret'],
  ['Body Equipment',  'Body'],
];

/** Armor location order for standard vehicles (Front/Right/Left/Rear/Turret/Rotor) */
const VEHICLE_ARMOR_LOCS = ['Front', 'Right', 'Left', 'Rear', 'Turret', 'Rear Turret'] as const;
const VTOL_ARMOR_LOCS = ['Front', 'Right', 'Left', 'Rear', 'Rotor', 'Turret'] as const;

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a Tank, Naval, VTOL, SupportTank, SupportVTOL,
 * LargeSupportTank, or GunEmplacement entity.
 */
export function parseBlkVehicle(bb: BuildingBlock, ctx: ParseContext): VehicleEntity {
  resetMountIdCounter();

  // ── Determine entity type ──
  // MegaMek stores naval vehicles as UnitType=Tank; we promote them based on motion_type.
  const NAVAL_MOTION_TYPES = new Set(['Naval', 'Submarine', 'Hydrofoil']);
  const unitType = bb.getFirstString('UnitType').trim();
  const motionType = bb.exists('motion_type') ? bb.getFirstString('motion_type') : '';
  let entity: VehicleEntity;

  switch (unitType) {
    case 'VTOL':              entity = new VtolEntity(); break;
    case 'SupportTank':       entity = new SupportTankEntity(); break;
    case 'SupportVTOL':       entity = new SupportVtolEntity(); break;
    case 'LargeSupportTank':  entity = new LargeSupportTankEntity(); break;
    case 'GunEmplacement':    entity = new GunEmplacementEntity(); break;
    default:
      entity = NAVAL_MOTION_TYPES.has(motionType) ? new NavalEntity() : new TankEntity();
      break;
  }

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Motion type ──
  if (motionType) {
    ctx.validateEnum('motion_type', motionType, VALID_VEHICLE_MOTION_TYPES, 'vehicle motion type');
    entity.motionType.set(motionType);
  }

  // ── Movement ──
  if (bb.exists('cruiseMP')) {
    const mp = bb.getFirstInt('cruiseMP');
    ctx.validateNonNegativeInt('cruiseMP', mp);
    entity.walkMP.set(mp);
  }

  // ── Engine ──
  if (bb.exists('engine_type')) {
    const code = bb.getFirstInt('engine_type');
    ctx.validateCode('engine_type', code, ENGINE_TYPE_FROM_CODE);
    entity.engineType.set(engineTypeFromCode(code));
  }

  // ── Turret ──
  const turretTag = bb.exists('Turret');
  const turret2Tag = bb.exists('Turret2');

  if (turretTag) {
    const turretCount = bb.getFirstInt('Turret');
    if (turretCount >= 0) {
      entity.hasTurret.set(true);
    }
  }
  if (turret2Tag) {
    entity.hasDualTurret.set(true);
    entity.hasTurret.set(true);
  }

  if (bb.exists('baseChassisTurretWeight')) {
    entity.baseChassisTurretWeight.set(bb.getFirstDouble('baseChassisTurretWeight'));
  }
  if (bb.exists('baseChassisTurret2Weight')) {
    entity.baseChassisTurret2Weight.set(bb.getFirstDouble('baseChassisTurret2Weight'));
  }

  // ── Fuel ──
  if (bb.exists('fuel_type')) {
    const fuelType = bb.getFirstString('fuel_type');
    ctx.validateEnum('fuel_type', fuelType, VALID_FUEL_TYPES, 'fuel type');
    entity.fuelType.set(fuelType);
  }

  // ── Trailer / No Control Systems ──
  if (bb.exists('trailer')) {
    entity.isTrailer.set(bb.getFirstInt('trailer') === 1);
  }
  if (bb.exists('hasNoControlSystems')) {
    entity.hasNoControlSystems.set(bb.getFirstInt('hasNoControlSystems') === 1);
  }

  // ── Extra seats ──
  if (bb.exists('extraSeats')) {
    entity.extraSeats.set(bb.getFirstInt('extraSeats'));
  }

  // ── Armor ──
  if (bb.exists('armor_type')) {
    const armorCode = bb.getFirstInt('armor_type');
    ctx.validateCode('armor_type', armorCode, ARMOR_TYPE_FROM_CODE);
    entity.armorType.set(armorTypeFromCode(armorCode));
  }
  if (bb.exists('armor_tech')) {
    const code = bb.getFirstInt('armor_tech');
    if (code === 1) entity.armorTechBase.set('Clan');
    else if (code === 2) entity.armorTechBase.set('Mixed');
    else if (code !== 0) ctx.warn('armor_tech', `Unknown armor_tech code: ${code}`);
  }
  entity.armorEquipment.set(
    resolveArmorEquipment(entity.armorType(), entity.armorTechBase() === 'Clan', ctx.equipmentDb)
  );

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');
    const armorMap = new Map<string, LocationArmor>();

    if (entity instanceof GunEmplacementEntity) {
      // Gun emplacements: single Turret armor value
      if (ints.length > 0) armorMap.set('Turret', locationArmor(ints[0]));
    } else {
      // Determine armor layout
      const armorLocs = entity instanceof VtolEntity ? [...VTOL_ARMOR_LOCS] : [...VEHICLE_ARMOR_LOCS];

      for (let i = 0; i < armorLocs.length && i < ints.length; i++) {
        armorMap.set(armorLocs[i], locationArmor(ints[i]));
      }
    }

    entity.armorValues.set(armorMap);
  }

  // ── Internal Structure type ──
  if (bb.exists('internal_type')) {
    const isCode = bb.getFirstInt('internal_type');
    if (isCode === 1) entity.structureType.set('Endo Steel');
    else if (isCode === 2) entity.structureType.set('Composite');
    else if (isCode === 3) entity.structureType.set('Reinforced');
  }

  // ── Gun Emplacement specifics ──
  if (entity instanceof GunEmplacementEntity) {
    if (bb.exists('buildingCF')) {
      entity.buildingCF.set(bb.getFirstInt('buildingCF'));
    }
  }

  // ── Support vehicle BAR rating ──
  if (entity instanceof SupportTankEntity && bb.exists('barrating')) {
    entity.barRating.set(bb.getFirstInt('barrating'));
  }
  if (entity instanceof SupportVtolEntity && bb.exists('barrating')) {
    entity.barRating.set(bb.getFirstInt('barrating'));
  }

  // ── Equipment per location ──
  let equipTags: [string, string][];
  if (entity instanceof GunEmplacementEntity) {
    equipTags = GE_EQUIP_TAGS;
  } else if (entity instanceof LargeSupportTankEntity) {
    equipTags = [...VEHICLE_EQUIP_TAGS, ...LST_EXTRA_EQUIP_TAGS];
  } else {
    equipTags = VEHICLE_EQUIP_TAGS;
  }

  for (const [blkTag, locCode] of equipTags) {
    if (!bb.exists(blkTag)) continue;
    const lines = bb.getDataAsString(blkTag);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = ctx.resolveEquipment(parsed.name, techBase, blkTag);

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: locCode,
        rearMounted: parsed.rearMounted,
        turretMounted: locCode === 'Turret' || locCode === 'Front Turret' || locCode === 'Rear Turret',
        omniPodMounted: parsed.omniPod,
        isNewBay: parsed.isNewBay,
        armored: false,
        size: parsed.size,
        facing: parsed.facing,
      });
    }
  }

  return entity;
}
