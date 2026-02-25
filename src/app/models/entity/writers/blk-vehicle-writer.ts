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
} from '../types';
import {
  BuildingBlockWriter,
  writeIdentity,
  writeYearTechMeta,
  writeMotionType,
  writeTransporters,
  writeArmorBlocks,
  writeInternalType,
  writeOmni,
  writeEngine,
  writeEquipmentByLocation,
  writeFluffBlocks,
  writeSource,
  writeTonnage,
  writeManualBV,
} from './building-block-writer';
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

  // 1. Identity: UnitType, Name, Model, mul id
  writeIdentity(w, entity, unitType);

  // 2. Year/Tech/Meta: year, originalBuildYear, type, role, quirks, weaponQuirks
  writeYearTechMeta(w, entity);

  // 3. motion_type
  writeMotionType(w, entity);

  // 4. transporters
  writeTransporters(w, entity);

  // 5. Movement: cruiseMP
  w.addBlock('cruiseMP', entity.walkMP());

  // 6. Engine: engine_type, clan_engine
  writeEngine(w, entity, ENGINE_TYPE_TO_CODE);

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
  } else {
    const armorLocs = entity instanceof VtolEntity ? [...VTOL_ARMOR_LOCS] : [...VEHICLE_ARMOR_LOCS];
    const armorInts: number[] = armorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
    w.addBlock('armor', ...armorInts);
  }

  // 11. Equipment per location
  let equipTags: [string, string][];
  if (entity instanceof GunEmplacementEntity) {
    equipTags = GE_EQUIP_TAGS;
  } else if (entity instanceof LargeSupportTankEntity) {
    equipTags = [...VEHICLE_EQUIP_TAGS, ...LST_EXTRA_EQUIP_TAGS];
  } else {
    equipTags = VEHICLE_EQUIP_TAGS;
  }

  writeEquipmentByLocation(w, entity, equipTags, encodeEquipmentLine);

  // 12. BAR rating (for support vehicles with BAR armor)
  if (entity instanceof SupportTankEntity) {
    w.addBlock('barrating', entity.barRating());
  }
  if (entity instanceof SupportVtolEntity) {
    w.addBlock('barrating', entity.barRating());
  }

  // 13. Support vehicle tech ratings
  if (entity instanceof SupportTankEntity || entity instanceof SupportVtolEntity) {
    if ((entity as any).structuralTechRating?.()) {
      w.addBlock('structural_tech_rating', (entity as any).structuralTechRating());
    }
    if ((entity as any).engineTechRating?.()) {
      w.addBlock('engine_tech_rating', (entity as any).engineTechRating());
    }
  }

  // 14. Fluff blocks
  writeFluffBlocks(w, entity.fluff());

  // 15. source
  writeSource(w, entity);

  // 16. tonnage
  writeTonnage(w, entity);

  // 17. Manual BV
  writeManualBV(w, entity);

  // 18. Omni turret weights (after tonnage, only for Omni vehicles)
  if (entity.omni()) {
    if (entity.baseChassisTurretWeight() > 0) {
      w.addBlock('baseChassisTurretWeight', entity.baseChassisTurretWeight());
    }
    if (entity.baseChassisTurret2Weight() > 0) {
      w.addBlock('baseChassisTurret2Weight', entity.baseChassisTurret2Weight());
    }
  }

  // 19. Fuel (support vehicles) / fuelType / controls / trailer / extra seats
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
