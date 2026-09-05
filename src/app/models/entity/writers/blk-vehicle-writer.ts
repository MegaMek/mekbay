// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { VehicleEntity } from '../entities/vehicle/vehicle-entity';
import { NavalEntity } from '../entities/vehicle/naval-entity';
import { VtolEntity } from '../entities/vehicle/vtol-entity';
import { LargeSupportTankEntity } from '../entities/vehicle/large-support-tank-entity';

import {
  BuildingBlockWriter,
  writeArmorBlocks,
  writeBlkPreamble,
  writeEngine,
  writeEquipmentByLocation,
  writeEmbeddedImages,
  writeFluffBlocks,
  writeInternalType,
  writeManualBV,
  writeOmni,
  writeSource,
  writeSupportVehicleBarRating,
  writeTonnage,
  writeTransporters,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import {
  LST_ARMOR_LOCS,
  ordinaryVehicleArmorLocations,
  superheavyVehicleArmorLocations,
  VTOL_ARMOR_LOCS,
} from '../parsers/blk-constants';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a VehicleEntity (or subclass) to BLK format.
 *
 * Block ordering matches MegaMek's BLKFile.getBlock() exactly.
 */
export function writeBlkVehicle(entity: VehicleEntity): string {
  const w = new BuildingBlockWriter();

  // ── Determine UnitType tag ──
  let unitType: string;
  if (entity instanceof LargeSupportTankEntity)       unitType = 'LargeSupportTank';
  else if (entity.isSupportVehicle())                 unitType = entity instanceof VtolEntity ? 'SupportVTOL' : 'SupportTank';
  else if (entity instanceof VtolEntity)              unitType = 'VTOL';
  else if (entity instanceof NavalEntity)             unitType = 'Tank';
  else                                                unitType = 'Tank';

  // 1-4. Identity / Year+Tech / motion_type / transporters
  writeBlkPreamble(w, entity, unitType);
  writeTransporters(w, entity);

  // 5. Movement: cruiseMP
  w.addBlock('cruiseMP', entity.originalWalkMP());

  // 6. Engine: engine_type, clan_engine
  writeEngine(w, entity);

  // 7. Armor: armor_type, armor_tech_rating, armor_tech_level
  writeArmorBlocks(w, entity);

  // 8. internal_type (only if not Standard)
  writeInternalType(w, entity);

  // 9. omni
  writeOmni(w, entity);

  // 10. Armor values array
  const armorMap = entity.armorValues();
  if (entity instanceof LargeSupportTankEntity) {
    // LST: Front, Front Right, Front Left, Rear Right, Rear Left, Rear[, Turret]
    const base: number[] = LST_ARMOR_LOCS.slice(0, 6).map(loc => armorMap.get(loc)?.front ?? 0);
    if (entity.hasTurret()) {
      base.push(armorMap.get('Turret')?.front ?? 0);
    }
    w.addBlock('armor', ...base);
  } else if (entity instanceof VtolEntity) {
    // VTOL: Front, Right, Left, Rear, Rotor[, Turret]
    const base: number[] = VTOL_ARMOR_LOCS.slice(0, 5).map(loc => armorMap.get(loc)?.front ?? 0);
    if (entity.hasTurret()) {
      base.push(armorMap.get('Turret')?.front ?? 0);
    }
    w.addBlock('armor', ...base);
  } else if (entity.isSuperHeavy() && !(entity instanceof VtolEntity)) {
    const count = 6 + (entity.hasDualTurret() ? 2 : entity.hasTurret() ? 1 : 0);
    const locations = superheavyVehicleArmorLocations(count).slice(0, count);
    w.addBlock('armor', ...locations.map(location => armorMap.get(location)?.front ?? 0));
  } else {
    const count = 4 + (entity.hasDualTurret() ? 2 : entity.hasTurret() ? 1 : 0);
    const locations = ordinaryVehicleArmorLocations(count).slice(0, count);
    w.addBlock('armor', ...locations.map(location => armorMap.get(location)?.front ?? 0));
  }

  // 11. Equipment per location
  let equipTags: [string, string][];
  if (entity instanceof LargeSupportTankEntity) {
    // LargeSupportTank: Body, Front, Front Right, Front Left, Rear Right, Rear Left, Rear[, Turret]
    equipTags = [
      ['Body Equipment',         'Body'],
      ['Front Equipment',        'Front'],
      ['Front Right Equipment',  'Front Right'],
      ['Front Left Equipment',   'Front Left'],
      ['Rear Right Equipment',   'Rear Right'],
      ['Rear Left Equipment',    'Rear Left'],
      ['Rear Equipment',         'Rear'],
    ];
    if (entity.hasTurret()) {
      equipTags.push(['Turret Equipment', 'Turret']);
    }
  } else if (entity.isSuperHeavy() && !(entity instanceof VtolEntity)) {
    // Superheavy Tank: Body, Front, Front Right, Front Left, Rear Right, Rear Left, Rear[, turrets]
    equipTags = [
      ['Body Equipment',         'Body'],
      ['Front Equipment',        'Front'],
      ['Front Right Equipment',  'Front Right'],
      ['Front Left Equipment',   'Front Left'],
      ['Rear Right Equipment',   'Rear Right'],
      ['Rear Left Equipment',    'Rear Left'],
      ['Rear Equipment',         'Rear'],
    ];
    if (entity.hasDualTurret()) {
      equipTags.push(['Rear Turret Equipment', 'Rear Turret']);
      equipTags.push(['Front Turret Equipment', 'Front Turret']);
    } else if (entity.hasTurret()) {
      equipTags.push(['Turret Equipment', 'Turret']);
    }
  } else {
    // Build dynamic list based on entity type and turret presence
    equipTags = [
      ['Body Equipment',   'Body'],
      ['Front Equipment',  'Front'],
      ['Right Equipment',  'Right'],
      ['Left Equipment',   'Left'],
      ['Rear Equipment',   'Rear'],
    ];
    if (entity instanceof VtolEntity) {
      equipTags.push(['Rotor Equipment', 'Rotor']);
    }
    if (entity.hasDualTurret()) {
      equipTags.push(['Rear Turret Equipment', 'Rear Turret']);
      equipTags.push(['Front Turret Equipment', 'Front Turret']);
    } else if (entity.hasTurret()) {
      equipTags.push(['Turret Equipment', 'Turret']);
    }
  }

  writeEquipmentByLocation(w, entity, equipTags, encodeEquipmentLine, true);

  // 12. BAR rating (only when the installed material is support-vehicle BAR armor)
  if (entity.isSupportVehicle()) writeSupportVehicleBarRating(w, entity);

  // 13. Support vehicle tech ratings
  if (entity.isSupportVehicle()) {
    w.addBlock('structural_tech_rating', entity.structuralTechRating());
    w.addBlock('engine_tech_rating', entity.engineTechRating());
  }

  // 14-17. Fluff / source / tonnage / Manual BV
  writeFluffBlocks(w, entity.fluff());
  writeSource(w, entity);
  writeTonnage(w, entity);
  writeManualBV(w, entity);

  // 18. Omni chassis weights (after tonnage, only for Omni vehicles)
  if (entity.omni()) {
    if (entity.baseChassisTurretWeight() >= 0) {
      const turretWeight = entity.baseChassisTurretWeight();
      w.addBlock('baseChassisTurretWeight', Number.isInteger(turretWeight) ? turretWeight.toFixed(1) : String(turretWeight));
    }
    if (entity.baseChassisTurret2Weight() >= 0) {
      const turretWeight2 = entity.baseChassisTurret2Weight();
      w.addBlock('baseChassisTurret2Weight', Number.isInteger(turretWeight2) ? turretWeight2.toFixed(1) : String(turretWeight2));
    }
  }

  // 18b. Sponson/Pintle turret weight (any Tank, not just omni)
  if (entity.baseChassisSponsonPintleWeight() >= 0) {
    const spw = entity.baseChassisSponsonPintleWeight();
    w.addBlock('baseChassisSponsonPintleWeight', Number.isInteger(spw) ? spw.toFixed(1) : String(spw));
  }

  // 18c. Fire control weight (support omni vehicles)
  if (entity.isSupportVehicle() && entity.omni()) {
    const fcw = entity.baseChassisFireConWeight();
    w.addBlock('baseChassisFireConWeight', Number.isInteger(fcw) ? fcw.toFixed(1) : String(fcw));
  }

  // 19. Fuel (support vehicles) / fuelType / controls / trailer / extra seats
  if (entity.isSupportVehicle()) {
    const fuelVal = entity.fuel();
    w.addBlock('fuel', Number.isInteger(fuelVal) ? fuelVal.toFixed(1) : String(fuelVal));
  }
  if (entity.fuelType()) {
    w.addBlock('fuelType', entity.fuelType());
  }
  if (entity.hasNoControlSystems()) {
    w.addBlock('hasNoControlSystems', 1);
  }
  if (entity.isTrailer()) {
    w.addBlock('trailer', 1);
  }
  if (entity.extraSeats() > 0) {
    w.addBlock('extra_seats', entity.extraSeats());
  }

  writeEmbeddedImages(w, entity);

  return w.toString(entity.nativeSourceTrailingNewlines || 2);
}
