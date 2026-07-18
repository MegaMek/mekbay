import type { SmallCraftEntity } from '../../entities/aero/small-craft-entity';
import { calculateArmorCost, nextHalfTon } from './common';

/** Mirrors MegaMek's SmallCraftCostCalculator for non-DropShip Small Craft. */
export function calculateSmallCraftCost(entity: SmallCraftEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const crewAndPassengers = entity.crew() + entity.passengers();
  const arcsWithGuns = new Set(entity.mountedWeapons().map(mount =>
    `${mount.location ?? ''}:${mount.rearMounted ? 'rear' : 'front'}`)).size;
  const engineMultiplier = entity.techBase() === 'Clan' ? 0.061 : 0.065;
  const engineWeight = nextHalfTon(tonnage * entity.originalWalkMP() * engineMultiplier);
  const fuelTonnage = Math.round(entity.fuel() / 40) / 2;
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
    calculateArmorCost(entity),
    (entity.heatSinkType() === 'Double' ? 6000 : 2000) * entity.heatSinkCount(),
    equipmentCost,
  ].reduce((total, cost) => total + Math.max(0, cost), 0);
  return Math.round(additiveCost * (1 + tonnage / 50));
}
