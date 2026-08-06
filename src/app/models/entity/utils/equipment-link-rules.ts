// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../../equipment-flags.type';
import { Equipment, MiscEquipment, WeaponEquipment } from '../../equipment.model';
import type { EntityMountedEquipment } from '../types';

const ARTEMIS_FLAGS: EquipmentFlag[] = ['F_ARTEMIS', 'F_ARTEMIS_V', 'F_ARTEMIS_PROTO'];
const LASER_MODULE_FLAGS: EquipmentFlag[] = ['F_LASER_INSULATOR', 'F_RISC_LASER_PULSE_MODULE'];
const WEAPON_ENHANCEMENT_FLAGS: EquipmentFlag[] = [
  ...ARTEMIS_FLAGS,
  'F_APOLLO',
  'F_PPC_CAPACITOR',
  ...LASER_MODULE_FLAGS,
];

export interface EquipmentLinkContext {
  readonly year: number;
}

export function isArtemisCompatibleWeapon(weapon: Equipment): boolean {
  return weapon.hasFlag('F_ARTEMIS_COMPATIBLE');
}

export function isPpcCapacitorCompatibleWeapon(
  weapon: Equipment,
  context?: EquipmentLinkContext,
): boolean {
  return weapon.hasFlag('F_PPC')
    && weapon.hasFlag('F_PPC_CAPACITOR_COMPATIBLE')
    && !(context && weapon.id === 'CLERPPC' && context.year < 3101);
}

export function isWeaponEnhancement(mount: EntityMountedEquipment): boolean {
  return mount.equipment instanceof MiscEquipment
    && mount.equipment.hasAnyFlag(WEAPON_ENHANCEMENT_FLAGS);
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
  if (!(enhancement instanceof MiscEquipment) || !(weapon instanceof WeaponEquipment)) return false;
  if (source.mountId === target.mountId || source.location !== target.location) return false;

  if (enhancement.hasAnyFlag(ARTEMIS_FLAGS)) return isArtemisCompatibleWeapon(weapon);
  if (enhancement.hasFlag('F_APOLLO')) return weapon.ammoType === 'MRM';
  if (enhancement.hasFlag('F_PPC_CAPACITOR')) {
    return isPpcCapacitorCompatibleWeapon(weapon, context);
  }
  if (enhancement.hasFlag('F_RISC_LASER_PULSE_MODULE')) {
    return weapon.hasFlag('F_LASER') && !weapon.hasFlag('F_PULSE') && weapon.techBase !== 'Clan';
  }
  if (enhancement.hasFlag('F_LASER_INSULATOR')) return weapon.hasFlag('F_LASER');
  return false;
}