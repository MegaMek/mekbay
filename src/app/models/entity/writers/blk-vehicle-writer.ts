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
  BuildingBlockWriter,
  writeArmorBlocks,
  writeBlkPreamble,
  writeEngine,
  writeEquipmentByLocation,
  writeFluffBlocks,
  writeInternalType,
  writeManualBV,
  writeOmni,
  writeSource,
  writeTonnage,
  writeTransporters,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import {
  GE_EQUIP_TAGS,
  LST_ARMOR_LOCS,
  SUPERHEAVY_ARMOR_LOCS,
  VEHICLE_ARMOR_LOCS,
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
  if (entity instanceof GunEmplacementEntity)        unitType = 'GunEmplacement';
  else if (entity instanceof LargeSupportTankEntity)  unitType = 'LargeSupportTank';
  else if (entity instanceof SupportVtolEntity)      unitType = 'SupportVTOL';
  else if (entity instanceof SupportTankEntity)       unitType = 'SupportTank';
  else if (entity instanceof VtolEntity)              unitType = 'VTOL';
  else if (entity instanceof NavalEntity)             unitType = 'Tank';
  else                                                unitType = 'Tank';

  // 1-4. Identity / Year+Tech / motion_type / transporters
  writeBlkPreamble(w, entity, unitType);
  writeTransporters(w, entity);

  // 5. Movement: cruiseMP
  w.addBlock('cruiseMP', entity.walkMP());

  // 6. Engine: engine_type, clan_engine
  writeEngine(w, entity);

  // 7. Armor: armor_type, armor_tech_rating, armor_tech_level
  if (!(entity instanceof GunEmplacementEntity)) {
    writeArmorBlocks(w, entity);
  }

  // 8. internal_type (only if not Standard)
  writeInternalType(w, entity);

  // 9. omni
  writeOmni(w, entity);

  // 10. Armor values array
  const armorMap = entity.armorValues();
  if (entity instanceof GunEmplacementEntity) {
    const turretArmor = armorMap.get('Turret')?.front ?? 0;
    w.addBlock('armor', turretArmor);
  } else if (entity instanceof LargeSupportTankEntity) {
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
    // Superheavy Tank: Front, Front Right, Front Left, Rear Right, Rear Left, Rear[, Turret[, Rear Turret]]
    const base: number[] = SUPERHEAVY_ARMOR_LOCS.slice(0, 6).map(loc => armorMap.get(loc)?.front ?? 0);
    if (entity.hasTurret()) {
      base.push(armorMap.get('Turret')?.front ?? 0);
    }
    if (entity.hasDualTurret()) {
      base.push(armorMap.get('Rear Turret')?.front ?? 0);
    }
    w.addBlock('armor', ...base);
  } else {
    // Tank: Front, Right, Left, Rear[, Turret[, Rear Turret]]
    const base: number[] = VEHICLE_ARMOR_LOCS.slice(0, 4).map(loc => armorMap.get(loc)?.front ?? 0);
    if (entity.hasTurret()) {
      base.push(armorMap.get('Turret')?.front ?? 0);
    }
    if (entity.hasDualTurret()) {
      base.push(armorMap.get('Rear Turret')?.front ?? 0);
    }
    w.addBlock('armor', ...base);
  }

  // 11. Equipment per location
  let equipTags: [string, string][];
  if (entity instanceof GunEmplacementEntity) {
    equipTags = GE_EQUIP_TAGS;
  } else if (entity instanceof LargeSupportTankEntity) {
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

  // 12. BAR rating (for support vehicles, only when explicitly set in original)
  if (entity instanceof SupportTankEntity && entity.barRating() >= 0) {
    w.addBlock('barrating', entity.barRating());
  }
  if (entity instanceof SupportVtolEntity && entity.barRating() >= 0) {
    w.addBlock('barrating', entity.barRating());
  }

  // 13. Support vehicle tech ratings
  if (entity instanceof SupportTankEntity || entity instanceof SupportVtolEntity) {
    const sv = entity as SupportTankEntity | SupportVtolEntity;
    w.addBlock('structural_tech_rating', sv.structuralTechRating());
    w.addBlock('engine_tech_rating', sv.engineTechRating());
  }

  // 14-17. Fluff / source / tonnage / Manual BV
  writeFluffBlocks(w, entity.fluff());
  writeSource(w, entity);
  writeTonnage(w, entity);
  writeManualBV(w, entity);

  // 18. Omni chassis weights (after tonnage, only for Omni vehicles)
  if (entity.omni()) {
    if (entity.baseChassisTurretWeight() >= 0) {
      const tw = entity.baseChassisTurretWeight();
      w.addBlock('baseChassisTurretWeight', Number.isInteger(tw) ? tw.toFixed(1) : String(tw));
    }
    if (entity.baseChassisTurret2Weight() >= 0) {
      const tw2 = entity.baseChassisTurret2Weight();
      w.addBlock('baseChassisTurret2Weight', Number.isInteger(tw2) ? tw2.toFixed(1) : String(tw2));
    }
  }

  // 18b. Sponson/Pintle turret weight (any Tank, not just omni)
  if (entity.baseChassisSponsonPintleWeight() >= 0) {
    const spw = entity.baseChassisSponsonPintleWeight();
    w.addBlock('baseChassisSponsonPintleWeight', Number.isInteger(spw) ? spw.toFixed(1) : String(spw));
  }

  // 18c. Fire control weight (support omni vehicles)
  if ((entity instanceof SupportTankEntity || entity instanceof SupportVtolEntity) && entity.omni()) {
    const fcw = entity.baseChassisFireConWeight();
    w.addBlock('baseChassisFireConWeight', Number.isInteger(fcw) ? fcw.toFixed(1) : String(fcw));
  }

  // 19. Fuel (support vehicles) / fuelType / controls / trailer / extra seats
  if (entity instanceof SupportTankEntity || entity instanceof SupportVtolEntity) {
    const sv = entity as SupportTankEntity | SupportVtolEntity;
    const fuelVal = sv.fuel();
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

  return w.toString();
}
