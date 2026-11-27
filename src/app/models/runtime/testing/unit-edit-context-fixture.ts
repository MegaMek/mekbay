// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createPristineMekState } from '../runtime-state';
import type { UnitEditContext } from '../unit-edit-context';

/** Stable identities for UI fixtures; a new factory represents a replacement owner. */
export function createUnitEditContextFixture(): (revision: number) => UnitEditContext {
    const owner = {};
    const contexts = new Map<number, UnitEditContext>();
    return revision => {
        let context = contexts.get(revision);
        if (!context) {
            context = Object.freeze({ owner, state: Object.freeze({ ...createPristineMekState(), stateRevision: revision }) });
            contexts.set(revision, context);
        }
        return context;
    };
}
