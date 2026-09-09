// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';

/** BLK records bay membership through contiguous members beginning with a weapon. */
export function blkEquipmentOrder(entity: BaseEntity): readonly EntityMountedEquipment[] {
    const weaponBays = entity.equipmentBays().filter(bay => bay.kind === 'weapon-bay');
    if (!weaponBays.length) return entity.equipment();
    const bayByMount = new Map(weaponBays.flatMap(bay => bay.mounts.map(mount => [mount.mountId, bay] as const)));
    const emitted = new Set<EntityMountedEquipment['mountId']>();
    const ordered: EntityMountedEquipment[] = [];
    for (const mount of entity.equipment()) {
        if (emitted.has(mount.mountId)) continue;
        const bay = bayByMount.get(mount.mountId);
        const firstWeapon = bay?.weapons[0];
        const members = bay && firstWeapon
            ? [firstWeapon, ...bay.mounts.filter(member => member.mountId !== firstWeapon.mountId)] : [mount];
        for (const member of members) {
            if (emitted.has(member.mountId)) continue;
            emitted.add(member.mountId);
            ordered.push(member);
        }
    }
    return ordered;
}
