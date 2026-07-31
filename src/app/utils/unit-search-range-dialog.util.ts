/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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
