import type { DropShipEntity } from '../../entities/aero/dropship-entity';
import type { JumpShipEntity } from '../../entities/largecraft/jumpship-entity';
import type { SpaceStationEntity } from '../../entities/largecraft/space-station-entity';
import type { WarShipEntity } from '../../entities/largecraft/warship-entity';
import type { EntityTransportBay } from '../../types';
import { nextHalfTon } from './common';

const SPHEROID_DROPSHIP_THRESHOLDS = [12500, 20000, 35000, 50000, 65000] as const;
const AERODYNE_DROPSHIP_THRESHOLDS = [6000, 9500, 12500, 17500, 25000] as const;
const CAPITAL_THRESHOLDS = [150000, 250000] as const;

type CapitalCraft = JumpShipEntity | WarShipEntity | SpaceStationEntity;

/** Mirrors MegaMek's DropShipCostCalculator. */
export function calculateDropShipCost(entity: DropShipEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const baseCosts = smallCraftSystemCosts(entity, equipmentCost);
  const collarCost = entity.collarType() === 'Standard' ? 10000
    : entity.collarType() === 'Prototype' ? 1010000 : 0;
  const additiveCost = baseCosts + collarCost + calculateLargeCraftBayAndDoorCost(entity)
    + 5000 * (entity.lifeboats() + entity.escapePods());
  return Math.round(additiveCost * (entity.motiveType() === 'Spheroid' ? 28 : 36));
}

/** Mirrors MegaMek's JumpShipCostCalculator. */
export function calculateJumpShipCost(entity: JumpShipEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const cost = sharedCapitalSystemSum(entity)
    + 1000 * tonnage * 0.012
    + 1000
    + calculateKfDriveCost(entity, 7500, 1)
    + 10000000 * (tonnage / 10000)
    + 25000
    + 100000 * dockingCount(entity, false)
    + calculateCapitalFuelTankCost(entity)
    + calculateLargeCraftArmorCost(entity)
    + heatSinkCost(entity)
    + escapeCraftCost(entity)
    + calculateGravDeckCost(entity)
    + calculateLargeCraftBayAndDoorCost(entity)
    + (entity.hpg() ? 1000000000 : 0)
    + equipmentCost;
  return Math.round(cost * 1.25);
}

/** Mirrors MegaMek's WarShipCostCalculator. */
export function calculateWarShipCost(entity: WarShipEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const thrust = entity.originalWalkMP();
  const cost = sharedCapitalSystemSum(entity)
    + 500 * thrust * (tonnage / 100)
    + 1000 * thrust * tonnage * 0.06
    + 1000
    + calculateKfDriveCost(entity, 20000, 5)
    + 20000000 * (50 + tonnage / 10000)
    + 25000
    + 100000 * dockingCount(entity, false)
    + calculateCapitalFuelTankCost(entity)
    + calculateLargeCraftArmorCost(entity)
    + heatSinkCost(entity)
    + escapeCraftCost(entity)
    + calculateGravDeckCost(entity)
    + calculateLargeCraftBayAndDoorCost(entity)
    + (entity.hpg() ? 1000000000 : 0)
    + equipmentCost;
  return Math.round(cost * 2);
}

/** Mirrors MegaMek's SpaceStationCostCalculator. */
export function calculateSpaceStationCost(entity: SpaceStationEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const cost = sharedCapitalSystemSum(entity)
    + 1000 * tonnage * 0.012
    + 1000
    + 25000
    + 100000 * dockingCount(entity, false)
    + calculateCapitalFuelTankCost(entity)
    + calculateLargeCraftArmorCost(entity)
    + heatSinkCost(entity)
    + escapeCraftCost(entity)
    + calculateGravDeckCost(entity)
    + calculateLargeCraftBayAndDoorCost(entity)
    + (entity.hpg() ? 1000000000 : 0)
    + equipmentCost;
  const multiplier = entity.modularOrKFAdapter()
    ? (tonnage > 100000 ? 50 : 20)
    : 5;
  return Math.round(cost * multiplier);
}

function smallCraftSystemCosts(entity: DropShipEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const crewAndPassengers = crewAndPassengerCount(entity);
  const primitive = entity.uniformArmor()?.type === 'PRIMITIVE_AERO';
  const engineMultiplier = entity.techBase() === 'Clan'
    ? 0.061
    : dropshipEngineMultiplier(primitive ? entity.effectiveOriginalBuildYear() : 2500);
  const engineWeight = nextHalfTon(tonnage * entity.originalWalkMP() * engineMultiplier);
  const fuelPointsPerTon = dropshipFuelPointsPerTon(entity);
  const fuelWeight = nextHalfTon((entity.fuel() / fuelPointsPerTon) * 1.02);
  return [
    200000 + 10 * tonnage,
    200000,
    5000 * crewAndPassengers,
    80000,
    100000,
    10000 * arcsWithGuns(entity),
    100000 * entity.structuralIntegrity(),
    25000,
    10 * tonnage,
    1000 * engineWeight,
    500 * entity.originalWalkMP() * tonnage / 100,
    200 * fuelWeight,
    calculateLargeCraftArmorCost(entity),
    heatSinkCost(entity),
    equipmentCost,
  ].reduce((sum, value) => sum + Math.max(0, value), 0);
}

function sharedCapitalSystemSum(entity: CapitalCraft): number {
  return 200000 + 10 * entity.tonnage()
    + 200000
    + 5000 * crewAndPassengerCount(entity)
    + 80000
    + 100000
    + 10000 * arcsWithGuns(entity)
    + 100000 * entity.structuralIntegrity();
}

function crewAndPassengerCount(entity: CapitalCraft | DropShipEntity): number {
  return entity.crew() + entity.passengers();
}

function arcsWithGuns(entity: CapitalCraft | DropShipEntity): number {
  const includeRear = entity.entityType === 'DropShip';
  return new Set(entity.mountedWeapons().map(mount =>
    `${mount.location ?? ''}:${includeRear && mount.rearMounted ? 'rear' : 'front'}`)).size;
}

function calculateKfDriveCost(entity: JumpShipEntity, sailTonnageDivisor: number, multiplier: number): number {
  const costDocks = dockingCount(entity, true);
  let driveCost = 60000000 + 75000000 * costDocks
    + 25000000 + 5000000 * costDocks
    + 50000000
    + 50000 * entity.kfIntegrity()
    + 50000 * (30 + entity.tonnage() / sailTonnageDivisor)
    + 500000 + 200000 * costDocks;
  driveCost *= multiplier;
  if (entity.lithiumFusion()) driveCost *= 3;
  return driveCost;
}

function dockingCount(entity: CapitalCraft, forCost: boolean): number {
  return entity.transporters().reduce((count, transporter) => {
    if (transporter.kind === 'docking-collar') return count + 1;
    if (forCost && transporter.kind === 'bay' && transporter.configuration.type === 'drop-shuttle') {
      return count + 2;
    }
    return count;
  }, 0);
}

function calculateCapitalFuelTankCost(entity: CapitalCraft): number {
  return (200 * entity.fuel()) / capitalFuelPerTon(entity.tonnage()) * 1.02;
}

function capitalFuelPerTon(tonnage: number): number {
  return tonnage >= 250000 ? 2.5 : tonnage >= 110000 ? 5 : 10;
}

function calculateGravDeckCost(entity: CapitalCraft): number {
  return entity.gravDecks().reduce((cost, diameter) => cost
    + (diameter > 250 ? 40000000 : diameter >= 100 ? 10000000 : 5000000), 0);
}

function calculateLargeCraftBayAndDoorCost(entity: CapitalCraft | DropShipEntity): number {
  let cost = 0;
  for (const transporter of entity.transporters()) {
    if (transporter.kind !== 'bay') continue;
    cost += 1000 * transporter.doors;
    if (!isStructuralBay(transporter)) cost += bayCost(transporter);
  }
  return cost;
}

function isStructuralBay(bay: EntityTransportBay): boolean {
  return ['crew-quarters', 'steerage-quarters', 'second-class-quarters', 'first-class-quarters',
    'standard-seats', 'pillion-seats', 'ejection-seats', 'infantry', 'battle-armor']
    .includes(bay.configuration.type);
}

function bayCost(bay: EntityTransportBay): number {
  const capacity = Math.trunc(bay.capacity);
  switch (bay.configuration.type) {
    case 'mek': return 20000 * capacity;
    case 'fighter': return 20000 * capacity + (bay.configuration.arts ? 1000000 : 0);
    case 'small-craft': return 20000 * capacity;
    case 'light-vehicle':
    case 'heavy-vehicle': return 10000 * capacity;
    case 'super-heavy-vehicle': return 20000 * capacity;
    case 'protomek': return 10000 * Math.ceil(bay.capacity);
    case 'liquid-cargo': return 100 * Math.ceil(bay.constructionWeight ?? bay.capacity);
    case 'insulated-cargo': return 250 * Math.ceil(bay.constructionWeight ?? bay.capacity);
    case 'refrigerated-cargo': return 200 * Math.ceil(bay.constructionWeight ?? bay.capacity);
    case 'livestock-cargo': return 2500 * Math.ceil(bay.constructionWeight ?? bay.capacity);
    case 'drop-shuttle': return 150000000;
    case 'naval-repair': return capacity * 5000 * (bay.configuration.pressurized ? 2 : 1)
      + (bay.configuration.arts ? 1000000 : 0);
    case 'reinforced-repair': return 30000 * capacity;
    default: return 0;
  }
}

function calculateLargeCraftArmorCost(entity: CapitalCraft | DropShipEntity): number {
  const mountedArmor = entity.uniformArmor();
  if (!mountedArmor) return 0;
  const armor = mountedArmor.armor;
  if (armor.cost === 'variable') throw new Error(`Unable to calculate armor cost for ${armor.id}`);

  let rawArmor = entity.totalArmorPoints();
  const primitive = 'driveCoreType' in entity
    ? entity.driveCoreType() === 'Primitive'
    : mountedArmor.type === 'PRIMITIVE_AERO';
  if (primitive) rawArmor = Math.ceil(rawArmor / 0.66);
  const siBonus = entity.entityType === 'DropShip'
    ? 6 * entity.structuralIntegrity()
    : 6 * Math.round(entity.structuralIntegrity() / 10);
  const pointsPerTon = resolveLargeCraftPointsPerTon(entity, armor.pptMultiplier,
    armor.pptDropship, armor.pptCapital);
  return nextHalfTon((rawArmor - siBonus) / pointsPerTon) * armor.cost;
}

function resolveLargeCraftPointsPerTon(
  entity: CapitalCraft | DropShipEntity,
  multiplier: number,
  dropshipPpt: readonly number[],
  capitalPpt: readonly number[],
): number {
  const thresholds = entity.entityType === 'DropShip'
    ? (entity.motiveType() === 'Spheroid' ? SPHEROID_DROPSHIP_THRESHOLDS : AERODYNE_DROPSHIP_THRESHOLDS)
    : CAPITAL_THRESHOLDS;
  const values = entity.entityType === 'DropShip' ? dropshipPpt : capitalPpt;
  if (values.length > thresholds.length) {
    const index = thresholds.findIndex(threshold => entity.tonnage() < threshold);
    return values[index < 0 ? values.length - 1 : index];
  }
  return 16 * multiplier;
}

function heatSinkCost(entity: CapitalCraft | DropShipEntity): number {
  return (entity.heatSinkType() === 'Double' ? 6000 : 2000) * entity.heatSinkCount();
}

function escapeCraftCost(entity: CapitalCraft): number {
  return 5000 * (entity.lifeboats() + entity.escapePods());
}

function dropshipFuelPointsPerTon(entity: DropShipEntity): number {
  const tonnage = entity.tonnage();
  let points = tonnage < 400 ? 80 : tonnage < 800 ? 70 : tonnage < 1200 ? 60
    : tonnage < 1900 ? 50 : tonnage < 3000 ? 40 : tonnage < 20000 ? 30
      : tonnage < 40000 ? 20 : 10;
  if (entity.uniformArmor()?.type === 'PRIMITIVE_AERO') {
    points /= dropshipPrimitiveFuelFactor(entity.effectiveOriginalBuildYear());
  }
  return points;
}

function dropshipPrimitiveFuelFactor(year: number): number {
  return year >= 2500 ? 1 : year >= 2400 ? 1.1 : year >= 2351 ? 1.3
    : year >= 2251 ? 1.4 : year >= 2201 ? 1.6 : year >= 2151 ? 1.8 : 2;
}

function dropshipEngineMultiplier(year: number): number {
  return year >= 2500 ? 0.065 : year >= 2351 ? 0.0715 : year >= 2300 ? 0.0845
    : year >= 2251 ? 0.091 : year >= 2201 ? 0.1104 : year >= 2151 ? 0.117 : 0.13;
}
