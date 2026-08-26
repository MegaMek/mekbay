// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { combineEquipmentStatuses, type EquipmentStatus } from '../equipment-status.model';
import { ImmutableIndex } from '../entity/immutable-collections';
import type { ComponentId } from '../entity/entity-identifiers';
import type { NonMekRuntimeIndex } from './non-mek-runtime-index';
import type { NonMekUnitRuntimeState } from './non-mek-unit-instance';

export interface NonMekComponentStatuses {
    readonly committed: ReadonlyMap<ComponentId, EquipmentStatus>;
    readonly preview: ReadonlyMap<ComponentId, EquipmentStatus>;
}

/** Resolve stored component state plus committed/pending location destruction once. */
export function projectNonMekComponentStatuses(
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
): NonMekComponentStatuses {
    const locations = new Map([...index.locations.values()].map(location => [location.code, location]));
    const committed = new Map<ComponentId, EquipmentStatus>();
    const preview = new Map<ComponentId, EquipmentStatus>();
    for (const component of index.components.values()) {
        const stored = state.components.get(component.id)?.statusOverride ?? 'available';
        const pending = state.pendingCombat.componentStatus.get(component.id) ?? stored;
        const committedLocationDestroyed = component.mount.getOccupiedLocations().some(code => {
            const location = locations.get(code);
            return location !== undefined
                && location.internalPoints > 0
                && (state.locations.get(location.id)?.internalDamage ?? 0) >= location.internalPoints;
        });
        const previewLocationDestroyed = component.mount.getOccupiedLocations().some(code => {
            const location = locations.get(code);
            return location !== undefined
                && location.internalPoints > 0
                && (state.locations.get(location.id)?.internalDamage ?? 0)
                    + (state.pendingCombat.locationInternalDamage.get(location.id) ?? 0)
                    >= location.internalPoints;
        });
        committed.set(component.id, combineEquipmentStatuses([
            stored,
            committedLocationDestroyed ? 'destroyed' : 'available',
        ]));
        preview.set(component.id, combineEquipmentStatuses([
            pending,
            previewLocationDestroyed ? 'destroyed' : 'available',
        ]));
    }
    return Object.freeze({
        committed: new ImmutableIndex(committed),
        preview: new ImmutableIndex(preview),
    });
}
