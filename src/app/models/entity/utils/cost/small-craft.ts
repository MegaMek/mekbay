import type { SmallCraftEntity } from '../../entities/aero/small-craft-entity';
import { nextHalfTon } from './common';
import { amount, buildCostReport, multiplier, type EntityCostEntry, type EntityCostReport } from './cost-report';

const SPHEROID_THRESHOLDS = [12500, 20000, 35000, 50000, 65000] as const;
const AERODYNE_THRESHOLDS = [6000, 9500, 12500, 17500, 25000] as const;

/** Mirrors MegaMek's SmallCraftCostCalculator for non-DropShip Small Craft. */
export function calculateSmallCraftCost(entity: SmallCraftEntity, equipmentCost: number): number {
  return calculateSmallCraftCostReport(entity, [amount('Equipment', equipmentCost)]).total;
}

export function calculateSmallCraftCostReport(
  entity: SmallCraftEntity, equipment: readonly EntityCostEntry[],
): EntityCostReport {
  const tonnage = entity.tonnage();
  const crewAndPassengers = entity.crew() + entity.passengers();
  const arcsWithGuns = new Set(entity.mountedWeapons().map(mount =>
    `${mount.location ?? ''}:${mount.rearMounted ? 'rear' : 'front'}`)).size;
  const primitive = entity.uniformArmor()?.type === 'PRIMITIVE_AERO';
  const engineMultiplier = entity.techBase() === 'Clan'
    ? 0.061
    : smallCraftEngineMultiplier(entity.effectiveOriginalBuildYear());
  const engineWeight = nextHalfTon(tonnage * entity.originalWalkMP() * engineMultiplier);
  const fuelPointsPerTon = primitive
    ? 80 / smallCraftPrimitiveFuelFactor(entity.effectiveOriginalBuildYear())
    : 80;
  const fuelTonnage = Math.round(2 * entity.fuel() / fuelPointsPerTon) / 2;
  const fuelSystemWeight = nextHalfTon(fuelTonnage * 1.02);
  return buildCostReport([
    amount('Bridge', 200000 + 10 * tonnage), amount('Computer', 200000),
    amount('Life Support', 5000 * crewAndPassengers), amount('Sensors', 80000), amount('Fire Control Computer', 100000),
    amount('Gunnery Control Systems', 10000 * arcsWithGuns), amount('Structure', 100000 * entity.structuralIntegrity()),
    amount('Attitude Thrusters', 25000), amount('Landing Gear', 10 * tonnage), amount('Engine', engineWeight * 1000),
    amount('Drive Unit', 500 * entity.originalWalkMP() * tonnage / 100), amount('Fuel Tanks', 200 * fuelSystemWeight),
    amount('Armor', calculateSmallCraftArmorCost(entity, primitive)),
    amount('Heatsinks', (entity.heatSinkType() === 'Double' ? 6000 : 2000) * entity.heatSinkCount()),
    ...equipment, multiplier('Weight Multiplier', 1 + tonnage / 50),
  ], true);
}

function calculateSmallCraftArmorCost(entity: SmallCraftEntity, primitive: boolean): number {
  const mountedArmor = entity.uniformArmor();
  if (!mountedArmor) return 0;
  const armor = mountedArmor.armor;
  if (armor.cost === 'variable') throw new Error(`Unable to calculate armor cost for ${armor.id}`);
  let rawArmor = entity.totalArmorPoints();
  if (primitive) rawArmor = Math.ceil(rawArmor / 0.66);
  const thresholds = entity.motiveType() === 'Spheroid' ? SPHEROID_THRESHOLDS : AERODYNE_THRESHOLDS;
  const index = thresholds.findIndex(threshold => entity.tonnage() < threshold);
  const pointsPerTon = armor.pptDropship.length > thresholds.length
    ? armor.pptDropship[index < 0 ? armor.pptDropship.length - 1 : index]
    : 16 * armor.pptMultiplier;
  return nextHalfTon((rawArmor - 4 * entity.structuralIntegrity()) / pointsPerTon) * armor.cost;
}

function smallCraftEngineMultiplier(year: number): number {
  return year >= 2500 ? 0.065 : year >= 2400 ? 0.078 : year >= 2300 ? 0.091
    : year >= 2251 ? 0.0975 : year >= 2201 ? 0.1105 : year >= 2151 ? 0.1235 : 0.143;
}

function smallCraftPrimitiveFuelFactor(year: number): number {
  return year >= 2500 ? 1 : year >= 2400 ? 1.2 : year >= 2300 ? 1.4
    : year >= 2251 ? 1.5 : year >= 2201 ? 1.7 : year >= 2151 ? 1.9 : 2.2;
}
