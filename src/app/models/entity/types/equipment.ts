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

import {
  AmmoEquipment,
  Equipment,
  type WeaponCharacteristics,
  WeaponEquipment,
} from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import { getEquipmentBV } from '../utils/equipment-bv';
import { getEquipmentCost } from '../utils/cost/equipment-pricing';
import { getEquipmentTonnage } from '../utils/equipment-tonnage';

// ============================================================================
// Mount Placement - Mek crit slot positions
//
// Each placement anchors one crit of an equipment mount to a specific
// (location, slot-index) pair.  Together with the system template, these
// derive the crit-slot grid without a separate editable signal.
// ============================================================================

/** A single crit-slot assignment for a Mek equipment mount */
export interface MountPlacement {
  readonly location: string;
  readonly slotIndex: number;
}

export type EquipmentAllocation =
  | { readonly kind: 'engine' }
  | { readonly kind: 'unallocated' }
  | {
    readonly kind: 'location';
    readonly location: string;
    readonly placements?: readonly MountPlacement[];
  };

export interface MountedWeaponCharacteristics extends WeaponCharacteristics {
  readonly criticalSlots: number | 'variable' | undefined;
}

// ============================================================================
// Mounted Equipment - the single canonical equipment model
//
// The entity's `equipment` signal is the sole source of truth for what is
// installed.  Mek critical-slot grids and location inventories are DERIVED
// from this list; they are never independently editable.
// ============================================================================

export interface EntityMountedEquipmentInit {
  /** Stable unique identifier within this entity */
  readonly mountId: string;

  /** Internal name - lookup key into the equipment DB */
  equipmentId: string;

  /** Resolved reference (set after parse / on equipment DB load) */
  equipment?: Equipment;

  /** Canonical allocation state. */
  readonly allocation: EquipmentAllocation;

  /** Rear-mounted */
  rearMounted: boolean;

  /** Turret-mounted (Mek head turret) */
  turretMounted: boolean;

  /** Vehicle turret type */
  turretType?: 'standard' | 'sponson' | 'pintle';

  /** OmniPod equipped */
  omniPodMounted: boolean;

  /** Component armored */
  armored: boolean;

  /** VGL facing (0–5) */
  facing?: number;

  /** Variable-size equipment size */
  size?: number;

  /** Split weapon tracking (Mek: crits span multiple locations) */
  isSplit?: boolean;

  /** BA mount location */
  baMountLocation?: 'Body' | 'LA' | 'RA' | 'Turret';

  /** Detachable Weapon Pack */
  isDWP?: boolean;

  /** Squad Support Weapon Mount */
  isSSWM?: boolean;

  /** Anti-Personnel Mount weapon */
  isAPM?: boolean;

  /** Ammo: shot count */
  shotsCount?: number;

  /** Weapon bay members (large craft) */
  bayWeapons?: number[];

  /** Weapon bay ammo (large craft) */
  bayAmmo?: number[];

  /** Starts a new weapon bay (large craft) */
  isNewBay?: boolean;

  /** Combined slot - second equipment in same slot (superheavy Mek) */
  secondEquipmentId?: string;
  secondEquipment?: Equipment;
}

export class EntityMountedEquipment implements EntityMountedEquipmentInit {
  readonly mountId: string;
  equipmentId: string;
  equipment?: Equipment;
  allocation: EquipmentAllocation;
  rearMounted: boolean;
  turretMounted: boolean;
  turretType?: 'standard' | 'sponson' | 'pintle';
  omniPodMounted: boolean;
  armored: boolean;
  facing?: number;
  size?: number;
  isSplit?: boolean;
  baMountLocation?: 'Body' | 'LA' | 'RA' | 'Turret';
  isDWP?: boolean;
  isSSWM?: boolean;
  isAPM?: boolean;
  shotsCount?: number;
  bayWeapons?: number[];
  bayAmmo?: number[];
  isNewBay?: boolean;
  secondEquipmentId?: string;
  secondEquipment?: Equipment;

  constructor(data: EntityMountedEquipmentInit) {
    Object.assign(this, data);
    this.mountId = data.mountId;
    this.equipmentId = data.equipmentId;
    this.allocation = data.allocation;
    this.rearMounted = data.rearMounted;
    this.turretMounted = data.turretMounted;
    this.omniPodMounted = data.omniPodMounted;
    this.armored = data.armored;
  }

  get location(): string {
    switch (this.allocation.kind) {
      case 'engine': return 'Engine';
      case 'unallocated': return 'Unallocated';
      case 'location': return this.allocation.location;
    }
  }

  get placements(): readonly MountPlacement[] | undefined {
    return this.allocation.kind === 'location' ? this.allocation.placements : undefined;
  }

  withAllocation(allocation: EquipmentAllocation): EntityMountedEquipment {
    return this.clone({ allocation });
  }

  static from(mount: EntityMountedEquipment | EntityMountedEquipmentInit): EntityMountedEquipment {
    return mount instanceof EntityMountedEquipment ? mount : new EntityMountedEquipment(mount);
  }

  clone(overrides: Partial<EntityMountedEquipmentInit> = {}): EntityMountedEquipment {
    return new EntityMountedEquipment({ ...this, ...overrides });
  }

  getOccupiedLocations(): readonly string[] {
    return [...new Set(this.placements?.map(placement => placement.location) ?? [this.location])];
  }

  getCriticalSlotRequirement(entity: BaseEntity): number | 'variable' | undefined {
    if (!this.equipment) return undefined;
    if (this.equipment.critSlots === 'variable') return 'variable';
    return this.equipment.getNumCriticalSlots(entity, this.size ?? 1);
  }

  getAmmoShots(): number | undefined {
    if (!(this.equipment instanceof AmmoEquipment)) return undefined;
    return this.shotsCount ?? this.equipment.shots;
  }

  getWeaponCharacteristics(entity: BaseEntity): MountedWeaponCharacteristics | undefined {
    if (!(this.equipment instanceof WeaponEquipment)) return undefined;
    return {
      ...this.equipment.characteristics,
      criticalSlots: this.getCriticalSlotRequirement(entity),
    };
  }

  getBV(entity: BaseEntity): number {
    return getEquipmentBV(entity, this);
  }

  getTonnage(entity: BaseEntity): number | undefined {
    return getEquipmentTonnage(entity, this);
  }

  getCost(entity: BaseEntity): number | undefined {
    return getEquipmentCost(entity, this);
  }
}

export type EntityMountedWeapon = EntityMountedEquipment & { readonly equipment: WeaponEquipment };

export function isEntityMountedWeapon(mount: EntityMountedEquipment): mount is EntityMountedWeapon {
  return mount.equipment instanceof WeaponEquipment;
}
