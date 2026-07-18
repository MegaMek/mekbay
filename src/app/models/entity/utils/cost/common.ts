import type { BaseEntity } from '../../base-entity';

export function nextHalfTon(tonnage: number): number {
  return Math.ceil(tonnage * 2) / 2;
}

export function standardRound(value: number, entity: BaseEntity): number {
  return entity.weightClass() === 'Small Support'
    ? Math.ceil(value * 1000) / 1000
    : nextHalfTon(value);
}

export function calculateArmorCost(entity: BaseEntity): number {
  let total = 0;
  for (const [location, mountedArmor] of entity.armorByLocation()) {
    const points = entity.armorValues().get(location);
    const armorPoints = (points?.front ?? 0) + (points?.rear ?? 0);
    if (armorPoints <= 0) continue;
    const armor = mountedArmor.armor;
    if (armor.cost === 'variable') throw new Error(`Unable to calculate armor cost for ${armor.id}`);
    if (armor.hasFlag('F_SUPPORT_VEE_BAR_ARMOR')) {
      total += armorPoints * armor.cost;
    } else {
      const armorWeight = standardRound(armorPoints / (16 * armor.pptMultiplier), entity);
      total += armorWeight * armor.cost;
    }
  }
  return total;
}

export function calculatePowerAmplifierWeight(entity: BaseEntity): number {
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

export function calculateHeatNeutralRequirement(entity: BaseEntity): number {
  return entity.mountedWeapons().reduce((total, mount) => {
    const weapon = mount.equipment;
    const producesHeat = (weapon.hasFlag('F_LASER') && weapon.ammoType === 'NA')
      || weapon.hasAnyFlag(['F_PPC', 'F_PLASMA', 'F_PLASMA_MFUK'])
      || (weapon.hasFlag('F_FLAMER') && weapon.ammoType === 'NA');
    return total + (producesHeat ? weapon.heat : 0);
  }, 0);
}

export function hasAnyEquipmentFlag(entity: BaseEntity, flags: readonly string[]): boolean {
  return entity.equipment().some(mount => mount.equipment?.hasAnyFlag([...flags]));
}
