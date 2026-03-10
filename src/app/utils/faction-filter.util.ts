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

import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import type { WildcardPattern } from './semantic-filter.util';
import { wildcardToRegex } from './string.util';

/**
 * Author: Drake
 * Resolved faction names from a filter, categorized by their filter state.
 */
export interface ResolvedFactionNames {
    or: string[];
    and: string[];
    not: string[];
}

/**
 * Resolves faction names from a filter's MultiStateSelection and optional
 * wildcard patterns. Wildcard patterns ("Free World*") are expanded
 * against the provided list of all available faction names.
 *
 * @param selection The MultiStateSelection from the faction filter value
 * @param allFactionNames All available faction names for wildcard expansion
 * @param wildcardPatterns Optional wildcard patterns from the filter state
 * @returns Resolved faction names categorized by state (or/and/not)
 */
export function resolveFactionNamesFromFilter(
    selection: MultiStateSelection | undefined,
    allFactionNames: string[],
    wildcardPatterns?: WildcardPattern[]
): ResolvedFactionNames {
    const or: string[] = [];
    const and: string[] = [];
    const not: string[] = [];

    // Collect explicit faction names from MultiStateSelection
    if (selection) {
        for (const [, opt] of Object.entries(selection)) {
            if (!opt.state) continue;
            if (opt.state === 'or') or.push(opt.name);
            else if (opt.state === 'and') and.push(opt.name);
            else if (opt.state === 'not') not.push(opt.name);
        }
    }

    // Expand wildcard patterns against all faction names
    if (wildcardPatterns && wildcardPatterns.length > 0) {
        for (const wp of wildcardPatterns) {
            const regex = wildcardToRegex(wp.pattern);
            const matched = allFactionNames.filter(name => regex.test(name));
            if (wp.state === 'or') or.push(...matched);
            else if (wp.state === 'and') and.push(...matched);
            else if (wp.state === 'not') not.push(...matched);
        }
    }

    return { or, and, not };
}

/**
 * Collects all positively-selected faction names (OR + AND) from a filter,
 * including wildcard expansion. Useful for picking a random faction from
 * the active filter.
 *
 * @param selection The MultiStateSelection from the faction filter value
 * @param allFactionNames All available faction names for wildcard expansion
 * @param wildcardPatterns Optional wildcard patterns from the filter state
 * @returns Deduplicated array of positively-selected faction names
 */
export function getPositiveFactionNamesFromFilter(
    selection: MultiStateSelection | undefined,
    allFactionNames: string[],
    wildcardPatterns?: WildcardPattern[]
): string[] {
    const resolved = resolveFactionNamesFromFilter(selection, allFactionNames, wildcardPatterns);
    const positive = [...resolved.or, ...resolved.and];
    // Deduplicate
    return [...new Set(positive)];
}
