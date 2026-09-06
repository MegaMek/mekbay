// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId,CriticalSlotId,LocationId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';
import type { EquipmentFlag } from '../equipment-flags.type';
import type { CBTUnitRuntimeIndex } from './cbt-unit-runtime';
import { RuntimeEquipmentStatusTopology,type RuntimeStatusComponentDefinition,type RuntimeStatusCriticalDefinition } from './equipment-status-kernel';

const EMPTY_FLAGS: ReadonlySet<EquipmentFlag> = new ImmutableSet([]);
interface EquipmentStatusIndex extends CBTUnitRuntimeIndex {
    readonly slots?: ReadonlyMap<CriticalSlotId, RuntimeStatusCriticalDefinition>;
    readonly locationIdsByComponent?: ReadonlyMap<ComponentId, readonly LocationId[]>;
}
// Indexes are immutable and shared by every state revision; compile static relationships once.
const TOPOLOGIES = new WeakMap<CBTUnitRuntimeIndex, RuntimeEquipmentStatusTopology>();

export function buildEquipmentStatusTopology(index: EquipmentStatusIndex): RuntimeEquipmentStatusTopology {
    const retained = TOPOLOGIES.get(index);
    if (retained) return retained;
    const slots = index.slots ?? new Map<CriticalSlotId, RuntimeStatusCriticalDefinition>();
    const slotsByComponent = new Map<ComponentId, CriticalSlotId[]>();
    for (const slot of slots.values()) {
        for (const rawId of slot.componentIds) {
            const componentId = rawId as ComponentId;
            let componentSlots = slotsByComponent.get(componentId);
            if (!componentSlots) slotsByComponent.set(componentId, componentSlots = []);
            componentSlots.push(slot.id as CriticalSlotId);
        }
    }
    const locationIdsByCode = new Map([...index.locations.values()].map(location => [location.code, location.id]));
    const components = new Map<string, RuntimeStatusComponentDefinition>();
    for (const [id, component] of index.components) {
        const locationIds = index.locationIdsByComponent?.get(id)
            ?? component.mount?.getOccupiedLocations().flatMap(code => {
                const locationId = locationIdsByCode.get(code);
                return locationId === undefined ? [] : [locationId];
            }) ?? [];
        components.set(id, {
            id,
            flags: component.mount?.equipment?.flags ?? EMPTY_FLAGS,
            locationIds,
            criticalSlotIds: slotsByComponent.get(id) ?? [],
        });
    }
    const topology = new RuntimeEquipmentStatusTopology({ components, criticalSlots: slots });
    TOPOLOGIES.set(index, topology);
    return topology;
}
