// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from '../equipment-flags.type';
import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';

/** Immutable entity facts shared by rules that inspect a component status. */
export interface ComponentStatusDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags: ReadonlySet<EquipmentFlag>;
}

export function createComponentStatusDefinition(input: {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags?: Iterable<EquipmentFlag>;
}): ComponentStatusDefinition {
    if (!input.displayName.trim() || input.displayName.includes('\0')) {
        throw new Error(`Invalid component status display name for ${input.componentId}`);
    }
    return Object.freeze({
        componentId: input.componentId,
        displayName: input.displayName,
        flags: new ImmutableSet(input.flags ?? []),
    });
}

export function componentStatusDefinition(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): ComponentStatusDefinition {
    const equipment = equipmentForComponent(index, componentId);
    if (!equipment) throw new Error(`Component ${componentId} has no equipment status definition`);
    return createComponentStatusDefinition({
        componentId,
        displayName: equipment.name,
        flags: equipment.flags,
    });
}
