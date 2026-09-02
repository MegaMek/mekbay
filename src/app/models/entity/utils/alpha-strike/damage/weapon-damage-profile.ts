// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import type { EntityMountedWeapon } from '../../../types';
import {
  artemisClanLrmDamageMultiplier,
  artemisClusterRoll,
  artemisKind,
  artemisTorpedoDamageMultiplier,
  isArtemisCompatibleWeapon,
  isArtemisEquipment,
  usesArtemisIVDamageTable,
} from '../../../../artemis-equipment.model';
import { alphaStrikeArtilleryAbility } from '../specials/artillery-special';
import { clusterHits } from '../../../../../utils/cluster-hit-table';
import { isApolloEquipment } from '../../../../apollo-mode.model';
import {
  PPC_CAPACITOR_DAMAGE_BONUS,
  isPpcCapacitorCompatibleWeapon,
  isPpcCapacitorEquipment,
  isPpcEquipment,
} from '../../../../ppc-capacitor.model';

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
}

/** Java WeaponType.isAlphaStrikePointDefense(), exported with Alpha Strike-only data. */
export function isAlphaStrikePointDefenseWeapon(weapon: WeaponEquipment): boolean {
  return weapon.alphaStrike?.pointDefense === true;
}

export function hasAlphaStrikeBattleForceClass(
  weapon: WeaponEquipment,
  battleForceClass: NonNullable<WeaponEquipment['alphaStrike']>['battleForceClass'],
): boolean {
  return weapon.alphaStrike?.battleForceClass === battleForceClass;
}

export function alphaStrikeWeaponConversionMetadata(
  weapon: WeaponEquipment,
): AlphaStrikeWeaponConversionMetadata {
  const artilleryDamage = weapon.damage === 'artillery';
  const pointDefense = isAlphaStrikePointDefenseWeapon(weapon);
  return {
    primaryClass: primaryDamageClass(weapon, pointDefense),
    flak: hasAlphaStrikeBattleForceClass(weapon, 'FLAK'),
    pointDefense,
    artilleryDamage,
    artillerySUA: artilleryDamage ? alphaStrikeArtilleryAbility(weapon) : null,
    arcSUA: weapon.weapon.atClass === 'TELE_MISSILE' ? 'TELE'
      : weapon.ammoType === 'INARC' ? 'INARC'
        : weapon.ammoType === 'NARC' ? 'SNARC' : null,
  };
}

/** MegaMek WeaponType BattleForce classes used by ASArcedDamageConverter. */
function primaryDamageClass(
  weapon: WeaponEquipment,
  pointDefense: boolean,
): AlphaStrikePrimaryDamageClass | null {
  if (hasAlphaStrikeBattleForceClass(weapon, 'TORPEDO')
    || weapon.damage === 'artillery'
    || (pointDefense && weapon.hasFlag('F_AMS'))) {
    return null;
  }
  if (hasAlphaStrikeBattleForceClass(weapon, 'CAPITAL_MISSILE')) return 'MSL';
  if (hasAlphaStrikeBattleForceClass(weapon, 'SUBCAPITAL')) return 'SCAP';
  if (hasAlphaStrikeBattleForceClass(weapon, 'CAPITAL')) return 'CAP';
  return 'STD';
}

const RANGE_HEXES: AlphaStrikeWeaponDamageVector = [0, 4, 16, 24];
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
  linked?: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean },
): number {
  assertRangeIndex(range);
  return battleForceDamage(weapon, range, linked);
}

function battleForceDamage(
  weapon: WeaponEquipment,
  range: AlphaStrikeRangeIndex,
  linked?: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean },
): number {
  if (weapon.alphaStrike?.damage) {
    if (weapon.ammoType === 'EXLRM') return weapon.alphaStrike.damage[range];
    const torpedoArtemisDamage = torpedoArtemisProfileDamage(weapon, range, linked);
    if (torpedoArtemisDamage !== null) {
      return torpedoArtemisDamage;
    }
    const clanLrmArtemisMultiplier = clanLrmArtemisDamageMultiplier(weapon, linked);
    if (clanLrmArtemisMultiplier !== null) {
      return weapon.alphaStrike.damage[range] * clanLrmArtemisMultiplier;
    }
    const clanSrmArtemisDamage = clanSrmArtemisProfileDamage(weapon, range, linked);
    if (clanSrmArtemisDamage !== null) return clanSrmArtemisDamage;
    const capacitatedSnubDamage = capacitatedSnubPpcDamage(weapon, range, linked);
    if (capacitatedSnubDamage !== null) return capacitatedSnubDamage;
    if (!hasDynamicFireControl(linked)) return weapon.alphaStrike.damage[range];
  }
  const damage = nativeBattleForceDamage(weapon, range, linked);
  return weapon.capital || weapon.subCapital ? damage * 10 : damage;
}

/** Torpedo profiles require underwater ranges, so the exported profile supplies the range-band mask. */
function torpedoArtemisProfileDamage(
  weapon: WeaponEquipment,
  range: AlphaStrikeRangeIndex,
  linked: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean } | undefined,
): number | null {
  if (!hasAlphaStrikeBattleForceClass(weapon, 'TORPEDO')
    || !isArtemisCompatibleWeapon(weapon)) return null;
  if (weapon.techBase === 'Clan' && weapon.ammoType === 'LRM_TORPEDO') {
    const multiplier = artemisTorpedoDamageMultiplier(linked);
    return multiplier === null ? null : (weapon.alphaStrike?.damage?.[range] ?? 0) * multiplier;
  }
  if (weapon.techBase === 'Clan' && weapon.ammoType === 'SRM_TORPEDO') {
    const artemisIV: Readonly<Partial<Record<number, number>>> = { 2: 0.4, 4: 0.6, 6: 1 };
    const artemisV: Readonly<Partial<Record<number, number>>> = { 2: 0.42, 4: 0.63, 6: 1.05 };
    const kind = artemisKind(linked);
    const damage = kind === 'v' ? artemisV[weapon.rackSize]
      : kind === 'iv' || kind === 'prototype'
        ? artemisIV[weapon.rackSize] : undefined;
    return damage === undefined ? null : (weapon.alphaStrike?.damage?.[range] ?? 0) > 0 ? damage : 0;
  }
  const roll = artemisClusterRoll(linked);
  if (roll === null) return null;
  if ((weapon.alphaStrike?.damage?.[range] ?? 0) <= 0) return 0;
  const missileDamage = weapon.ammoType === 'SRM_TORPEDO' ? 2 : 1;
  return applyMinimumRange(
    clusterHits(roll, weapon.rackSize) * missileDamage,
    weapon,
    range,
  ) / 10;
}

function clanSrmArtemisProfileDamage(
  weapon: WeaponEquipment,
  range: AlphaStrikeRangeIndex,
  linked: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean } | undefined,
): number | null {
  if (weapon.techBase !== 'Clan'
    || !hasAlphaStrikeBattleForceClass(weapon, 'SRM')
    || !isArtemisCompatibleWeapon(weapon)) return null;
  const artemisIV: Readonly<Partial<Record<number, number>>> = { 2: 0.4, 4: 0.6, 6: 1 };
  const artemisV: Readonly<Partial<Record<number, number>>> = { 2: 0.42, 4: 0.63, 6: 1.05 };
  const kind = artemisKind(linked);
  const damage = kind === 'v' ? artemisV[weapon.rackSize]
    : kind === 'iv' || kind === 'prototype'
      ? artemisIV[weapon.rackSize] : undefined;
  return damage === undefined ? null : range <= 1 ? damage : 0;
}

function capacitatedSnubPpcDamage(
  weapon: WeaponEquipment,
  range: AlphaStrikeRangeIndex,
  linked: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean } | undefined,
): number | null {
  const classicDamage = weapon.weapon.damage;
  const alphaStrikeDamage = weapon.alphaStrike?.damage;
  if (!isPpcCapacitorEquipment(linked)
    || weapon.techBase !== 'IS'
    || !isPpcCapacitorCompatibleWeapon(weapon)
    || !Array.isArray(classicDamage)
    || classicDamage[0] !== 10 || classicDamage[1] !== 8 || classicDamage[2] !== 5
    || alphaStrikeDamage?.[0] !== 1 || alphaStrikeDamage[1] !== 0.65) return null;
  return ([0.75, 0.5, 0, 0] as const)[range];
}

/** Clan LRM weapon overrides scale their exported unlinked profile for Artemis fire control. */
function clanLrmArtemisDamageMultiplier(
  weapon: WeaponEquipment,
  linked: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean } | undefined,
): number | null {
  if (weapon.techBase !== 'Clan'
    || !hasAlphaStrikeBattleForceClass(weapon, 'LRM')
    || !isArtemisCompatibleWeapon(weapon)) return null;
  return artemisClanLrmDamageMultiplier(linked);
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
  if (weapon.hasFlag('F_MGA')) return 0;
  if (hasAlphaStrikeBattleForceClass(weapon, 'MML')) return mmlDamage(weapon, rangeIndex, linked);
  const range = RANGE_HEXES[rangeIndex];
  if (range > (weapon.ranges[2] ?? 0)) return 0;
  if (weapon.hasFlag('F_MRM') || weapon.ammoType === 'MRM') {
    const roll = isApolloEquipment(linked) ? 6 : 7;
    const multiplier = isApolloEquipment(linked) ? 1 : 0.95;
    return applyMinimumRange(clusterHits(roll, weapon.rackSize) * multiplier, weapon, rangeIndex) / 10;
  }
  if (isClusterMissile(weapon)) {
    const roll = artemisClusterRoll(linked, 7)!;
    const multiplier = weapon.hasFlag('F_SRM')
      || weapon.ammoType === 'SRM'
      || weapon.ammoType === 'SRM_TORPEDO' ? 2 : 1;
    return applyMinimumRange(clusterHits(roll, weapon.rackSize) * multiplier, weapon, rangeIndex) / 10;
  }
  if (isPpcEquipment(weapon) && isPpcCapacitorEquipment(linked)) {
    return genericBattleForceDamage(
      weapon,
      rangeIndex,
      damage => (damage + PPC_CAPACITOR_DAMAGE_BONUS) / 2,
    );
  }
  if (weapon.ammoType === 'AC') return applyMinimumRange(weapon.rackSize, weapon, rangeIndex) / 10;
  return genericBattleForceDamage(weapon, rangeIndex);
}

function hasDynamicFireControl(
  linked: { hasFlag(flag: Parameters<WeaponEquipment['hasFlag']>[0]): boolean } | undefined,
): boolean {
  return isArtemisEquipment(linked)
    || isApolloEquipment(linked)
    || isPpcCapacitorEquipment(linked);
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

function isClusterMissile(weapon: WeaponEquipment): boolean {
  return (weapon.damage === 'cluster'
    && (weapon.hasFlag('F_LRM') || weapon.hasFlag('F_SRM') || weapon.hasFlag('F_MML')))
    || ['LRM', 'SRM', 'MML', 'LRM_PRIMITIVE', 'LRM_IMP', 'SRM_IMP',
      'LRM_TORPEDO', 'SRM_TORPEDO'].includes(weapon.ammoType);
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
  const usesArtemis = usesArtemisIVDamageTable(linked);
  return ((usesArtemis ? artemis[weapon.rackSize] : undefined) ?? standard[weapon.rackSize])?.[rangeIndex] ?? 0;
}

