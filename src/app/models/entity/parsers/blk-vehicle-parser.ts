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
  VALID_VEHICLE_MOTIVE_TYPES,
  armorTypeFromCode,
  locationArmor,
  parseMotiveType,
  resolveArmorEquipment,
  structureTypeFromCode,
} from '../types';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk, parseBlkEngine } from './blk-base-parser';
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

/** BLK armor array ordering per vehicle type (positional index → location name) */
const VEHICLE_ARMOR_LOCS = ['Front', 'Right', 'Left', 'Rear', 'Turret', 'Rear Turret'] as const;
const VTOL_ARMOR_LOCS = ['Front', 'Right', 'Left', 'Rear', 'Rotor', 'Turret'] as const;
const SUPERHEAVY_ARMOR_LOCS = ['Front', 'Front Right', 'Front Left', 'Rear Right', 'Rear Left', 'Rear', 'Turret', 'Rear Turret'] as const;
const LST_ARMOR_LOCS = ['Front', 'Front Right', 'Front Left', 'Rear Right', 'Rear Left', 'Rear', 'Turret'] as const;

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
  const NAVAL_MOTIVE_TYPES = new Set(['Naval', 'Submarine', 'Hydrofoil']);
  const unitType = bb.getFirstString('UnitType').trim();
  const rawMotiveType = bb.exists('motion_type') ? bb.getFirstString('motion_type') : '';
  let entity: VehicleEntity;

  switch (unitType) {
    case 'VTOL':              entity = new VtolEntity(); break;
    case 'SupportTank':       entity = new SupportTankEntity(); break;
    case 'SupportVTOL':       entity = new SupportVtolEntity(); break;
    case 'LargeSupportTank':  entity = new LargeSupportTankEntity(); break;
    case 'GunEmplacement':    entity = new GunEmplacementEntity(); break;
    default:
      entity = NAVAL_MOTIVE_TYPES.has(rawMotiveType) ? new NavalEntity() : new TankEntity();
      break;
  }

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Motive type ──
  if (rawMotiveType) {
    ctx.validateEnum('motion_type', rawMotiveType, VALID_VEHICLE_MOTIVE_TYPES, 'vehicle motive type');
    entity.motiveType.set(parseMotiveType(rawMotiveType));
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
    const result = parseBlkEngine(bb, entity, {
      engineTypeRequired: true,
      includeHeatSinks: false,
    });
    if (result) entity.mountedEngine.set(result.mountedEngine);
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
  if (bb.exists('baseChassisSponsonPintleWeight')) {
    entity.baseChassisSponsonPintleWeight.set(bb.getFirstDouble('baseChassisSponsonPintleWeight'));
  }
  if ((entity instanceof SupportTankEntity || entity instanceof SupportVtolEntity) && bb.exists('baseChassisFireConWeight')) {
    (entity as SupportTankEntity | SupportVtolEntity).baseChassisFireConWeight.set(bb.getFirstDouble('baseChassisFireConWeight'));
  }

  // ── Fuel ──
  if (bb.exists('fuelType')) {
    const fuelType = bb.getFirstString('fuelType');
    ctx.validateEnum('fuelType', fuelType, VALID_FUEL_TYPES, 'fuel type');
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
    } else if (entity instanceof LargeSupportTankEntity) {
      // LST: Front, Front Right, Front Left, Rear Right, Rear Left, Rear[, Turret]
      for (let i = 0; i < LST_ARMOR_LOCS.length && i < ints.length; i++) {
        armorMap.set(LST_ARMOR_LOCS[i], locationArmor(ints[i]));
      }
      if (ints.length >= 7 && !entity.hasTurret()) {
        entity.hasTurret.set(true);
      }
    } else if (entity instanceof VtolEntity) {
      // VTOL: Front, Right, Left, Rear, Rotor[, Turret]
      for (let i = 0; i < VTOL_ARMOR_LOCS.length && i < ints.length; i++) {
        armorMap.set(VTOL_ARMOR_LOCS[i], locationArmor(ints[i]));
      }
      // Infer turret from armor array length (6 = has chin turret)
      if (ints.length >= 6 && !entity.hasTurret()) {
        entity.hasTurret.set(true);
      }
    } else if (entity.isSuperHeavy() && !(entity instanceof VtolEntity)) {
      // Superheavy Tank: Front, Front Right, Front Left, Rear Right, Rear Left, Rear[, Turret[, Rear Turret]]
      for (let i = 0; i < SUPERHEAVY_ARMOR_LOCS.length && i < ints.length; i++) {
        armorMap.set(SUPERHEAVY_ARMOR_LOCS[i], locationArmor(ints[i]));
      }
      if (ints.length >= 7 && !entity.hasTurret()) {
        entity.hasTurret.set(true);
      }
      if (ints.length >= 8 && !entity.hasDualTurret()) {
        entity.hasDualTurret.set(true);
      }
    } else {
      // Tank: Front, Right, Left, Rear[, Turret[, Rear Turret]]
      for (let i = 0; i < VEHICLE_ARMOR_LOCS.length && i < ints.length; i++) {
        armorMap.set(VEHICLE_ARMOR_LOCS[i], locationArmor(ints[i]));
      }
      // Infer turret presence from armor array length
      if (ints.length >= 5 && !entity.hasTurret()) {
        entity.hasTurret.set(true);
      }
      if (ints.length >= 6 && !entity.hasDualTurret()) {
        entity.hasDualTurret.set(true);
      }
    }

    entity.armorValues.set(armorMap);
  }

  // ── Internal Structure type ──
  if (bb.exists('internal_type')) {
    const isCode = bb.getFirstInt('internal_type');
    entity.rawInternalTypeCode.set(isCode);
    entity.structureType.set(structureTypeFromCode(isCode));
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

  // ── Support vehicle tech ratings and fuel ──
  if (entity instanceof SupportTankEntity || entity instanceof SupportVtolEntity) {
    const sv = entity as SupportTankEntity | SupportVtolEntity;
    if (bb.exists('structural_tech_rating')) {
      sv.structuralTechRating.set(bb.getFirstInt('structural_tech_rating'));
    }
    if (bb.exists('engine_tech_rating')) {
      sv.engineTechRating.set(bb.getFirstInt('engine_tech_rating'));
    }
    if (bb.exists('fuel')) {
      sv.fuel.set(parseFloat(bb.getDataAsString('fuel')[0] || '0'));
    }
  }

  // ── Equipment per location ──
  let equipTags: [string, string][];
  if (entity instanceof GunEmplacementEntity) {
    equipTags = GE_EQUIP_TAGS;
  } else if (entity instanceof LargeSupportTankEntity || (entity.isSuperHeavy() && !(entity instanceof VtolEntity))) {
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
      const resolved = ctx.resolveEquipment(parsed.name, blkTag);

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: locCode,
        rearMounted: parsed.rearMounted,
        turretMounted: locCode === 'Turret' || locCode === 'Front Turret' || locCode === 'Rear Turret',
        turretType: parsed.turretType,
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
