// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitRuntimeState } from './cbt-unit-runtime';

/** Ephemeral authority for an edit, never persisted or inferred from the rendered sheet. */
export interface UnitEditContext {
    readonly owner: object;
    readonly state: CBTUnitRuntimeState;
}

export function isUnitEditContextCurrent(expected: UnitEditContext, current: UnitEditContext): boolean {
    return expected.owner === current.owner && expected.state === current.state;
}
