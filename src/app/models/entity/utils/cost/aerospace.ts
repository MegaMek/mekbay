import type { AeroEntity } from '../../entities/aero/aero-entity';
import type { ConvFighterEntity } from '../../entities/aero/conv-fighter-entity';
import { calculateArmorCost, calculateHeatNeutralRequirement, calculatePowerAmplifierWeight } from './common';
import { amount, buildCostReport, multiplier, type EntityCostEntry, type EntityCostReport } from './cost-report';

/** Mirrors MegaMek's AeroCostCalculator. */
export function calculateAeroFighterCost(entity: AeroEntity, equipmentCost: number): number {
  return calculateAeroFighterCostReport(entity, [amount('Equipment', equipmentCost)]).total;
}

export function calculateAeroFighterCostReport(
  entity: AeroEntity, equipment: readonly EntityCostEntry[],
): EntityCostReport {
  const tonnage = entity.tonnage();
  const engine = entity.mountedEngine();
  const priceMultiplier = (entity.omni() ? 1.25 : 1) * (1 + tonnage / 200);
  return buildCostReport([
    amount('Cockpit', 200000), amount('Life Support', 50000), amount('Sensors', 2000 * tonnage),
    amount('Structure', 50000 * entity.structuralIntegrity()), amount('Flight Systems', 25000 + 10 * tonnage),
    amount('Engine', engine.installed ? (engine.baseCost * engine.rating * tonnage) / 75 : 0),
    amount('Fuel Tanks', (200 * entity.fuel()) / 80), amount('Armor', calculateArmorCost(entity)),
    amount('Heatsinks', (entity.heatSinkType() === 'Double' ? 6000 : 2000) * entity.heatSinkCount()),
    ...equipment, multiplier('Weight Multiplier', priceMultiplier),
  ], true);
}

/** Mirrors MegaMek's ConvFighterCostCalculator. */
export function calculateConventionalFighterCost(entity: ConvFighterEntity, equipmentCost: number): number {
  return calculateConventionalFighterCostReport(entity, [amount('Equipment', equipmentCost)]).total;
}

export function calculateConventionalFighterCostReport(
  entity: ConvFighterEntity, equipment: readonly EntityCostEntry[],
): EntityCostReport {
  const tonnage = entity.tonnage();
  const engine = entity.mountedEngine();
  const avionicsWeight = Math.ceil(tonnage / 5) / 2;
  const vstolWeight = entity.vstol() ? Math.ceil(tonnage / 10) / 2 : 0;
  return buildCostReport([
    amount('Avionics', 4000 * avionicsWeight), amount('VSTOL Equipment', 5000 * vstolWeight),
    amount('Structure', 4000 * entity.structuralIntegrity()), amount('Flight Systems', 25000 + 10 * tonnage),
    amount('Engine', engine.installed ? (engine.baseCost * engine.rating * tonnage) / 75 : 0),
    amount('Fuel Tanks', (200 * entity.fuel()) / 160), amount('Armor', calculateArmorCost(entity)),
    amount('Heatsinks', (entity.heatSinkType() === 'Double' ? 6000 : 2000) * calculateHeatNeutralRequirement(entity)),
    ...equipment, amount('Power Amplifiers', 20000 * calculatePowerAmplifierWeight(entity)),
    multiplier('Omni Multiplier', 1.25, entity.omni()), multiplier('Weight Multiplier', 1 + tonnage / 200),
  ], true);
}
