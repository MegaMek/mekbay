// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment, ammoMatchesWeapon } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';

const NON_EXPLOSIVE_AMMO_TYPES = new Set(['LIGHT_NGAUSS', 'MED_NGAUSS', 'HEAVY_NGAUSS']);

/** Returns whether a mounted component prevents the Alpha Strike ENE ability. */
export function blocksExplosiveNullification(
  entity: BaseEntity,
  mount: ReturnType<BaseEntity['equipment']>[number],
): boolean {
  const equipment = mount.equipment;
  if (!equipment) return false;
  if (equipment.hasAnyFlag(['F_BOMB_BAY', 'F_BOOBY_TRAP'])) {
    return true;
  }
  if (mount.location === 'Unallocated') return false;
  if (!equipment.isExplosive()) return false;
  if (equipment.hasFlag('F_FUEL')
    || equipment.hasFlag('F_BLUE_SHIELD')
    || equipment.hasAllFlags(['F_JUMP_JET', 'S_PROTOTYPE', 'S_IMPROVED'])
    || equipment.hasFlag('F_RISC_LASER_PULSE_MODULE')
    || equipment.hasFlag('F_EMERGENCY_COOLANT_SYSTEM')) return true;
  if (equipment instanceof WeaponEquipment) return mountedWeaponExplosionDamage(entity, mount, equipment) > 0;
  if (equipment instanceof AmmoEquipment) {
    return !NON_EXPLOSIVE_AMMO_TYPES.has(equipment.ammoType)
      && (mount.shotsCount ?? equipment.shots) > 0 && equipment.damagePerShot > 0;
  }
  return false;
}

/** Returns whether any installed component prevents the Alpha Strike ENE ability. */
export function hasExplosiveComponent(entity: BaseEntity): boolean {
  return entity.equipment().some(mount => blocksExplosiveNullification(entity, mount));
}

function mountedWeaponExplosionDamage(
  entity: BaseEntity,
  mount: ReturnType<BaseEntity['equipment']>[number],
  weapon: WeaponEquipment,
): number {
  if (hasMountedWeaponQuirk(entity, mount, weapon, 'ammo_feed_problems')) {
    const liveAmmo = entity.equipment().find(candidate => candidate.equipment instanceof AmmoEquipment
      && ammoMatchesWeapon(weapon, candidate.equipment)
      && (candidate.getAmmoShots() ?? 0) > 0);
    if (liveAmmo?.equipment instanceof AmmoEquipment) {
      return weapon.rackSize * liveAmmo.equipment.damagePerShot;
    }
  }
  return weapon.weapon.explosionDamage;
}

function hasMountedWeaponQuirk(
  entity: BaseEntity,
  mount: ReturnType<BaseEntity['equipment']>[number],
  weapon: WeaponEquipment,
  quirkName: string,
): boolean {
  const identifiers = new Set([weapon.id, weapon.name, ...weapon.aliases]);
  return entity.weaponQuirks().some(quirk => quirk.name === quirkName
    && quirk.location === mount.location
    && identifiers.has(quirk.weaponName)
    && mount.placements?.some(placement => placement.location === quirk.location
      && placement.slotIndex === quirk.slot) === true);
}