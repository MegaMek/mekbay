// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId, CriticalSlotId } from '../entity/entity-identifiers';
import type { MekRuntimeIndex, MekIndexedCriticalSlot } from './mek-runtime-index';
import { mekCriticalDamageThreshold } from './equipment-status-kernel';

/** First mark is component armor; the following mark is the first component hit. */
export function mekCriticalSlotDirectHitThreshold(slot: MekIndexedCriticalSlot): number {
    return slot.armored ? 2 : 1;
}

/**
 * Maximum representable marks for one slot.
 *
 * Ordinary multi-slot equipment cannot be hit twice in the same slot. Core
 * autocannons mounted in exactly one slot are the production exception: their
 * second component hit must remain representable after the first hit.
 */
export function mekCriticalSlotMaximumHits(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    slot: MekIndexedCriticalSlot,
): number {
    const componentHits = slot.componentIds.reduce((maximum, componentId) => {
        const component = index.components.get(componentId);
        if (component?.kind !== 'equipment') return maximum;
        const installedSlots = componentCriticalSlotIds(index, componentId);
        if (installedSlots.length !== 1) return maximum;
        return Math.max(
            maximum,
            mekCriticalDamageThreshold(ruleset, component.mount.equipment?.flags ?? new Set()),
        );
    }, 1);
    return componentHits + (slot.armored ? 1 : 0);
}

/** Whether a slot can receive a rules-owned critical hit. */
export function mekCriticalSlotHittable(
    index: MekRuntimeIndex,
    slot: MekIndexedCriticalSlot,
): boolean {
    return slot.componentIds.some(componentId => {
        const component = index.components.get(componentId);
        return component?.kind === 'system' || component?.mount.equipment?.hittable !== false;
    });
}

export function componentCriticalSlotIds(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): readonly CriticalSlotId[] {
    return Object.freeze([...index.slots.values()]
        .filter(slot => slot.componentIds.includes(componentId))
        .map(slot => slot.id));
}
