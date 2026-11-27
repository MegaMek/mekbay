// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { isWeaponEnhancement } from './equipment-link-rules';

/**
 * The order BLK writes equipment in, which its weapon quirks number. Equipment keeps its own order, which owns the links
 * a reader derives, except that a weapon bay's members go together: each bay weapon followed by its enhancements, since
 * a reader links one to the nearest weapon above it, then the bay's ammo (MegaMek BLKFile.equipmentLayout).
 */
export function blkEquipmentOrder(entity: BaseEntity): readonly EntityMountedEquipment[] {
    const weaponBays = entity.equipmentBays().filter(bay => bay.kind === 'weapon-bay' && bay.weapons.length);
    if (!weaponBays.length) return entity.equipment();
    const bayByMount = new Map(weaponBays.flatMap(bay => bay.mounts.map(mount => [mount.mountId, bay] as const)));
    const emitted = new Set<EntityMountedEquipment['mountId']>();
    const ordered: EntityMountedEquipment[] = [];
    const emit = (mount: EntityMountedEquipment) => {
        if (emitted.has(mount.mountId)) return;
        emitted.add(mount.mountId);
        ordered.push(mount);
    };
    for (const mount of entity.equipment()) {
        const weapon = isWeaponEnhancement(mount) ? entity.getLinkedMount(mount) : undefined;
        // A bay weapon's enhancement is written with that weapon
        if (emitted.has(mount.mountId) || (weapon && bayByMount.has(weapon.mountId))) continue;
        const bay = bayByMount.get(mount.mountId);
        if (!bay) {
            emit(mount);
            continue;
        }
        for (const bayWeapon of bay.weapons) {
            emit(bayWeapon);
            entity.getLinkingMounts(bayWeapon).filter(isWeaponEnhancement).forEach(emit);
        }
        bay.mounts.forEach(emit);
    }
    return ordered;
}
