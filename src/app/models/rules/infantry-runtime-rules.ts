// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ImmutableSet } from '../entity/immutable-collections';
import type { ComponentId } from '../entity/entity-identifiers';
import type { InfantryBaseEntity } from '../entity/entities/infantry/infantry-base-entity';
import { InfantryEntity } from '../entity/entities/infantry/infantry-entity';
import { WeaponEquipment } from '../equipment.model';
import type { MotiveModes } from '../motiveModes.model';
import type { NonMekRuntimeComponent, NonMekRuntimeIndex } from '../runtime/non-mek-runtime-index';
import type { NonMekUnitRuntimeState } from '../runtime/non-mek-unit-instance';

export interface InfantryRuntimeRulesProjection {
    readonly destroyed: boolean;
    readonly movementMinimums: Readonly<Record<MotiveModes, number>>;
    readonly fireBlockedComponentIds: ReadonlySet<ComponentId>;
}

const INFANTRY_MOVEMENT_MINIMUMS: Readonly<Record<MotiveModes, number>> = Object.freeze({
    stationary: 0,
    walk: 0,
    run: 0,
    jump: 1,
    UMU: 0,
    VTOL: 0,
});

/** Production Infantry/Battle Armor rules over the canonical Entity and sparse state. */
export function projectInfantryRuntimeRules(
    entity: InfantryBaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
): InfantryRuntimeRulesProjection {
    return Object.freeze({
        destroyed: state.explicitlyDestroyed || allTroopLocationsDestroyed(index, state),
        movementMinimums: INFANTRY_MOVEMENT_MINIMUMS,
        fireBlockedComponentIds: new ImmutableSet(uncrewedFieldGuns(entity, index, state)),
    });
}

function allTroopLocationsDestroyed(
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
): boolean {
    const locations = [...index.locations.values()];
    return locations.length > 0 && locations.every(location => {
        const runtime = state.locations.get(location.id);
        const internalDestroyed = location.internalPoints <= 0
            || (runtime?.internalDamage ?? 0) >= location.internalPoints;
        const armorDestroyed = location.armorFaceIds.every(faceId => {
            const face = index.armorFaces.get(faceId);
            const damage = runtime?.armorDamage.find(entry => entry.faceId === faceId)?.damage ?? 0;
            return face !== undefined && damage >= face.maximumPoints;
        });
        return internalDestroyed && armorDestroyed;
    });
}

function uncrewedFieldGuns(
    entity: InfantryBaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
): Set<ComponentId> {
    const blocked = new Set<ComponentId>();
    if (!(entity instanceof InfantryEntity)) return blocked;

    const troopLocation = [...index.locations.values()].find(location => location.code === 'Infantry');
    const troopCount = troopLocation === undefined
        ? 0
        : Math.max(
            0,
            troopLocation.internalPoints
                - (state.locations.get(troopLocation.id)?.internalDamage ?? 0),
        );
    const groups = new Map<string, NonMekRuntimeComponent[]>();
    for (const component of index.components.values()) {
        if (component.mount.location !== 'Field Guns'
            || !(component.mount.equipment instanceof WeaponEquipment)) continue;
        const group = groups.get(component.mount.equipmentId) ?? [];
        group.push(component);
        groups.set(component.mount.equipmentId, group);
    }
    for (const components of groups.values()) {
        const mount = components[0]!.mount;
        const crewSize = Math.max(2, Math.ceil(mount.getTonnage(entity) ?? 0));
        const functionalCount = Math.min(components.length, Math.floor(troopCount / crewSize));
        components.slice(functionalCount).forEach(component => blocked.add(component.id));
    }
    return blocked;
}
