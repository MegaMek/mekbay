// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, type WeaponEquipment, ammoMatchesWeapon } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import type { EntityMountedWeapon } from '../../../types';

/** Java's generic Alpha Strike low-ammunition modifier for a weapon mount. */
export function alphaStrikeAmmoDamageMultiplier(
  weapon: WeaponEquipment,
  weapons: readonly EntityMountedWeapon[],
  ammunition: readonly ReturnType<BaseEntity['equipment']>[number][],
  battleArmor = false,
): number {
  if (weapon.ammoType === 'NA' || weapon.oneShotCount
    || battleArmor && !weapon.hasFlag('F_MISSILE')) return 1;
  const weaponCount = weapons.filter(mount =>
    mount.equipment.id === weapon.id && !mount.equipment.oneShotCount).length;
  const shots = ammunition.reduce((total, mount) => mount.equipment instanceof AmmoEquipment
    && ammoMatchesWeapon(weapon, mount.equipment) ? total + (mount.getAmmoShots() ?? 0) : total, 0);
  const divisor = weapon.ammoType === 'AC_ROTARY' ? 6
    : weapon.ammoType === 'AC_ULTRA' || weapon.ammoType === 'AC_ULTRA_THB' ? 2 : 1;
  const averageShots = battleArmor
    ? Math.floor(shots / Math.max(weaponCount, 1))
    : shots / Math.max(weaponCount, 1);
  return averageShots >= 10 * divisor ? 1 : shots > 0 ? 0.75 : 0;
}
