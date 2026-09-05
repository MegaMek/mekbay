// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CriticalSlotId, ComponentId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';
import type { EquipmentFlag } from '../equipment-flags.type';
import { RuntimeEquipmentStatusTopology, type RuntimeStatusComponentDefinition } from './equipment-status-kernel';
import { componentLocationIds, type MekRuntimeIndex } from './mek-runtime-index';

const EMPTY_FLAGS: ReadonlySet<EquipmentFlag> = new ImmutableSet([]);

/** Compile entity relationships in one pass; the runtime instance owns their lifetime. */
export function buildMekEquipmentStatusTopology(index: MekRuntimeIndex): RuntimeEquipmentStatusTopology {
    const slotsByComponent = new Map<ComponentId, CriticalSlotId[]>();
    for (const slot of index.slots.values()) {
        for (const componentId of slot.componentIds) {
            let slots = slotsByComponent.get(componentId);
            if (!slots) slotsByComponent.set(componentId, slots = []);
            slots.push(slot.id);
        }
    }
    const components = new Map<string, RuntimeStatusComponentDefinition>();
    for (const [id, component] of index.components) {
        components.set(id, {
            id,
            flags: component.kind === 'equipment' ? component.mount.equipment?.flags ?? EMPTY_FLAGS : EMPTY_FLAGS,
            locationIds: componentLocationIds(index, id),
            criticalSlotIds: slotsByComponent.get(id) ?? [],
        });
    }
    return new RuntimeEquipmentStatusTopology({ components, criticalSlots: index.slots });
}
