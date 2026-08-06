// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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

  /** Entity-specific syntax for an explicit ammo quantity. */
  shotsFormat?: 'none' | 'ba-handheld' | 'large-craft' | 'protomek';

  /** Marks this mount as the first member of a serialized weapon bay. */
  startsWeaponBay?: boolean;

  /** Emits the mount's OmniPod suffix. Defaults to true. */
  includeOmniPod?: boolean;
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
  if (options?.startsWeaponBay) {
    name = '(B) ' + name;
  }

  // Rear mounted prefix
  if (mount.rearMounted) {
    name = '(R) ' + name;
  }

  // Turret suffix - standard (T) is implied by the BLK location block,
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
  if (mount.omniPodMounted && (options?.includeOmniPod ?? true)) {
    name += ':OMNI';
  }

  // BA mount location
  if (mount.baMountLocation) {
    name += `:${mount.baMountLocation === 'Turret' ? 'TU' : mount.baMountLocation}`;
  }

  // Explicit ammo quantity syntax depends on the owning entity's file grammar.
  if (mount.shotsCount !== undefined) {
    switch (options?.shotsFormat ?? 'none') {
      case 'ba-handheld': name += `:Shots${mount.shotsCount}#`; break;
      case 'large-craft': name += `:${mount.shotsCount}`; break;
      case 'protomek': name += ` (${mount.shotsCount})`; break;
    }
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
