import type { SmallCraftEntity } from '../../entities/aero/small-craft-entity';
import { nextHalfTon } from './common';

/** Mirrors MegaMek's SmallCraftCostCalculator for non-DropShip Small Craft. */
export function calculateSmallCraftCost(entity: SmallCraftEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const crewAndPassengers = entity.crew() + entity.passengers();
  const arcsWithGuns = new Set(entity.mountedWeapons().map(mount =>
    `${mount.location ?? ''}:${mount.rearMounted ? 'rear' : 'front'}`)).size;
  const primitive = entity.uniformArmor()?.type === 'PRIMITIVE_AERO';
  const engineMultiplier = entity.techBase() === 'Clan'
    ? 0.061
    : smallCraftEngineMultiplier(primitive ? entity.effectiveOriginalBuildYear() : 2500);
  const engineWeight = nextHalfTon(tonnage * entity.originalWalkMP() * engineMultiplier);
  const fuelPointsPerTon = primitive
    ? 80 / smallCraftPrimitiveFuelFactor(entity.effectiveOriginalBuildYear())
    : 80;
  const fuelTonnage = Math.round(2 * entity.fuel() / fuelPointsPerTon) / 2;
  const fuelSystemWeight = nextHalfTon(fuelTonnage * 1.02);
  const additiveCost = [
    200000 + 10 * tonnage,
    200000,
    5000 * crewAndPassengers,
    80000,
    100000,
    10000 * arcsWithGuns,
    100000 * entity.structuralIntegrity(),
    25000,
    10 * tonnage,
    engineWeight * 1000,
    500 * entity.originalWalkMP() * tonnage / 100,
    200 * fuelSystemWeight,
    calculateSmallCraftArmorCost(entity, primitive),
    (entity.heatSinkType() === 'Double' ? 6000 : 2000) * entity.heatSinkCount(),
    equipmentCost,
  ].reduce((total, cost) => total + Math.max(0, cost), 0);
  return Math.round(additiveCost * (1 + tonnage / 50));
}

function calculateSmallCraftArmorCost(entity: SmallCraftEntity, primitive: boolean): number {
  const mountedArmor = entity.uniformArmor();
  if (!mountedArmor) return 0;
  const armor = mountedArmor.armor;
  if (armor.cost === 'variable') throw new Error(`Unable to calculate armor cost for ${armor.id}`);
  let rawArmor = entity.totalArmorPoints();
  if (primitive) rawArmor = Math.ceil(rawArmor / 0.66);
  const pointsPerTon = 16 * armor.pptMultiplier;
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
