// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { RangeFilterConfig } from '../services/unit-search-filters.model';

export interface NullableRangeInput {
    from: number | null;
    to: number | null;
}

/**
 * Clamps entered endpoints to the available range and returns them in ascending order.
 * Missing endpoints represent the corresponding available-range boundary.
 */
export function normalizeUnitSearchRange(
    input: NullableRangeInput,
    availableRange: readonly [number, number],
): [number, number] {
    const [availableMin, availableMax] = availableRange;
    const clamp = (value: number) => Math.min(availableMax, Math.max(availableMin, value));
    const from = clamp(input.from ?? availableMin);
    const to = clamp(input.to ?? availableMax);

    return from <= to ? [from, to] : [to, from];
}

/** Returns whether the range dialog must accept non-integer values. */
export function rangeFilterAllowsFloatingValues(
    config: Pick<RangeFilterConfig, 'stepSize' | 'specialValues'> | undefined,
): boolean {
    return !Number.isInteger(config?.stepSize ?? 1)
        || (config?.specialValues?.some(value => !Number.isInteger(value)) ?? false);
}
