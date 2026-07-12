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
import { normalizeLooseText, wildcardToRegex } from './string.util';

/**
 * Resolved dropdown values from a filter, categorized by their filter state.
 */
export interface ResolvedDropdownNames {
    or: string[];
    and: string[];
    not: string[];
}

function resolveExplicitDropdownNames(name: string, allNames: string[]): string[] {
    const exactMatches = allNames.filter(candidate => candidate.toLowerCase() === name.toLowerCase());
    if (exactMatches.length > 0) {
        return exactMatches;
    }

    const normalizedName = normalizeLooseText(name);
    if (!normalizedName) {
        return [name];
    }

    const looseMatches = allNames.filter(candidate => normalizeLooseText(candidate) === normalizedName);
    return looseMatches.length > 0 ? looseMatches : [name];
}

/**
 * Resolves dropdown names from a filter's MultiStateSelection and optional
 * wildcard patterns. Wildcard patterns are expanded against the provided
 * list of all available names.
 */
export function resolveDropdownNamesFromFilter(
    selection: MultiStateSelection | undefined,
    allNames: string[],
    wildcardPatterns?: WildcardPattern[]
): ResolvedDropdownNames {
    const or: string[] = [];
    const and: string[] = [];
    const not: string[] = [];

    if (selection) {
        for (const [, opt] of Object.entries(selection)) {
            if (!opt.state) continue;
            const resolvedNames = resolveExplicitDropdownNames(opt.name, allNames);
            if (opt.state === 'or') or.push(...resolvedNames);
            else if (opt.state === 'and') and.push(...resolvedNames);
            else if (opt.state === 'not') not.push(...resolvedNames);
        }
    }

    if (wildcardPatterns && wildcardPatterns.length > 0) {
        for (const wp of wildcardPatterns) {
            const regex = wildcardToRegex(wp.pattern);
            const matched = allNames.filter(name => regex.test(name));
            if (wp.state === 'or') or.push(...matched);
            else if (wp.state === 'and') and.push(...matched);
            else if (wp.state === 'not') not.push(...matched);
        }
    }

    return {
        or: Array.from(new Set(or)),
        and: Array.from(new Set(and)),
        not: Array.from(new Set(not)),
    };
}

/**
 * Collects all positively-selected dropdown names (OR + AND) from a filter,
 * including wildcard expansion.
 */
export function getPositiveDropdownNamesFromFilter(
    selection: MultiStateSelection | undefined,
    allNames: string[],
    wildcardPatterns?: WildcardPattern[]
): string[] {
    const resolved = resolveDropdownNamesFromFilter(selection, allNames, wildcardPatterns);
    const positive = [...resolved.or, ...resolved.and];
    return [...new Set(positive)];
}

export function hasResolvedDropdownNames(resolved: ResolvedDropdownNames): boolean {
    return resolved.or.length > 0 || resolved.and.length > 0 || resolved.not.length > 0;
}