// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** The complete Classic BattleTech ruleset vocabulary used by publication and runtime. */
export type CBTRuleset = 'total-warfare' | 'core-2026';

export const TOTAL_WARFARE_RULESET: CBTRuleset = 'total-warfare';
export const CORE_2026_RULESET: CBTRuleset = 'core-2026';

export const CBT_RULESET_LABELS: Readonly<Record<CBTRuleset, string>> = Object.freeze({
    'total-warfare': 'Total Warfare',
    'core-2026': 'Core 2026',
});

export function isCBTRuleset(value: unknown): value is CBTRuleset {
    return value === TOTAL_WARFARE_RULESET || value === CORE_2026_RULESET;
}
