// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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