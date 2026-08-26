// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CommandReduction } from './unit-instance';

export type ComponentStateChangeResult =
    | { readonly accepted: true; readonly changed: boolean; readonly idempotent: boolean }
    | {
        readonly accepted: false;
        readonly changed: false;
        readonly idempotent: false;
        readonly reason: Extract<CommandReduction, { readonly accepted: false }>['reason'];
    };

export function unchangedComponentState(): ComponentStateChangeResult {
    return Object.freeze({ accepted: true, changed: false, idempotent: true });
}

export function componentStateChangeFromReduction(reduction: CommandReduction): ComponentStateChangeResult {
    if (reduction.accepted) {
        return Object.freeze({
            accepted: true,
            changed: !reduction.idempotent,
            idempotent: reduction.idempotent,
        });
    }
    if (reduction.reason === 'NO_CHANGE') return unchangedComponentState();
    return Object.freeze({
        accepted: false,
        changed: false,
        idempotent: false,
        reason: reduction.reason,
    });
}
