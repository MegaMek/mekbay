// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../base-entity';
import { MekEntity } from '../entities/mek/mek-entity';
import type { EntityMountedEquipment, MountId } from '../types/equipment';
import { blkEquipmentOrder } from './blk-equipment-order';

/** Native codecs regenerate mount IDs. Match detached IDs to their original identities. */
export function matchNativeMounts(original: BaseEntity, detached: BaseEntity): ReadonlyMap<MountId, MountId> {
    const physical = original instanceof MekEntity;
    const available = new Map<string, MountId[]>();
    for (const mount of physical ? original.equipment() : blkEquipmentOrder(original)) {
        const key = nativeMountKey(mount, physical);
        const occurrences = available.get(key) ?? [];
        occurrences.push(mount.mountId);
        available.set(key, occurrences);
    }
    const originalByDetached = new Map<MountId, MountId>();
    for (const mount of detached.equipment()) {
        const originalId = available.get(nativeMountKey(mount, physical))?.shift();
        if (originalId) originalByDetached.set(mount.mountId, originalId);
    }
    return originalByDetached;
}

/** Identical native mounts pair by occurrence; Mek placements disambiguate physical mounts. */
function nativeMountKey(mount: EntityMountedEquipment, physical: boolean): string {
    return JSON.stringify([
        mount.equipment?.id ?? mount.equipmentId, mount.location, mount.rearMounted,
        mount.size ?? 1, mount.baMountLocation ?? '', mount.isDWP ?? false, mount.isAPM ?? false,
        physical ? [...mount.placements ?? []].map(placement => `${placement.location}:${placement.slotIndex}`).sort() : [],
    ]);
}
