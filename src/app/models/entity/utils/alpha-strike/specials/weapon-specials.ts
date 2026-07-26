import { AmmoEquipment, type AmmoType, type WeaponEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import { BattleArmorEntity, InfantryEntity } from '../../../entities';
import type { EntityMountedWeapon } from '../../../types';
import {
  alphaStrikeDamageLocationMultiplier,
  alphaStrikeSpecialLocationMultiplier,
  type AlphaStrikeDamageLocation,
} from '../damage/generic-location-mapper';
import { baseBattleForceDamageForWeapon, type AlphaStrikeRangeIndex } from '../damage/weapon-damage-profile';
import { dualRoundedNormalDamage, roundUpToTenth } from '../damage/damage-rounding';
import { AlphaStrikeSpecialAbilityCollector } from './special-ability-collector';
import { alphaStrikeAmmoDamageMultiplier } from '../damage/weapon-modifiers';

type WeaponSpecialDamageKind = 'LRM' | 'SRM' | 'AC' | 'FLK' | 'IATM' | 'TOR' | 'REL';
type RawDamage = [number, number, number, number];

const SPECIAL_AMMO_TYPES: Readonly<Record<WeaponSpecialDamageKind, readonly WeaponEquipment['ammoType'][]>> = {
  LRM: ['LRM', 'LRM_PRIMITIVE', 'LRM_IMP', 'MML'],
  SRM: ['SRM', 'SRM_IMP', 'MML'],
  AC: ['AC', 'AC_PRIMITIVE', 'AC_IMP', 'AC_ULTRA', 'AC_ULTRA_THB', 'AC_LBX', 'AC_LBX_THB', 'AC_ROTARY'],
  FLK: ['AC_LBX', 'AC_LBX_THB'],
  IATM: ['IATM'],
  TOR: ['LRM_TORPEDO', 'SRM_TORPEDO', 'LRM_TORPEDO_COMBO'],
  REL: ['ROCKET_LAUNCHER'],
};

const ARTILLERY_ABILITIES: Readonly<Partial<Record<AmmoType, string>>> = {
  LONG_TOM: 'ARTLT',
  SNIPER: 'ARTS',
  THUMPER: 'ARTT',
  LONG_TOM_CANNON: 'ARTLTC',
  SNIPER_CANNON: 'ARTSC',
  THUMPER_CANNON: 'ARTTC',
  BA_TUBE: 'ARTBA',
};

/** Converts generic unit weapon abilities that are not represented in Alpha Strike arcs. */
export function alphaStrikeWeaponSpecials(
  entity: BaseEntity,
  scope: 'standard' | 'turret' = 'standard',
): string[] {
  const specials = new AlphaStrikeSpecialAbilityCollector();
  const weapons = entity.mountedWeapons();
  const ammo = entity.equipment().filter(mount => mount.equipment instanceof AmmoEquipment);
  const targetingComputer = entity.equipment().some(mount => mount.equipment?.hasFlag('F_TARGETING_COMPUTER'));

  const countsForDiscreteSpecial = (mount: EntityMountedWeapon) =>
    alphaStrikeSpecialLocationMultiplier(entity, scope, mount) > 0;
  const countsForDamageSpecial = (mount: EntityMountedWeapon) =>
    alphaStrikeDamageLocationMultiplier(entity, scope, mount) > 0;
  for (const mount of weapons) {
    if (countsForDiscreteSpecial(mount)) {
      addDiscreteWeaponSpecials(mount, specials, entity instanceof BattleArmorEntity || entity instanceof InfantryEntity);
    }
  }
  addArtillerySpecials(weapons.filter(countsForDiscreteSpecial), specials);
  addDamageSpecials(entity, weapons, ammo, targetingComputer, specials, countsForDamageSpecial);
  if (scope === 'standard') addRearSpecial(entity, weapons, ammo, targetingComputer, specials);
  return specials.toArray();
}

function addDiscreteWeaponSpecials(
  mount: EntityMountedWeapon,
  specials: AlphaStrikeSpecialAbilityCollector,
  infantryElement: boolean,
): void {
  const weapon = mount.equipment;
  if (infantryElement && weapon.isInfantryWeapon()) specials.add('AM');
  if (weapon.hasFlag('F_TAG')) {
    specials.add(weapon.ranges[0] < 5 ? 'LTAG' : 'TAG');
    if (weapon.hasFlag('F_C3MBS')) {
      specials.add('C3BSM1');
      addNumericSpecial(specials, 'MHQ', 6);
    } else if (weapon.hasFlag('F_C3M')) {
      specials.add('C3M1');
      addNumericSpecial(specials, 'MHQ', 5);
    }
  }
  if (weapon.hasAnyFlag(['F_TSEMP', 'F_CWS'])) addNumericSpecial(specials, weapon.oneShotCount ? 'TSEMPO' : 'TSEMP', 1);
  if (weapon.hasFlag('F_TELE_MISSILE')) specials.add('TELE');
  if (weapon.ammoType === 'INARC') addNumericSpecial(specials, 'INARC', 1);
  else if (weapon.ammoType === 'NARC') addNumericSpecial(specials, 'SNARC', 1);
  if (weapon.ammoType === 'TASER') addNumericSpecial(specials, 'MTAS', 1);
  if (weapon.ammoType === 'APDS') specials.add('RAMS');
  else if (weapon.hasFlag('F_AMS')) specials.add('AMS');
}

function addArtillerySpecials(
  weapons: readonly EntityMountedWeapon[],
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  for (const mount of weapons) {
    const weapon = mount.equipment;
    if (weapon.damage !== 'artillery' && !weapon.hasFlag('F_ARTILLERY')) continue;
    const ability = artilleryAbility(weapon);
    if (ability) addArtillerySpecial(specials, ability);
  }
}

function addArtillerySpecial(specials: AlphaStrikeSpecialAbilityCollector, ability: string): void {
  specials.addHyphenatedCount(ability);
}

function artilleryAbility(weapon: WeaponEquipment): string | null {
  if (weapon.ammoType === 'ARROW_IV') return weapon.techBase === 'Clan' ? 'ARTAC' : 'ARTAIS';
  if (weapon.ammoType === 'CRUISE_MISSILE') return weapon.rackSize === 50 ? 'ARTCM5'
    : weapon.rackSize === 70 ? 'ARTCM7' : weapon.rackSize === 90 ? 'ARTCM9' : 'ARTCM12';
  return ARTILLERY_ABILITIES[weapon.ammoType] ?? null;
}

function addDamageSpecials(
  entity: BaseEntity,
  weapons: readonly EntityMountedWeapon[],
  ammo: readonly ReturnType<BaseEntity['equipment']>[number][],
  targetingComputer: boolean,
  specials: AlphaStrikeSpecialAbilityCollector,
  countsForScope: (mount: EntityMountedWeapon) => boolean,
): void {
  for (const kind of Object.keys(SPECIAL_AMMO_TYPES) as WeaponSpecialDamageKind[]) {
    const damage = sumSpecialDamage(entity, weapons, ammo, targetingComputer, (weapon, mount) =>
      countsForScope(mount) && SPECIAL_AMMO_TYPES[kind].includes(weapon.ammoType)
      && (kind !== 'LRM' && kind !== 'SRM' || !hasArtemis(entity, mount)), kind);
    if (kind === 'REL' && damage.some(value => value > 0)) specials.add('REL');
    else if (qualifiesForDamageSpecial(damage, kind)) specials.add(`${kind}${formatDamage(damage, kind)}`);
  }

  const indirectFire = sumSpecialDamage(entity, weapons, ammo, targetingComputer, (weapon, mount) =>
    countsForScope(mount)
    && ['LRM', 'LRM_PRIMITIVE', 'LRM_IMP', 'MML'].includes(weapon.ammoType)
    && !hasArtemis(entity, mount));
  if (indirectFire[2] > 0) specials.add(`IF${dualRoundedNormalDamage(indirectFire[2])}`);
}

function addRearSpecial(
  entity: BaseEntity,
  weapons: readonly EntityMountedWeapon[],
  ammo: readonly ReturnType<BaseEntity['equipment']>[number][],
  targetingComputer: boolean,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  const damage = sumSpecialDamage(entity, weapons, ammo, targetingComputer, (_weapon, mount) =>
    alphaStrikeDamageLocationMultiplier(entity, 'rear', mount) > 0);
  if (damage.some(value => value > 0)) specials.add(`REAR${formatRearDamage(damage)}`);
}

function sumSpecialDamage(
  entity: BaseEntity,
  weapons: readonly EntityMountedWeapon[],
  ammo: readonly ReturnType<BaseEntity['equipment']>[number][],
  targetingComputer: boolean,
  include: (weapon: WeaponEquipment, mount: EntityMountedWeapon) => boolean,
  kind?: WeaponSpecialDamageKind,
): RawDamage {
  const result: RawDamage = [0, 0, 0, 0];
  for (const mount of weapons) {
    const weapon = mount.equipment;
    if (!include(weapon, mount) || weapon.damage === 'artillery' || weapon.hasFlag('F_ARTILLERY')) continue;
    let multiplier = alphaStrikeAmmoDamageMultiplier(weapon, weapons, ammo);
    if (weapon.oneShotCount) multiplier *= 0.1;
    if (targetingComputer && weapon.hasFlag('F_DIRECT_FIRE')) multiplier *= 1.1;
    for (let range = 0; range < 4; range++) {
      const mmlMultiplier = mmlDamageMultiplier(weapon, range as AlphaStrikeRangeIndex, kind);
      result[range] += baseBattleForceDamageForWeapon(weapon, range as AlphaStrikeRangeIndex) * multiplier * mmlMultiplier;
    }
  }
  return result;
}

function hasArtemis(entity: BaseEntity, mount: EntityMountedWeapon): boolean {
  const linked = entity.getLinkingMount(mount)?.equipment;
  return !!linked?.hasAnyFlag(['F_ARTEMIS', 'F_ARTEMIS_PROTO', 'F_ARTEMIS_V']);
}

function mmlDamageMultiplier(
  weapon: WeaponEquipment,
  range: AlphaStrikeRangeIndex,
  kind: WeaponSpecialDamageKind | undefined,
): number {
  if (weapon.ammoType !== 'MML') return 1;
  if (kind === 'LRM') return range === 0 ? 0 : range === 1 ? 0.5 : 1;
  if (kind === 'SRM') return range === 2 ? 0 : range === 1 ? 0.5 : 1;
  return 1;
}

function qualifiesForDamageSpecial(damage: RawDamage, kind: WeaponSpecialDamageKind): boolean {
  if (kind === 'FLK' || kind === 'TOR') return damage.some(value => value > 0);
  return roundUpToTenth(damage[1]) >= 1;
}

function formatDamage(damage: RawDamage, kind: WeaponSpecialDamageKind): string {
  const rangeCount = kind === 'SRM' ? 2 : 3;
  const usesMinimumDamage = kind === 'FLK' || kind === 'TOR';
  return damage.slice(0, rangeCount)
    .map(value => formatSpecialDamage(value, usesMinimumDamage))
    .join('/');
}

function formatRearDamage(damage: RawDamage): string {
  return damage.slice(0, 3).map(value => value > 0 ? dualRoundedNormalDamage(value) : '-').join('/');
}

function formatSpecialDamage(value: number, usesMinimumDamage: boolean): string {
  if (usesMinimumDamage) return value > 0 ? dualRoundedNormalDamage(value) : '-';
  return String(Math.round(roundUpToTenth(value))) === '0' ? '-' : String(Math.round(roundUpToTenth(value)));
}

function addNumericSpecial(
  specials: AlphaStrikeSpecialAbilityCollector,
  ability: string,
  value: number,
): void {
  specials.addNumeric(ability, value);
}