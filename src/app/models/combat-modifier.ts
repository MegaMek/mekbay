// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ToHitModifierBreakdownEntry } from './rules/game-rules';

export interface UnitModifierBreakdownEntry extends ToHitModifierBreakdownEntry {
    readonly alternateModifier?: number;
    readonly alternateModifierLabel?: string;
}

export interface UnitModifierTotal {
    readonly modifier: number;
    readonly alternateModifier?: number;
    readonly alternateModifierLabel?: string;
}

export function calculateModifierTotal(
    entries: readonly UnitModifierBreakdownEntry[],
): UnitModifierTotal {
    let min = 0;
    let max = 0;
    for (const entry of entries) {
        min += Math.min(entry.modifier, entry.alternateModifier ?? entry.modifier);
        max += Math.max(entry.modifier, entry.alternateModifier ?? entry.modifier);
    }
    return min === max
        ? Object.freeze({ modifier: max })
        : Object.freeze({ modifier: max, alternateModifier: min });
}
