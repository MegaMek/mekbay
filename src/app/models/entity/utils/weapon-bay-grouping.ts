// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EntityMountedWeapon } from '../types';
import { weaponBayEquipmentId } from './implicit-equipment';

export const MAX_STANDARD_DAMAGE_PER_WEAPON_BAY = 700;

/** Canonical class/arc identity used when legacy data omits weapon-bay relationships. */
export function weaponBayGroupingKey(mount: EntityMountedWeapon): string {
  return JSON.stringify({
    locations: [...mount.getOccupiedLocations()].sort(),
    rearMounted: mount.rearMounted,
    turretMounted: mount.turretMounted,
    turretType: mount.turretType ?? null,
    facing: mount.facing ?? null,
    bayType: weaponBayEquipmentId(mount.equipment),
  });
}

/** MegaMek's construction limit is expressed as standard damage, so capital AV counts tenfold. */
export function standardWeaponBayDamage(mount: EntityMountedWeapon): number {
  const shortAttackValue = Math.max(0, mount.equipment.weapon.av[0] ?? 0);
  return shortAttackValue * (mount.equipment.capital ? 10 : 1);
}

/** Capital mass-driver bays are explicitly exempt from the normal 700-point limit. */
export function weaponBayDamageLimit(mount: EntityMountedWeapon): number {
  return mount.equipment.weapon.atClass === 'CAPITAL_MD'
    ? Number.POSITIVE_INFINITY
    : MAX_STANDARD_DAMAGE_PER_WEAPON_BAY;
}

/**
 * Infer legal bays for weapons whose source data has no authored relationship.
 * The minimum number of bays is used and the members are balanced by damage as
 * required by the construction rules. Input order remains the presentation order.
 */
export function inferWeaponBayWeaponGroups(
  weapons: readonly EntityMountedWeapon[],
): readonly (readonly EntityMountedWeapon[])[] {
  const byClassAndArc = new Map<string, EntityMountedWeapon[]>();
  for (const weapon of weapons) {
    const key = weaponBayGroupingKey(weapon);
    const group = byClassAndArc.get(key);
    if (group) group.push(weapon);
    else byClassAndArc.set(key, [weapon]);
  }
  return Object.freeze([...byClassAndArc.values()].flatMap(splitAtDamageLimit));
}

function splitAtDamageLimit(
  group: readonly EntityMountedWeapon[],
): readonly (readonly EntityMountedWeapon[])[] {
  if (group.length === 0) return [];
  const indexed = group.map((weapon, index) => ({
    weapon,
    index,
    damage: standardWeaponBayDamage(weapon),
  }));
  const totalDamage = indexed.reduce((total, weapon) => total + weapon.damage, 0);
  const damageLimit = weaponBayDamageLimit(group[0]);
  const minimumBayCount = Number.isFinite(damageLimit)
    ? Math.max(1, Math.ceil(totalDamage / damageLimit))
    : 1;
  const bays = Array.from({ length: minimumBayCount }, () => ({
    damage: 0,
    weapons: [] as typeof indexed,
  }));

  const descending = [...indexed].sort((left, right) =>
    right.damage - left.damage || left.index - right.index);
  for (const weapon of descending) {
    const available = bays
      .filter(candidate => candidate.damage + weapon.damage <= damageLimit)
      .reduce<(typeof bays)[number] | null>((best, candidate) =>
        best === null || candidate.damage < best.damage ? candidate : best, null);
    const target = available ?? { damage: 0, weapons: [] as typeof indexed };
    if (available === null) bays.push(target);
    target.weapons.push(weapon);
    target.damage += weapon.damage;
  }

  return bays
    .filter(bay => bay.weapons.length > 0)
    .map(bay => [...bay.weapons].sort((left, right) => left.index - right.index))
    .sort((left, right) => left[0].index - right[0].index)
    .map(bay => Object.freeze(bay.map(entry => entry.weapon)));
}
