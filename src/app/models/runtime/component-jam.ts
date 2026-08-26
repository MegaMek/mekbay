// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from '../equipment-flags.type';
import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';

/** Immutable entity and selected-rules facts required by jam/unjam. */
export interface ComponentJamDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags: ReadonlySet<EquipmentFlag>;
    readonly supportsJamming: boolean;
}

export function createComponentJamDefinition(input: {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags?: Iterable<EquipmentFlag>;
    readonly supportsJamming: boolean;
}): ComponentJamDefinition {
    if (!input.displayName.trim() || input.displayName.includes('\0')) {
        throw new Error(`Invalid component jam display name for ${input.componentId}`);
    }
    return Object.freeze({
        componentId: input.componentId,
        displayName: input.displayName,
        flags: new ImmutableSet(input.flags ?? []),
        supportsJamming: input.supportsJamming,
    });
}
