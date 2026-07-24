import type { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import { amount, buildCostReport, multiplier, type EntityCostEntry, type EntityCostReport } from './cost-report';

/** Mirrors MegaMek's ProtoMekCostCalculator. */
export function calculateProtoMekCost(entity: ProtoMekEntity, equipmentCost: number): number {
  return calculateProtoMekCostReport(entity, [amount('Equipment', equipmentCost)]).total;
}

export function calculateProtoMekCostReport(
  entity: ProtoMekEntity, equipment: readonly EntityCostEntry[],
): EntityCostReport {
  const tonnage = entity.tonnage();
  const engine = entity.mountedEngine();
  const armorCostPerPoint = entity.uniformArmor()?.armor.cost;
  if (armorCostPerPoint === undefined || armorCostPerPoint === 'variable') {
    throw new Error('Unable to calculate ProtoMek armor cost');
  }
  const energyWeaponHeat = entity.mountedWeapons()
    .filter(mount => mount.equipment.hasFlag('F_ENERGY'))
    .reduce((heat, mount) => heat + mount.equipment.heat, 0);
  return buildCostReport([
    amount('Cockpit', tonnage >= 10 ? 800000 : 500000), amount('Life Support', 75000),
    amount('Sensors', 2000 * tonnage), amount('Myomer', 2000 * tonnage),
    amount('Structure', (entity.isGlider() ? 600 : entity.isQuad() ? 500 : 400) * tonnage),
    amount('Arm Actuators', 2 * 180 * tonnage), amount('Leg Actuators', 540 * tonnage),
    amount('Engine', engine.installed ? (5000 * tonnage * engine.rating) / 75 : 0),
    amount('Jump Jets', tonnage * entity.jumpMP() ** 2 * 200), amount('Heatsinks', 2000 * energyWeaponHeat),
    amount('Armor', entity.totalArmorPoints() * armorCostPerPoint), ...equipment,
    multiplier('Weight Multiplier', 1 + tonnage / 100),
  ]);
}
