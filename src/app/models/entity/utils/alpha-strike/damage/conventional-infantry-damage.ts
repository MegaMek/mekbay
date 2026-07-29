import { getAmmoCategory } from '../../../../equipment.model';
import type { InfantryEntity } from '../../../entities';
import { toStandardDamage } from './damage-rounding';
import { type AlphaStrikeStandardDamageResult, ZERO_DAMAGE } from './damage-types';
import { sumAlphaStrikeWeaponDamage } from './weapon-damage-aggregation';
import { alphaStrikeTroopFactor } from './troop-factor';

/** Converts conventional infantry and field-gun standard damage plus HT. */
export function calculateConventionalInfantryDamage(
  entity: InfantryEntity,
): AlphaStrikeStandardDamageResult {
  const fieldGuns = entity.rangedWeapons().filter(mount => mount.location === 'Field Guns');
  const hasActiveFieldArtillery = fieldGuns.some(mount =>
    getAmmoCategory(mount.equipment.ammoType) === 'Artillery');
  if (fieldGuns.length > 0 && !hasActiveFieldArtillery) {
    const raw = sumAlphaStrikeWeaponDamage(entity, mount => mount.location === 'Field Guns');
    raw[3] = 0;
    const standard = toStandardDamage(raw);
    return emptyResult(standard, heatSpecial(entity, standard));
  }

  const weapon = entity.rangeWeapon();
  if (!weapon?.infantry) return emptyResult({ ...ZERO_DAMAGE });
  const factor = alphaStrikeTroopFactor(entity.totalInternalPoints());
  const primary = entity.primaryWeapon();
  const secondary = entity.secondaryWeapon();
  const secondaryCount = entity.secondaryCount();
  const squadSize = Math.max(entity.squadSize(), 1);
  const damagePerTrooper = (
    Math.min(0.6, primary?.infantry.damage ?? 0) * Math.max(0, squadSize - secondaryCount)
    + (secondary?.infantry.damage ?? 0) * secondaryCount
  ) / squadSize;
  const shortDamage = damagePerTrooper * factor / 10;
  const range = weapon.infantry.range * 3;
  const standard = toStandardDamage([
    shortDamage,
    range > 3 ? shortDamage : 0,
    range > 15 ? shortDamage : 0,
    0,
  ]);
  return emptyResult(standard, heatSpecial(entity, standard));
}

function emptyResult(
  standard: AlphaStrikeStandardDamageResult['standard'],
  heatSpecials: readonly string[] = [],
): AlphaStrikeStandardDamageResult {
  return { standard, overheat: 0, arcs: {}, heatSpecials };
}

function heatSpecial(
  entity: InfantryEntity,
  standard: AlphaStrikeStandardDamageResult['standard'],
): string[] {
  const fieldGuns = entity.rangedWeapons().filter(mount => mount.location === 'Field Guns');
  const eligibleWeapons = fieldGuns.length > 0
    ? fieldGuns.map(mount => mount.equipment)
    : [entity.rangeWeapon()];
  const hasHeatWeapon = eligibleWeapons.some(weapon => weapon?.hasAnyFlag(['F_FLAMER', 'F_PLASMA']));
  const shortDamage = Number.parseInt(standard.dmgS, 10) || 0;
  if (!hasHeatWeapon || shortDamage < 1) return [];
  const heatDamage = Math.min(2, shortDamage);
  return [`HT${heatDamage}/${standard.dmgM === '0' ? '-' : heatDamage}/${standard.dmgL === '0' ? '-' : heatDamage}`];
}