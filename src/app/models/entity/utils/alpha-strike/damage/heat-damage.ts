// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { WeaponEquipment } from '../../../../equipment.model';
import type { EntityMountedWeapon } from '../../../types';

export type AlphaStrikeHeatDamage = readonly [short: number, medium: number, long: number];

const NO_HEAT_DAMAGE: AlphaStrikeHeatDamage = [0, 0, 0];

export function alphaStrikeHeatDamageForWeapon(weapon: WeaponEquipment): AlphaStrikeHeatDamage {
  const exportedDamage = weapon.alphaStrike?.heatDamage;
  return exportedDamage ? [exportedDamage[0], exportedDamage[1], exportedDamage[2]] : NO_HEAT_DAMAGE;
}

/** Sums raw weapon HT values before Alpha Strike threshold conversion. */
export function sumAlphaStrikeHeatDamage(
  weapons: readonly EntityMountedWeapon[],
  include: (mount: EntityMountedWeapon) => boolean = () => true,
): [short: number, medium: number, long: number] {
  const total: [number, number, number] = [0, 0, 0];
  for (const mount of weapons) {
    if (!include(mount)) continue;
    const heatDamage = alphaStrikeHeatDamageForWeapon(mount.equipment);
    total[0] += heatDamage[0];
    total[1] += heatDamage[1];
    total[2] += heatDamage[2];
  }
  return total;
}

/** Converts raw Alpha Strike weapon heat totals to an HT special, if any. */
export function alphaStrikeHeatSpecial(rawDamage: AlphaStrikeHeatDamage): string | null {
  const values = rawDamage.map(alphaStrikeHeatLevel);
  return values.some(value => value > 0) ? `HT${values.map(formatHeatLevel).join('/')}` : null;
}

export function alphaStrikeHeatLevel(rawDamage: number): 0 | 1 | 2 {
  if (!Number.isFinite(rawDamage) || rawDamage < 0) {
    throw new RangeError('Alpha Strike heat damage must be a nonnegative finite number');
  }
  return rawDamage > 10 ? 2 : rawDamage > 4 ? 1 : 0;
}

function formatHeatLevel(value: number): string {
  return value === 0 ? '-' : String(value);
}
