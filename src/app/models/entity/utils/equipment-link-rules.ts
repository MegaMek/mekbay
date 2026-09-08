// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, Equipment, MiscEquipment, WeaponEquipment, ammoMatchesWeapon } from '../../equipment.model';
import type { EntityMountedEquipment } from '../types';
import {
  isLaserInsulatorCompatibleWeapon,
  isLaserInsulatorEquipment,
} from '../../laser-insulator.model';
import { isApolloEquipment } from '../../apollo-mode.model';
import {
  isRiscLaserPulseCompatibleWeapon,
  isRiscLaserPulseModule,
} from '../../risc-laser-mode.model';
import {
  isPpcCapacitorCompatibleWeapon,
  isPpcCapacitorEquipment,
} from '../../ppc-capacitor.model';
import {
  isArtemisCompatibleWeapon,
  isArtemisEquipment,
} from '../../artemis-equipment.model';
import { isWeaponEnhancementEquipment as hasWeaponEnhancementMarker } from '../../weapon-enhancement.model';

export { isPpcCapacitorCompatibleWeapon } from '../../ppc-capacitor.model';

export interface EquipmentLinkContext {
  readonly year: number;
}

export { isArtemisCompatibleWeapon, isArtemisVEquipment } from '../../artemis-equipment.model';

export function isArtemisVCompatibleWeapon(equipment: Equipment | undefined): boolean {
  return isArtemisCompatibleWeapon(equipment);
}

export function isWeaponEnhancementEquipment(equipment: Equipment | undefined): boolean {
  return hasWeaponEnhancementMarker(equipment);
}

export function isWeaponEnhancement(mount: EntityMountedEquipment): boolean {
  return mount.equipment instanceof MiscEquipment
    && (isArtemisEquipment(mount.equipment)
      || isApolloEquipment(mount.equipment)
      || isPpcCapacitorEquipment(mount.equipment)
      || isRiscLaserPulseModule(mount.equipment)
      || isLaserInsulatorEquipment(mount.equipment));
}

/** Sources whose directed links are encoded by native equipment order/attachment flags. */
export function isEquipmentLinkSource(mount: EntityMountedEquipment): boolean {
  return isWeaponEnhancement(mount) || (mount.equipment instanceof WeaponEquipment && mount.isDWP === true)
    || (mount.equipment instanceof MiscEquipment && (['F_AP_MOUNT', 'F_ARMORED_GLOVE', 'F_DETACHABLE_WEAPON_PACK'] as const)
      .some(flag => mount.equipment!.hasFlag(flag)));
}

/**
 * Domain rule for directed enhancement links. The enhancement is the source;
 * the weapon it modifies is the target, matching MegaMek Mounted#setLinked.
 */
export function canLinkEquipment(
  source: EntityMountedEquipment,
  target: EntityMountedEquipment,
  context: EquipmentLinkContext,
): boolean {
  const enhancement = source.equipment;
  const weapon = target.equipment;
  if (source.mountId === target.mountId || source.location !== target.location) return false;
  if (enhancement instanceof WeaponEquipment && weapon instanceof AmmoEquipment) {
    return source.isDWP === true && target.isDWP === true && ammoMatchesWeapon(enhancement, weapon);
  }
  if (!(enhancement instanceof MiscEquipment) || !(weapon instanceof WeaponEquipment)) return false;
  if (enhancement.hasFlag('F_AP_MOUNT') || enhancement.hasFlag('F_ARMORED_GLOVE')) return target.isAPM === true && weapon.isInfantryWeapon();
  if (enhancement.hasFlag('F_DETACHABLE_WEAPON_PACK')) return target.isDWP === true;

  if (isArtemisEquipment(enhancement)) return isArtemisCompatibleWeapon(weapon);
  if (isApolloEquipment(enhancement)) return weapon.ammoType === 'MRM';
  if (isPpcCapacitorEquipment(enhancement)) {
    return isPpcCapacitorCompatibleWeapon(weapon, context);
  }
  if (isRiscLaserPulseModule(enhancement)) {
    return isRiscLaserPulseCompatibleWeapon(weapon);
  }
  if (isLaserInsulatorEquipment(enhancement)) return isLaserInsulatorCompatibleWeapon(weapon);
  return false;
}
