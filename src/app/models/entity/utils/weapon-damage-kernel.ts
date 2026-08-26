// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { hasWeaponTrait } from '../../weapon-traits-kernel';

/** Minimal immutable inputs needed to resolve record-sheet weapon damage. */
export interface WeaponDamageFacts {
  readonly id: string;
  readonly damage: string | number | readonly number[];
  readonly rackSize: number;
  readonly ammoType: string;
  readonly flags: ReadonlySet<string>;
  readonly oneShotCount: 0 | 1 | 2;
  readonly rapidFireCount: number;
}

export interface AmmoDamageFacts {
  readonly damagePerShot: number;
}

export type ResolvedWeaponDamageUnit = 'missile' | 'shot' | 'artillery';

export interface ResolvedWeaponDamageFacts {
  readonly values: readonly number[];
  readonly maximum: number;
  readonly unit?: ResolvedWeaponDamageUnit;
}

/**
 * Resolve static weapon damage from detached catalog facts.
 *
 * This is the sole formula owner shared by Equipment and MekEntity callers.
 * Compatible-ammunition selection stays at each
 * boundary; the kernel only consumes the selected ammo's damage fact.
 */
export function resolveWeaponDamageFacts(
  weapon: WeaponDamageFacts,
  ammo: AmmoDamageFacts | null,
): ResolvedWeaponDamageFacts {
  const damage = weapon.damage;
  if (damage === '') return fixedDamage(0);
  if (damage === 'special' && weapon.oneShotCount > 0 && ammo) {
    return fixedDamage(ammo.damagePerShot);
  }
  if (damage === 'cluster') return resolveClusterDamage(weapon, ammo);
  if (damage === 'artillery') return fixedDamage(weapon.rackSize, 'artillery');
  if (damage === 'variable') {
    return fixedDamage(weapon.id === 'CLPlasmaCannon' ? 0 : weapon.rackSize);
  }
  if (Array.isArray(damage)) return { values: damage, maximum: Math.max(0, ...damage) };
  if (typeof damage !== 'number' || damage < 0) return fixedDamage(weapon.rackSize);

  return {
    values: [damage],
    maximum: damage * Math.max(1, weapon.rapidFireCount),
    ...(weapon.rapidFireCount > 0 ? { unit: 'shot' as const } : {}),
  };
}

function resolveClusterDamage(
  weapon: WeaponDamageFacts,
  ammo: AmmoDamageFacts | null,
): ResolvedWeaponDamageFacts {
  if (hasWeaponTrait(weapon.flags, 'large-missile')) return fixedDamage(ammo?.damagePerShot ?? 0);
  if (hasWeaponTrait(weapon.flags, 'narc')) {
    return { values: [1], maximum: weapon.rackSize, unit: 'missile' };
  }
  if (weapon.ammoType === 'HAG') return fixedDamage(weapon.rackSize);
  if (weapon.ammoType === 'MEK_MORTAR') {
    const damagePerMissile = ammo?.damagePerShot ?? 2;
    return { values: [damagePerMissile], maximum: weapon.rackSize * damagePerMissile, unit: 'missile' };
  }
  if (weapon.ammoType === 'BA_TUBE' || !hasWeaponTrait(weapon.flags, 'missile')) {
    return fixedDamage(weapon.rackSize);
  }
  return {
    values: [ammo?.damagePerShot ?? 0],
    maximum: ammo ? weapon.rackSize * ammo.damagePerShot : 0,
    unit: 'missile',
  };
}

function fixedDamage(
  value: number,
  unit?: ResolvedWeaponDamageUnit,
): ResolvedWeaponDamageFacts {
  return { values: [value], maximum: value, ...(unit ? { unit } : {}) };
}
