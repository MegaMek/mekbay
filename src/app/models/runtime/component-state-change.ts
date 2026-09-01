// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekUnitCommandResult } from './unit-instance';

export interface ComponentStateChangeResult {
    readonly accepted: boolean;
    readonly changed: boolean;
}

export function unchangedComponentState(): ComponentStateChangeResult {
    return Object.freeze({ accepted: true, changed: false });
}

export function componentStateChangeFromReduction(reduction: MekUnitCommandResult): ComponentStateChangeResult {
    return Object.freeze({
        accepted: reduction.accepted,
        changed: reduction.changed,
    });
}
