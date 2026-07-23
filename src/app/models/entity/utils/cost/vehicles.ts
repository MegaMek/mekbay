import type { SupportVehicle } from '../../entities/support-vehicle';
import type { VehicleEntity } from '../../entities/vehicle/vehicle-entity';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import {
  calculateArmorCost,
  calculateHeatNeutralRequirement,
  calculatePowerAmplifierWeight,
  hasAnyEquipmentFlag,
  nextHalfTon,
  standardRound,
} from './common';
import { amount, buildCostReport, multiplier, type EntityCostEntry, type EntityCostReport } from './cost-report';

/** Mirrors MegaMek's CombatVehicleCostCalculator for support and combat vehicles. */
export function calculateVehicleCost(entity: VehicleEntity, equipmentCost: number): number {
  return calculateVehicleCostReport(entity, [amount('Equipment', equipmentCost)]).total;
}

export function calculateVehicleCostReport(
  entity: VehicleEntity,
  equipment: readonly EntityCostEntry[],
): EntityCostReport {
  const tonnage = entity.tonnage();
  const supportVehicle = entity.isSupportVehicle();
  const engine = entity.mountedEngine();
  const engineCost = !engine.installed ? 0 : supportVehicle
    ? 5000 * getEquipmentEngineWeight(entity) * engine.descriptor().svCostMultiplier
    : (engine.baseCost * engine.rating * tonnage) / 75;
  const armorCost = calculateVehicleArmorCost(entity);

  const entries: EntityCostEntry[] = [];
  if (entity.isSupportVehicle()) {
    const chassisCost = 2500 * getSupportVehicleStructureWeight(entity)
      * getSupportVehicleChassisCostMultiplier(entity);
    const structuralTechMultiplier = 0.5 + (entity.structuralTechRating() * 0.25);
    entries.push(amount('Chassis', chassisCost), amount('Engine', engineCost), amount('Armor', armorCost));
    entries.push(multiplier('Structural Tech Rating', structuralTechMultiplier));
  } else {
    const structureDivisor = entity.isSuperHeavy()
      && entity.motiveType() !== 'Naval'
      && entity.motiveType() !== 'Submarine' ? 5 : 10;
    const structureCost = nextHalfTon(tonnage / structureDivisor) * 10000;
    const controlCost = entity.hasNoControlSystems() ? 0 : nextHalfTon(tonnage * 0.05) * 10000;
    entries.push(amount('Structure', structureCost), amount('Engine', engineCost),
      amount('Controls', controlCost), amount('Armor', armorCost));
  }

  entries.push(amount('Power Amplifiers', calculatePowerAmplifierWeight(entity) * 20000));
  // MegaMek Engine.getWeightFreeEngineHeatSinks(): support-vehicle engines
  // never provide weight-free heat sinks, regardless of power source.
  const freeHeatSinks = supportVehicle ? 0 : engine.weightFreeHeatSinks;
  entries.push(amount('Heatsinks', Math.max(0,
    calculateVehicleHeatSinkRequirement(entity) - freeHeatSinks) * 2000));
  entries.push(amount('Turrets', calculateVehicleTurretWeight(entity) * 5000));
  entries.push(...equipment, amount('Extra Seats', entity.extraSeats() * 100));

  if (!supportVehicle) {
    const liftTonnage = ['Hover', 'Hydrofoil', 'VTOL', 'Submarine', 'WiGE'].includes(entity.motiveType())
      ? Math.ceil(tonnage / 5) / 2 : 0;
    entries.push(amount('Lift Equipment', liftTonnage * (entity.motiveType() === 'VTOL' ? 40000 : 20000)));
  }

  entries.push(multiplier('Omni Multiplier', 1.25, entity.omni()));
  entries.push(multiplier('Weight Multiplier', getVehicleTonnageMultiplier(entity)));
  if (!supportVehicle) {
    entries.push(multiplier('Flotation/Sealing Multiplier', 1.25,
      hasAnyEquipmentFlag(entity, ['F_FLOTATION_HULL', 'F_ENVIRONMENTAL_SEALING'])));
    entries.push(multiplier('Off-Road Multiplier', 1.2, hasAnyEquipmentFlag(entity, ['F_OFF_ROAD'])));
  }
  return buildCostReport(entries, true);
}

function calculateVehicleArmorCost(entity: VehicleEntity): number {
  return calculateArmorCost(entity);
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
  for (const [flag, value] of SUPPORT_VEHICLE_CHASSIS_COST_MODIFIERS) {
    if (hasAnyEquipmentFlag(entity, [flag])) multiplier *= value;
  }
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

function calculateVehicleHeatSinkRequirement(entity: VehicleEntity): number {
  return calculateHeatNeutralRequirement(entity);
}

function calculateVehicleTurretWeight(entity: VehicleEntity): number {
  const tonnage = entity.mountedWeapons().reduce((total, mount) => {
    const inTurret = mount.location === 'Turret'
      || mount.location === 'Front Turret'
      || mount.location === 'Rear Turret';
    if (!inTurret) return total;
    const enhancement = entity.getLinkingMount(mount);
    const capacitorTonnage = enhancement?.equipment?.hasFlag('F_PPC_CAPACITOR')
      ? enhancement.getTonnage(entity) ?? 0
      : 0;
    return total + ((mount.getTonnage(entity) ?? 0) + capacitorTonnage) / 10;
  }, 0);
  return standardRound(tonnage, entity);
}
