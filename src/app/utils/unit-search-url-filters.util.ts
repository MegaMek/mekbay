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

import type { MultiState, MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import type { GameSystem } from '../models/common.model';
import { getAvailableDropdownValuesMap, type UnitSearchDropdownValuesDependencies } from './unit-search-dropdown-values.util';
import { AdvFilterType, type FilterState, SORT_OPTIONS } from '../services/unit-search-filters.model';
import { getAdvancedFilterConfigByKey } from './unit-search-filter-config.util';

interface ParsedUnitSearchScalarUrlState {
    searchText: string | null;
    sortKey: string | null;
    sortDirection: 'asc' | 'desc' | null;
    expanded: boolean;
    gunnery: number | null;
    piloting: number | null;
    bvLimit: number | null;
    hasFilters: boolean;
}

interface UnitSearchQueryParametersArgs {
    searchText: string;
    filterState: FilterState;
    semanticKeys: ReadonlySet<string>;
    selectedSort: string;
    selectedSortDirection: 'asc' | 'desc';
    expanded: boolean;
    gunnery: number;
    piloting: number;
    bvLimit: number;
    publicTagsParam: string | null;
}

interface UnitSearchQueryParameters {
    [key: string]: string | number | null | undefined;
    q: string | null;
    filters: string | null;
    pt: string | null;
    sort: string | null;
    sortDir: 'asc' | 'desc' | null;
    gunnery: number | null;
    piloting: number | null;
    bvLimit: number | null;
    expanded: 'true' | null;
    gs?: GameSystem | null;
}

function parseBoundedInteger(value: string | null | undefined, min: number, max: number): number | null {
    if (!value) {
        return null;
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < min || parsed > max) {
        return null;
    }

    return parsed;
}

function parsePositiveInteger(value: string | null | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

export function parseUnitSearchScalarUrlState(
    params: URLSearchParams,
    opts: { expandView?: boolean } = {},
): ParsedUnitSearchScalarUrlState {
    const searchText = params.get('q');
    const sortParam = params.get('sort');
    const sortDirectionParam = params.get('sortDir');
    const filtersParam = params.get('filters');

    const hasFilters = Boolean(searchText || filtersParam);
    const shouldExpand = opts.expandView ?? (!params.has('instance') && !params.has('units') && hasFilters);

    return {
        searchText,
        sortKey: sortParam && SORT_OPTIONS.some(opt => opt.key === sortParam) ? sortParam : null,
        sortDirection: sortDirectionParam === 'asc' || sortDirectionParam === 'desc' ? sortDirectionParam : null,
        expanded: params.get('expanded') === 'true' || shouldExpand,
        gunnery: parseBoundedInteger(params.get('gunnery'), 0, 8),
        piloting: parseBoundedInteger(params.get('piloting'), 0, 8),
        bvLimit: parsePositiveInteger(params.get('bvLimit')),
        hasFilters,
    };
}

function generateCompactFiltersParam(state: FilterState): string | null {
    const parts: string[] = [];

    for (const [key, filterState] of Object.entries(state)) {
        if (!filterState.interactedWith) continue;

        const conf = getAdvancedFilterConfigByKey(key);
        if (!conf) continue;

        if (conf.type === AdvFilterType.RANGE) {
            const [min, max] = filterState.value;
            parts.push(`${key}:${min}-${max}`);
        } else if (conf.type === AdvFilterType.DROPDOWN) {
            if (conf.multistate) {
                const selection = filterState.value as MultiStateSelection;
                const subParts: string[] = [];

                for (const [name, selectionValue] of Object.entries(selection)) {
                    if (selectionValue.state !== false) {
                        let part = name;
                        if (selectionValue.state === 'and') part += '.';
                        else if (selectionValue.state === 'not') part += '!';
                        if (selectionValue.count > 1) part += `~${selectionValue.count}`;
                        subParts.push(part);
                    }
                }

                if (subParts.length > 0) {
                    parts.push(`${key}:${subParts.join(',')}`);
                }
            } else {
                const values = filterState.value as string[];
                if (values.length > 0) {
                    parts.push(`${key}:${values.join(',')}`);
                }
            }
        }
    }

    return parts.length > 0 ? parts.join('|') : null;
}

export function buildUnitSearchQueryParameters({
    searchText,
    filterState,
    semanticKeys,
    selectedSort,
    selectedSortDirection,
    expanded,
    gunnery,
    piloting,
    bvLimit,
    publicTagsParam,
}: UnitSearchQueryParametersArgs): UnitSearchQueryParameters {
    const uiOnlyFilters: FilterState = {};
    for (const [key, state] of Object.entries(filterState)) {
        if (!semanticKeys.has(key)) {
            uiOnlyFilters[key] = state;
        }
    }

    const filtersParam = generateCompactFiltersParam(uiOnlyFilters);

    return {
        q: searchText.trim() || null,
        filters: filtersParam || null,
        pt: publicTagsParam,
        sort: selectedSort || null,
        sortDir: selectedSortDirection !== 'asc' ? selectedSortDirection : null,
        gunnery: gunnery !== DEFAULT_GUNNERY_SKILL ? gunnery : null,
        piloting: piloting !== DEFAULT_PILOTING_SKILL ? piloting : null,
        bvLimit: bvLimit > 0 ? bvLimit : null,
        expanded: expanded ? 'true' : null,
    };
}

function parseCompactFiltersFromUrl(filtersParam: string): FilterState {
    const filterState: FilterState = {};
    const parts = filtersParam.split('|');

    for (const part of parts) {
        const colonIndex = part.indexOf(':');
        if (colonIndex === -1) continue;

        const key = part.substring(0, colonIndex);
        const valueStr = part.substring(colonIndex + 1);

        const conf = getAdvancedFilterConfigByKey(key);
        if (!conf) continue;

        if (conf.type === AdvFilterType.RANGE) {
            const match = valueStr.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
            if (match) {
                const min = parseFloat(match[1]);
                const max = parseFloat(match[2]);
                if (!isNaN(min) && !isNaN(max)) {
                    filterState[key] = {
                        value: [min, max],
                        interactedWith: true,
                    };
                }
            }
        } else if (conf.type === AdvFilterType.DROPDOWN) {
            if (conf.multistate) {
                const selection: MultiStateSelection = {};
                const items = valueStr.split(',');

                for (const item of items) {
                    let name = item;
                    let state: MultiState = 'or';
                    let count = 1;

                    const starIndex = name.indexOf('~');
                    if (starIndex !== -1) {
                        count = parseInt(name.substring(starIndex + 1)) || 1;
                        name = name.substring(0, starIndex);
                    }

                    if (name.endsWith('.')) {
                        state = 'and';
                        name = name.slice(0, -1);
                    } else if (name.endsWith('!')) {
                        state = 'not';
                        name = name.slice(0, -1);
                    }

                    selection[name] = { name, state, count };
                }

                if (Object.keys(selection).length > 0) {
                    filterState[key] = {
                        value: selection,
                        interactedWith: true,
                    };
                }
            } else {
                const values = valueStr.split(',').filter(Boolean);
                if (values.length > 0) {
                    filterState[key] = {
                        value: values,
                        interactedWith: true,
                    };
                }
            }
        }
    }

    return filterState;
}

function validateParsedFiltersFromUrl(
    parsedFilters: FilterState,
    dropdownValuesDependencies: UnitSearchDropdownValuesDependencies,
): FilterState {
    const validFilters: FilterState = {};

    for (const [key, state] of Object.entries(parsedFilters)) {
        const conf = getAdvancedFilterConfigByKey(key);
        if (!conf) continue;

        if (conf.type === AdvFilterType.DROPDOWN) {
            // Trust tag URLs even before tag data is fully loaded into units.
            if (key === '_tags') {
                validFilters[key] = state;
                continue;
            }

            const availableValuesMap = getAvailableDropdownValuesMap(conf, dropdownValuesDependencies);

            if (conf.multistate) {
                const selection = state.value as MultiStateSelection;
                const validSelection: MultiStateSelection = {};
                for (const [name, selectionValue] of Object.entries(selection)) {
                    const properCase = availableValuesMap.get(name.toLowerCase());
                    if (properCase) {
                        validSelection[properCase] = { ...selectionValue, name: properCase };
                    }
                }
                if (Object.keys(validSelection).length > 0) {
                    validFilters[key] = { value: validSelection, interactedWith: true };
                }
            } else {
                const values = state.value as string[];
                const validValues = values
                    .map(value => availableValuesMap.get(value.toLowerCase()))
                    .filter((value): value is string => value !== undefined);
                if (validValues.length > 0) {
                    validFilters[key] = { value: validValues, interactedWith: true };
                }
            }
            continue;
        }

        validFilters[key] = state;
    }

    return validFilters;
}

export function parseAndValidateCompactFiltersFromUrl(
    filtersParam: string,
    dropdownValuesDependencies: UnitSearchDropdownValuesDependencies,
): FilterState {
    return validateParsedFiltersFromUrl(
        parseCompactFiltersFromUrl(filtersParam),
        dropdownValuesDependencies,
    );
}