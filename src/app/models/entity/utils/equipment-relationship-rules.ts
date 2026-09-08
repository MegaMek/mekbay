// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types';
import { isEquipmentLinkSource } from './equipment-link-rules';
import { isLaserInsulatorEquipment } from '../../laser-insulator.model';
import { isRiscLaserPulseModule } from '../../risc-laser-mode.model';

/** Reconcile inferred relationships from the entity's current mounted equipment. */
export function reconcileEquipmentRelationships(entity: BaseEntity): void {
  const mounts = entity.equipment();
  const claimedTargets = new Set<EntityMountedEquipment>();
  const links = new Map<EntityMountedEquipment, EntityMountedEquipment>();

  for (const source of mounts) {
    const target = entity.getLinkedMount(source);
    if (target) claimedTargets.add(target);
  }

  const firstTarget = (
    source: EntityMountedEquipment,
  ): EntityMountedEquipment | undefined => mounts.find(target => {
    return !claimedTargets.has(target)
      && entity.canLinkEquipment(source, target);
  });

  const setLink = (source: EntityMountedEquipment, target: EntityMountedEquipment | undefined): void => {
    if (!target) return;
    links.set(source, target);
    claimedTargets.add(target);
  };

  // BLKBattleArmorFile gives each :APM weapon the preceding free AP mount/glove.
  // A second pass below assigns any remaining weapons to the first free mount.
  const precedingAp = new Map<string, EntityMountedEquipment>();
  for (const mount of mounts) {
    if (mount.equipment?.hasFlag('F_AP_MOUNT') || mount.equipment?.hasFlag('F_ARMORED_GLOVE')) {
      if (!entity.getLinkedMount(mount)) precedingAp.set(mount.location, mount);
    } else if (mount.isAPM && !claimedTargets.has(mount)) {
      const source = precedingAp.get(mount.location);
      if (source && entity.canLinkEquipment(source, mount)) setLink(source, mount);
      precedingAp.delete(mount.location);
    }
  }

  for (let index = 0; index < mounts.length; index++) {
    const source = mounts[index];
    const equipment = source.equipment;
    if (!isEquipmentLinkSource(source) || entity.getLinkedMount(source) || links.has(source)) continue;

    if (isLaserInsulatorEquipment(equipment) || isRiscLaserPulseModule(equipment)) {
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
