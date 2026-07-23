import type { BaseEntity } from '../../base-entity';
import { MiscEquipment } from '../../../equipment.model';

export function nextHalfTon(tonnage: number): number {
  const truncated = Math.round(tonnage * 1000000) / 1000000;
  return Math.ceil(truncated * 2) / 2;
}

export function standardRound(value: number, entity: BaseEntity): number {
  return entity.weightClass() === 'Small Support'
    ? Math.ceil(value * 1000) / 1000
    : nextHalfTon(value);
}

export function calculateArmorCost(entity: BaseEntity): number {
  const uniformArmor = entity.uniformArmor();
  if (uniformArmor && !uniformArmor.armor.hasFlag('F_SUPPORT_VEE_BAR_ARMOR')) {
    const armor = uniformArmor.armor;
    if (armor.cost === 'variable') throw new Error(`Unable to calculate armor cost for ${armor.id}`);
    const armorWeight = standardRound(
      entity.totalArmorPoints() / (16 * armor.pptMultiplier),
      entity,
    );
    return armorWeight * armor.cost;
  }

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
      const armorWeight = armorPoints / (16 * armor.pptMultiplier);
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
  const weaponHeat = entity.mountedWeapons().reduce((total, mount) => {
    const weapon = mount.equipment;
    const producesHeat = (weapon.hasFlag('F_LASER') && weapon.ammoType === 'NA')
      || weapon.hasAnyFlag(['F_PPC', 'F_PLASMA', 'F_PLASMA_MFUK'])
      || (weapon.hasFlag('F_FLAMER') && weapon.ammoType === 'NA');
    if (!producesHeat) return total;
    const enhancement = entity.getLinkingMount(mount)?.equipment;
    let heat = weapon.heat;
    if (weapon.hasFlag('F_LASER') && enhancement?.hasFlag('F_LASER_INSULATOR')) {
      heat = Math.max(1, heat - 1);
    }
    return total + heat;
  }, 0);
  const capacitorHeat = entity.equipment().reduce((total, mount) => {
    const equipment = mount.equipment;
    return total + (equipment?.hasFlag('F_PPC_CAPACITOR') ? 5 : 0);
  }, 0);
  const hasStealth = [...entity.armorByLocation().values()]
    .some(mounted => ['STEALTH', 'STEALTH_VEHICLE'].includes(mounted.armor.armorType));
  const powerSource = entity.mountedEngine().descriptor().powerSource;
  const miscHeat = entity.equipment().reduce((total, mount) => {
    const equipment = mount.equipment;
    if (!(equipment instanceof MiscEquipment)) return total;
    const isSpotWelder = equipment.hasAllFlags(['F_CLUB', 'S_SPOT_WELDER']);
    if (isSpotWelder && ['fusion', 'fission'].includes(powerSource)) return total;
    return total + equipment.operatingHeat;
  }, 0);
  return weaponHeat + capacitorHeat + miscHeat + (hasStealth ? 10 : 0);
}

export function hasAnyEquipmentFlag(entity: BaseEntity, flags: readonly string[]): boolean {
  return entity.equipment().some(mount => mount.equipment?.hasAnyFlag([...flags]));
}
