// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, type AlphaStrikeBattleForceClass, type WeaponEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import { AeroEntity, BattleArmorEntity, InfantryEntity } from '../../../entities';
import type { EntityMountedWeapon } from '../../../types';
import {
  alphaStrikeDamageLocationMultiplier,
  alphaStrikeSpecialLocationMultiplier,
  type AlphaStrikeDamageLocation,
} from '../damage/generic-location-mapper';
import { baseBattleForceDamageForWeapon, type AlphaStrikeRangeIndex } from '../damage/weapon-damage-profile';
import { alphaStrikeRoundUp, dualRoundedNormalDamage, roundUpToTenth } from '../damage/damage-rounding';
import { alphaStrikeWeaponHeatForConversion } from '../damage/heat-adjustment';
import { alphaStrikeHeatCapacityForEntity } from '../damage/heat-capacity';
import { AlphaStrikeSpecialAbilityCollector } from './special-ability-collector';
import { alphaStrikeArtilleryAbility } from './artillery-special';
import { alphaStrikeAmmoDamageMultiplier } from '../damage/weapon-modifiers';
import { SIGNATURE_SYSTEM_HEAT, hasStealthFlag } from '../../../../stealth-equipment.model';
import { battleArmorTroopFactor } from '../damage/battle-armor-damage';
import { alphaStrikeWeaponDamageModifier } from '../damage/weapon-damage-aggregation';
import {
  entityHasTargetingComputer,
  targetingComputerDamageMultiplier,
} from '../../targeting-computer';
import { isArtemisEquipment } from '../../../../artemis-equipment.model';
import { c3MasterWeaponAlphaStrikeFacts } from '../../../../c3-network.model';

type WeaponSpecialDamageKind = 'LRM' | 'SRM' | 'AC' | 'FLK' | 'IATM' | 'TOR' | 'REL';
type RawDamage = [number, number, number, number];

const BATTLE_FORCE_CLASSES_BY_SPECIAL_KIND: Readonly<Record<WeaponSpecialDamageKind, readonly AlphaStrikeBattleForceClass[]>> = {
  LRM: ['LRM', 'MML'],
  SRM: ['SRM', 'MML'],
  AC: ['AC'],
  FLK: ['FLAK'],
  IATM: ['IATM'],
  TOR: ['TORPEDO'],
  REL: ['REL'],
};

function hasBattleForceClass(weapon: WeaponEquipment, kind: WeaponSpecialDamageKind): boolean {
  const battleForceClass = weapon.alphaStrike?.battleForceClass;
  return battleForceClass !== undefined && BATTLE_FORCE_CLASSES_BY_SPECIAL_KIND[kind].includes(battleForceClass);
}

/** Converts generic unit weapon abilities that are not represented in Alpha Strike arcs. */
export function alphaStrikeWeaponSpecials(
  entity: BaseEntity,
  scope: 'standard' | 'turret' = 'standard',
  damageHeatFactors?: readonly [number, number, number, number],
  rearDamageHeatFactors?: readonly [number, number, number, number],
): string[] {
  return collectAlphaStrikeWeaponSpecials(entity, scope, damageHeatFactors, rearDamageHeatFactors).toArray();
}

export function collectAlphaStrikeWeaponSpecials(
  entity: BaseEntity,
  scope: 'standard' | 'turret' = 'standard',
  damageHeatFactors: readonly [number, number, number, number] = [1, 1, 1, 1],
  rearDamageHeatFactors: readonly [number, number, number, number] = [1, 1, 1, 1],
): AlphaStrikeSpecialAbilityCollector {
  const specials = new AlphaStrikeSpecialAbilityCollector();
  const weapons = entity.rangedWeapons();
  const ammo = entity.equipment().filter(mount => mount.equipment instanceof AmmoEquipment);
  const targetingComputer = entityHasTargetingComputer(entity);

  const countsForDiscreteSpecial = (mount: EntityMountedWeapon) => entity instanceof BattleArmorEntity
    ? scope === 'standard' && ['Squad', 'Trooper 1'].includes(mount.location)
    : alphaStrikeSpecialLocationMultiplier(entity, scope, mount) > 0;
  const countsForDamageSpecial = (mount: EntityMountedWeapon) => entity instanceof BattleArmorEntity
    ? scope === 'standard' && !mount.isSSWM && ['Squad', 'Trooper 1'].includes(mount.location)
    : alphaStrikeDamageLocationMultiplier(entity, scope, mount) > 0;
  for (const mount of weapons) {
    if (countsForDiscreteSpecial(mount)) {
      addDiscreteWeaponSpecials(
        mount,
        specials,
        entity instanceof BattleArmorEntity,
        entity instanceof AeroEntity,
      );
    }
  }
  if (entity instanceof InfantryEntity) {
    for (const weapon of [entity.primaryWeapon(), entity.secondaryWeapon()]) {
      if (weapon?.hasFlag('F_TAG')) specials.add(weapon.ranges[0] < 5 ? 'LTAG' : 'TAG');
    }
  }
  addArtillerySpecials(entity, weapons.filter(countsForDiscreteSpecial), specials);
  addDamageSpecials(
    entity, weapons, ammo, targetingComputer, specials, countsForDamageSpecial, scope, damageHeatFactors,
  );
  if (scope === 'standard') {
    addRearSpecial(entity, weapons, ammo, targetingComputer, specials, rearDamageHeatFactors);
  }
  return specials;
}

function addDiscreteWeaponSpecials(
  mount: EntityMountedWeapon,
  specials: AlphaStrikeSpecialAbilityCollector,
  battleArmorElement: boolean,
  aerospaceElement: boolean,
): void {
  const weapon = mount.equipment;
  if (weapon.hasFlag('F_TAG')) {
    specials.add(weapon.ranges[0] < 5 ? 'LTAG' : 'TAG');
    const c3Master = c3MasterWeaponAlphaStrikeFacts(weapon);
    if (c3Master.ability !== undefined) {
      specials.addOptionalCount(c3Master.ability);
    }
    if (c3Master.mobileHeadquarters !== undefined) {
      addNumericSpecial(specials, 'MHQ', c3Master.mobileHeadquarters);
    }
  }
  if (weapon.hasFlag('F_TSEMP') || weapon.hasFlag('F_CWS')) {
    addNumericSpecial(specials, weapon.oneShotCount ? 'TSEMP-O' : 'TSEMP', 1);
  }
  if (weapon.weapon.atClass === 'TELE_MISSILE') specials.add('TELE');
  if (weapon.ammoType === 'INARC') specials.addOptionalCount('INARC');
  else if (weapon.ammoType === 'NARC') {
    if (battleArmorElement) specials.add('CNARC');
    else specials.addOptionalCount('SNARC');
  }
  if (weapon.ammoType === 'TASER') {
    addNumericSpecial(specials, battleArmorElement ? 'BTAS' : 'MTAS', 1);
  }
  if (weapon.id === 'ISAPDS' || weapon.id === 'ISBAAPDS' || weapon.ammoType === 'APDS') specials.add('RAMS');
  else if (weapon.hasFlag('F_AMS')
    && !(aerospaceElement && weapon.alphaStrike?.pointDefense === true)) specials.add('AMS');
}

function addArtillerySpecials(
  entity: BaseEntity,
  weapons: readonly EntityMountedWeapon[],
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  for (const mount of weapons) {
    const weapon = mount.equipment;
    if (weapon.damage !== 'artillery' && weapon.id !== 'ISBATubeArtillery') continue;
    if (entity instanceof AeroEntity
      && ['LONG_TOM_CANNON', 'SNIPER_CANNON', 'THUMPER_CANNON'].includes(weapon.ammoType)) continue;
    const ability = alphaStrikeArtilleryAbility(weapon);
    if (ability) addArtillerySpecial(specials, ability);
  }
}

function addArtillerySpecial(specials: AlphaStrikeSpecialAbilityCollector, ability: string): void {
  specials.addHyphenatedCount(ability);
}

function addDamageSpecials(
  entity: BaseEntity,
  weapons: readonly EntityMountedWeapon[],
  ammo: readonly ReturnType<BaseEntity['equipment']>[number][],
  targetingComputer: boolean,
  specials: AlphaStrikeSpecialAbilityCollector,
  countsForScope: (mount: EntityMountedWeapon) => boolean,
  scope: 'standard' | 'turret',
  damageHeatFactors: readonly [number, number, number, number],
): void {
  const allowedKinds = entity instanceof BattleArmorEntity
    ? new Set<WeaponSpecialDamageKind>(['FLK'])
    : entity instanceof AeroEntity
      ? new Set<WeaponSpecialDamageKind>(['FLK', 'TOR', 'REL'])
      : new Set(Object.keys(BATTLE_FORCE_CLASSES_BY_SPECIAL_KIND) as WeaponSpecialDamageKind[]);
  for (const kind of allowedKinds) {
    const damage = applyDamageFactors(applyBattleArmorSpecialDamageFactor(entity,
      sumSpecialDamage(entity, weapons, ammo, targetingComputer, (weapon, mount) =>
      countsForScope(mount) && hasBattleForceClass(weapon, kind)
      && (kind !== 'LRM' && kind !== 'SRM' || !hasArtemis(entity, mount)), kind)), damageHeatFactors);
    if (!qualifiesForDamageSpecial(damage, kind)) continue;
    if (kind === 'REL') specials.add('REL');
    else specials.add(`${kind}${formatDamage(damage, kind, entity instanceof AeroEntity)}`);
  }

  if (!(entity instanceof AeroEntity)) {
    const indirectFire = applyDamageFactors(applyBattleArmorSpecialDamageFactor(entity,
      sumSpecialDamage(entity, weapons, ammo, targetingComputer, (weapon, mount) =>
        countsForScope(mount) && weapon.alphaStrikeIndirectFire)), damageHeatFactors);
    if (indirectFire[2] > 0) specials.add(`IF${dualRoundedNormalDamage(indirectFire[2])}`);
  }

  if (entity instanceof AeroEntity && scope === 'standard') {
    const pointDefense = sumPointDefenseDamage(weapons, ammo, targetingComputer, countsForScope);
    const heatFactor = aerospacePointDefenseHeatFactor(entity, weapons, countsForScope);
    pointDefense[0] *= heatFactor;
    pointDefense[1] *= heatFactor;
    if (pointDefense.some(value => value > 0)) {
      specials.add(`PNT${alphaStrikeRoundUp(roundUpToTenth(pointDefense[0]))}`);
    }
  }
}

function sumPointDefenseDamage(
  weapons: readonly EntityMountedWeapon[],
  ammo: readonly ReturnType<BaseEntity['equipment']>[number][],
  targetingComputer: boolean,
  countsForScope: (mount: EntityMountedWeapon) => boolean,
): RawDamage {
  const result: RawDamage = [0, 0, 0, 0];
  for (const mount of weapons) {
    const weapon = mount.equipment;
    if (!countsForScope(mount) || weapon.alphaStrike?.pointDefense !== true) continue;
    let multiplier = alphaStrikeAmmoDamageMultiplier(weapon, weapons, ammo);
    if (weapon.oneShotCount === 1) multiplier *= 0.1;
    multiplier *= targetingComputerDamageMultiplier(targetingComputer, weapon);
    for (let range = 0; range < 4; range++) {
      const damage = weapon.hasFlag('F_AMS')
        ? range === 0 ? 0.3 : 0
        : baseBattleForceDamageForWeapon(weapon, range as AlphaStrikeRangeIndex);
      result[range] += damage * multiplier;
    }
  }
  return result;
}

function applyBattleArmorSpecialDamageFactor(entity: BaseEntity, damage: RawDamage): RawDamage {
  if (!(entity instanceof BattleArmorEntity)) return damage;
  const factor = battleArmorTroopFactor(entity.trooperCount());
  return damage.map(value => value * factor) as RawDamage;
}

function addRearSpecial(
  entity: BaseEntity,
  weapons: readonly EntityMountedWeapon[],
  ammo: readonly ReturnType<BaseEntity['equipment']>[number][],
  targetingComputer: boolean,
  specials: AlphaStrikeSpecialAbilityCollector,
  heatFactors: readonly [number, number, number, number],
): void {
  const damage = applyDamageFactors(sumSpecialDamage(
    entity, weapons, ammo, targetingComputer,
    (_weapon, mount) => alphaStrikeDamageLocationMultiplier(entity, 'rear', mount) > 0,
  ), heatFactors);
  if (damage.some(value => value > 0)) specials.add(`REAR${formatRearDamage(damage, entity instanceof AeroEntity)}`);
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
    if (!include(weapon, mount) || weapon.damage === 'artillery'
      || weapon.hasFlag('F_ARTILLERY')) continue;
    const multiplier = alphaStrikeWeaponDamageModifier(
      entity,
      mount,
      weapons,
      ammo,
      targetingComputer,
      entity instanceof BattleArmorEntity,
    );
    for (let range = 0; range < 4; range++) {
      const mmlMultiplier = mmlDamageMultiplier(weapon, range as AlphaStrikeRangeIndex, kind);
      const linked = kind === 'TOR' ? entity.getLinkingMount(mount)?.equipment : undefined;
      const damage = baseBattleForceDamageForWeapon(weapon, range as AlphaStrikeRangeIndex, linked);
      result[range] += damage * multiplier * mmlMultiplier;
    }
  }
  return result;
}

function hasArtemis(entity: BaseEntity, mount: EntityMountedWeapon): boolean {
  const linked = entity.getLinkingMount(mount)?.equipment;
  return isArtemisEquipment(linked);
}

function mmlDamageMultiplier(
  weapon: WeaponEquipment,
  range: AlphaStrikeRangeIndex,
  kind: WeaponSpecialDamageKind | undefined,
): number {
  if (weapon.alphaStrike?.battleForceClass !== 'MML') return 1;
  if (kind === 'LRM') return range === 0 ? 0 : range === 1 ? 0.5 : 1;
  if (kind === 'SRM') return range === 2 ? 0 : range === 1 ? 0.5 : 1;
  return 1;
}

function qualifiesForDamageSpecial(damage: RawDamage, kind: WeaponSpecialDamageKind): boolean {
  if (kind === 'FLK' || kind === 'TOR') return damage.some(value => value > 0);
  return roundUpToTenth(damage[1]) >= 1;
}

function formatDamage(damage: RawDamage, kind: WeaponSpecialDamageKind, aerospace: boolean): string {
  const rangeCount = kind === 'SRM' ? 2 : aerospace && kind === 'FLK' ? 4 : 3;
  const usesMinimumDamage = kind === 'FLK' || kind === 'TOR';
  return damage.slice(0, rangeCount)
    .map(value => formatSpecialDamage(value, usesMinimumDamage))
    .join('/');
}

function formatRearDamage(damage: RawDamage, aerospace: boolean): string {
  return damage.slice(0, aerospace ? 4 : 3)
    .map(value => value > 0 ? dualRoundedNormalDamage(value) : '-')
    .join('/');
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

function aerospacePointDefenseHeatFactor(
  entity: AeroEntity,
  weapons: readonly EntityMountedWeapon[],
  countsForScope: (mount: EntityMountedWeapon) => boolean,
): number {
  if (entity.entityType !== 'Aero') return 1;
  const weaponHeat = weapons.reduce((total, mount) => countsForScope(mount)
    ? total + alphaStrikeWeaponHeatForConversion(mount.equipment)
    : total, 0);
  const signatureHeat = entity.equipment().some(mount => hasStealthFlag(mount.equipment))
    ? SIGNATURE_SYSTEM_HEAT
    : 0;
  const capacity = alphaStrikeHeatCapacityForEntity(entity, entity.heatCapacity(false));
  const adjustedHeat = weaponHeat + signatureHeat - 4;
  return adjustedHeat > capacity ? capacity / adjustedHeat : 1;
}

function applyDamageFactors(
  damage: RawDamage,
  factors: readonly [number, number, number, number],
): RawDamage {
  return damage.map((value, range) => value * factors[range]) as RawDamage;
}
