/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import type { GameSystem } from '../models/common.model';
import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import {
    filterStateToSemanticText,
    tokensToFilterState,
    type SemanticToken,
} from './semantic-filter.util';
import { isComplexQuery, parseSemanticQueryAST, type ParseResult } from './semantic-filter-ast.util';
import { getAdvancedFilterConfigByKey, getAdvancedFilterConfigBySemanticField, getDropdownOptionSource } from './unit-search-filter-config.util';
import { type AdvFilterConfig, AdvFilterType, type FilterState } from '../services/unit-search-filters.model';
import { hasUnclosedQuote, isCommittedSemanticToken } from './unit-search-shared.util';

export interface UnitSearchSemanticStateDependencies {
    getDropdownOptionUniverse: (filterKey: string) => readonly string[];
    getExternalDropdownValues: (filterKey: string) => readonly string[];
    getDisplayName: (filterKey: string, value: string) => string | undefined;
}

interface BuildPromotedSearchTextArgs extends UnitSearchSemanticStateDependencies {
    rawText: string;
    gameSystem: GameSystem;
    manualState: FilterState;
    totalRanges: Record<string, [number, number]>;
}

export function getCommittedSemanticTokens(tokens: SemanticToken[]): SemanticToken[] {
    return tokens.filter(token => isCommittedSemanticToken(token));
}

function getCanonicalDropdownLookup(
    conf: AdvFilterConfig,
    dependencies: UnitSearchSemanticStateDependencies,
): Map<string, string> {
    const lookup = new Map<string, string>();
    const addEntry = (rawValue: string, canonicalValue: string) => {
        lookup.set(rawValue.toLowerCase(), canonicalValue);
        const displayValue = dependencies.getDisplayName(conf.key, rawValue);
        if (displayValue) {
            lookup.set(displayValue.toLowerCase(), canonicalValue);
        }
    };

    const values = getDropdownOptionSource(conf) === 'external'
        ? dependencies.getExternalDropdownValues(conf.key)
        : dependencies.getDropdownOptionUniverse(conf.key);

    for (const value of values) {
        addEntry(value, value);
    }

    return lookup;
}

function canonicalizeSemanticDropdownState(
    key: string,
    state: FilterState[string],
    dependencies: UnitSearchSemanticStateDependencies,
): FilterState[string] {
    const conf = getAdvancedFilterConfigByKey(key);
    if (!conf || conf.type !== AdvFilterType.DROPDOWN) {
        return state;
    }

    const lookup = getCanonicalDropdownLookup(conf, dependencies);
    if (lookup.size === 0) {
        return state;
    }

    const canonicalizeValue = (value: string): string => lookup.get(value.toLowerCase()) ?? value;

    if (conf.multistate) {
        const selection = state.value as MultiStateSelection;
        const canonicalSelection: MultiStateSelection = {};

        for (const [name, option] of Object.entries(selection)) {
            const canonicalName = canonicalizeValue(name);
            const existing = canonicalSelection[canonicalName];
            const canonicalOption = {
                ...option,
                name: canonicalName,
            };

            if (!existing) {
                canonicalSelection[canonicalName] = canonicalOption;
                continue;
            }

            if (canonicalOption.state === 'not') {
                existing.state = 'not';
            } else if (canonicalOption.state === 'and' && existing.state === 'or') {
                existing.state = 'and';
            }

            if (canonicalOption.count > existing.count) {
                existing.count = canonicalOption.count;
                existing.countOperator = canonicalOption.countOperator;
                existing.countMax = canonicalOption.countMax;
                existing.countIncludeRanges = canonicalOption.countIncludeRanges;
                existing.countExcludeRanges = canonicalOption.countExcludeRanges;
            }
        }

        return {
            ...state,
            value: canonicalSelection,
            wildcardPatterns: state.wildcardPatterns?.map(pattern => pattern.pattern.includes('*')
                ? pattern
                : { ...pattern, pattern: canonicalizeValue(pattern.pattern) }),
        };
    }

    const values = Array.isArray(state.value) ? state.value as string[] : [];
    return {
        ...state,
        value: Array.from(new Set(values.map(value => canonicalizeValue(value)))),
        wildcardPatterns: state.wildcardPatterns?.map(pattern => pattern.pattern.includes('*')
            ? pattern
            : { ...pattern, pattern: canonicalizeValue(pattern.pattern) }),
    };
}

export function canonicalizeSemanticFilterState(
    state: FilterState,
    dependencies: UnitSearchSemanticStateDependencies,
): FilterState {
    const result: FilterState = {};

    for (const [key, filterState] of Object.entries(state)) {
        result[key] = canonicalizeSemanticDropdownState(key, filterState, dependencies);
    }

    return result;
}

export function getSemanticFilterKeysFromParsed(parsed: ParseResult): Set<string> {
    const committedTokens = getCommittedSemanticTokens(parsed.tokens);
    if (committedTokens.length === 0) {
        return new Set();
    }

    const keys = new Set<string>();
    for (const token of committedTokens) {
        const conf = getAdvancedFilterConfigBySemanticField(token.field);
        if (conf) {
            keys.add(conf.key);
        }
    }

    return keys;
}

function getPromotableSemanticOverlaps(semanticKeys: Set<string>, manualState: FilterState): FilterState {
    const overlaps: FilterState = {};

    for (const [key, state] of Object.entries(manualState)) {
        if (!state.interactedWith || !semanticKeys.has(key)) {
            continue;
        }

        if (!getAdvancedFilterConfigByKey(key)) {
            continue;
        }

        overlaps[key] = state;
    }

    return overlaps;
}

export function buildPromotedSearchText(args: BuildPromotedSearchTextArgs): { text: string; promotedKeys: string[] } {
    const { rawText, gameSystem, manualState, totalRanges, ...dependencies } = args;

    if (hasUnclosedQuote(rawText)) {
        return { text: rawText, promotedKeys: [] };
    }

    const parsed = parseSemanticQueryAST(rawText, gameSystem);
    if (isComplexQuery(parsed.ast)) {
        return { text: rawText, promotedKeys: [] };
    }

    const overlaps = getPromotableSemanticOverlaps(
        getSemanticFilterKeysFromParsed(parsed),
        manualState,
    );
    const promotedKeys = Object.keys(overlaps);
    if (promotedKeys.length === 0) {
        return { text: rawText, promotedKeys };
    }

    const overlapText = filterStateToSemanticText(
        overlaps,
        '',
        gameSystem,
        totalRanges,
    ).trim();
    if (!overlapText) {
        return { text: rawText, promotedKeys: [] };
    }

    const combinedText = rawText.trim() ? `${rawText.trim()} ${overlapText}` : overlapText;
    const combinedParsed = parseSemanticQueryAST(combinedText, gameSystem);
    const normalizedText = filterStateToSemanticText(
        canonicalizeSemanticFilterState(
            tokensToFilterState(combinedParsed.tokens, gameSystem, totalRanges),
            dependencies,
        ),
        combinedParsed.textSearch,
        gameSystem,
        totalRanges,
    ).trim();

    return {
        text: normalizedText || combinedText,
        promotedKeys,
    };
}