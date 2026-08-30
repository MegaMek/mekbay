// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export const BASE_RULES_REFS: ReadonlySet<string> = new Set(['BMM', 'Core', 'TM', 'TW']);

export function isBaseRulesRef(rulesRef: string): boolean {
    return BASE_RULES_REFS.has(rulesRef);
}
