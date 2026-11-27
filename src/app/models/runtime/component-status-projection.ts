// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableIndex } from '../entity/immutable-collections';
import type { EquipmentStatus } from '../equipment-status.model';
import type { CBTUnitRuntimeIndex,CBTUnitRuntimeState,RuntimeStatePerspective } from './cbt-unit-runtime';
import { RuntimeEquipmentStatusKernel,type RuntimeEquipmentCommittedState } from './equipment-status-kernel';
import { buildEquipmentStatusTopology } from './equipment-status-topology';

export interface ComponentStatusProjection {
    readonly committed: ReadonlyMap<ComponentId, EquipmentStatus>;
    readonly preview: ReadonlyMap<ComponentId, EquipmentStatus>;
}

/** Projects authored component/location causes through the same kernel used by slot mechanics. */
export function projectComponentLocationStatuses(
    index: CBTUnitRuntimeIndex,
    state: CBTUnitRuntimeState,
    vehicleEngineHits?: Readonly<{ committed: boolean; preview: boolean }>,
): ComponentStatusProjection {
    const topology = buildEquipmentStatusTopology(index);
    const facts = (perspective: RuntimeStatePerspective): RuntimeEquipmentCommittedState => {
        const components = new Map<string, EquipmentStatus>();
        for (const component of index.components.values()) {
            const stored = state.components.get(component.id)?.statusOverride ?? 'available';
            components.set(component.id, perspective === 'preview'
                ? state.pendingCombat.componentStatus.get(component.id) ?? stored : stored);
        }
        const locations = new Map<string, EquipmentStatus>();
        for (const location of index.locations.values()) {
            const damage = (state.locations.get(location.id)?.internalDamage ?? 0)
                + (perspective === 'preview' ? state.pendingCombat.locationInternalDamage.get(location.id) ?? 0 : 0);
            if (location.internalPoints > 0 && damage >= location.internalPoints) locations.set(location.id, 'destroyed');
        }
        return { components, locations, criticalSlots: new Map(),
            engineHit: vehicleEngineHits?.[perspective] ?? false };
    };
    const family = vehicleEngineHits === undefined ? 'other' as const : 'vehicle' as const;
    const committedKernel = new RuntimeEquipmentStatusKernel(topology, facts('committed'), { family });
    const previewKernel = new RuntimeEquipmentStatusKernel(topology, facts('preview'), { family });
    return Object.freeze({
        committed: new ImmutableIndex([...index.components.keys()].map(id => [id, committedKernel.component(id).status] as const)),
        preview: new ImmutableIndex([...index.components.keys()].map(id => [id, previewKernel.component(id).status] as const)),
    });
}
