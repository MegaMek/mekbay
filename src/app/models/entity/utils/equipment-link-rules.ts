/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import type { EntityMountedEquipment } from '../types';

const ARTEMIS_FLAGS = ['F_ARTEMIS', 'F_ARTEMIS_V', 'F_ARTEMIS_PROTO'];
const LASER_MODULE_FLAGS = ['F_LASER_INSULATOR', 'F_RISC_LASER_PULSE_MODULE'];
const WEAPON_ENHANCEMENT_FLAGS = [
  ...ARTEMIS_FLAGS,
  'F_APOLLO',
  'F_PPC_CAPACITOR',
  ...LASER_MODULE_FLAGS,
];
const IS_CAPACITOR_PPC_IDS = new Set([
  'ISPPC',
  'ISLightPPC',
  'ISHeavyPPC',
  'ISERPPC',
  'ISSnubNosePPC',
]);

export interface EquipmentLinkContext {
  readonly year: number;
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

  if (enhancement.hasAnyFlag(ARTEMIS_FLAGS)) return weapon.hasFlag('F_ARTEMIS_COMPATIBLE');
  if (enhancement.hasFlag('F_APOLLO')) return weapon.ammoType === 'MRM';
  if (enhancement.hasFlag('F_PPC_CAPACITOR')) {
    return weapon.hasFlag('F_PPC') && (IS_CAPACITOR_PPC_IDS.has(weapon.id)
      || (weapon.id === 'CLERPPC' && context.year >= 3101));
  }
  if (enhancement.hasFlag('F_RISC_LASER_PULSE_MODULE')) {
    return weapon.hasFlag('F_LASER') && !weapon.hasFlag('F_PULSE') && weapon.techBase !== 'Clan';
  }
  if (enhancement.hasFlag('F_LASER_INSULATOR')) return weapon.hasFlag('F_LASER');
  return false;
}