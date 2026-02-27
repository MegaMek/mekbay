/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import { EntityMountedEquipment } from '../types';

/**
 * Options for equipment line encoding.
 */
export interface EncodeEquipmentOptions {
  /**
   * When true, suppresses location-implied suffixes (`(T)`, `(R)`)
   * that are already conveyed by the BLK block structure.
   */
  blkMode?: boolean;
}

/**
 * Encodes an `EntityMountedEquipment` into an equipment line string.
 *
 * Mirrors Java's equipment line encoding. The encoded line
 * can be placed inside a `<LocationName Equipment>` block (BLK)
 * or used in an MTF crit-slot section.
 *
 * @param mount The mounted equipment to encode
 * @param options Encoding options
 * @returns The encoded equipment line
 */
export function encodeEquipmentLine(mount: EntityMountedEquipment, options?: EncodeEquipmentOptions): string {
  let name = mount.equipmentId;
  const blk = options?.blkMode ?? false;

  // Weapon bay marker
  if (mount.isNewBay) {
    name = '(B) ' + name;
  }

  // Rear mounted prefix
  if (mount.rearMounted) {
    name = '(R) ' + name;
  }

  // Turret suffix — standard (T) is implied by the BLK location block,
  // but sponson (ST) and pintle (PT) appear in location blocks and need the suffix.
  if (!blk) {
    if (mount.turretType) {
      name += turretSuffix(mount.turretType);
    } else if (mount.turretMounted) {
      name += '(T)';
    }
  } else if (mount.turretType && mount.turretType !== 'standard') {
    name += turretSuffix(mount.turretType);
  }

  // BA mount types (Java order: DWP → SSWM → APM → OMNI)
  if (mount.isDWP) {
    name += ':DWP';
  }
  if (mount.isSSWM) {
    name += ':SSWM';
  }
  if (mount.isAPM) {
    name += ':APM';
  }

  // OmniPod suffix
  if (mount.omniPodMounted) {
    name += ':OMNI';
  }

  // BA mount location
  if (mount.baMountLocation) {
    name += `:${mount.baMountLocation === 'Turret' ? 'TU' : mount.baMountLocation}`;
  }

  // Shot count (for BA/handheld ammo) or variable-size equipment (mutually exclusive)
  if (mount.shotsLeft !== undefined) {
    name += `:Shots${mount.shotsLeft}#`;
  } else if (mount.size !== undefined) {
    const sizeVal = Number.isInteger(mount.size) ? mount.size.toFixed(1) : String(mount.size);
    name += `:SIZE:${sizeVal}`;
  }

  // VGL facing
  if (mount.facing !== undefined) {
    name += facingSuffix(mount.facing);
  }

  return name;
}

/**
 * Returns the turret type suffix for a BLK equipment line.
 */
function turretSuffix(type: 'standard' | 'sponson' | 'pintle'): string {
  switch (type) {
    case 'standard': return '(T)';
    case 'sponson':  return '(ST)';
    case 'pintle':   return '(PT)';
  }
}

/**
 * Returns the facing suffix for a BLK equipment line (VGL).
 * Facing values: 0=FL, 1=FR, 2=F, 3=R, 4=RL, 5=RR
 */
function facingSuffix(facing: number): string {
  switch (facing) {
    case 0: return '(FL)';
    case 1: return '(FR)';
    case 2: return '(F)';
    case 3: return '(R)';
    case 4: return '(RL)';
    case 5: return '(RR)';
    default: return '';
  }
}
