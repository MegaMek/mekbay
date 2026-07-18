import type { AeroEntity } from '../../entities/aero/aero-entity';
import type { ConvFighterEntity } from '../../entities/aero/conv-fighter-entity';
import { calculateArmorCost, calculateHeatNeutralRequirement, calculatePowerAmplifierWeight } from './common';

/** Mirrors MegaMek's AeroCostCalculator. */
export function calculateAeroFighterCost(entity: AeroEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const engine = entity.mountedEngine();
  const additiveCost = [
    200000, 50000, 2000 * tonnage, 50000 * entity.structuralIntegrity(),
    25000 + (10 * tonnage),
    engine.installed ? (engine.baseCost * engine.rating * tonnage) / 75 : 0,
    (200 * entity.fuel()) / 80,
    calculateArmorCost(entity),
    (entity.heatSinkType() === 'Double' ? 6000 : 2000) * entity.heatSinkCount(),
    equipmentCost,
  ].reduce((total, cost) => total + Math.max(0, cost), 0);
  return Math.round(additiveCost * (entity.omni() ? 1.25 : 1) * (1 + tonnage / 200));
}

/** Mirrors MegaMek's ConvFighterCostCalculator. */
export function calculateConventionalFighterCost(entity: ConvFighterEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const engine = entity.mountedEngine();
  const avionicsWeight = Math.ceil(tonnage / 5) / 2;
  const vstolWeight = entity.vstol() ? Math.ceil(tonnage / 10) / 2 : 0;
  const additiveCost = [
    4000 * avionicsWeight, 5000 * vstolWeight, 4000 * entity.structuralIntegrity(),
    25000 + (10 * tonnage),
    engine.installed ? (engine.baseCost * engine.rating * tonnage) / 75 : 0,
    (200 * entity.fuel()) / 160, calculateArmorCost(entity),
    (entity.heatSinkType() === 'Double' ? 6000 : 2000) * calculateHeatNeutralRequirement(entity),
    equipmentCost, 20000 * calculatePowerAmplifierWeight(entity),
  ].reduce((total, cost) => total + Math.max(0, cost), 0);
  return Math.round(additiveCost * (entity.omni() ? 1.25 : 1) * (1 + tonnage / 200));
}
