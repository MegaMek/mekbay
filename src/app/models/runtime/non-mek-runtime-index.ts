// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import {
type ArmorFaceId,
type ComponentId,
type CrewPositionId,
type LocationId,
type SystemDamageTrackId
} from '../entity/entity-identifiers';
import { ImmutableIndex } from '../entity/immutable-collections';
import {
systemDamageDefinitions,
type SystemDamageDefinition,
} from '../rules/system-damage-rules';
import type {
CBTRuntimeArmorFace,CBTRuntimeCrewPosition,CBTRuntimeEquipment,CBTRuntimeLocation,
CBTUnitRuntimeIndex
} from './cbt-unit-runtime';
import { buildUnitRuntimeIndex } from './unit-runtime-index';

/** Disposable lookups over the canonical entity; no blueprint facts are copied. */
export interface NonMekRuntimeIndex extends CBTUnitRuntimeIndex {
    readonly locations: ReadonlyMap<LocationId, CBTRuntimeLocation>;
    readonly armorFaces: ReadonlyMap<ArmorFaceId, CBTRuntimeArmorFace>;
    readonly components: ReadonlyMap<ComponentId, CBTRuntimeEquipment>;
    readonly damageTracks: ReadonlyMap<SystemDamageTrackId, SystemDamageDefinition>;
    readonly crewPositions: ReadonlyMap<CrewPositionId, CBTRuntimeCrewPosition>;
}

export function buildNonMekRuntimeIndex(entity: BaseEntity): NonMekRuntimeIndex {
    const base = buildUnitRuntimeIndex(entity);
    const damageTracks = new Map<SystemDamageTrackId, SystemDamageDefinition>();
    for (const track of systemDamageDefinitions(entity)) {
        if (damageTracks.has(track.id)) throw new Error(`Duplicate non-Mek damage-track ID ${track.id}`);
        damageTracks.set(track.id, track);
    }

    return Object.freeze({
        ...base,
        damageTracks: new ImmutableIndex(damageTracks),
    });
}
