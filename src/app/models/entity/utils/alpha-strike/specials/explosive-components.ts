// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, MiscEquipment, WeaponEquipment, ammoMatchesWeapon } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import { isBombastLaserEquipment } from '../../../../bombast-laser-mode.model';
import {
  RISC_LASER_PULSE_EXPLOSION_DAMAGE,
  isRiscLaserPulseModule,
} from '../../../../risc-laser-mode.model';
import { isPpcCapacitorEquipment, isPpcEquipment } from '../../../../ppc-capacitor.model';
import {
  BLUE_SHIELD_EXPLOSION_DAMAGE,
  EMERGENCY_COOLANT_SYSTEM_EXPLOSION_DAMAGE,
  isBlueShieldEquipment,
  isEmergencyCoolantSystemEquipment,
} from '../../../../escalating-equipment.model';
import { jumpJetCriticalExplosionDamage } from '../../../../jump-equipment.model';
import { supportEquipmentExplosionDamage } from '../../../../support-equipment.model';
import { isExplosiveAerospaceSupportEquipment } from '../../../../aerospace-support-equipment.model';

const NON_EXPLOSIVE_AMMO_TYPES = new Set(['LIGHT_NGAUSS', 'MED_NGAUSS', 'HEAVY_NGAUSS']);

/** Returns whether a mounted component prevents the Alpha Strike ENE ability. */
export function isExplosive(
  entity: BaseEntity,
  mount: ReturnType<BaseEntity['equipment']>[number],
): boolean {
  const equipment = mount.equipment;
  if (!equipment) return false;
  if (equipment instanceof MiscEquipment) {
    if (isExplosiveAerospaceSupportEquipment(equipment)) return true;
  }
  if ((equipment instanceof WeaponEquipment && (isPpcEquipment(equipment) || isBombastLaserEquipment(equipment)))
    || (equipment instanceof MiscEquipment && isPpcCapacitorEquipment(equipment))) return false;

  return equipment.isExplosive()
    && mountedExplosionDamage(entity, mount, equipment) > 0
    && mount.location !== 'Unallocated';
}

function mountedExplosionDamage(
  entity: BaseEntity,
  mount: ReturnType<BaseEntity['equipment']>[number],
  equipment: NonNullable<ReturnType<BaseEntity['equipment']>[number]['equipment']>,
): number {
  const supportExplosion = supportEquipmentExplosionDamage(equipment);
  if (supportExplosion !== null) return supportExplosion;
  if (isBlueShieldEquipment(equipment)) return BLUE_SHIELD_EXPLOSION_DAMAGE;
  const jumpJetExplosion = jumpJetCriticalExplosionDamage(equipment);
  if (jumpJetExplosion !== undefined) return jumpJetExplosion;
  if (isRiscLaserPulseModule(equipment)) return RISC_LASER_PULSE_EXPLOSION_DAMAGE;
  if (isEmergencyCoolantSystemEquipment(equipment)) {
    return EMERGENCY_COOLANT_SYSTEM_EXPLOSION_DAMAGE;
  }
  if (equipment instanceof WeaponEquipment) return mountedWeaponExplosionDamage(entity, mount, equipment);
  if (equipment instanceof AmmoEquipment) {
    return NON_EXPLOSIVE_AMMO_TYPES.has(equipment.ammoType)
      ? 0
      : (mount.shotsCount ?? equipment.shots) * equipment.damagePerShot;
  }
  return 0;
}

/** Returns whether any installed component prevents the Alpha Strike ENE ability. */
export function hasExplosiveComponent(entity: BaseEntity): boolean {
  return entity.equipment().some(mount => isExplosive(entity, mount));
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
  if (entity.weightClass() === 'Super Heavy') return mount.placedCriticalSlotCount * 2;
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
