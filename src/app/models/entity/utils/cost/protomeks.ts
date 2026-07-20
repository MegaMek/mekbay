import type { ProtoMekEntity } from '../../entities/protomek/protomek-entity';

/** Mirrors MegaMek's ProtoMekCostCalculator. */
export function calculateProtoMekCost(entity: ProtoMekEntity, equipmentCost: number): number {
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
    tonnage >= 10 ? 800000 : 500000, 75000, 2000 * tonnage, 2000 * tonnage,
    (entity.isGlider() ? 600 : entity.isQuad() ? 500 : 400) * tonnage,
    2 * 180 * tonnage, 540 * tonnage,
    engine.installed ? (5000 * tonnage * engine.rating) / 75 : 0,
    tonnage * entity.jumpMP() ** 2 * 200, 2000 * energyWeaponHeat,
    entity.totalArmorPoints() * armorCostPerPoint, equipmentCost,
  ].reduce((total, cost) => total + Math.max(0, cost), 0);
  return additiveCosts * (1 + tonnage / 100);
}
