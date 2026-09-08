// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import { isEquipmentLinkSource } from '../../models/entity/utils/equipment-link-rules';
import { encodeNativeEntity } from '../../models/entity/write-entity';

/** Native slot/bay order owns inferred links; preserve the editor's mount identities. */
export function reconcileConstructionEquipmentRelationships(entity: BaseEntity): void {
    const originals = entity.equipment();
    const linkSources = originals.filter(isEquipmentLinkSource);
    if (!linkSources.length && !originals.some(mount => mount.equipment?.hasFlag('F_MGA'))) {
        entity.replaceEquipmentBays('machine-gun-array', []);
        return;
    }
    const parsed = parseEntity(encodeNativeEntity(entity), entity instanceof MekEntity ? 'construction.mtf' : 'construction.blk', entity.getEquipmentRegistry()).entity;
    const available = new Map<string, EntityMountedEquipment[]>();
    for (const mount of originals) {
        const key = nativeMountKey(mount, entity instanceof MekEntity);
        const occurrences = available.get(key) ?? [];
        occurrences.push(mount);
        available.set(key, occurrences);
    }
    const originalByParsed = new Map<EntityMountedEquipment, EntityMountedEquipment>();
    for (const mount of parsed.equipment()) {
        const original = available.get(nativeMountKey(mount, entity instanceof MekEntity))?.shift();
        if (original) originalByParsed.set(mount, original);
    }
    for (const source of linkSources) entity.unlinkEquipment(source);
    for (const parsedSource of parsed.equipment().filter(isEquipmentLinkSource)) {
        const source = originalByParsed.get(parsedSource);
        const parsedTarget = parsed.getLinkedMount(parsedSource);
        const target = parsedTarget && originalByParsed.get(parsedTarget);
        if (source && target && entity.canLinkEquipment(source, target)) entity.linkEquipment(source, target);
    }
    entity.replaceEquipmentBays('machine-gun-array', parsed.equipmentBays()
        .filter(bay => bay.kind === 'machine-gun-array')
        .flatMap(bay => {
            const controller = bay.controller && originalByParsed.get(bay.controller);
            const mounts = bay.mounts.map(mount => originalByParsed.get(mount)).filter((mount): mount is EntityMountedEquipment => !!mount);
            return controller && mounts.length ? [{ controller, mounts }] : [];
        }));
}

/** Identical native mounts are paired by occurrence; physical Mek placements disambiguate them. */
function nativeMountKey(mount: EntityMountedEquipment, physical: boolean): string {
    return JSON.stringify([
        mount.equipment?.id ?? mount.equipmentId, mount.location, mount.rearMounted,
        mount.size ?? 1, mount.baMountLocation ?? '', mount.isDWP ?? false, mount.isAPM ?? false,
        physical ? [...mount.placements ?? []].map(placement => `${placement.location}:${placement.slotIndex}`).sort() : [],
    ]);
}
