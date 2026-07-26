import { AmmoEquipment, type WeaponEquipment, ammoMatchesWeapon } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import type { EntityMountedWeapon } from '../../../types';

/** Java's generic Alpha Strike low-ammunition modifier for a weapon mount. */
export function alphaStrikeAmmoDamageMultiplier(
  weapon: WeaponEquipment,
  weapons: readonly EntityMountedWeapon[],
  ammunition: readonly ReturnType<BaseEntity['equipment']>[number][],
): number {
  if (weapon.ammoType === 'NA' || weapon.oneShotCount) return 1;
  const weaponCount = weapons.filter(mount => mount.equipment.id === weapon.id).length;
  const shots = ammunition.reduce((total, mount) => mount.equipment instanceof AmmoEquipment
    && ammoMatchesWeapon(weapon, mount.equipment) ? total + (mount.getAmmoShots() ?? 0) : total, 0);
  const divisor = weapon.ammoType === 'AC_ROTARY' ? 6
    : weapon.ammoType === 'AC_ULTRA' || weapon.ammoType === 'AC_ULTRA_THB' ? 2 : 1;
  return shots / Math.max(weaponCount, 1) >= 10 * divisor ? 1 : shots > 0 ? 0.75 : 0;
}