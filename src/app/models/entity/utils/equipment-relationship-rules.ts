// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types';
import { isWeaponEnhancement } from './equipment-link-rules';

/** Reconcile inferred relationships from the entity's current mounted equipment. */
export function reconcileEquipmentRelationships(entity: BaseEntity): void {
  const mounts = entity.equipment();
  const weapons = mounts.filter(mount => mount.equipment instanceof WeaponEquipment);
  const claimedTargets = new Set<EntityMountedEquipment>();
  const links = new Map<EntityMountedEquipment, EntityMountedEquipment>();

  for (const source of mounts) {
    const target = entity.getLinkedMount(source);
    if (target) claimedTargets.add(target);
  }

  const firstTarget = (
    source: EntityMountedEquipment,
  ): EntityMountedEquipment | undefined => weapons.find(target => {
    const weapon = target.equipment;
    return weapon instanceof WeaponEquipment && !claimedTargets.has(target)
      && entity.canLinkEquipment(source, target);
  });

  const setLink = (source: EntityMountedEquipment, target: EntityMountedEquipment | undefined): void => {
    if (!target) return;
    links.set(source, target);
    claimedTargets.add(target);
  };

  for (let index = 0; index < mounts.length; index++) {
    const source = mounts[index];
    const equipment = source.equipment;
    if (!(equipment instanceof MiscEquipment) || !isWeaponEnhancement(source)
      || entity.getLinkedMount(source)) continue;

    if (equipment.hasAnyFlag(['F_LASER_INSULATOR', 'F_RISC_LASER_PULSE_MODULE'])) {
      const predecessor = mounts[index - 1];
      if (predecessor && !claimedTargets.has(predecessor)
        && entity.canLinkEquipment(source, predecessor)) {
        setLink(source, predecessor);
      } else {
        setLink(source, firstTarget(source));
      }
    } else {
      setLink(source, firstTarget(source));
    }
  }

  if (links.size > 0) {
    for (const [source, target] of links) entity.linkEquipment(source, target);
  }

  const claimedMachineGuns = new Set<EntityMountedEquipment>();
  const machineGunArrays: { controller: EntityMountedEquipment; mounts: EntityMountedEquipment[] }[] = [];
  for (const controller of mounts) {
    const equipment = controller.equipment;
    if (!(equipment instanceof WeaponEquipment) || !equipment.hasFlag('F_MGA')) continue;
    const members = mounts.filter(candidate => {
      const weapon = candidate.equipment;
      return candidate !== controller && weapon instanceof WeaponEquipment
        && weapon.hasFlag('F_MG') && !weapon.hasFlag('F_MGA')
        && candidate.location === controller.location && weapon.rackSize === equipment.rackSize
        && !claimedMachineGuns.has(candidate);
    }).slice(0, 4);
    for (const member of members) claimedMachineGuns.add(member);
    if (members.length > 0) machineGunArrays.push({ controller, mounts: members });
  }
  entity.replaceEquipmentBays('machine-gun-array', machineGunArrays);
}