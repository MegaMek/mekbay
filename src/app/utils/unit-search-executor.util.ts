// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { GameSystem } from '../models/common.model';
import type { UnitSearchNormalization, UnitSearchNormalizationMatch } from '../models/unit-search-result.model';
import { getForcePacks } from '../models/forcepacks.model';
import { ADVANCED_FILTERS, AS_MOVEMENT_MODE_DISPLAY_NAMES, AdvFilterType, isMegaMekRaritySortKey, normalizeMotiveValue, type FilterState, type SearchTelemetryStage } from '../services/unit-search-filters.model';
import {
    filterUnitsWithAST,
    getMatchingTextForUnit,
    isComplexQuery,
    type EvaluatorContext,
    type ParseResult,
} from './semantic-filter-ast.util';
import { createSearchMatcher, parseSearchQuery, type SearchTokensGroup } from './search.util';
import {
    compareUnitsByName,
    compileRelevanceSearchGroups,
    computeRelevanceScore,
    naturalCompare,
} from './sort.util';
import { removeAccents, wildcardToRegex } from './string.util';
import { getNowMs, getProperty, getUnitCountableFilterData, isCommittedSemanticToken, measureStage } from './unit-search-shared.util';
import { applyFilterStateToUnits, type UnitFilterKernelDependencies } from './unit-filter-kernel.util';
import type { AvailabilityFilterScope } from '../services/unit-search-filters.model';
import { findBvNormalizationMatch } from './bv-normalization.util';
import { findPvNormalizationMatch } from './pv-normalization.util';
import type { ParsedASSpecials } from './as-special-filter.util';
import type { UnitSearchRecord } from './unit-search-worker-protocol.util';
import type { UnitUuid } from '../services/unit-catalog/unit-catalog.types';

export interface UnitSearchExecutionRequest<
    TUnit extends UnitSearchRecord = UnitSummary,
> {
    units: TUnit[];
    parsedQuery: ParseResult;
    searchTokens: SearchTokensGroup[];
    uiOnlyFilterState?: FilterState;
    uiOnlyFilterDependencies?: UnitFilterKernelDependencies<NoInfer<TUnit>>;
    initialAvailabilityScope?: AvailabilityFilterScope;
    gameSystem: GameSystem;
    sortKey: string;
    sortDirection: 'asc' | 'desc';
    bvPvLimit: number;
    forceTotalBvPv: number;
    getAdjustedBV: (unit: NoInfer<TUnit>) => number;
    getAdjustedPV: (unit: NoInfer<TUnit>) => number;
    normalization?: UnitSearchNormalization | null;
    unitBelongsToEra: (unit: NoInfer<TUnit>, eraName: string, scope?: AvailabilityFilterScope) => boolean;
    unitBelongsToFaction: (unit: NoInfer<TUnit>, factionName: string, eraNames?: readonly string[]) => boolean;
    unitMatchesAvailabilityFrom?: (unit: NoInfer<TUnit>, availabilityFromName: string, scope?: AvailabilityFilterScope) => boolean;
    unitMatchesAvailabilityRarity?: (unit: NoInfer<TUnit>, rarityName: string, scope?: AvailabilityFilterScope) => boolean;
    unitBelongsToForcePack: (unit: NoInfer<TUnit>, packName: string) => boolean;
    unitMatchesFormationTarget?: (unit: NoInfer<TUnit>, formationName: string) => boolean;
    getAllEraNames: () => string[];
    getAllFactionNames: () => string[];
    getAllAvailabilityFromNames?: () => string[];
    getAllAvailabilityRarityNames?: () => string[];
    getAllFormationNames?: () => string[];
    getDisplayName?: (filterKey: string, value: string) => string | undefined;
    getIndexedUnitIds?: (filterKey: string, value: string, scope?: AvailabilityFilterScope) => ReadonlySet<UnitUuid> | undefined;
    getIndexedFilterValues?: (filterKey: string) => readonly string[];
    getIndexedASSpecials?: (unitUuid: UnitUuid) => ParsedASSpecials | undefined;
    availabilitySortScope?: AvailabilityFilterScope;
    getMegaMekRaritySortScore?: (unit: NoInfer<TUnit>, scope?: AvailabilityFilterScope) => number;
}

export interface UnitSearchExecutionResult<
    TUnit extends UnitSearchRecord = UnitSummary,
> {
    results: TUnit[];
    normalizationMatchesByUnitUuid: ReadonlyMap<UnitUuid, UnitSearchNormalizationMatch>;
    telemetryStages: SearchTelemetryStage[];
    totalMs: number;
    unitCount: number;
    isComplex: boolean;
}

function getSelectedASMotiveCodes(
    parsedQuery: ParseResult,
    uiOnlyFilterState: FilterState | undefined,
): ReadonlySet<string> | null {
    const selectedDisplayNames = new Set<string>();

    const addValue = (value: string) => {
        if (value.includes('*')) {
            const matcher = wildcardToRegex(value);
            for (const [code, displayName] of Object.entries(AS_MOVEMENT_MODE_DISPLAY_NAMES)) {
                if (matcher.test(code) || matcher.test(displayName)) {
                    selectedDisplayNames.add(displayName);
                }
            }
            return;
        }

        selectedDisplayNames.add(normalizeMotiveValue(value));
    };

    const uiMotiveState = uiOnlyFilterState?.['as._motive'];
    if (uiMotiveState?.interactedWith && Array.isArray(uiMotiveState.value)) {
        for (const value of uiMotiveState.value) {
            if (typeof value === 'string' && value) {
                addValue(value);
            }
        }
    }

    for (const token of parsedQuery.tokens) {
        if (token.field !== 'motive' || token.operator === '!=' || !isCommittedSemanticToken(token)) {
            continue;
        }

        for (const value of token.values) {
            addValue(value);
        }
    }

    if (selectedDisplayNames.size === 0) {
        return null;
    }

    const selectedCodes = new Set<string>();
    for (const [code, displayName] of Object.entries(AS_MOVEMENT_MODE_DISPLAY_NAMES)) {
        if (selectedDisplayNames.has(displayName)) {
            selectedCodes.add(code);
        }
    }

    return selectedCodes.size > 0 ? selectedCodes : null;
}

export function executeUnitSearch<TUnit extends UnitSearchRecord>(
    request: UnitSearchExecutionRequest<TUnit>,
): UnitSearchExecutionResult<TUnit> {
    const telemetryStages: SearchTelemetryStage[] = [];
    const searchStartedAt = getNowMs();
    const allUnits = request.units;
    const unitCount = allUnits.length;
    const parsedQuery = request.parsedQuery;
    const isComplex = isComplexQuery(parsedQuery.ast);
    const hasTextSearch = parsedQuery.textSearch.trim().length > 0;
    const uiOnlyFilterState = request.uiOnlyFilterState ?? {};
    const selectedMotiveCodes = getSelectedASMotiveCodes(parsedQuery, uiOnlyFilterState);
    const normalization = request.normalization ?? null;
    const searchMatchersByText = new Map<string, (textToSearch: string, alphanumericText?: string) => boolean>([
        [parsedQuery.textSearch, createSearchMatcher(request.searchTokens, true, true)],
    ]);
    const getSearchMatcher = (text: string): ((textToSearch: string, alphanumericText?: string) => boolean) => {
        const cached = searchMatchersByText.get(text);
        if (cached) {
            return cached;
        }

        const matcher = createSearchMatcher(parseSearchQuery(text), true, true);
        searchMatchersByText.set(text, matcher);
        return matcher;
    };
    const normalizationEnabled = normalization !== null
        && ((normalization.kind === 'bv' && request.gameSystem === GameSystem.CBT)
            || (normalization.kind === 'pv' && request.gameSystem === GameSystem.AS));
    const normalizationMatchCache = new Map<string, UnitSearchNormalizationMatch | null>();
    const resolveNormalizationMatch = (unit: TUnit): UnitSearchNormalizationMatch | null => {
        if (!normalizationEnabled) {
            return null;
        }
        if (!normalizationMatchCache.has(unit.uuid)) {
            normalizationMatchCache.set(unit.uuid, normalization?.kind === 'bv'
                ? findBvNormalizationMatch(unit, normalization.settings)
                : normalization?.kind === 'pv'
                    ? findPvNormalizationMatch(unit, normalization.settings)
                    : null);
        }
        return normalizationMatchCache.get(unit.uuid) ?? null;
    };
    const getContextualAdjustedBV = (unit: TUnit): number => {
        return resolveNormalizationMatch(unit)?.adjustedValue ?? request.getAdjustedBV(unit);
    };
    const getContextualAdjustedPV = (unit: TUnit): number => {
        return resolveNormalizationMatch(unit)?.adjustedValue ?? request.getAdjustedPV(unit);
    };

    const context: EvaluatorContext<TUnit> = {
        getProperty,
        getUnitId: unit => unit.uuid,
        getAdjustedBV: getContextualAdjustedBV,
        getAdjustedPV: getContextualAdjustedPV,
        gameSystem: request.gameSystem,
        matchesText: (unit: TUnit, text: string) => {
            const searchableText = unit._searchKey
                || removeAccents(`${unit.chassis ?? ''} ${unit.model ?? ''}`.toLowerCase());
            return getSearchMatcher(text)(searchableText, unit._searchKeyAlphanumeric);
        },
        getCountableValues: (unit: TUnit, filterKey: string) => {
            switch (filterKey) {
                case 'componentName':
                case 'weaponType':
                    return getUnitCountableFilterData(unit, filterKey)?.counts ?? null;
                default:
                    return null;
            }
        },
        unitBelongsToEra: request.unitBelongsToEra,
        unitBelongsToFaction: request.unitBelongsToFaction,
        unitMatchesAvailabilityFrom: request.unitMatchesAvailabilityFrom,
        unitMatchesAvailabilityRarity: request.unitMatchesAvailabilityRarity,
        unitBelongsToForcePack: request.unitBelongsToForcePack,
        unitMatchesFormationTarget: request.unitMatchesFormationTarget,
        getAllEraNames: request.getAllEraNames,
        getAllFactionNames: request.getAllFactionNames,
        getAllAvailabilityFromNames: request.getAllAvailabilityFromNames,
        getAllAvailabilityRarityNames: request.getAllAvailabilityRarityNames,
        getAllFormationNames: request.getAllFormationNames,
        getAllForcePackNames: () => getForcePacks().map(pack => pack.name),
        getASMovementValues: (unit: TUnit) => {
            const mvm = unit.as?.MVm;
            if (!mvm) return [];
            if (selectedMotiveCodes === null) {
                return Object.values(mvm);
            }

            const values: number[] = [];
            for (const [code, value] of Object.entries(mvm)) {
                if (selectedMotiveCodes.has(code)) {
                    values.push(value);
                }
            }
            return values;
        },
        getDisplayName: request.getDisplayName,
        getIndexedUnitIds: request.getIndexedUnitIds,
        getIndexedFilterValues: request.getIndexedFilterValues,
        getIndexedASSpecials: request.getIndexedASSpecials,
    };

    let candidateUnits = allUnits;
    if (normalizationEnabled) {
        candidateUnits = measureStage(
            telemetryStages,
            request.gameSystem === GameSystem.CBT ? 'bv-normalization' : 'pv-normalization',
            unitCount,
            () => allUnits.filter(unit => resolveNormalizationMatch(unit) !== null),
            value => value.length,
        );
    }

    let results = measureStage(
        telemetryStages,
        'ast-filter',
        candidateUnits.length,
        () => filterUnitsWithAST(candidateUnits, parsedQuery.ast, context, request.initialAvailabilityScope),
        value => value.length,
    );

    if (Object.keys(uiOnlyFilterState).length > 0) {
        results = measureStage(
            telemetryStages,
            'ui-only-filters',
            results.length,
            () => request.uiOnlyFilterDependencies
                ? applyFilterStateToUnits({
                    units: results,
                    state: uiOnlyFilterState,
                    dependencies: {
                        ...request.uiOnlyFilterDependencies,
                        getAdjustedBV: getContextualAdjustedBV,
                        getAdjustedPV: getContextualAdjustedPV,
                    },
                })
                : results,
            value => value.length,
        );
    }

    if (request.bvPvLimit > 0) {
        const remaining = request.bvPvLimit - request.forceTotalBvPv;
        const isAS = request.gameSystem === GameSystem.AS;
        results = measureStage(
            telemetryStages,
            'budget-filter',
            results.length,
            () => results.filter(unit => {
                const unitValue = isAS ? getContextualAdjustedPV(unit) : getContextualAdjustedBV(unit);
                return unitValue <= remaining;
            }),
            value => value.length,
        );
    }

    const sorted = [...results];
    const compiledSearchTokens = compileRelevanceSearchGroups(request.searchTokens);
    let relevanceScores: WeakMap<TUnit, number> | null = null;
    let megaMekRarityScores: WeakMap<TUnit, number> | null = null;
    if (request.sortKey === '' && hasTextSearch) {
        relevanceScores = measureStage(
            telemetryStages,
            'relevance-prep',
            sorted.length,
            () => {
                const scores = new WeakMap<TUnit, number>();

                for (const unit of sorted) {
                    const chassis = (unit.chassis ?? '').toLowerCase();
                    const model = (unit.model ?? '').toLowerCase();

                    if (isComplex) {
                        const matchingTexts = getMatchingTextForUnit(
                            parsedQuery.ast,
                            unit,
                            context,
                            request.initialAvailabilityScope,
                        );
                        if (matchingTexts.length > 0) {
                            let bestScore = 0;
                            for (const text of matchingTexts) {
                                const textTokens = compileRelevanceSearchGroups(parseSearchQuery(text));
                                const score = computeRelevanceScore(chassis, model, textTokens);
                                if (score > bestScore) {
                                    bestScore = score;
                                }
                            }
                            const combinedTokens = compileRelevanceSearchGroups(
                                parseSearchQuery(matchingTexts.join(' ')),
                            );
                            const combinedScore = computeRelevanceScore(chassis, model, combinedTokens);
                            scores.set(unit, Math.max(bestScore, combinedScore));
                        } else {
                            scores.set(unit, 0);
                        }
                    } else {
                        scores.set(unit, computeRelevanceScore(chassis, model, compiledSearchTokens));
                    }
                }

                return scores;
            }
        );
    }

    if (isMegaMekRaritySortKey(request.sortKey) && request.getMegaMekRaritySortScore) {
        megaMekRarityScores = new WeakMap<TUnit, number>();
        for (const unit of sorted) {
            megaMekRarityScores.set(unit, request.getMegaMekRaritySortScore(unit, request.availabilitySortScope));
        }
    }

    measureStage(
        telemetryStages,
        'sort',
        sorted.length,
        () => {
            sorted.sort((a, b) => {
                let comparison = 0;

                if (request.sortKey === '') {
                    const aScore = relevanceScores?.get(a) ?? 0;
                    const bScore = relevanceScores?.get(b) ?? 0;
                    comparison = bScore - aScore;
                    if (comparison === 0) {
                        comparison = compareUnitsByName(a, b);
                    }
                } else if (request.sortKey === 'name') {
                    comparison = compareUnitsByName(a, b);
                } else if (request.sortKey === 'bv') {
                    comparison = getContextualAdjustedBV(a) - getContextualAdjustedBV(b);
                } else if (request.sortKey === 'as.PV') {
                    comparison = getContextualAdjustedPV(a) - getContextualAdjustedPV(b);
                } else if (isMegaMekRaritySortKey(request.sortKey)) {
                    comparison = (megaMekRarityScores?.get(a) ?? 0) - (megaMekRarityScores?.get(b) ?? 0);
                    if (comparison === 0) {
                        comparison = compareUnitsByName(a, b);
                    }
                } else {
                    const aValue = getProperty(a, request.sortKey);
                    const bValue = getProperty(b, request.sortKey);
                    if (typeof aValue === 'string' && typeof bValue === 'string') {
                        comparison = naturalCompare(aValue, bValue);
                    } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                        comparison = aValue - bValue;
                    }
                }

                if (comparison === 0 && request.sortKey !== 'name') {
                    comparison = compareUnitsByName(a, b);
                }

                if (request.sortDirection === 'desc') {
                    return -comparison;
                }
                return comparison;
            });

            return sorted;
        },
        value => value.length,
    );

    const normalizationMatchesByUnitUuid = new Map<UnitUuid, UnitSearchNormalizationMatch>();
    if (normalizationEnabled) {
        for (const unit of sorted) {
            const match = resolveNormalizationMatch(unit);
            if (match) {
                normalizationMatchesByUnitUuid.set(unit.uuid, match);
            }
        }
    }

    return {
        results: sorted,
        normalizationMatchesByUnitUuid,
        telemetryStages,
        totalMs: getNowMs() - searchStartedAt,
        unitCount,
        isComplex,
    };
}
