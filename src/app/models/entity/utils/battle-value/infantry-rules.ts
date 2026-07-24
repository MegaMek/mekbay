import type { InfantryEntity } from '../../entities/infantry/infantry-entity';

const PROSTHETIC_DAMAGE: Readonly<Record<string, number>> = {
  LASER: 0.11,
  BALLISTIC: 0.01,
  NEEDLER: 0.04,
  SHOTGUN: 0.05,
  SONIC_STUNNER: 0.05,
  SMG: 0.05,
  BLADE: 0.02,
  SHOCKER: 0.04,
  VIBROBLADE: 0.14,
  RUMAL_GARROTE: 0.14,
  GRAPPLER: 0,
  CLIMBING_CLAWS: 0.02,
};

function normalizedProsthetic(value: string): string {
  return value.trim().toUpperCase().replace(/[\s/()-]+/g, '_').replace(/^_|_$/g, '');
}

export function hasInfantryAugmentation(entity: InfantryEntity, augmentation: string): boolean {
  return entity.augmentations().includes(augmentation);
}

/** Mirrors ConvInfantry.calcDamageDivisor() for pristine construction state. */
export function infantryDamageDivisor(entity: InfantryEntity): number {
  const armorKit = entity.armorKit();
  let divisor = armorKit?.damageDivisor ?? entity.armorDivisor();
  if (!armorKit && divisor === 1 && hasInfantryAugmentation(entity, 'tsm_implant')) divisor = 0.5;
  if (divisor === 0.5 && hasInfantryAugmentation(entity, 'dermal_camo_armor')) divisor = 1;
  if (hasInfantryAugmentation(entity, 'dermal_armor')) divisor += 1;
  return divisor * (entity.mount()?.damageDivisor ?? 1);
}

export function hasDermalCamoStealth(entity: InfantryEntity): boolean {
  return !entity.armorKit()
    && hasInfantryAugmentation(entity, 'dermal_camo_armor')
    && (entity.motiveType() === 'Leg' || entity.motiveType() === 'Jump');
}

export function prostheticDamageBonus(entity: InfantryEntity): number {
  return (PROSTHETIC_DAMAGE[normalizedProsthetic(entity.prostheticEnhancement1())] ?? 0)
    * entity.prostheticEnhancement1Count()
    + (PROSTHETIC_DAMAGE[normalizedProsthetic(entity.prostheticEnhancement2())] ?? 0)
    * entity.prostheticEnhancement2Count();
}

export function hasProstheticAntiMekBonus(entity: InfantryEntity): boolean {
  return [
    entity.prostheticEnhancement1(), entity.prostheticEnhancement2(),
    entity.extraneousPair1(), entity.extraneousPair2(),
  ].some(value => ['GRAPPLER', 'CLIMBING_CLAWS'].includes(normalizedProsthetic(value)));
}

/** Mirrors ConvInfantry.canMakeAntiMekAttacks() for pristine units. */
export function canMakeAntiMekAttacks(entity: InfantryEntity): boolean {
  const mechanized = ['Tracked', 'Wheeled', 'Hover', 'VTOL', 'Submarine'].includes(entity.motiveType());
  const hasFieldWeapon = entity.equipment().some(mount => mount.location === 'Field Guns');
  return !mechanized && !entity.effectiveEncumberingArmor() && !hasFieldWeapon;
}