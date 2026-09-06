// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import {
asArmorFaceId,asComponentId,asCrewPositionId,asLocationId,
type ArmorFaceId,type ComponentId,type CrewPositionId,type LocationId,
} from '../entity/entity-identifiers';
import { ImmutableIndex } from '../entity/immutable-collections';
import { mekLocationId } from '../entity/mek-entity-conventions';
import type { EntityMountedEquipment } from '../entity/types';
import type {
CBTRuntimeArmorFace,CBTRuntimeCrewPosition,CBTRuntimeEquipment,
CBTRuntimeLocation,CBTUnitRuntimeIndex,
} from './cbt-unit-runtime';

export function componentIdForMount(mount: EntityMountedEquipment): ComponentId {
    return asComponentId(mount.mountId);
}

/** Entity-owned equipment, damage locations and crew have the same identity contract for every unit. */
export function buildUnitRuntimeIndex(entity: BaseEntity): CBTUnitRuntimeIndex & {
    readonly components: ReadonlyMap<ComponentId, CBTRuntimeEquipment>;
} {
    const locations = new Map<LocationId, CBTRuntimeLocation>();
    const armorFaces = new Map<ArmorFaceId, CBTRuntimeArmorFace>();
    for (const location of entity.damageLocations()) {
        const id = entity.entityType === 'Mek'
            ? mekLocationId(location.code) : asLocationId(`location:${location.code}`);
        if (id === null) throw new Error(`Unknown damage location ${location.code}`);
        const faces: ArmorFaceId[] = [];
        const includeRear = entity.hasRearArmor(location.code)
            || (entity.entityType !== 'Mek' && location.armor.rear > 0);
        for (const face of includeRear ? ['front', 'rear'] as const : ['front'] as const) {
            const faceId = asArmorFaceId(`armor:${id}:${face}`);
            faces.push(faceId);
            armorFaces.set(faceId, Object.freeze({ id: faceId, locationId: id,
                face, maximumPoints: location.armor[face] }));
        }
        locations.set(id, Object.freeze({ id, code: location.code,
            internalPoints: location.internalPoints, armorFaceIds: Object.freeze(faces) }));
    }
    const components = new Map<ComponentId, CBTRuntimeEquipment>();
    for (const mount of entity.equipment()) {
        const id = componentIdForMount(mount);
        if (components.has(id)) throw new Error(`Duplicate entity mount ID ${mount.mountId}`);
        components.set(id, Object.freeze({ kind: 'equipment', id, mount }));
    }
    const crewPositions = new Map<CrewPositionId, CBTRuntimeCrewPosition>();
    for (let occurrence = 0; occurrence < entity.crewSlotCount(); occurrence++) {
        const id = asCrewPositionId(`crew:${occurrence}`);
        crewPositions.set(id, Object.freeze({ id, occurrence }));
    }
    return Object.freeze({ locations: new ImmutableIndex(locations), armorFaces: new ImmutableIndex(armorFaces),
        components: new ImmutableIndex(components), crewPositions: new ImmutableIndex(crewPositions) });
}
