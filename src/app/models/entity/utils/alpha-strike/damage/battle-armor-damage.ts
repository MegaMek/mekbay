// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment, ammoMatchesWeapon } from '../../../../equipment.model';
import type { BattleArmorEntity } from '../../../entities';
import type { EntityMountedEquipment } from '../../../types';
import { toStandardDamage } from './damage-rounding';
import type { AlphaStrikeDamage, RawDamageVector } from './damage-types';
import {
  battleForceDamageForMount,
  hasAlphaStrikeBattleForceClass,
  type AlphaStrikeRangeIndex,
} from './weapon-damage-profile';
import { alphaStrikeTroopFactor } from './troop-factor';
import {
  entityHasTargetingComputer,
  targetingComputerDamageMultiplier,
} from '../../targeting-computer';
import {
  isAntiPersonnelMountEquipment,
  isArmoredGloveEquipment,
} from '../../../../battle-armor-equipment.model';

export interface BattleArmorDamageOptions {
  readonly shootingStrength?: number;
  readonly isOperational?: (mount: EntityMountedEquipment) => boolean;
}

export interface BattleArmorDamageBreakdown {
  readonly shootingStrength: number;
  readonly troopFactor: number;
  readonly normal: Readonly<RawDamageVector>;
  readonly squadSupport: Readonly<RawDamageVector>;
  readonly apOrGloveBonus: number;
  readonly vibroclawBonus: number;
  readonly raw: Readonly<RawDamageVector>;
}

export interface BattleArmorDamageResult {
  readonly standard: AlphaStrikeDamage;
  readonly breakdown: BattleArmorDamageBreakdown;
}

export function battleArmorTroopFactor(shootingStrength: number): number {
  return alphaStrikeTroopFactor(shootingStrength) + 0.5;
}

export function calculateBattleArmorStandardDamage(
  entity: BattleArmorEntity,
  options: BattleArmorDamageOptions = {},
): BattleArmorDamageResult {
  const shootingStrength = options.shootingStrength ?? entity.trooperCount();
  const troopFactor = battleArmorTroopFactor(shootingStrength);
  const normal = sumBattleArmorWeaponDamage(entity, mount =>
    !mount.isAPM && !mount.isSSWM && isRepresentativeLocation(mount.location));
  const squadSupport = sumBattleArmorWeaponDamage(entity, mount => !!mount.isSSWM);
  const equipment = entity.equipment();
  const apOrGloveBonus = equipment.some(mount => isArmoredGloveEquipment(mount.equipment))
    ? 0.1
    : equipment.some(mount => isAntiPersonnelMountEquipment(mount.equipment)) ? 0.05 : 0;
  const isOperational = options.isOperational ?? (() => true);
  const vibroclawBonus = equipment.filter(mount =>
    mount.equipment?.hasFlag('F_VIBROCLAW') && isOperational(mount)).length * 0.1;
  const raw: RawDamageVector = [
    (normal[0] + apOrGloveBonus) * troopFactor + squadSupport[0] + vibroclawBonus,
    normal[1] * troopFactor + squadSupport[1],
    normal[2] * troopFactor + squadSupport[2],
    0,
  ];
  return {
    standard: toStandardDamage(raw),
    breakdown: {
      shootingStrength,
      troopFactor,
      normal,
      squadSupport,
      apOrGloveBonus,
      vibroclawBonus,
      raw,
    },
  };
}

function sumBattleArmorWeaponDamage(
  entity: BattleArmorEntity,
  include: (mount: EntityMountedEquipment) => boolean,
): RawDamageVector {
  const weapons = entity.rangedWeapons();
  const ammo = entity.equipment().filter(mount => mount.equipment instanceof AmmoEquipment);
  const targetingComputer = entityHasTargetingComputer(entity);
  return weapons.reduce<RawDamageVector>((total, mount) => {
    const weapon = mount.equipment;
    if (!include(mount) || weapon.damage === 'artillery'
      || hasAlphaStrikeBattleForceClass(weapon, 'TORPEDO')) return total;
    let modifier = battleArmorAmmoModifier(weapon, weapons, ammo);
    if (weapon.oneShotCount === 1) modifier *= 0.1;
    modifier *= targetingComputerDamageMultiplier(targetingComputer, weapon);
    for (let range = 0; range < 3; range++) {
      total[range] += battleForceDamageForMount(
        entity,
        mount,
        range as AlphaStrikeRangeIndex,
      ) * modifier;
    }
    return total;
  }, [0, 0, 0, 0]);
}

function battleArmorAmmoModifier(
  weapon: WeaponEquipment,
  weapons: readonly EntityMountedEquipment[],
  ammo: readonly EntityMountedEquipment[],
): number {
  if (!weapon.hasFlag('F_MISSILE') || weapon.oneShotCount) return 1;
  const weaponCount = weapons.filter(mount =>
    mount.equipment instanceof WeaponEquipment
    && mount.equipment.id === weapon.id
    && !mount.equipment.oneShotCount).length;
  const shots = ammo.reduce((sum, mount) => mount.equipment instanceof AmmoEquipment
    && ammoMatchesWeapon(weapon, mount.equipment) ? sum + (mount.getAmmoShots() ?? 0) : sum, 0);
  const divisor = weapon.ammoType === 'AC_ROTARY' ? 6
    : weapon.ammoType === 'AC_ULTRA' || weapon.ammoType === 'AC_ULTRA_THB' ? 2 : 1;
  const averageShots = Math.floor(shots / Math.max(weaponCount, 1));
  return averageShots >= 10 * divisor ? 1 : shots > 0 ? 0.75 : 0;
}

function isRepresentativeLocation(location: string): boolean {
  return location === 'Squad' || location === 'Trooper 1';
}

