// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { hasWeaponTrait } from '../models/weapon-traits-kernel';

const SUSTAINED_TURNS = 10;

// MegaMek stores this table as float[], so preserve binary32 values before
// promotion to double. Decimal doubles change x.x5 rounding boundaries.
const EXPECTED_HITS_BY_RACK_SIZE = new Float32Array([
  0, 1, 1.58, 2, 2.63, 3.17, 4, 4.49, 4.98, 5.47, 6.31,
  7.23, 8.14, 8.59, 9.04, 9.5, 10.1, 10.8, 11.42, 12.1, 12.7,
]);

export interface SustainedDamageWeaponFact {
  readonly damage: number;
  readonly ammoType: string;
  readonly rackSize: number;
  readonly rapidFireCount: number;
  readonly oneShotCount: 0 | 1 | 2;
  readonly clusterDamage: boolean;
  /** Battle Armor squad mounts demand one shot per trooper. */
  readonly ammoDemandMultiplier?: number;
  /** Family-specific static multiplier, e.g. Battle Armor squad clusters. */
  readonly damageMultiplier?: number;
}

export interface GroundSustainedWeaponProfile {
  readonly id: string;
  readonly damage: string | number | readonly number[];
  readonly rackSize: number;
  readonly ammoType: string;
  readonly flags: ReadonlySet<string>;
  /** Maximum damage per shot among compatible installed ammunition. */
  readonly ammoDamagePerShot?: number;
}

export interface SustainedDamageFacts {
  readonly fireFraction: number;
  readonly weapons: readonly SustainedDamageWeaponFact[];
  /** Already-resolved installed capacity by exact ammo type and rack size. */
  readonly availableShots: ReadonlyMap<string, number>;
}

/** Exact ten-turn SVGMassPrinter sustained-damage calculation. */
export function calculateSustainedDamageFromFacts(facts: SustainedDamageFacts): number {
  const ammoMultipliers = calculateAmmoMultipliers(facts);
  let total = 0;
  for (const weapon of facts.weapons) {
    let multiplier = weapon.oneShotCount > 0 ? weapon.oneShotCount / SUSTAINED_TURNS : 1;
    if (weapon.ammoType !== 'NA' && weapon.oneShotCount === 0) {
      multiplier *= ammoMultipliers.get(sustainedDamageAmmoKey(weapon.ammoType, weapon.rackSize)) ?? 1;
    }
    if (weapon.clusterDamage && weapon.rackSize > 0) {
      multiplier *= expectedClusterHits(weapon.rackSize) / weapon.rackSize;
    }
    if (weapon.ammoType === 'AC_ROTARY') multiplier *= 3.17;
    else if (weapon.ammoType === 'AC_ULTRA' || weapon.ammoType === 'AC_ULTRA_THB') multiplier *= 1.42;
    multiplier *= weapon.damageMultiplier ?? 1;
    total += weapon.damage * multiplier * facts.fireFraction;
  }
  return Math.round(total * 10) / 10;
}

export function sustainedDamageAmmoKey(ammoType: string, rackSize: number): string {
  return `${ammoType}:${rackSize}`;
}

export function expectedClusterHits(rackSize: number): number {
  if (rackSize === 30 || rackSize === 40) {
    return 2 * (EXPECTED_HITS_BY_RACK_SIZE[rackSize / 2] ?? rackSize / 2);
  }
  return EXPECTED_HITS_BY_RACK_SIZE[rackSize] ?? rackSize;
}

/** Exact non-aerospace/non-infantry SVGMassPrinter max-damage rule. */
export function maximumGroundSustainedWeaponDamage(profile: GroundSustainedWeaponProfile): number {
  // An MGA changes how its linked machine guns resolve; it is not another gun.
  if (hasWeaponTrait(profile.flags, 'machine-gun-array')) return 0;
  const damage = profile.damage;
  if (damage === '') return 0;
  if (damage === 'cluster') {
    const perMissile = profile.ammoType === 'ATM' || profile.ammoType === 'IATM'
      ? profile.ammoDamagePerShot ?? 2
      : hasWeaponTrait(profile.flags, 'srm')
        || profile.ammoType === 'SRM_TORPEDO'
        || profile.ammoType === 'MML' ? 2 : 1;
    return profile.rackSize * perMissile;
  }
  if (damage === 'variable' || damage === 'special') return 0;
  if (damage === 'artillery') return profile.rackSize;
  if (Array.isArray(damage)) return Math.max(0, ...damage);
  return typeof damage === 'number' && damage >= 0 ? damage : Math.max(0, profile.rackSize);
}

function calculateAmmoMultipliers(facts: SustainedDamageFacts): ReadonlyMap<string, number> {
  const neededByKey = new Map<string, number>();
  const effectiveTurns = SUSTAINED_TURNS * facts.fireFraction;
  for (const weapon of facts.weapons) {
    if (weapon.ammoType === 'NA' || weapon.oneShotCount > 0) continue;
    const needed = Math.max(1, weapon.rapidFireCount)
      * effectiveTurns
      * (weapon.ammoDemandMultiplier ?? 1);
    const key = sustainedDamageAmmoKey(weapon.ammoType, weapon.rackSize);
    neededByKey.set(key, (neededByKey.get(key) ?? 0) + needed);
  }
  return new Map([...neededByKey].map(([key, needed]) => {
    const available = facts.availableShots.get(key) ?? 0;
    return [key, needed <= 0 ? 1 : available <= 0 ? 0 : Math.min(1, available / needed)] as const;
  }));
}
