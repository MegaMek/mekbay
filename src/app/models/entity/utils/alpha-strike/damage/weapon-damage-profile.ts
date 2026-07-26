/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */
import { WeaponEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import type { EntityMountedWeapon } from '../../../types';

export type AlphaStrikeRangeIndex = 0 | 1 | 2 | 3;
export type AlphaStrikeWeaponDamageVector = readonly [number, number, number, number];
export type AlphaStrikePrimaryDamageClass = 'STD' | 'CAP' | 'SCAP' | 'MSL';

export interface AlphaStrikeWeaponConversionMetadata {
  readonly primaryClass: AlphaStrikePrimaryDamageClass | null;
  readonly flak: boolean;
  readonly pointDefense: boolean;
  readonly artilleryDamage: boolean;
  readonly artillerySUA: string | null;
  readonly arcSUA: string | null;
  readonly explosiveComponent: boolean;
  readonly alphaStrikeHeat: number;
}

const ALPHA_STRIKE_POINT_DEFENSE_WEAPON_IDS = new Set([
  'CLERMicroLaser', 'CLMicroPulseLaser', 'CLChemicalLaserSmall', 'CLERSmallLaser',
  'CLHeavySmallLaser', 'CLSmallPulseLaser', 'ISERSmallLaser', 'Small Laser',
  'ISSmallPulseLaser', 'ISSmallReengineeredLaser', 'ISSmallXPulseLaser',
  'Machine Gun', 'CLAMS', 'CLLaserAntiMissileSystem', 'ISAMS',
  'ISLaserAntiMissileSystem', 'ISAPDS', 'ISLaserPrimitiveSmall',
  'CLERLaserSmallPrototype',
]);

/** Java WeaponType.isAlphaStrikePointDefense() as canonical MekBay equipment IDs. */
export function isAlphaStrikePointDefenseWeapon(weapon: WeaponEquipment): boolean {
  return weapon.hasAnyFlag(['F_AMS', 'F_B_POD', 'F_M_POD']) || weapon.ammoType === 'APDS'
    || ALPHA_STRIKE_POINT_DEFENSE_WEAPON_IDS.has(weapon.id);
}

export function alphaStrikeWeaponConversionMetadata(
  weapon: WeaponEquipment,
): AlphaStrikeWeaponConversionMetadata {
  const artilleryDamage = weapon.damage === 'artillery' || weapon.hasFlag('F_ARTILLERY');
  const pointDefense = isAlphaStrikePointDefenseWeapon(weapon);
  return {
    primaryClass: primaryDamageClass(weapon, pointDefense),
    flak: weapon.ammoType === 'AC_LBX',
    pointDefense,
    artilleryDamage,
    artillerySUA: artilleryDamage ? artillerySpecialAbility(weapon) : null,
    arcSUA: weapon.hasFlag('F_TELE_MISSILE') ? 'TELE'
      : weapon.hasFlag('F_NARC') ? (weapon.oneShotCount ? 'SNARC' : weapon.ammoType === 'INARC' ? 'INARC' : 'NARC')
        : null,
    explosiveComponent: weapon.isExplosive() && weapon.weapon.explosionDamage > 0,
    alphaStrikeHeat: weapon.heat,
  };
}

/** MegaMek WeaponType BattleForce classes used by ASArcedDamageConverter. */
function primaryDamageClass(
  weapon: WeaponEquipment,
  pointDefense: boolean,
): AlphaStrikePrimaryDamageClass | null {
  if (isTorpedoWeapon(weapon) || weapon.damage === 'artillery' || weapon.hasFlag('F_ARTILLERY') || pointDefense) {
    return null;
  }
  if (weapon.capital && weapon.getWeaponCategory() === 'missile') return 'MSL';
  if (weapon.capital) return 'CAP';
  if (weapon.subCapital) return 'SCAP';
  return 'STD';
}

const RANGE_HEXES: AlphaStrikeWeaponDamageVector = [0, 4, 16, 24];
/** MegaMek's Compute.clusterHitsTable, indexed as [rackSize, roll 2 through 12]. */
const CLUSTER_HIT_TABLE: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2],
  [3, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3], [4, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4],
  [5, 1, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5], [6, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6],
  [7, 2, 2, 3, 4, 4, 4, 4, 6, 6, 7, 7], [8, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 8],
  [9, 3, 3, 4, 5, 5, 5, 5, 7, 7, 9, 9], [10, 3, 3, 4, 6, 6, 6, 6, 8, 8, 10, 10],
  [11, 4, 4, 5, 7, 7, 7, 7, 9, 9, 11, 11], [12, 4, 4, 5, 8, 8, 8, 8, 10, 10, 12, 12],
  [13, 4, 4, 5, 8, 8, 8, 8, 11, 11, 13, 13], [14, 5, 5, 6, 9, 9, 9, 9, 11, 11, 14, 14],
  [15, 5, 5, 6, 9, 9, 9, 9, 12, 12, 15, 15], [16, 5, 5, 7, 10, 10, 10, 10, 13, 13, 16, 16],
  [17, 5, 5, 7, 10, 10, 10, 10, 14, 14, 17, 17], [18, 6, 6, 8, 11, 11, 11, 11, 14, 14, 18, 18],
  [19, 6, 6, 8, 11, 11, 11, 11, 15, 15, 19, 19], [20, 6, 6, 9, 12, 12, 12, 12, 16, 16, 20, 20],
  [21, 7, 7, 9, 13, 13, 13, 13, 17, 17, 21, 21], [22, 7, 7, 9, 14, 14, 14, 14, 18, 18, 22, 22],
  [23, 7, 7, 10, 15, 15, 15, 15, 19, 19, 23, 23], [24, 8, 8, 10, 16, 16, 16, 16, 20, 20, 24, 24],
  [25, 8, 8, 10, 16, 16, 16, 16, 21, 21, 25, 25], [26, 9, 9, 11, 17, 17, 17, 17, 21, 21, 26, 26],
  [27, 9, 9, 11, 17, 17, 17, 17, 22, 22, 27, 27], [28, 9, 9, 11, 17, 17, 17, 17, 23, 23, 28, 28],
  [29, 10, 10, 12, 18, 18, 18, 18, 23, 23, 29, 29], [30, 10, 10, 12, 18, 18, 18, 18, 24, 24, 30, 30],
  [40, 12, 12, 18, 24, 24, 24, 24, 32, 32, 40, 40],
];

const ARTILLERY_SUAS: Readonly<Partial<Record<WeaponEquipment['ammoType'], string>>> = {
  ARROW_IV: 'ARTAIS',
  LONG_TOM: 'ARTLT',
  SNIPER: 'ARTS',
  THUMPER: 'ARTT',
  LONG_TOM_CANNON: 'ARTLTC',
  SNIPER_CANNON: 'ARTSC',
  THUMPER_CANNON: 'ARTTC',
  BA_TUBE: 'ARTBA',
};

/** Returns MegaMek's per-mount BattleForce damage before entity-wide modifiers. */
export function battleForceDamageForMount(
  entity: BaseEntity,
  mount: EntityMountedWeapon,
  range: AlphaStrikeRangeIndex,
): number {
  assertRangeIndex(range);
  return battleForceDamage(mount.equipment, range, entity.getLinkingMount(mount)?.equipment);
}

/** Returns the unlinked base profile used by MegaMek's long-range heat filter. */
export function baseBattleForceDamageForWeapon(
  weapon: WeaponEquipment,
  range: AlphaStrikeRangeIndex,
): number {
  assertRangeIndex(range);
  return battleForceDamage(weapon, range);
}

function battleForceDamage(
  weapon: WeaponEquipment,
  range: AlphaStrikeRangeIndex,
  linked?: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean },
): number {
  const damage = nativeBattleForceDamage(weapon, range, linked);
  return weapon.capital || weapon.subCapital ? damage * 10 : damage;
}

function assertRangeIndex(range: number): asserts range is AlphaStrikeRangeIndex {
  if (!Number.isInteger(range) || range < 0 || range > 3) {
    throw new RangeError(`Alpha Strike range index must be an integer from 0 through 3; received ${range}`);
  }
}

/** Native port of MegaMek's common WeaponType BattleForce damage behavior. */
function nativeBattleForceDamage(
  weapon: WeaponEquipment,
  rangeIndex: AlphaStrikeRangeIndex,
  linked?: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean },
): number {
  if (weapon.id === 'CLPlasmaCannon') return 0;
  if (weapon.hasFlag('F_MGA')) return 0;
  if (weapon.id === 'CLERMicroLaser') return rangeIndex === 0 ? 0.2 : 0;
  if (weapon.ammoType === 'MML') return mmlDamage(weapon, rangeIndex, linked);
  if (weapon.ammoType === 'ATM') return atmDamage(weapon, rangeIndex, false);
  if (weapon.ammoType === 'IATM') return atmDamage(weapon, rangeIndex, true);
  const range = RANGE_HEXES[rangeIndex];
  if (range > (weapon.ranges[2] ?? 0)) return 0;

  if (weapon.ammoType === 'AC_ROTARY') return rotaryAutocannonDamage(weapon, rangeIndex);
  if (weapon.ammoType === 'AC_ULTRA' || weapon.ammoType === 'AC_ULTRA_THB') {
    return applyMinimumRange(weapon.rackSize * 1.5, weapon, rangeIndex) / 10;
  }
  if (weapon.ammoType === 'AC_LBX') {
    return applyMinimumRange(clusterHits(7, weapon.rackSize) * 1.05, weapon, rangeIndex) / 10;
  }
  if (weapon.hasFlag('F_HAG') || weapon.ammoType === 'HAG') return hagDamage(weapon, rangeIndex);
  if (weapon.ammoType === 'LRM_STREAK') return rangeIndex <= 2 ? weapon.rackSize * 0.1 : 0;
  if (weapon.ammoType === 'SRM_STREAK' || weapon.id.includes('StreakSRM')) {
    return weapon.rackSize * 0.2;
  }
  if (weapon.hasFlag('F_MRM') || weapon.ammoType === 'MRM') {
    const roll = linked?.hasFlag('F_APOLLO') ? 6 : 7;
    const multiplier = linked?.hasFlag('F_APOLLO') ? 1 : 0.95;
    return applyMinimumRange(clusterHits(roll, weapon.rackSize) * multiplier, weapon, rangeIndex) / 10;
  }
  if (isClusterMissile(weapon)) {
    const roll = linked?.hasFlag('F_ARTEMIS_V') ? 11
      : linked?.hasFlag('F_ARTEMIS') ? 9
        : linked?.hasFlag('F_ARTEMIS_PROTO') ? 8 : 7;
    const multiplier = weapon.hasFlag('F_SRM') || weapon.ammoType === 'SRM' ? 2 : 1;
    return applyMinimumRange(clusterHits(roll, weapon.rackSize) * multiplier, weapon, rangeIndex) / 10;
  }
  if (weapon.hasFlag('F_PPC') && linked?.hasFlag('F_PPC_CAPACITOR')) {
    return genericBattleForceDamage(weapon, rangeIndex, damage => (damage + 5) / 2);
  }
  if (weapon.ammoType === 'AC') return applyMinimumRange(weapon.rackSize, weapon, rangeIndex) / 10;
  return genericBattleForceDamage(weapon, rangeIndex);
}

function genericBattleForceDamage(
  weapon: WeaponEquipment,
  rangeIndex: AlphaStrikeRangeIndex,
  adjustDamage: (damage: number) => number = damage => damage,
): number {
  const rawDamage = rawDamageAtRange(weapon, rangeIndex);
  if (rawDamage === 0) return 0;
  let damage = adjustDamage(rawDamage);
  damage = applyMinimumRange(damage, weapon, rangeIndex);
  const toHitModifier = typeof weapon.toHitModifier === 'number'
    ? weapon.toHitModifier : weapon.toHitModifier[0] ?? 0;
  return (damage - damage * toHitModifier * 0.05) / 10;
}

/** Compatibility export for custom equipment and callers outside conversion. */
export function legacyBattleForceDamageFallback(
  weapon: WeaponEquipment,
  rangeIndex: AlphaStrikeRangeIndex,
): number {
  assertRangeIndex(rangeIndex);
  return genericBattleForceDamage(weapon, rangeIndex);
}

function rawDamageAtRange(weapon: WeaponEquipment, rangeIndex: AlphaStrikeRangeIndex): number {
  if ((weapon.capital || weapon.subCapital) && weapon.weapon.av.some(value => value !== 0)) {
    return weapon.weapon.av[rangeIndex] ?? 0;
  }
  const damage = weapon.weapon.damage;
  if (Array.isArray(damage)) {
    const index = Math.min(rangeIndex, damage.length - 1);
    return damage[index] ?? 0;
  }
  if (typeof damage === 'number' && damage >= 0) return damage;
  let avIndex = rangeIndex;
  while (avIndex > 0 && (weapon.weapon.av[avIndex] ?? 0) === 0) avIndex--;
  return weapon.weapon.av[avIndex] ?? 0;
}

function applyMinimumRange(damage: number, weapon: WeaponEquipment, rangeIndex: AlphaStrikeRangeIndex): number {
  return rangeIndex === 0 && weapon.minimumRange > 0
    ? damage * (12 - weapon.minimumRange) / 12
    : damage;
}

function clusterHits(roll: number, rackSize: number): number {
  if (!Number.isInteger(roll) || roll < 2 || roll > 12) {
    throw new RangeError(`Cluster table roll must be an integer from 2 through 12; received ${roll}`);
  }
  const row = CLUSTER_HIT_TABLE.find(candidate => candidate[0] === rackSize);
  return row?.[roll - 1] ?? 0;
}

function isClusterMissile(weapon: WeaponEquipment): boolean {
  return (weapon.damage === 'cluster' && weapon.hasAnyFlag(['F_LRM', 'F_SRM', 'F_MML']))
    || ['LRM', 'SRM', 'MML', 'LRM_PRIMITIVE', 'LRM_IMP', 'SRM_IMP'].includes(weapon.ammoType);
}

function hagDamage(weapon: WeaponEquipment, rangeIndex: AlphaStrikeRangeIndex): number {
  const multiplier = weapon.rackSize === 20 ? 1 : weapon.rackSize === 30 ? 1.5 : 2;
  if (rangeIndex === 0) return 1.328 * multiplier;
  return rangeIndex <= 2 ? 1.2 * multiplier : 0;
}

/** ISMML3/5/7/9 getBattleForceDamage overrides in MegaMek. */
function mmlDamage(
  weapon: WeaponEquipment,
  rangeIndex: AlphaStrikeRangeIndex,
  linked?: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean },
): number {
  const standard: Readonly<Partial<Record<number, AlphaStrikeWeaponDamageVector>>> = {
    3: [0.4, 0.3, 0.2, 0],
    5: [0.6, 0.45, 0.3, 0],
    7: [0.8, 0.6, 0.4, 0],
    9: [1, 0.75, 0.5, 0],
  };
  const artemis: Readonly<Partial<Record<number, AlphaStrikeWeaponDamageVector>>> = {
    5: [0.8, 0.6, 0.4, 0],
    7: [1.2, 0.9, 0.6, 0],
    9: [1.4, 1.05, 0.7, 0],
  };
  const usesArtemis = linked?.hasFlag('F_ARTEMIS') || linked?.hasFlag('F_ARTEMIS_PROTO');
  return (usesArtemis ? artemis[weapon.rackSize] : standard[weapon.rackSize])?.[rangeIndex] ?? 0;
}

/** CLATM3/6/9/12 and CLIATM3/6/9/12 getBattleForceDamage overrides in MegaMek. */
function atmDamage(
  weapon: WeaponEquipment,
  rangeIndex: AlphaStrikeRangeIndex,
  improved: boolean,
): number {
  const profiles: Readonly<Partial<Record<number, AlphaStrikeWeaponDamageVector>>> = improved ? {
    3: [0.9, 0.6, 0.3, 0],
    6: [1.8, 1.2, 0.6, 0],
    9: [2.7, 1.8, 0.9, 0],
    12: [3.6, 2.4, 1.2, 0],
  } : {
    3: [0.6, 0.4, 0.2, 0],
    6: [1.5, 1, 0.5, 0],
    9: [2.1, 1.4, 0.7, 0],
    12: [3, 2, 1, 0],
  };
  return profiles[weapon.rackSize]?.[rangeIndex] ?? 0;
}

function rotaryAutocannonDamage(weapon: WeaponEquipment, rangeIndex: AlphaStrikeRangeIndex): number {
  if (weapon.rackSize === 2) return rangeIndex <= 2 ? 0.8 : 0;
  return rangeIndex <= 1 ? 2 : 0;
}

function isTorpedoWeapon(weapon: WeaponEquipment): boolean {
  return ['LRM_TORPEDO', 'SRM_TORPEDO', 'LRM_TORPEDO_COMBO'].includes(weapon.ammoType);
}

function artillerySpecialAbility(weapon: WeaponEquipment): string | null {
  if (weapon.ammoType === 'ARROW_IV') return weapon.techBase === 'Clan' ? 'ARTAC' : 'ARTAIS';
  if (weapon.ammoType === 'CRUISE_MISSILE') {
    return weapon.rackSize === 50 ? 'ARTCM5' : weapon.rackSize === 70 ? 'ARTCM7'
      : weapon.rackSize === 90 ? 'ARTCM9' : 'ARTCM12';
  }
  return ARTILLERY_SUAS[weapon.ammoType] ?? null;
}
