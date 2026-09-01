// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import type { EntityMountedEquipment } from '../entity/types';
import { ImmutableIndex } from '../entity/immutable-collections';
import {
    nonMekDamageTrackDefinitions,
    type NonMekDamageTrackDefinition,
} from '../rules/non-mek-damage-track-rules';
import {
    asArmorFaceId,
    asComponentId,
    asCrewPositionId,
    asLocationId,
    type ArmorFaceId,
    type ComponentId,
    type SystemDamageTrackId,
    type CrewPositionId,
    type LocationId,
} from '../entity/entity-identifiers';
import type {
    CBTRuntimeArmorFace,
    CBTRuntimeComponent,
    CBTRuntimeCrewPosition,
    CBTRuntimeLocation,
    CBTUnitRuntimeIndex,
} from './cbt-unit-runtime';

export type NonMekRuntimeLocation = CBTRuntimeLocation;

export type NonMekRuntimeArmorFace = CBTRuntimeArmorFace;

export interface NonMekRuntimeComponent extends CBTRuntimeComponent {
    readonly kind: 'equipment';
    readonly mount: EntityMountedEquipment;
}

export type NonMekRuntimeCrewPosition = CBTRuntimeCrewPosition;

export type NonMekDamageTrack = NonMekDamageTrackDefinition;

/** Disposable lookups over the canonical entity; no blueprint facts are copied. */
export interface NonMekRuntimeIndex extends CBTUnitRuntimeIndex {
    readonly locations: ReadonlyMap<LocationId, NonMekRuntimeLocation>;
    readonly armorFaces: ReadonlyMap<ArmorFaceId, NonMekRuntimeArmorFace>;
    readonly components: ReadonlyMap<ComponentId, NonMekRuntimeComponent>;
    readonly damageTracks: ReadonlyMap<SystemDamageTrackId, NonMekDamageTrack>;
    readonly crewPositions: ReadonlyMap<CrewPositionId, NonMekRuntimeCrewPosition>;
}

export function componentIdForMount(mount: EntityMountedEquipment): ComponentId {
    return asComponentId(mount.mountId);
}

export function buildNonMekRuntimeIndex(entity: BaseEntity): NonMekRuntimeIndex {
    const locations = new Map<LocationId, NonMekRuntimeLocation>();
    const armorFaces = new Map<ArmorFaceId, NonMekRuntimeArmorFace>();
    for (const damageLocation of entity.damageLocations()) {
        const code = damageLocation.code;
        const id = asLocationId(`location:${code}`);
        const armor = damageLocation.armor;
        const faceIds: ArmorFaceId[] = [];
        const frontId = asArmorFaceId(`armor:${id}:front`);
        faceIds.push(frontId);
        armorFaces.set(frontId, Object.freeze({
            id: frontId,
            locationId: id,
            face: 'front',
            maximumPoints: armor.front,
        }));
        if (entity.hasRearArmor(code) || armor.rear > 0) {
            const rearId = asArmorFaceId(`armor:${id}:rear`);
            faceIds.push(rearId);
            armorFaces.set(rearId, Object.freeze({
                id: rearId,
                locationId: id,
                face: 'rear',
                maximumPoints: armor.rear,
            }));
        }
        locations.set(id, Object.freeze({
            id,
            code,
            ...(damageLocation.sheetCode === undefined ? {} : { sheetCode: damageLocation.sheetCode }),
            internalPoints: damageLocation.internalPoints,
            armorFaceIds: Object.freeze(faceIds),
            ...(damageLocation.combinedPips === true ? { combinedPips: true } : {}),
            ...(damageLocation.soldierPips === true ? { soldierPips: true } : {}),
        }));
    }

    const components = new Map<ComponentId, NonMekRuntimeComponent>();
    for (const mount of entity.equipment()) {
        const id = componentIdForMount(mount);
        if (components.has(id)) throw new Error(`Duplicate entity mount ID ${mount.mountId}`);
        components.set(id, Object.freeze({ kind: 'equipment', id, mount }));
    }

    const damageTracks = new Map<SystemDamageTrackId, NonMekDamageTrack>();
    for (const track of nonMekDamageTrackDefinitions(entity)) {
        if (damageTracks.has(track.id)) throw new Error(`Duplicate non-Mek damage-track ID ${track.id}`);
        damageTracks.set(track.id, track);
    }

    const crewPositions = new Map<CrewPositionId, NonMekRuntimeCrewPosition>();
    for (let occurrence = 0; occurrence < entity.crewSlotCount(); occurrence += 1) {
        const id = asCrewPositionId(`crew:${occurrence}`);
        crewPositions.set(id, Object.freeze({ id, occurrence }));
    }

    return Object.freeze({
        locations: new ImmutableIndex(locations),
        armorFaces: new ImmutableIndex(armorFaces),
        components: new ImmutableIndex(components),
        damageTracks: new ImmutableIndex(damageTracks),
        crewPositions: new ImmutableIndex(crewPositions),
    });
}
