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

import type { Unit } from '../models/units.model';
import { GameSystem } from '../models/common.model';
import { getForcePacks } from '../models/forcepacks.model';
import { ADVANCED_FILTERS, AS_MOVEMENT_MODE_DISPLAY_NAMES, AdvFilterType, isMegaMekRaritySortKey, normalizeMotiveValue, type FilterState, type SearchTelemetryStage } from '../services/unit-search-filters.model';
import {
    filterUnitsWithAST,
    getMatchingTextForUnit,
    isComplexQuery,
    type EvaluatorContext,
    type ParseResult,
} from './semantic-filter-ast.util';
import { matchesSearch, parseSearchQuery, type SearchTokensGroup } from './search.util';
import { compareUnitsByName, computeRelevanceScore, naturalCompare } from './sort.util';
import { wildcardToRegex } from './string.util';
import { getNowMs, getProperty, getUnitComponentData, isCommittedSemanticToken, measureStage } from './unit-search-shared.util';
import { applyFilterStateToUnits, type UnitFilterKernelDependencies } from './unit-filter-kernel.util';
import type { AvailabilityFilterScope } from '../services/unit-search-filters.model';

interface UnitSearchExecutionRequest {
    units: Unit[];
    parsedQuery: ParseResult;
    searchTokens: SearchTokensGroup[];
    uiOnlyFilterState?: FilterState;
    uiOnlyFilterDependencies?: UnitFilterKernelDependencies;
    gameSystem: GameSystem;
    sortKey: string;
    sortDirection: 'asc' | 'desc';
    bvPvLimit: number;
    forceTotalBvPv: number;
    getAdjustedBV: (unit: Unit) => number;
    getAdjustedPV: (unit: Unit) => number;
    unitBelongsToEra: (unit: Unit, eraName: string, scope?: AvailabilityFilterScope) => boolean;
    unitBelongsToFaction: (unit: Unit, factionName: string, eraNames?: readonly string[]) => boolean;
    unitMatchesAvailabilityFrom?: (unit: Unit, availabilityFromName: string, scope?: AvailabilityFilterScope) => boolean;
    unitMatchesAvailabilityRarity?: (unit: Unit, rarityName: string, scope?: AvailabilityFilterScope) => boolean;
    unitBelongsToForcePack: (unit: Unit, packName: string) => boolean;
    getAllEraNames: () => string[];
    getAllFactionNames: () => string[];
    getAllAvailabilityFromNames?: () => string[];
    getAllAvailabilityRarityNames?: () => string[];
    getDisplayName?: (filterKey: string, value: string) => string | undefined;
    getIndexedUnitIds?: (filterKey: string, value: string, scope?: AvailabilityFilterScope) => ReadonlySet<string> | undefined;
    getIndexedFilterValues?: (filterKey: string) => readonly string[];
    availabilitySortScope?: AvailabilityFilterScope;
    getMegaMekRaritySortScore?: (unit: Unit, scope?: AvailabilityFilterScope) => number;
}

interface UnitSearchExecutionResult {
    results: Unit[];
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

export function executeUnitSearch(request: UnitSearchExecutionRequest): UnitSearchExecutionResult {
    const telemetryStages: SearchTelemetryStage[] = [];
    const searchStartedAt = getNowMs();
    const allUnits = request.units;
    const unitCount = allUnits.length;
    const parsedQuery = request.parsedQuery;
    const isComplex = isComplexQuery(parsedQuery.ast);
    const hasTextSearch = parsedQuery.textSearch.trim().length > 0;
    const uiOnlyFilterState = request.uiOnlyFilterState ?? {};
    const selectedMotiveCodes = getSelectedASMotiveCodes(parsedQuery, uiOnlyFilterState);

    const context: EvaluatorContext = {
        getProperty,
        getUnitId: (unit: Unit) => unit.name,
        getAdjustedBV: request.getAdjustedBV,
        getAdjustedPV: request.getAdjustedPV,
        gameSystem: request.gameSystem,
        matchesText: (unit: Unit, text: string) => {
            const searchableText = unit._searchKey || `${unit.chassis ?? ''} ${unit.model ?? ''}`.toLowerCase();
            const tokens = parseSearchQuery(text);
            return matchesSearch(searchableText, tokens, true);
        },
        getCountableValues: (unit: Unit, filterKey: string) => {
            switch (filterKey) {
                case 'componentName':
                    return getUnitComponentData(unit).counts;
                default:
                    return null;
            }
        },
        unitBelongsToEra: request.unitBelongsToEra,
        unitBelongsToFaction: request.unitBelongsToFaction,
        unitMatchesAvailabilityFrom: request.unitMatchesAvailabilityFrom,
        unitMatchesAvailabilityRarity: request.unitMatchesAvailabilityRarity,
        unitBelongsToForcePack: request.unitBelongsToForcePack,
        getAllEraNames: request.getAllEraNames,
        getAllFactionNames: request.getAllFactionNames,
        getAllAvailabilityFromNames: request.getAllAvailabilityFromNames,
        getAllAvailabilityRarityNames: request.getAllAvailabilityRarityNames,
        getAllForcePackNames: () => getForcePacks().map(pack => pack.name),
        getASMovementValues: (unit: Unit) => {
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
    };

    let results = measureStage(
        telemetryStages,
        'ast-filter',
        unitCount,
        () => filterUnitsWithAST(allUnits, parsedQuery.ast, context),
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
                    dependencies: request.uiOnlyFilterDependencies,
                })
                : results,
            value => value.length,
        );
    }

    if (request.bvPvLimit > 0) {
        const remaining = request.bvPvLimit - request.forceTotalBvPv;
        const isAS = request.gameSystem === GameSystem.ALPHA_STRIKE;
        results = measureStage(
            telemetryStages,
            'budget-filter',
            results.length,
            () => results.filter(unit => {
                const unitValue = isAS ? request.getAdjustedPV(unit) : request.getAdjustedBV(unit);
                return unitValue <= remaining;
            }),
            value => value.length,
        );
    }

    const sorted = [...results];
    let relevanceScores: WeakMap<Unit, number> | null = null;
    let megaMekRarityScores: WeakMap<Unit, number> | null = null;
    if (request.sortKey === '' && hasTextSearch) {
        relevanceScores = measureStage(
            telemetryStages,
            'relevance-prep',
            sorted.length,
            () => {
                const scores = new WeakMap<Unit, number>();

                for (const unit of sorted) {
                    const chassis = (unit.chassis ?? '').toLowerCase();
                    const model = (unit.model ?? '').toLowerCase();

                    if (isComplex) {
                        const matchingTexts = getMatchingTextForUnit(parsedQuery.ast, unit, context);
                        if (matchingTexts.length > 0) {
                            let bestScore = 0;
                            for (const text of matchingTexts) {
                                const textTokens = parseSearchQuery(text);
                                const score = computeRelevanceScore(chassis, model, textTokens);
                                if (score > bestScore) {
                                    bestScore = score;
                                }
                            }
                            const combinedTokens = parseSearchQuery(matchingTexts.join(' '));
                            const combinedScore = computeRelevanceScore(chassis, model, combinedTokens);
                            scores.set(unit, Math.max(bestScore, combinedScore));
                        } else {
                            scores.set(unit, 0);
                        }
                    } else {
                        scores.set(unit, computeRelevanceScore(chassis, model, request.searchTokens));
                    }
                }

                return scores;
            }
        );
    }

    if (isMegaMekRaritySortKey(request.sortKey) && request.getMegaMekRaritySortScore) {
        megaMekRarityScores = new WeakMap<Unit, number>();
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
                    comparison = request.getAdjustedBV(a) - request.getAdjustedBV(b);
                } else if (request.sortKey === 'as.PV') {
                    comparison = request.getAdjustedPV(a) - request.getAdjustedPV(b);
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

                if (request.sortDirection === 'desc') {
                    return -comparison;
                }
                return comparison;
            });

            return sorted;
        },
        value => value.length,
    );

    return {
        results: sorted,
        telemetryStages,
        totalMs: getNowMs() - searchStartedAt,
        unitCount,
        isComplex,
    };
}