import type { BaseEntity } from '../../../base-entity';
import { dualRoundedUpDamage } from '../damage/damage-rounding';
import { alphaStrikeDamageLocationMultiplier } from '../damage/generic-location-mapper';
import { alphaStrikeHeatSpecial, sumAlphaStrikeHeatDamage } from '../damage/heat-damage';
import { sumAlphaStrikeWeaponDamage } from '../damage/weapon-damage-aggregation';
import { alphaStrikeWeaponSpecials } from './weapon-specials';

/** Serializes the scoped standard damage and special abilities in a TUR ability. */
export function alphaStrikeTurretSpecial(entity: BaseEntity): string | undefined {
  const rawDamage = sumAlphaStrikeWeaponDamage(entity, mount =>
    alphaStrikeDamageLocationMultiplier(entity, 'turret', mount) > 0);
  const abilities = alphaStrikeWeaponSpecials(entity, 'turret');
  const heat = alphaStrikeHeatSpecial(sumAlphaStrikeHeatDamage(entity.mountedWeapons(), mount =>
    alphaStrikeDamageLocationMultiplier(entity, 'turret', mount) > 0));
  if (heat) abilities.push(heat);

  const standardDamage = rawDamage.some(value => value > 0)
    ? rawDamage.slice(0, 3).map(value => {
      const damage = dualRoundedUpDamage(value);
      return damage === '0' ? '-' : damage;
    }).join('/')
    : undefined;
  const contents = standardDamage ? [standardDamage, ...sortAbilities(abilities)] : sortAbilities(abilities);
  return contents.length > 0 ? `TUR(${contents.join(',')})` : undefined;
}

function sortAbilities(abilities: readonly string[]): string[] {
  return [...new Set(abilities)].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' }));
}
