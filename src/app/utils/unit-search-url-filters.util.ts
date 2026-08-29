// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MultiState, MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import type { GameSystem } from '../models/common.model';
import { getAvailableDropdownValuesMap, type UnitSearchDropdownValuesDependencies } from './unit-search-dropdown-values.util';
import { AdvFilterType, normalizeTriStateBooleanFilterValue, type FilterState, SORT_OPTIONS } from '../services/unit-search-filters.model';
import { getAdvancedFilterConfigByKey, getPublicUnitSearchPropertyKey, normalizeUnitSearchPropertyKey } from './unit-search-filter-config.util';
import { parseValues } from './semantic-filter.util';
import { normalizeMultiStateSelection } from './unit-search-shared.util';
import type { UnitSearchViewMode } from '../models/options.model';
import { DEFAULT_CLASSIC_BV_NORMALIZATION_MAX_DELTA, type BvNormalizationSettings, type PvNormalizationSettings, type UnitSearchBudgetMode } from '../models/unit-search-result.model';
import { isValidBvNormalizationSettings } from './bv-normalization.util';
import { isValidPvNormalizationSettings } from './pv-normalization.util';
import { getASSpecialToken } from './as-special-filter.util';

export interface ParsedUnitSearchScalarUrlState {
    searchText: string | null;
    sortKey: string | null;
    sortDirection: 'asc' | 'desc' | null;
    expanded: boolean;
    gunnery: number | null;
    piloting: number | null;
    bvLimit: number | null;
    budgetMode: UnitSearchBudgetMode;
    bvNormalization: BvNormalizationSettings | null;
    pvNormalization: PvNormalizationSettings | null;
    hasFilters: boolean;
    viewMode: UnitSearchViewMode | null;
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
    budgetMode?: UnitSearchBudgetMode;
    bvNormalization?: BvNormalizationSettings;
    pvNormalization?: PvNormalizationSettings;
    publicTagsParam: string | null;
    viewMode?: UnitSearchViewMode;
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
    bvMode: 'limit' | 'normalize' | null;
    bvMin: number | null;
    bvMax: number | null;
    gMin: number | null;
    gMax: number | null;
    pMin: number | null;
    pMax: number | null;
    maxDelta: number | null;
    pvMode: 'normalize' | null;
    pvMin: number | null;
    pvMax: number | null;
    skillMin: number | null;
    skillMax: number | null;
    expanded: 'true' | null;
    view: Exclude<UnitSearchViewMode, 'list'> | null;
    gs?: GameSystem | null;
}

export function parseUnitSearchViewMode(value: string | null | undefined): UnitSearchViewMode | null {
    return value === 'list' || value === 'card' || value === 'chassis' || value === 'table'
        ? value
        : null;
}

function quoteCompactFilterValue(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function serializeCompactFilterValue(value: string): string {
    const needsQuoting = value.includes(',') || value.includes('|') || value.includes(':') ||
        value.includes('"') || value.includes('\\') || value.includes('~') ||
        value.endsWith('.') || value.endsWith('!');

    return needsQuoting ? quoteCompactFilterValue(value) : value;
}

function splitCompactFilterValues(valueStr: string): string[] {
    return parseValues(valueStr).filter(value => value.trim() !== '');
}

function serializeASSpecialMinimumSuffix(values: readonly (number | null)[] | undefined): string {
    if (!values?.some(value => value !== null && value !== undefined)) {
        return '';
    }

    let lastValueIndex = values.length - 1;
    while (lastValueIndex >= 0 && (values[lastValueIndex] === null || values[lastValueIndex] === undefined)) {
        lastValueIndex--;
    }

    return '^' + values.slice(0, lastValueIndex + 1)
        .map(value => value === null || value === undefined ? '' : String(value))
        .join('/');
}

function parseASSpecialMinimumSuffix(value: string): { name: string; minimumValues?: (number | null)[] } {
    const markerIndex = value.lastIndexOf('^');
    if (markerIndex === -1) {
        return { name: value };
    }

    const parts = value.slice(markerIndex + 1).split('/');
    const minimumValues: (number | null)[] = [];
    for (const part of parts) {
        if (part === '') {
            minimumValues.push(null);
            continue;
        }

        const parsed = Number(part);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return { name: value };
        }
        minimumValues.push(parsed);
    }

    return minimumValues.some(entry => entry !== null)
        ? { name: value.slice(0, markerIndex), minimumValues }
        : { name: value.slice(0, markerIndex) };
}

function parseBoundedInteger(value: string | null | undefined, min: number, max: number): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
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

function parseNonnegativeInteger(value: string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return null;
    }

    return parsed;
}

export function parseUnitSearchScalarUrlState(
    params: URLSearchParams,
    opts: { expandView?: boolean } = {},
): ParsedUnitSearchScalarUrlState {
    const searchText = params.get('q');
    const rawSortParam = params.get('sort');
    const sortParam = rawSortParam ? normalizeUnitSearchPropertyKey(rawSortParam) : null;
    const sortDirectionParam = params.get('sortDir');
    const filtersParam = params.get('filters');
    const viewMode = parseUnitSearchViewMode(params.get('view'));

    const hasFilters = Boolean(searchText || filtersParam);
    const shouldExpand = opts.expandView ?? (!params.has('instance') && !params.has('units') && hasFilters);
    const normalization: BvNormalizationSettings = {
        targetBv: {
            min: parseNonnegativeInteger(params.get('bvMin')) ?? -1,
            max: parseNonnegativeInteger(params.get('bvMax')) ?? -1,
        },
        gunnery: {
            min: parseBoundedInteger(params.get('gMin'), 0, 8) ?? -1,
            max: parseBoundedInteger(params.get('gMax'), 0, 8) ?? -1,
        },
        piloting: {
            min: parseBoundedInteger(params.get('pMin'), 0, 8) ?? -1,
            max: parseBoundedInteger(params.get('pMax'), 0, 8) ?? -1,
        },
        maxDelta: params.has('maxDelta')
            ? parseBoundedInteger(params.get('maxDelta'), 0, 8) ?? -1
            : DEFAULT_CLASSIC_BV_NORMALIZATION_MAX_DELTA,
    };
    const rawBudgetMode = params.get('bvMode');
    const bvNormalization = rawBudgetMode === 'normalize'
        && isValidBvNormalizationSettings(normalization)
        ? normalization
        : null;
    const pvSettings: PvNormalizationSettings = {
        targetPv: {
            min: parseNonnegativeInteger(params.get('pvMin')) ?? -1,
            max: parseNonnegativeInteger(params.get('pvMax')) ?? -1,
        },
        skill: {
            min: parseBoundedInteger(params.get('skillMin'), 0, 8) ?? -1,
            max: parseBoundedInteger(params.get('skillMax'), 0, 8) ?? -1,
        },
    };
    const pvNormalization = params.get('pvMode') === 'normalize'
        && isValidPvNormalizationSettings(pvSettings)
        ? pvSettings
        : null;
    const hasConflictingBudgetModes = rawBudgetMode !== null && params.get('pvMode') === 'normalize';
    const resolvedBvNormalization = hasConflictingBudgetModes ? null : bvNormalization;
    const resolvedPvNormalization = hasConflictingBudgetModes ? null : pvNormalization;
    const budgetMode: UnitSearchBudgetMode = hasConflictingBudgetModes
        ? null
        : resolvedPvNormalization
        ? 'pv-normalization'
        : resolvedBvNormalization
        ? 'bv-normalization'
        : rawBudgetMode === 'limit'
            ? 'force-limit'
            : null;

    return {
        searchText,
        sortKey: sortParam && SORT_OPTIONS.some(opt => opt.key === sortParam) ? sortParam : null,
        sortDirection: sortDirectionParam === 'asc' || sortDirectionParam === 'desc' ? sortDirectionParam : null,
        expanded: params.get('expanded') === 'true' || (viewMode !== 'table' && shouldExpand),
        gunnery: parseBoundedInteger(params.get('gunnery'), 0, 8),
        piloting: parseBoundedInteger(params.get('piloting'), 0, 8),
        bvLimit: budgetMode === 'force-limit' ? parsePositiveInteger(params.get('bvLimit')) : null,
        budgetMode,
        bvNormalization: resolvedBvNormalization,
        pvNormalization: resolvedPvNormalization,
        hasFilters,
        viewMode,
    };
}

function generateCompactFiltersParam(state: FilterState): string | null {
    const parts: string[] = [];

    for (const [key, filterState] of Object.entries(state)) {
        if (!filterState.interactedWith) continue;

        const conf = getAdvancedFilterConfigByKey(key);
        if (!conf) continue;
        const publicKey = getPublicUnitSearchPropertyKey(key);

        if (conf.type === AdvFilterType.RANGE) {
            const [min, max] = filterState.value;
            parts.push(`${publicKey}:${min}-${max}`);
        } else if (conf.type === AdvFilterType.BOOLEAN) {
            const value = normalizeTriStateBooleanFilterValue(filterState.value);
            if (value !== null) {
                parts.push(`${publicKey}:${value === 'or' ? 'yes' : 'no'}`);
            }
        } else if (conf.type === AdvFilterType.DROPDOWN) {
            if (conf.multistate) {
                const selection = normalizeMultiStateSelection(filterState.value);
                const subParts: string[] = [];

                for (const [name, selectionValue] of Object.entries(selection)) {
                    if (selectionValue.state !== false) {
                        let part = serializeCompactFilterValue(name);
                        if (selectionValue.state === 'and') part += '.';
                        else if (selectionValue.state === 'not') part += '!';
                        if (selectionValue.count > 1) part += `~${selectionValue.count}`;
                        if (key === 'as.specials') {
                            part += serializeASSpecialMinimumSuffix(selectionValue.minimumValues);
                        }
                        subParts.push(part);
                    }
                }

                if (subParts.length > 0) {
                    parts.push(`${publicKey}:${subParts.join(',')}`);
                }
            } else {
                const values = filterState.value as string[];
                if (values.length > 0) {
                    parts.push(`${publicKey}:${values.map(serializeCompactFilterValue).join(',')}`);
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
    budgetMode = null,
    bvNormalization,
    pvNormalization,
    publicTagsParam,
    viewMode = 'list',
}: UnitSearchQueryParametersArgs): UnitSearchQueryParameters {
    const uiOnlyFilters: FilterState = {};
    for (const [key, state] of Object.entries(filterState)) {
        if (!semanticKeys.has(key)) {
            uiOnlyFilters[key] = state;
        }
    }

    const filtersParam = generateCompactFiltersParam(uiOnlyFilters);
    const forceLimitActive = budgetMode === 'force-limit';
    const normalizationActive = budgetMode === 'bv-normalization' && bvNormalization != null;
    const pvNormalizationActive = budgetMode === 'pv-normalization' && pvNormalization != null;

    return {
        q: searchText.trim() || null,
        filters: filtersParam || null,
        pt: publicTagsParam,
        sort: selectedSort ? getPublicUnitSearchPropertyKey(selectedSort) : null,
        sortDir: selectedSortDirection !== 'asc' ? selectedSortDirection : null,
        gunnery: gunnery !== DEFAULT_GUNNERY_SKILL ? gunnery : null,
        piloting: piloting !== DEFAULT_PILOTING_SKILL ? piloting : null,
        bvLimit: forceLimitActive && bvLimit > 0 ? bvLimit : null,
        bvMode: normalizationActive ? 'normalize' : forceLimitActive ? 'limit' : null,
        bvMin: normalizationActive ? bvNormalization.targetBv.min : null,
        bvMax: normalizationActive ? bvNormalization.targetBv.max : null,
        gMin: normalizationActive ? bvNormalization.gunnery.min : null,
        gMax: normalizationActive ? bvNormalization.gunnery.max : null,
        pMin: normalizationActive ? bvNormalization.piloting.min : null,
        pMax: normalizationActive ? bvNormalization.piloting.max : null,
        maxDelta: normalizationActive ? bvNormalization.maxDelta : null,
        pvMode: pvNormalizationActive ? 'normalize' : null,
        pvMin: pvNormalizationActive ? pvNormalization.targetPv.min : null,
        pvMax: pvNormalizationActive ? pvNormalization.targetPv.max : null,
        skillMin: pvNormalizationActive ? pvNormalization.skill.min : null,
        skillMax: pvNormalizationActive ? pvNormalization.skill.max : null,
        expanded: expanded ? 'true' : null,
        view: viewMode === 'list' ? null : viewMode,
    };
}

function parseCompactFiltersFromUrl(
    filtersParam: string,
    dropdownValuesDependencies?: UnitSearchDropdownValuesDependencies,
): FilterState {
    const filterState: FilterState = {};
    const parts = filtersParam.split('|');

    for (const part of parts) {
        const colonIndex = part.indexOf(':');
        if (colonIndex === -1) continue;

        const key = normalizeUnitSearchPropertyKey(part.substring(0, colonIndex));
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
        } else if (conf.type === AdvFilterType.BOOLEAN) {
            const value = normalizeTriStateBooleanFilterValue(valueStr);
            if (value !== null) {
                filterState[key] = {
                    value,
                    interactedWith: true,
                };
            }
        } else if (conf.type === AdvFilterType.DROPDOWN) {
            const availableValuesMap = dropdownValuesDependencies
                ? getAvailableDropdownValuesMap(conf, dropdownValuesDependencies)
                : null;
            const legacyCompositeSpecial = key === 'as.specials' && /^TUR\s*\(.*\)$/i.test(valueStr)
                ? valueStr
                : undefined;
            const exactValueMatch = availableValuesMap?.get(valueStr.toLowerCase()) ?? legacyCompositeSpecial;

            if (conf.multistate) {
                if (exactValueMatch) {
                    filterState[key] = {
                        value: {
                            [exactValueMatch]: { name: exactValueMatch, state: 'or', count: 1 },
                        },
                        interactedWith: true,
                    };
                    continue;
                }

                const selection: MultiStateSelection = {};
                const items = splitCompactFilterValues(valueStr);

                for (const item of items) {
                    let name = item;
                    let state: MultiState = 'or';
                    let count = 1;
                    let minimumValues: (number | null)[] | undefined;

                    if (key === 'as.specials') {
                        const parsedMinimum = parseASSpecialMinimumSuffix(name);
                        name = parsedMinimum.name;
                        minimumValues = parsedMinimum.minimumValues;
                    }

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

                    name = conf.valueNormalizer?.(name) ?? name;

                    selection[name] = {
                        name,
                        state,
                        count,
                        ...(minimumValues ? { minimumValues } : {}),
                    };
                }

                if (Object.keys(selection).length > 0) {
                    filterState[key] = {
                        value: selection,
                        interactedWith: true,
                    };
                }
            } else {
                const values = exactValueMatch
                    ? [exactValueMatch]
                    : splitCompactFilterValues(valueStr);
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
                const selection = normalizeMultiStateSelection(state.value);
                const validSelection: MultiStateSelection = {};
                for (const [name, selectionValue] of Object.entries(selection)) {
                    const normalizedName = conf.valueNormalizer?.(name) ?? name;
                    const properCase = availableValuesMap.get(normalizedName.toLowerCase());
                    if (properCase) {
                        validSelection[properCase] = { ...selectionValue, name: properCase };
                        continue;
                    }

                    // Preserve old shared URLs that selected one concrete TUR
                    // string before the specials index switched to tokens.
                    if (key === 'as.specials') {
                        const token = getASSpecialToken(normalizedName);
                        if (token && availableValuesMap.has(token.toLowerCase())) {
                            validSelection[normalizedName] = { ...selectionValue, name: normalizedName };
                        }
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
        parseCompactFiltersFromUrl(filtersParam, dropdownValuesDependencies),
        dropdownValuesDependencies,
    );
}

/** Resolve startup view state without allowing local preferences to alter shared search URLs. */
export function resolveInitialUnitSearchViewMode(
    params: URLSearchParams,
    persistedViewMode: UnitSearchViewMode,
): UnitSearchViewMode {
    const explicitViewMode = parseUnitSearchViewMode(params.get('view'));
    if (explicitViewMode) {
        return explicitViewMode === 'table' && params.get('expanded') !== 'true'
            ? 'list'
            : explicitViewMode;
    }

    const hasSearchState = params.has('q') || params.has('filters');
    return hasSearchState || persistedViewMode === 'table' ? 'list' : persistedViewMode;
}
