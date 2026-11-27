// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../base-entity';
import type { EntityWeaponQuirk } from '../types/common';
import type { EntityMountedEquipment, EquipmentBay } from '../types/equipment';
import type { Quirk } from '../../quirks.model';
import { WeaponEquipment } from '../../equipment.model';
import {
  isAeroEntity,
  isBattleArmorEntity,
  isInfantryEntity,
  isMekEntity,
  isProtoMekEntity,
  isVehicleEntity,
} from './entity-type-guards';
import { blkEquipmentOrder } from './blk-equipment-order';
import { weaponBayEquipmentId } from './implicit-equipment';

/** MegaMek WeaponQuirks / OptionsConstants; separate from the design-quirk catalog. */
export const WEAPON_QUIRKS: readonly Quirk[] = [
  { key: 'accurate', name: 'Accurate Weapon', type: 'positive', description: '−1 to hit.' },
  { key: 'inaccurate', name: 'Inaccurate Weapon', type: 'negative', description: '+1 to hit.' },
  {
    key: 'stable_weapon',
    name: 'Stabilized Weapon',
    type: 'positive',
    description: '−1 to hit when attacking while running.',
  },
  { key: 'imp_cooling', name: 'Improved Cooling Jacket', type: 'positive', description: '−1 heat generated.' },
  { key: 'poor_cooling', name: 'Poor Cooling Jacket', type: 'negative', description: '+1 heat generated.' },
  { key: 'no_cooling', name: 'No Cooling Jacket', type: 'negative', description: '+2 heat generated.' },
  {
    key: 'exposed_linkage',
    name: 'Exposed Weapon Linkage',
    type: 'negative',
    description: 'A hit to its location can damage the weapon linkage.',
  },
  {
    key: 'ammo_feed_problems',
    name: 'Ammo Feed Problems',
    type: 'negative',
    description: 'Prone to jamming and ammunition explosions.',
  },
  { key: 'static_feed', name: 'Static Ammo Feed', type: 'negative', description: 'Cannot switch ammunition types.' },
  {
    key: 'em_interference',
    name: 'EM Interference',
    type: 'negative',
    description: 'Firing causes electromagnetic interference for one turn.',
  },
  {
    key: 'fast_reload',
    name: 'Fast Reload',
    type: 'positive',
    description: 'The weapon can be reloaded more quickly.',
  },
  {
    key: 'direct_torso_mount',
    name: 'Directional Torso Mount',
    type: 'positive',
    description: 'The weapon can be set to the front or rear arc; the selected arc persists until changed.',
  },
  {
    key: 'direct_torso_mount_quad',
    name: 'Directional Torso Mount (360)',
    type: 'positive',
    description: 'A quad Mek weapon mount with a full 360-degree firing arc.',
  },
  {
    key: 'mod_weapons',
    name: 'Modular Weapon',
    type: 'positive',
    description: 'The weapon is designed for easy replacement.',
  },
  {
    key: 'jettison_capable',
    name: 'Jettison-Capable Weapon',
    type: 'positive',
    description: 'Can be jettisoned and later recovered.',
  },
  { key: 'non_functional', name: 'Non-Functional', type: 'negative', description: 'The weapon does not function.' },
  { key: 'misrepaired_weapon', name: 'Misrepaired Weapon', type: 'negative', description: '+1 to hit.' },
  { key: 'misreplaced_weapon', name: 'Misreplaced Weapon', type: 'negative', description: '+1 to hit.' },
];

export function weaponQuirkDefinition(name: string): Quirk | undefined {
  return WEAPON_QUIRKS.find((quirk) => quirk.key === name);
}

export function canHaveWeaponQuirks(mount: EntityMountedEquipment): boolean {
  const equipment = mount.equipment;
  return (
    equipment instanceof WeaponEquipment ||
    equipment?.hasFlag('F_CLUB') === true ||
    equipment?.hasFlag('F_SHIELD') === true
  );
}

export function canAssignWeaponQuirks(entity: BaseEntity, mount: EntityMountedEquipment): boolean {
  return (
    canHaveWeaponQuirks(mount) && mount.allocation.kind !== 'unallocated' && weaponQuirkAddress(entity, mount).slot >= 0
  );
}

/** MegaMek WeaponQuirks.isQuirkDisallowed, plus the directional mount's placement restriction. */
export function weaponQuirkApplies(entity: BaseEntity, mount: EntityMountedEquipment, key: string): boolean {
  if (!canHaveWeaponQuirks(mount) || isInfantryEntity(entity)) return false;
  const equipment = mount.equipment;
  const cooling = ['imp_cooling', 'poor_cooling', 'no_cooling'].includes(key);
  const ammo = ['ammo_feed_problems', 'static_feed', 'fast_reload'].includes(key);
  if (!(equipment instanceof WeaponEquipment)) return !cooling && !ammo && key !== 'em_interference';
  if (ammo && (!equipment.ammoType || equipment.ammoType === 'NA')) return false;
  if (
    key === 'em_interference' &&
    (!equipment.hasFlag('F_ENERGY') || ['JumpShip', 'WarShip', 'SpaceStation'].includes(entity.entityType))
  )
    return false;
  if (
    cooling &&
    (equipment.heat === 0 || isVehicleEntity(entity) || isBattleArmorEntity(entity) || isProtoMekEntity(entity))
  )
    return false;
  if (isProtoMekEntity(entity) && ['fast_reload', 'static_feed', 'jettison_capable', 'mod_weapons'].includes(key))
    return false;
  if (isAeroEntity(entity) && ['jettison_capable', 'stable_weapon', 'exposed_linkage'].includes(key)) return false;
  if (['JumpShip', 'WarShip', 'SpaceStation'].includes(entity.entityType) && key === 'mod_weapons') return false;
  if (key === 'direct_torso_mount' || key === 'direct_torso_mount_quad') {
    if (
      !isMekEntity(entity) ||
      !['CT', 'LT', 'RT', 'HD'].includes(mount.location) ||
      ['GAUSS_HEAVY', 'IGAUSS_HEAVY'].includes(equipment.ammoType ?? '') ||
      new Set(mount.placements?.map((p) => p.location)).size > 1
    )
      return false;
    if (key === 'direct_torso_mount_quad' && !['Quad', 'QuadVee'].includes(entity.chassisConfig)) return false;
  }
  return true;
}

/** Native MTF uses a physical critical slot; BLK families use their equipment order in the location. */
export function weaponQuirkAddress(entity: BaseEntity, mount: EntityMountedEquipment): Omit<EntityWeaponQuirk, 'name'> {
  const ordered = blkEquipmentOrder(entity).filter((candidate) => candidate.location === mount.location);
  const index = ordered.findIndex((candidate) => candidate.mountId === mount.mountId);
  // Java adds a bay's own critical slot immediately after its first weapon.
  const bayStarts = new Set(
    entity
      .equipmentBays()
      .filter((bay) => bay.kind === 'weapon-bay')
      .map((bay) => bay.weapons[0]?.mountId),
  );
  const slot =
    isMekEntity(entity) && mount.location !== 'Unallocated'
      ? mount.placements
          ?.filter((p) => p.location === mount.location)
          .reduce((first, p) => Math.min(first, p.slotIndex), Infinity)
      : index < 0
        ? -1
        : index + ordered.slice(0, index).filter((candidate) => bayStarts.has(candidate.mountId)).length;
  const location =
    entity.entityType === 'BattleArmor' && entity.techBase() === 'Clan' && mount.location === 'Squad'
      ? 'Point'
      : entity.componentLocationLabel(mount.location);
  return { weaponName: mount.equipmentId, location, slot: slot == null || !Number.isFinite(slot) ? -1 : slot };
}

export function weaponQuirkMount(entity: BaseEntity, entry: EntityWeaponQuirk): EntityMountedEquipment | undefined {
  return entity.equipment().find((mount) => {
    const address = weaponQuirkAddress(entity, mount);
    return (
      address.location === entry.location &&
      address.slot === entry.slot &&
      [mount.equipmentId, mount.equipment?.name, ...(mount.equipment?.aliases ?? [])].includes(entry.weaponName)
    );
  });
}

/** Resolved target of a weapon quirk entry: an installed weapon or a large-craft weapon bay. */
export type WeaponQuirkTarget =
  | { readonly kind: 'mount'; readonly mount: EntityMountedEquipment }
  | { readonly kind: 'bay'; readonly bay: EquipmentBay };

/** MegaMek places a bay's own critical slot immediately after its first weapon (see weaponQuirkAddress). */
export function weaponBayQuirkAddress(
  entity: BaseEntity,
  bay: EquipmentBay,
): Omit<EntityWeaponQuirk, 'name'> | undefined {
  const first = bay.weapons[0];
  if (!first) return undefined;
  const weaponName = weaponBayEquipmentId(first.equipment);
  const address = weaponQuirkAddress(entity, first);
  return address.slot < 0 ? undefined : { weaponName, location: address.location, slot: address.slot + 1 };
}

export function weaponQuirkTarget(entity: BaseEntity, entry: EntityWeaponQuirk): WeaponQuirkTarget | undefined {
  const mount = weaponQuirkMount(entity, entry);
  if (mount) return { kind: 'mount', mount };
  const bay = entity.equipmentBays().find((candidate) => {
    if (candidate.kind !== 'weapon-bay') return false;
    const address = weaponBayQuirkAddress(entity, candidate);
    return (
      !!address &&
      address.location === entry.location &&
      address.slot === entry.slot &&
      address.weaponName === entry.weaponName
    );
  });
  return bay ? { kind: 'bay', bay } : undefined;
}

const reconcilingEntities = new WeakSet<BaseEntity>();

export function withWeaponQuirkReconciliation<Result>(entity: BaseEntity, action: () => Result): Result {
  if (reconcilingEntities.has(entity)) return action();
  const previous = entity.weaponQuirks().map((entry) => ({ entry, target: weaponQuirkTarget(entity, entry) }));
  reconcilingEntities.add(entity);
  try {
    return action();
  } finally {
    reconcilingEntities.delete(entity);
    entity.weaponQuirks.update((entries) =>
      entries.flatMap((entry) => {
        const target = previous.find((saved) => saved.entry === entry)?.target;
        if (!target) return [entry];
        if (target.kind === 'bay') {
          const memberIds = new Set(target.bay.weapons.map((mount) => mount.mountId));
          const bay = entity
            .equipmentBays()
            .find((bay) => bay.kind === 'weapon-bay' && bay.weapons.some((mount) => memberIds.has(mount.mountId)));
          const address = bay && weaponBayQuirkAddress(entity, bay);
          return address ? [{ name: entry.name, ...address }] : [];
        }
        const mount = entity.equipment().find((mount) => mount.mountId === target.mount.mountId);
        return mount ? [{ name: entry.name, ...weaponQuirkAddress(entity, mount) }] : [];
      }),
    );
  }
}

/** Whether the target currently accepts the quirk; a bay accepts what any of its weapons allows. */
export function weaponQuirkTargetApplies(entity: BaseEntity, target: WeaponQuirkTarget, key: string): boolean {
  return target.kind === 'bay'
    ? target.bay.weapons.some((weapon) => weaponQuirkApplies(entity, weapon, key))
    : canAssignWeaponQuirks(entity, target.mount) && weaponQuirkApplies(entity, target.mount, key);
}

export function weaponQuirkLabels(entity: BaseEntity): string[] {
  return entity.applicableWeaponQuirks().map((entry) => {
    const mount = weaponQuirkMount(entity, entry);
    return `${mount?.displayName() ?? entry.weaponName} (${entry.location}${entry.slot >= 0 ? ` ${entry.slot + 1}` : ''}): ${weaponQuirkDefinition(entry.name)?.name ?? entry.name}`;
  });
}
