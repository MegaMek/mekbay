// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import { isMekLocation, type EntityMountedEquipment } from '../types';
import { isEquipmentLinkSource, isWeaponEnhancement } from './equipment-link-rules';
import { isMekEntity } from './entity-type-guards';
import { isLaserInsulatorEquipment } from '../../laser-insulator.model';

/**
 * The order an enhancement reads its location in: a Mek location's critical rows, where a weapon split from another
 * location stands at its first row here; otherwise the equipment list.
 */
function readingOrder(
  entity: BaseEntity,
  mounts: readonly EntityMountedEquipment[],
  source: EntityMountedEquipment,
): readonly EntityMountedEquipment[] {
  if (!isMekEntity(entity) || !isMekLocation(source.location)) return mounts;
  const rows = entity.criticalSlotGrid().get(source.location) ?? [];
  const firstRow = (mount: EntityMountedEquipment) => {
    const row = rows.findIndex(slot => slot.type === 'equipment' && slot.mounts.some(placed => placed.mountId === mount.mountId));
    return row < 0 ? Infinity : row;
  };
  return mounts.map((mount, order) => ({ mount, order, row: firstRow(mount) }))
    .sort((left, right) => (left.row - right.row) || (left.order - right.order))
    .map(({ mount }) => mount);
}

/**
 * An enhancement attaches to the nearest weapon above it in its location that can take it, so a laser takes any number
 * of insulators and one of each other enhancement. With no such weapon above, it takes the first weapon in its location
 * that can take it and carries none of its kind, as MegaMek has always done; an insulator that finds every laser
 * insulated stacks on the first one, as MegaMek's MekFileParser does.
 */
function enhancementTarget(
  entity: BaseEntity,
  mounts: readonly EntityMountedEquipment[],
  source: EntityMountedEquipment,
): EntityMountedEquipment | undefined {
  const ordered = readingOrder(entity, mounts, source);
  const canTake = (weapon: EntityMountedEquipment) => entity.canLinkEquipment(source, weapon);
  for (let above = ordered.indexOf(source) - 1; above >= 0; above--) if (canTake(ordered[above])) return ordered[above];
  // Only insulators may share a laser; canLinkEquipment already keeps every other kind to one per weapon.
  const insulator = isLaserInsulatorEquipment(source.equipment);
  const takers = ordered.filter(canTake);
  return takers.find(weapon => !(insulator && entity.getLinkingMounts(weapon).some(other => isLaserInsulatorEquipment(other.equipment))))
    ?? (insulator ? takers[0] : undefined);
}

/** Reconcile inferred relationships from the entity's current mounted equipment. */
export function reconcileEquipmentRelationships(entity: BaseEntity): void {
  const mounts = entity.equipment();
  const bare = (target: EntityMountedEquipment) => !entity.getLinkingMounts(target).length;

  // BLKBattleArmorFile gives each :APM weapon the preceding free AP mount/glove.
  // A second pass below assigns any remaining weapons to the first free mount.
  const precedingAp = new Map<string, EntityMountedEquipment>();
  for (const mount of mounts) {
    if (mount.equipment?.hasFlag('F_AP_MOUNT') || mount.equipment?.hasFlag('F_ARMORED_GLOVE')) {
      if (!entity.getLinkedMount(mount)) precedingAp.set(mount.location, mount);
    } else if (mount.isAPM && !entity.getLinkingMounts(mount).length) {
      const source = precedingAp.get(mount.location);
      if (source && entity.canLinkEquipment(source, mount)) entity.linkEquipment(source, mount);
      precedingAp.delete(mount.location);
    }
  }

  // Enhancements follow their weapon; other link sources take the first weapon nothing targets yet.
  for (let index = 0; index < mounts.length; index++) {
    const source = mounts[index];
    if (!isEquipmentLinkSource(source) || entity.getLinkedMount(source)) continue;
    const target = isWeaponEnhancement(source)
      ? enhancementTarget(entity, mounts, source)
      : mounts.find(candidate => bare(candidate) && entity.canLinkEquipment(source, candidate));
    if (target) entity.linkEquipment(source, target);
  }

  const claimedMachineGuns = new Set<EntityMountedEquipment>();
  const machineGunArrays: { controller: EntityMountedEquipment; mounts: EntityMountedEquipment[] }[] = [];
  const criticalGrid = isMekEntity(entity) ? entity.criticalSlotGrid() : undefined;
  for (const controller of mounts) {
    const equipment = controller.equipment;
    if (!(equipment instanceof WeaponEquipment) || !equipment.hasFlag('F_MGA')) continue;
    const candidates = new Set(mounts.filter(candidate => {
      const weapon = candidate.equipment;
      return candidate !== controller && weapon instanceof WeaponEquipment
        && weapon.hasFlag('F_MG') && !weapon.hasFlag('F_MGA')
        && candidate.location === controller.location && weapon.rackSize === equipment.rackSize
        && !claimedMachineGuns.has(candidate);
    }));
    let members: EntityMountedEquipment[] = [];
    // Native MTF encodes separate arrays through contiguous critical blocks (MekFileParser.linkMGAs).
    // This is a loading convention, not a construction restriction on MGA placement.
    const slots = isMekLocation(controller.location) ? criticalGrid?.get(controller.location) : undefined;
    for (const slot of slots ?? []) {
      const candidate = slot.type === 'equipment' ? slot.mounts[0] : undefined;
      if (candidate && candidates.delete(candidate)) {
        members.push(candidate);
        if (members.length === 4) break;
      } else if (members.length > 0) break;
    }
    if (members.length === 0) members = [...candidates].slice(0, 4);
    for (const member of members) claimedMachineGuns.add(member);
    if (members.length > 0) machineGunArrays.push({ controller, mounts: members });
  }
  entity.replaceEquipmentBays('machine-gun-array', machineGunArrays);
}
