// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../../models/entity/base-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import { isEquipmentLinkSource } from '../../models/entity/utils/equipment-link-rules';
import { matchNativeMounts } from '../../models/entity/utils/native-mount-correspondence';
import { encodeNativeEntity, nativeEntityFormat } from '../../models/entity/write-entity';

/** Native slot/bay order owns inferred links; preserve the editor's mount identities. */
export function reconcileConstructionEquipmentRelationships(entity: BaseEntity): void {
    const originals = entity.equipment();
    const linkSources = originals.filter(isEquipmentLinkSource);
    // A changed attachment flag can stop an old source qualifying for inference.
    // Clear its old derived link as well as those still recognized as sources.
    const previousSources = originals.filter(mount => !!entity.getLinkedMount(mount));
    if (!linkSources.length && !originals.some(mount => mount.equipment?.hasFlag('F_MGA'))) {
        for (const source of previousSources) entity.unlinkEquipment(source);
        entity.replaceEquipmentBays('machine-gun-array', []);
        return;
    }
    const parsed = parseEntity(encodeNativeEntity(entity), `construction.${nativeEntityFormat(entity)}`, entity.getEquipmentRegistry()).entity;
    const originalIds = matchNativeMounts(entity, parsed);
    const originalById = new Map(originals.map(mount => [mount.mountId, mount]));
    const originalByParsed = new Map<EntityMountedEquipment, EntityMountedEquipment>();
    for (const mount of parsed.equipment()) {
        const originalId = originalIds.get(mount.mountId);
        const original = originalId && originalById.get(originalId);
        if (original) originalByParsed.set(mount, original);
    }
    for (const source of previousSources) entity.unlinkEquipment(source);
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
