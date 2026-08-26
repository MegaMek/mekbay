// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  AmmoEquipment,
  Equipment,
  WeaponEquipment,
} from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import { getEquipmentBV } from '../utils/equipment-bv';
import { getEquipmentCost } from '../utils/cost/equipment-pricing';
import { getEquipmentTonnage } from '../utils/equipment-tonnage';
import {
  isPhysicalWeaponEquipment,
  resolvePhysicalWeaponDamage,
  type EntityMountedPhysicalWeapon,
} from '../utils/physical-weapon';
import type { FixedPhysicalDamage } from './weapon';

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

// ============================================================================
// Mounted Equipment - the single canonical equipment model
//
// The entity's `equipment` signal is the sole source of truth for what is
// installed.  Mek critical-slot grids and location inventories are DERIVED
// from this list; they are never independently editable.
// ============================================================================

declare const mountIdBrand: unique symbol;

/** Entity-local identity for an installed mount. Not an equipment database ID. */
export type MountId = string & { readonly [mountIdBrand]: true };

/** Create a mount identity at an entity hydration boundary. */
export function createMountId(value: string): MountId {
  if (!value) throw new Error('Equipment mount IDs cannot be empty');
  return value as MountId;
}

export interface EntityMountedEquipmentInit {
  /** Stable unique identifier within this entity */
  readonly mountId: MountId | string;

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

}

/** Input accepted when installing equipment; entity ownership supplies identity. */
export type EntityMountedEquipmentInput = Omit<EntityMountedEquipmentInit, 'mountId'>;

export class EntityMountedEquipment implements EntityMountedEquipmentInit {
  private owner?: BaseEntity;
  readonly mountId: MountId;
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
  baMountLocation?: 'Body' | 'LA' | 'RA' | 'Turret';
  isDWP?: boolean;
  isSSWM?: boolean;
  isAPM?: boolean;
  shotsCount?: number;
  constructor(data: EntityMountedEquipmentInit, owner?: BaseEntity) {
    Object.assign(this, data);
    this.owner = owner;
    this.mountId = createMountId(data.mountId);
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

  get placedCriticalSlotCount(): number {
    return this.placements?.length ?? 0;
  }

  /** Canonical user-facing name for this installed equipment mount. */
  displayName(): string {
    const name = this.equipment?.shortName || this.equipment?.name || this.equipmentId;
    const modifiers: string[] = [];
    if (this.rearMounted) modifiers.push('R');

    const turret = this.turretType === 'sponson'
      ? 'S'
      : this.turretType === 'pintle'
        ? 'P'
        : this.turretMounted || this.turretType === 'standard'
          ? 'T'
          : null;
    if (turret !== null) modifiers.push(turret);

    if (this.baMountLocation === 'Body') modifiers.push('Body');
    else if (this.baMountLocation === 'Turret' && !modifiers.includes('T')) modifiers.push('T');
    if (this.isSSWM) modifiers.push('SSW: Trooper 1');
    if (this.isDWP) modifiers.push('DWP');

    return modifiers.length === 0 ? name : `${name} (${modifiers.join(', ')})`;
  }

  withAddedPlacement(placement: MountPlacement, primaryLocation = this.location): EntityMountedEquipment {
    if (this.allocation.kind !== 'location') {
      throw new Error(`Cannot add a critical placement to ${this.allocation.kind}-allocated equipment`);
    }
    return this.clone({
      allocation: {
        kind: 'location', location: primaryLocation,
        placements: [...(this.placements ?? []), placement],
      },
    });
  }

  clone(overrides: Partial<EntityMountedEquipmentInit> = {}): EntityMountedEquipment {
    return new EntityMountedEquipment({ ...this, ...overrides }, this.owner);
  }

  /** Associate a parsed or externally-created mount with its canonical entity context. */
  attachToEntity(entity: BaseEntity): void {
    this.assertCanAttachToEntity(entity);
    this.owner = entity;
  }

  /** Validate installation ownership without mutating the mount. */
  assertCanAttachToEntity(entity: BaseEntity): void {
    if (this.owner && this.owner !== entity) {
      throw new Error('Equipment mount is already attached to another entity');
    }
  }

  getOccupiedLocations(): readonly string[] {
    return [...new Set(this.placements?.map(placement => placement.location) ?? [this.location])];
  }

  get isSplitAcrossLocations(): boolean {
    return this.getOccupiedLocations().length > 1;
  }

  /** Resolves this mount's slot count using its entity context and size. */
  getNumCriticalSlots(entity: BaseEntity): number | undefined {
    if (!this.equipment) return undefined;
    return this.equipment.getNumCriticalSlots(entity, this.size ?? 1);
  }

  getAmmoShots(): number | undefined {
    if (!(this.equipment instanceof AmmoEquipment)) return undefined;
    return this.shotsCount ?? this.equipment.shots;
  }

  isPhysicalWeapon(): this is EntityMountedPhysicalWeapon {
    return isPhysicalWeaponEquipment(this.equipment);
  }

  getPhysicalWeaponDamage(): FixedPhysicalDamage | undefined {
    if (!this.isPhysicalWeapon()) return undefined;
    if (!this.owner) throw new Error('Physical weapon damage requires an attached entity');
    return resolvePhysicalWeaponDamage(this.equipment, this.owner.tonnage());
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

export type EquipmentBayKind = 'weapon-bay' | 'machine-gun-array';

/** A mounted-equipment aggregate with one canonical member list. */
export class EquipmentBay {
  readonly kind: EquipmentBayKind;
  readonly controller?: EntityMountedEquipment;
  readonly mounts: readonly EntityMountedEquipment[];

  constructor(
    kind: EquipmentBayKind,
    mounts: readonly EntityMountedEquipment[],
    controller?: EntityMountedEquipment,
  ) {
    this.kind = kind;
    this.mounts = [...mounts];
    this.controller = controller;
  }

  get weapons(): readonly EntityMountedWeapon[] {
    return this.mounts.filter(isEntityMountedWeapon);
  }

  get ammo(): readonly EntityMountedEquipment[] {
    return this.mounts.filter(mount => mount.equipment instanceof AmmoEquipment);
  }
}
