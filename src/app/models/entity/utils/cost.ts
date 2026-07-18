/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { AmmoEquipment, ArmorEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import type { ProtoMekEntity } from '../entities/protomek/protomek-entity';
import type { SupportVehicle } from '../entities/support-vehicle';
import type { VehicleEntity } from '../entities/vehicle/vehicle-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { getEquipmentEngineWeight } from './equipment-engine-weight';
import { isVehicleEntity } from './entity-type-guards';
import { getFireControlWeaponCost } from './fire-control';
import { getTargetingComputerRelevantWeight } from './targeting-computer';

const POWER_GENERATOR_BASE_COST: Readonly<Record<string, number>> = {
  STEAM: 4000,
  SOLAR: 8000,
  FISSION: 15000,
  FUSION: 10000,
  COMBUSTION_LIQUID: 5000,
  COMBUSTION_SOLID: 5000,
  FUEL_CELL: 7000,
  EXTERNAL_PCMT: 5000,
  EXTERNAL: 5000,
};

export interface EntityCostOptions {
  /** Excludes ammunition other than coolant pods. MegaMek's exported cost uses false. */
  readonly ignoreAmmo?: boolean;
}

/**
 * Calculates the construction cost represented by canonical entity state.
 *
 * Equipment prices come from the equipment database through
 * `EntityMountedEquipment.getCost()`. That method only calculates a price
 * when the database marks the equipment cost as `variable`; fixed prices are
 * returned unchanged.
 */
export function calculateEntityCost(
  entity: BaseEntity,
  options: EntityCostOptions = {},
): number {
  const ignoreAmmo = options.ignoreAmmo ?? false;
  const equipmentCost = calculateMountedEquipmentCost(entity, ignoreAmmo);

  // MegaMek prices a handheld weapon's equipment once as its structure and
  // once as its equipment payload.
  if (entity.entityType === 'HandheldWeapon') return equipmentCost * 2;
  if (entity.entityType === 'ProtoMek') {
    return calculateProtoMekCost(entity as ProtoMekEntity, equipmentCost);
  }
  if (isVehicleEntity(entity)) return calculateVehicleCost(entity, equipmentCost);

  // Family system calculators are layered on this shared equipment total.
  // Until a family contributes construction systems, this remains a useful
  // domain value instead of duplicating database prices in exporters.
  return equipmentCost;
}

/** Mirrors MegaMek's ProtoMekCostCalculator. */
function calculateProtoMekCost(entity: ProtoMekEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const engine = entity.mountedEngine();
  const armorCostPerPoint = entity.uniformArmor()?.armor.cost;
  if (armorCostPerPoint === undefined || armorCostPerPoint === 'variable') {
    throw new Error('Unable to calculate ProtoMek armor cost');
  }

  const energyWeaponHeat = entity.mountedWeapons()
    .filter(mount => mount.equipment.hasFlag('F_ENERGY'))
    .reduce((heat, mount) => heat + mount.equipment.heat, 0);

  const additiveCosts = [
    tonnage >= 10 ? 800_000 : 500_000,
    75_000,
    2_000 * tonnage,
    2_000 * tonnage,
    (entity.isGlider() ? 600 : entity.isQuad() ? 500 : 400) * tonnage,
    2 * 180 * tonnage,
    540 * tonnage,
    engine.installed ? (5_000 * tonnage * engine.rating) / 75 : 0,
    tonnage * entity.jumpMP() ** 2 * 200,
    2_000 * energyWeaponHeat,
    entity.totalArmorPoints() * armorCostPerPoint,
    equipmentCost,
  ].reduce((total, cost) => total + Math.max(0, cost), 0);

  return additiveCosts * (1 + tonnage / 100);
}

/** Mirrors CostCalculator.getWeaponsAndEquipmentCost's mounted-item rules. */
export function calculateMountedEquipmentCost(
  entity: BaseEntity,
  ignoreAmmo = false,
): number {
  let total = 0;

  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment || equipment instanceof ArmorEquipment) continue;
    if (ignoreAmmo && equipment instanceof AmmoEquipment
      && equipment.ammoType !== 'COOLANT_POD') continue;
    if (equipment.hasFlag('F_BA_MANIPULATOR')) continue;
    if (entity.entityType === 'ProtoMek' && equipment.hasFlag('F_EI_INTERFACE')) continue;

    const cost = mount.getCost(entity);
    if (cost === undefined) {
      throw new Error(`Unable to calculate variable cost for ${equipment.id}`);
    }

    // Java casts every mounted item's double cost to long before summing.
    total += Math.trunc(cost);
  }

  if (!isLargeCraft(entity)) total += calculateTransporterCost(entity);

  return total;
}

function calculateTransporterCost(entity: BaseEntity): number {
  let total = 0;
  for (const transporter of entity.transporters()) {
    if (transporter.kind !== 'bay') continue;
    const type = transporter.configuration.type;
    const capacity = Math.trunc(transporter.capacity);
    switch (type) {
      case 'standard-seats': total += 100 * capacity; break;
      case 'pillion-seats': total += 10 * capacity; break;
      case 'ejection-seats': total += 25000 * capacity; break;
      case 'crew-quarters':
      case 'second-class-quarters': total += 15000 * capacity; break;
      case 'steerage-quarters': total += 5000 * capacity; break;
      case 'first-class-quarters': total += 30000 * capacity; break;
      case 'mek': total += 20000 * capacity; break;
      case 'fighter': total += (20000 * capacity) + (transporter.configuration.arts ? 1000000 : 0); break;
      case 'small-craft': total += 20000 * capacity; break;
      case 'light-vehicle':
      case 'heavy-vehicle': total += 10000 * capacity; break;
      case 'super-heavy-vehicle': total += 20000 * capacity; break;
      case 'protomek': total += 10000 * Math.ceil(transporter.capacity); break;
      case 'infantry': total += 15000 * Math.ceil(transporter.capacity); break;
      case 'battle-armor': {
        const squadSize = transporter.configuration.techBase === 'Clan'
          ? 5 : transporter.configuration.comStar ? 6 : 4;
        total += 15000 * Math.ceil(transporter.capacity * 2 * squadSize);
        break;
      }
      case 'liquid-cargo': total += 100 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'insulated-cargo': total += 250 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'refrigerated-cargo': total += 200 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'livestock-cargo': total += 2500 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
    }
    const isSeatsOrQuarters = type === 'standard-seats' || type === 'pillion-seats'
      || type === 'ejection-seats' || type === 'crew-quarters' || type === 'steerage-quarters'
      || type === 'second-class-quarters' || type === 'first-class-quarters';
    if (!isSeatsOrQuarters) total += 1000 * transporter.doors;
  }
  return total;
}

function isLargeCraft(entity: BaseEntity): boolean {
  return entity.entityType === 'SmallCraft' || entity.entityType === 'DropShip'
    || entity.entityType === 'JumpShip' || entity.entityType === 'WarShip'
    || entity.entityType === 'SpaceStation';
}

/** Resolves one mount's database-backed fixed or entity-dependent variable cost. */
export function getEquipmentCost(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): number | undefined {
  const equipment = mount.equipment;
  if (!equipment) return undefined;
  if (equipment.cost !== 'variable') return equipment.cost;

  const tonnage = entity.tonnage();
  let cost: number | undefined;
  if (equipment.hasFlag('F_POWER_GENERATOR')) {
    const generatorType = equipment.id.slice(0, -' PowerGenerator'.length);
    const baseCost = POWER_GENERATOR_BASE_COST[generatorType];
    cost = baseCost === undefined ? undefined : baseCost * (mount.size ?? 1);
  } else if (equipment.hasFlag('F_CARGO_LIFTER')) {
    return 250 * Math.ceil((mount.size ?? 1) * 2);
  } else if (equipment.hasFlag('F_DRONE_CARRIER_CONTROL') || equipment.hasFlag('F_MASH')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_MASC') && equipment.hasFlag('F_BA_EQUIPMENT')) {
    cost = entity.runMP() * 75000;
  } else if (equipment.hasFlag('F_FLOTATION_HULL')
    || equipment.hasFlag('F_OFF_ROAD')
    || (equipment.hasFlag('F_ENVIRONMENTAL_SEALING') && entity.entityType !== 'Mek')) {
    cost = 0;
  } else if (equipment.hasFlag('F_JET_BOOSTER') || equipment.hasFlag('S_SUPERCHARGER')) {
    cost = entity.isSupportVehicle()
      ? getEquipmentEngineWeight(entity) * 10000
      : entity.mountedEngine().rating * 10000;
  } else if (equipment.hasFlag('F_MASC') && entity.entityType === 'ProtoMek') {
    cost = Math.round(entity.mountedEngine().rating * 1000 * tonnage * 0.025);
  } else if (equipment.hasFlag('F_MASC')) {
    const mascTonnage = Math.round(tonnage / (equipment.techBase === 'Clan' ? 25 : 20));
    cost = entity.mountedEngine().rating * mascTonnage * 1000;
  } else if (equipment.hasFlag('F_TARGETING_COMPUTER')) {
    const relevantWeight = getTargetingComputerRelevantWeight(entity);
    const divider = equipment.techBase === 'IS' ? 4 : 5;
    cost = relevantWeight === undefined ? undefined : 10000 * Math.ceil(relevantWeight / divider);
  } else if (equipment.hasFlag('F_ARMORED_MOTIVE_SYSTEM')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 100000;
  } else if (equipment.hasFlag('F_ENVIRONMENTAL_SEALING')) {
    cost = entity.entityType === 'Mek' ? 225 * tonnage : 0;
  } else if (equipment.hasFlag('F_LIMITED_AMPHIBIOUS') || equipment.hasFlag('F_FULLY_AMPHIBIOUS')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_DUNE_BUGGY')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : 10 * equipmentTonnage * equipmentTonnage;
  } else if (equipment.hasFlag('F_DRONE_OPERATING_SYSTEM')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 10000) + 5000;
  } else if (equipment.hasAnyFlag(['F_HEAD_TURRET', 'F_SHOULDER_TURRET', 'F_QUAD_TURRET'])) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_SPONSON_TURRET')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 4000;
  } else if (equipment.hasFlag('F_PINTLE_TURRET')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 1000;
  } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_HATCHET')) {
    cost = Math.ceil(tonnage / 15) * 5000;
  } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_SWORD')) {
    cost = nextHalfTon(tonnage / 20) * 10000;
  } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_RETRACTABLE_BLADE')) {
    cost = (1 + Math.ceil(tonnage / 20)) * 10000;
  } else if (equipment.hasFlag('F_TRACKS')) {
    const multiplier = equipment.hasFlag('S_QUADVEE_WHEELS') ? 750 : 500;
    cost = Math.ceil((multiplier * entity.mountedEngine().rating * tonnage) / 75);
  } else if (equipment.hasFlag('F_TALON')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : Math.ceil(equipmentTonnage * 300);
  } else if (equipment.hasFlag('F_SPIKES')) {
    cost = Math.ceil(tonnage * 50);
  } else if (equipment.hasFlag('F_PARTIAL_WING')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : Math.ceil(equipmentTonnage * 50000);
  } else if (equipment.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM')) {
    cost = Math.ceil(tonnage * (entity.locationIsLeg(mount.location) ? 700 : 500));
  } else if (equipment.hasFlag('F_HAND_WEAPON') && equipment.hasFlag('S_CLAW')) {
    cost = Math.ceil(tonnage * 200);
  } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_LANCE')) {
    cost = Math.ceil(tonnage * 150);
  } else if (equipment.hasFlag('F_MECHANICAL_JUMP_BOOSTER')) {
    if (entity.weightClass() === 'Assault') cost = 300000;
    else if (entity.weightClass() === 'Heavy') cost = 150000;
    else if (entity.weightClass() === 'Medium') cost = 75000;
    else cost = 50000;
  } else if (equipment.hasFlag('F_LADDER')) {
    cost = (mount.size ?? 1) * 5;
  } else if (equipment.hasFlag('F_COMMUNICATIONS')) {
    cost = (mount.size ?? 1) * 10000;
  } else if (equipment.hasFlag('F_BASIC_FIRE_CONTROL') || equipment.hasFlag('F_ADVANCED_FIRE_CONTROL')) {
    const weaponCost = getFireControlWeaponCost(entity);
    cost = weaponCost === undefined
      ? undefined
      : weaponCost * (equipment.hasFlag('F_BASIC_FIRE_CONTROL') ? 0.05 : 0.1);
  } else if (equipment.hasFlag('F_LIGHT_SAIL')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_NAVAL_C3')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 100000;
  } else if (equipment.hasFlag('F_SRCS')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 10000) + 5000;
  } else if (equipment.hasFlag('F_SASRCS')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 12500) + 6250;
  } else if (equipment.hasFlag('F_CASPAR')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 50000) + 500000;
  } else if (equipment.hasFlag('F_CASPAR_II')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 20000) + 50000;
  } else if (equipment.hasFlag('F_ATAC')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 100000;
  } else if (equipment.hasFlag('F_DTAC')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 50000;
  } else if (equipment.hasFlag('F_RAM_PLATE')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_DAMAGE_INTERRUPT_CIRCUIT')) {
    cost = 150 * Math.max(1, entity.crewSlotCount());
  } else if (equipment.hasFlag('F_ANTI_MEK_GEAR')) {
    // Anti-Mek training is represented by Infantry's price multiplier;
    // the equipment marker has no independent additive cost.
    cost = 0;
  }

  if (cost === undefined || !mount.armored) return cost;
  const criticalSlots = equipment.getNumCriticalSlots(entity, mount.size ?? 1);
  return criticalSlots === undefined ? undefined : cost + (150000 * criticalSlots);
}

function nextHalfTon(tonnage: number): number {
  return Math.ceil(tonnage * 2) / 2;
}

/** Mirrors MegaMek's CombatVehicleCostCalculator for support and combat vehicles. */
function calculateVehicleCost(entity: VehicleEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const supportVehicle = entity.isSupportVehicle();
  const engine = entity.mountedEngine();
  const engineCost = !engine.installed ? 0 : supportVehicle
    ? 5000 * getEquipmentEngineWeight(entity) * engine.descriptor().svCostMultiplier
    : (engine.baseCost * engine.rating * tonnage) / 75;
  const armorCost = calculateVehicleArmorCost(entity);

  let cost: number;
  if (entity.isSupportVehicle()) {
    const chassisCost = 2500 * getSupportVehicleStructureWeight(entity)
      * getSupportVehicleChassisCostMultiplier(entity);
    const structuralTechMultiplier = 0.5 + (entity.structuralTechRating() * 0.25);
    cost = (chassisCost + engineCost + armorCost) * structuralTechMultiplier;
  } else {
    const structureDivisor = entity.isSuperHeavy()
      && entity.motiveType() !== 'Naval'
      && entity.motiveType() !== 'Submarine' ? 5 : 10;
    const structureCost = nextHalfTon(tonnage / structureDivisor) * 10000;
    const controlCost = entity.hasNoControlSystems() ? 0 : nextHalfTon(tonnage * 0.05) * 10000;
    cost = engineCost + armorCost + structureCost + controlCost;
  }

  cost += calculatePowerAmplifierWeight(entity) * 20000;
  cost += Math.max(0, calculateVehicleHeatSinkRequirement(entity) - engine.weightFreeHeatSinks) * 2000;
  cost += calculateVehicleTurretWeight(entity) * 5000;
  cost += equipmentCost + (entity.extraSeats() * 100);

  if (!supportVehicle) {
    const liftTonnage = ['Hover', 'Hydrofoil', 'VTOL', 'Submarine', 'WiGE'].includes(entity.motiveType())
      ? Math.ceil(tonnage / 5) / 2 : 0;
    cost += liftTonnage * (entity.motiveType() === 'VTOL' ? 40000 : 20000);
  }

  if (entity.omni()) cost *= 1.25;
  cost *= getVehicleTonnageMultiplier(entity);
  if (!supportVehicle) {
    if (hasAnyEquipmentFlag(entity, ['F_FLOTATION_HULL', 'F_ENVIRONMENTAL_SEALING'])) cost *= 1.25;
    if (hasAnyEquipmentFlag(entity, ['F_OFF_ROAD'])) cost *= 1.2;
  }
  return Math.round(cost);
}

function calculateVehicleArmorCost(entity: VehicleEntity): number {
  let total = 0;
  for (const [location, mountedArmor] of entity.armorByLocation()) {
    const points = entity.armorValues().get(location);
    const armorPoints = (points?.front ?? 0) + (points?.rear ?? 0);
    if (armorPoints <= 0) continue;
    const armor = mountedArmor.armor;
    if (armor.hasFlag('F_SUPPORT_VEE_BAR_ARMOR')) {
      const cost = armor.cost;
      if (cost === 'variable') throw new Error(`Unable to calculate armor cost for ${armor.id}`);
      total += armorPoints * cost;
    } else {
      const cost = armor.cost;
      if (cost === 'variable') throw new Error(`Unable to calculate armor cost for ${armor.id}`);
      const armorWeight = standardRound(armorPoints / (16 * armor.pptMultiplier), entity);
      total += armorWeight * cost;
    }
  }
  return total;
}

const SUPPORT_VEHICLE_STRUCTURE_COST_MODIFIERS: ReadonlyArray<readonly [string, number]> = [
  ['F_AMPHIBIOUS', 1.75], ['F_ARMORED_CHASSIS', 1.5], ['F_BICYCLE', 0.75],
  ['F_CONVERTIBLE', 1.1], ['F_DUNE_BUGGY', 1.5], ['F_ENVIRONMENTAL_SEALING', 2],
  ['F_EXTERNAL_POWER_PICKUP', 1.1], ['F_HYDROFOIL', 1.7], ['F_MONOCYCLE', 0.5],
  ['F_OFF_ROAD', 1.5], ['F_PROP', 1.2], ['F_SNOWMOBILE', 1.75],
  ['F_STOL_CHASSIS', 1.5], ['F_SUBMERSIBLE', 1.8], ['F_TRACTOR_MODIFICATION', 1.2],
  ['F_TRAILER_MODIFICATION', 0.8], ['F_ULTRA_LIGHT', 0.5], ['F_VSTOL_CHASSIS', 2],
];

function getSupportVehicleStructureWeight(entity: VehicleEntity & SupportVehicle): number {
  const ratingMultipliers = [1.6, 1.3, 1.15, 1, 0.85, 0.66];
  let modifier = 1;
  for (const [flag, multiplier] of SUPPORT_VEHICLE_STRUCTURE_COST_MODIFIERS) {
    if (hasAnyEquipmentFlag(entity, [flag])) modifier *= multiplier;
  }
  const raw = getSupportVehicleBaseChassisValue(entity) * (ratingMultipliers[entity.structuralTechRating()] ?? 1)
    * modifier * entity.tonnage();
  return entity.tonnage() < 5 ? Math.floor(raw * 1000) / 1000 : Math.floor(raw * 2) / 2;
}

function getSupportVehicleBaseChassisValue(entity: VehicleEntity): number {
  const tonnage = entity.tonnage();
  const superHeavy = entity.isSuperHeavy();
  if (entity.entityType === 'SupportVTOL') return tonnage < 5 ? 0.2 : superHeavy ? 0.3 : 0.25;
  switch (entity.motiveType()) {
    case 'Hover': return tonnage < 5 ? 0.2 : superHeavy ? 0.3 : 0.25;
    case 'Naval':
    case 'Hydrofoil':
    case 'Submarine': return tonnage < 5 ? 0.12 : 0.15;
    case 'Tracked': return tonnage < 5 ? 0.13 : superHeavy ? 0.25 : 0.15;
    case 'Wheeled': return tonnage < 5 ? 0.12 : superHeavy ? 0.18 : 0.15;
    case 'WiGE': return tonnage < 5 ? 0.12 : superHeavy ? 0.17 : 0.15;
    default: return 0;
  }
}

const SUPPORT_VEHICLE_CHASSIS_COST_MODIFIERS: ReadonlyArray<readonly [string, number]> = [
  ['F_AMPHIBIOUS', 1.25], ['F_ARMORED_CHASSIS', 2], ['F_BICYCLE', 0.75],
  ['F_CONVERTIBLE', 1.1], ['F_DUNE_BUGGY', 1.25], ['F_ENVIRONMENTAL_SEALING', 1.75],
  ['F_EXTERNAL_POWER_PICKUP', 1.1], ['F_HYDROFOIL', 1.1], ['F_MONOCYCLE', 1.3],
  ['F_OFF_ROAD', 1.2], ['F_PROP', 0.75], ['F_SNOWMOBILE', 1.3],
  ['F_STOL_CHASSIS', 1.5], ['F_SUBMERSIBLE', 3.5], ['F_TRACTOR_MODIFICATION', 1.1],
  ['F_TRAILER_MODIFICATION', 0.75], ['F_ULTRA_LIGHT', 1.5], ['F_VSTOL_CHASSIS', 2],
];

function getSupportVehicleChassisCostMultiplier(entity: VehicleEntity & SupportVehicle): number {
  let multiplier = 1;
  for (const [flag, value] of SUPPORT_VEHICLE_CHASSIS_COST_MODIFIERS) if (hasAnyEquipmentFlag(entity, [flag])) multiplier *= value;
  return multiplier;
}

function getVehicleTonnageMultiplier(entity: VehicleEntity): number {
  const tonnage = entity.tonnage();
  if (entity.isSupportVehicle() && ['Naval', 'Hydrofoil', 'Submarine'].includes(entity.motiveType())) {
    return 1 + tonnage / 100000;
  }
  switch (entity.motiveType()) {
    case 'Hover':
    case 'Submarine': return 1 + tonnage / 50;
    case 'Hydrofoil': return 1 + tonnage / 75;
    case 'Naval':
    case 'Wheeled': return 1 + tonnage / 200;
    case 'Tracked': return 1 + tonnage / 100;
    case 'VTOL': return 1 + tonnage / 30;
    case 'WiGE': return 1 + tonnage / 25;
    case 'Rail':
    case 'MagLev': return 1 + tonnage / 250;
    default: return 1;
  }
}

function calculatePowerAmplifierWeight(entity: VehicleEntity): number {
  const engine = entity.mountedEngine();
  if (engine.isFusion || engine.isFission || entity.weightClass() === 'Small Support') return 0;
  const tonnage = entity.mountedWeapons().reduce((total, mount) => {
    const weapon = mount.equipment;
    const requiresPower = (weapon.hasFlag('F_LASER') && weapon.ammoType === 'NA')
      || weapon.hasAnyFlag(['F_PPC', 'F_PLASMA', 'F_PLASMA_MFUK'])
      || (weapon.hasFlag('F_FLAMER') && weapon.ammoType === 'NA');
    return total + (requiresPower ? mount.getTonnage(entity) ?? 0 : 0);
  }, 0);
  return nextHalfTon(tonnage / 10);
}

function calculateVehicleHeatSinkRequirement(entity: VehicleEntity): number {
  let heat = entity.mountedWeapons().reduce((total, mount) => {
    const weapon = mount.equipment;
    const producesHeat = (weapon.hasFlag('F_LASER') && weapon.ammoType === 'NA')
      || weapon.hasAnyFlag(['F_PPC', 'F_PLASMA', 'F_PLASMA_MFUK'])
      || (weapon.hasFlag('F_FLAMER') && weapon.ammoType === 'NA');
    return total + (producesHeat ? weapon.heat : 0);
  }, 0);
  return heat;
}

function calculateVehicleTurretWeight(entity: VehicleEntity): number {
  const tonnage = entity.mountedWeapons().reduce((total, mount) => {
    const inTurret = mount.location === 'Turret' || mount.location === 'Rear Turret';
    return total + (inTurret ? (mount.getTonnage(entity) ?? 0) / 10 : 0);
  }, 0);
  return standardRound(tonnage, entity);
}

function hasAnyEquipmentFlag(entity: BaseEntity, flags: readonly string[]): boolean {
  return entity.equipment().some(mount => mount.equipment?.hasAnyFlag([...flags]));
}

function standardRound(value: number, entity: BaseEntity): number {
  return entity.weightClass() === 'Small Support'
    ? Math.ceil(value * 1000) / 1000
    : nextHalfTon(value);
}