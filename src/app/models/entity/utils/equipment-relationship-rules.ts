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