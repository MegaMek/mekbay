// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MultiStateOption, MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import type { UnitSummary } from '../models/unit-summary.model';
import type { UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import {
    ADVANCED_FILTERS,
    AS_MOVEMENT_MODE_DISPLAY_NAMES,
    type AvailabilityFilterScope,
    type AdvFilterConfig,
    AdvFilterType,
    type FilterState,
    getBooleanFilterUnitValue,
    normalizeTriStateBooleanFilterValue,
} from '../services/unit-search-filters.model';
import type { WildcardPattern } from './semantic-filter.util';
import { wildcardToRegex } from './string.util';
import {
    checkQuantityConstraint,
    getSelectedPositiveDropdownNames,
    getUnitCountableFilterData,
    normalizeMultiStateSelection,
    unitMatchesRulesRefsSelection,
} from './unit-search-shared.util';
import { getUnitVariantGroupKey } from './unit-variant.util';
import { isCountableBackedDropdown } from './unit-search-filter-config.util';
import {
    buildIndexedASSpecialSelectionCandidates,
    compileASSpecialSelections,
    unitMatchesASSpecialSelections,
    type ParsedASSpecials,
} from './as-special-filter.util';

export interface UnitFilterKernelDependencies {
    getProperty: (unit: UnitSummary, key?: string) => unknown;
    getAdjustedBV: (unit: UnitSummary) => number;
    getAdjustedPV: (unit: UnitSummary) => number;
    getUnitIdsForExternalFilters: (
        eraFilterState?: FilterState[string],
        factionFilterState?: FilterState[string],
    ) => Set<string> | null;
    getPositiveFactionNames: (
        selectedFactionEntries: MultiStateSelection,
        wildcardPatterns?: WildcardPattern[],
    ) => string[];
    unitMatchesAvailabilityFrom: (unit: UnitSummary, availabilityFromName: string, scope?: AvailabilityFilterScope) => boolean;
    unitMatchesAvailabilityRarity: (unit: UnitSummary, rarityName: string, scope?: AvailabilityFilterScope) => boolean;
    getForcePackLookupSet: (packName: string) => ReadonlySet<string> | undefined;
    getAvailabilityLookupKey: (unit: UnitSummary) => string;
    getIndexedUnitIds?: (filterKey: string, value: string) => ReadonlySet<UnitUuid> | undefined;
    getIndexedASSpecials?: (unitUuid: UnitUuid) => ParsedASSpecials | undefined;
}

interface ApplyUnitFilterStateRequest {
    units: UnitSummary[];
    state: FilterState;
    dependencies: UnitFilterKernelDependencies;
    skipKey?: string;
}

const ADVANCED_FILTER_CONFIG_BY_KEY = new Map(ADVANCED_FILTERS.map(conf => [conf.key, conf]));

function filterUnitsByMultiState(
    units: UnitSummary[],
    key: string,
    selection: MultiStateSelection,
    getProperty: UnitFilterKernelDependencies['getProperty'],
    wildcardPatterns?: WildcardPattern[],
): UnitSummary[] {
    const orList: MultiStateOption[] = [];
    const andList: MultiStateOption[] = [];
    const notList: MultiStateOption[] = [];

    for (const selectionValue of Object.values(selection)) {
        if (selectionValue.state === 'or') orList.push(selectionValue);
        else if (selectionValue.state === 'and') andList.push(selectionValue);
        else if (selectionValue.state === 'not') notList.push(selectionValue);
    }

    const hasWildcards = wildcardPatterns && wildcardPatterns.length > 0;
    if (orList.length === 0 && andList.length === 0 && notList.length === 0 && !hasWildcards) {
        return units;
    }

    const hasQuantityConstraint = (item: MultiStateOption) =>
        item.count > 1 || item.countOperator || item.countMax !== undefined ||
        item.countIncludeRanges || item.countExcludeRanges;
    const needsQuantityCounting = orList.some(hasQuantityConstraint) ||
        andList.some(hasQuantityConstraint) || notList.some(hasQuantityConstraint);
    const isCountableFilter = isCountableBackedDropdown(ADVANCED_FILTER_CONFIG_BY_KEY.get(key));
    const compiledOrPatterns = wildcardPatterns?.filter(p => p.state === 'or').map(pattern => ({ pattern, regex: wildcardToRegex(pattern.pattern) })) ?? [];
    const compiledAndPatterns = wildcardPatterns?.filter(p => p.state === 'and').map(pattern => ({ pattern, regex: wildcardToRegex(pattern.pattern) })) ?? [];
    const compiledNotPatterns = wildcardPatterns?.filter(p => p.state === 'not').map(pattern => ({ pattern, regex: wildcardToRegex(pattern.pattern) })) ?? [];

    return units.filter(unit => {
        let unitData: { names: Set<string>; counts?: Map<string, number> };

        if (isCountableFilter) {
            const cached = getUnitCountableFilterData(unit, key);
            unitData = {
                names: cached?.names ?? new Set<string>(),
                counts: needsQuantityCounting ? cached?.counts : undefined,
            };
        } else {
            const propValue = getProperty(unit, key);
            const unitValues = Array.isArray(propValue) ? propValue : [propValue];
            const names = new Set(unitValues.filter(v => v != null).map(v => String(v).toLowerCase()));

            unitData = { names };
            if (needsQuantityCounting) {
                const counts = new Map<string, number>();
                for (const value of unitValues) {
                    if (value != null) {
                        const lowerValue = String(value).toLowerCase();
                        counts.set(lowerValue, (counts.get(lowerValue) || 0) + 1);
                    }
                }
                unitData.counts = counts;
            }
        }

        if (hasWildcards) {
            for (const { regex } of compiledNotPatterns) {
                for (const name of unitData.names) {
                    if (regex.test(name)) return false;
                }
            }

            for (const { regex } of compiledAndPatterns) {
                let hasMatch = false;
                for (const name of unitData.names) {
                    if (regex.test(name)) {
                        hasMatch = true;
                        break;
                    }
                }
                if (!hasMatch) return false;
            }

            if (compiledOrPatterns.length > 0 && orList.length === 0) {
                let hasMatch = false;
                for (const { regex } of compiledOrPatterns) {
                    for (const name of unitData.names) {
                        if (regex.test(name)) {
                            hasMatch = true;
                            break;
                        }
                    }
                    if (hasMatch) break;
                }
                if (!hasMatch) return false;
            }
        }

        if (notList.length > 0) {
            for (const item of notList) {
                const lowerName = item.name.toLowerCase();
                if (!unitData.names.has(lowerName)) continue;

                if (needsQuantityCounting && unitData.counts) {
                    const unitCount = unitData.counts.get(lowerName) || 0;
                    if (checkQuantityConstraint(unitCount, item.count, item.countOperator, item.countMax, item.countIncludeRanges, item.countExcludeRanges)) {
                        return false;
                    }
                } else {
                    return false;
                }
            }
        }

        if (andList.length > 0) {
            for (const item of andList) {
                const lowerName = item.name.toLowerCase();
                if (!unitData.names.has(lowerName)) return false;

                if (needsQuantityCounting && unitData.counts) {
                    const unitCount = unitData.counts.get(lowerName) || 0;
                    if (!checkQuantityConstraint(unitCount, item.count, item.countOperator, item.countMax, item.countIncludeRanges, item.countExcludeRanges)) {
                        return false;
                    }
                }
            }
        }

        if (orList.length > 0) {
            let hasMatch = false;
            for (const item of orList) {
                const lowerName = item.name.toLowerCase();
                if (!unitData.names.has(lowerName)) continue;

                if (needsQuantityCounting && unitData.counts) {
                    const unitCount = unitData.counts.get(lowerName) || 0;
                    if (checkQuantityConstraint(unitCount, item.count, item.countOperator, item.countMax, item.countIncludeRanges, item.countExcludeRanges)) {
                        hasMatch = true;
                        break;
                    }
                } else {
                    hasMatch = true;
                    break;
                }
            }
            if (!hasMatch) return false;
        }

        return true;
    });
}

export function applyFilterStateToUnits(request: ApplyUnitFilterStateRequest): UnitSummary[] {
    const { units, state, dependencies, skipKey } = request;
    let results = units;
    const activeFilters: Record<string, unknown> = {};
    const activeStandardFilters: Array<{ conf: AdvFilterConfig; filterState: FilterState[string] }> = [];

    for (const [key, filterState] of Object.entries(state)) {
        if (key === skipKey || !filterState.interactedWith) {
            continue;
        }

        activeFilters[key] = filterState.value;
        const conf = ADVANCED_FILTER_CONFIG_BY_KEY.get(key);
        if (conf && !conf.external) {
            activeStandardFilters.push({ conf, filterState });
        }
    }

    const selectedEraNames = getSelectedPositiveDropdownNames(activeFilters['era']);
    const selectedFactionEntries = normalizeMultiStateSelection(activeFilters['faction']);
    const selectedAvailabilityFromNames = getSelectedPositiveDropdownNames(activeFilters['availabilityFrom']);
    const selectedAvailabilityRarityNames = getSelectedPositiveDropdownNames(activeFilters['availabilityRarity']);

    let externalUnitIds: Set<string> | null = null;
    const eraFilterState = skipKey === 'era' ? undefined : state['era'];
    const factionFilterState = skipKey === 'faction' ? undefined : state['faction'];
    const factionWildcardPatterns = factionFilterState?.wildcardPatterns;
    const positiveFactionNames = Object.values(selectedFactionEntries).some(selection => selection.state)
        || (factionWildcardPatterns && factionWildcardPatterns.length > 0)
        ? dependencies.getPositiveFactionNames(selectedFactionEntries, factionWildcardPatterns)
        : [];
    externalUnitIds = dependencies.getUnitIdsForExternalFilters(eraFilterState, factionFilterState);

    if (externalUnitIds) {
        results = results.filter(unit => externalUnitIds.has(dependencies.getAvailabilityLookupKey(unit)));
    }

    const selectedForcePackNames = activeFilters['forcePack'] as string[] || [];
    if (selectedForcePackNames.length > 0) {
        const lookupKeySet = new Set<string>();
        for (const packName of selectedForcePackNames) {
            const packSet = dependencies.getForcePackLookupSet(packName);
            if (packSet) {
                for (const key of packSet) lookupKeySet.add(key);
            }
        }
        results = results.filter(unit => lookupKeySet.has(getUnitVariantGroupKey(unit)));
    }

    const availabilityScope: AvailabilityFilterScope = {
        ...(selectedEraNames.length > 0 ? { eraNames: selectedEraNames } : {}),
        ...(positiveFactionNames.length > 0 ? { factionNames: positiveFactionNames } : {}),
        ...(selectedAvailabilityFromNames.length > 0 ? { availabilityFromNames: selectedAvailabilityFromNames } : {}),
    };

    if (selectedAvailabilityFromNames.length > 0) {
        results = results.filter(unit => (
            selectedAvailabilityFromNames.some(availabilityFromName => (
                dependencies.unitMatchesAvailabilityFrom(unit, availabilityFromName, availabilityScope)
            ))
        ));
    }

    if (selectedAvailabilityRarityNames.length > 0) {
        results = results.filter(unit => (
            selectedAvailabilityRarityNames.some(rarityName => (
                dependencies.unitMatchesAvailabilityRarity(unit, rarityName, availabilityScope)
            ))
        ));
    }

    for (const { conf, filterState } of activeStandardFilters) {
        const val = filterState.value;
        const wildcardPatterns = filterState.wildcardPatterns;

        if (conf.type === AdvFilterType.BOOLEAN) {
            const booleanFilterValue = normalizeTriStateBooleanFilterValue(val);
            if (booleanFilterValue !== null) {
                const expectedValue = booleanFilterValue === 'or';
                results = results.filter(unit => (
                    getBooleanFilterUnitValue(conf, dependencies.getProperty(unit, conf.key)) === expectedValue
                ));
            }
            continue;
        }

        if (conf.type === AdvFilterType.DROPDOWN && conf.key === 'rulesRefs') {
            const selectedRulesRefs = Array.isArray(val)
                ? val.filter((value): value is string => typeof value === 'string')
                : [];
            if (selectedRulesRefs.length > 0) {
                results = results.filter(unit => unitMatchesRulesRefsSelection(
                    dependencies.getProperty(unit, conf.key),
                    selectedRulesRefs,
                ));
            }
            continue;
        }

        if (conf.type === AdvFilterType.DROPDOWN && conf.multistate) {
            const selection = normalizeMultiStateSelection(val);
            if (conf.key === 'as.specials') {
                const specialSelections = [
                    ...Object.values(selection),
                    ...(wildcardPatterns ?? []).map(pattern => ({
                        name: pattern.pattern,
                        state: pattern.state,
                    })),
                ];
                const indexedCandidates = dependencies.getIndexedUnitIds
                    ? buildIndexedASSpecialSelectionCandidates(
                        specialSelections,
                        token => dependencies.getIndexedUnitIds?.('as.specials', token),
                    )
                    : null;
                if (indexedCandidates) {
                    results = results.filter(unit => indexedCandidates.has(unit.uuid));
                }
                const compiledSelections = compileASSpecialSelections(specialSelections);
                results = results.filter(unit => unitMatchesASSpecialSelections(
                    dependencies.getProperty(unit, conf.key),
                    compiledSelections,
                    dependencies.getIndexedASSpecials?.(unit.uuid),
                ));
                continue;
            }

            results = filterUnitsByMultiState(
                results,
                conf.key,
                selection,
                dependencies.getProperty,
                wildcardPatterns,
            );
            continue;
        }

        if (conf.type === AdvFilterType.SEMANTIC) {
            const searchTerms: string[] = Array.isArray(val)
                ? val.filter((value): value is string => typeof value === 'string')
                : val !== null && typeof val === 'object'
                    ? Object.keys(val)
                    : [String(val)];
            const hasSearchTerms = searchTerms.length > 0;
            const hasWildcards = wildcardPatterns && wildcardPatterns.length > 0;
            const includePatterns = wildcardPatterns?.filter(p => p.state === 'or') || [];
            const excludePatterns = wildcardPatterns?.filter(p => p.state === 'not') || [];
            const andPatterns = wildcardPatterns?.filter(p => p.state === 'and') || [];
            const includeMatchers = includePatterns.map(pattern => wildcardToRegex(pattern.pattern));
            const excludeMatchers = excludePatterns.map(pattern => wildcardToRegex(pattern.pattern));
            const andMatchers = andPatterns.map(pattern => wildcardToRegex(pattern.pattern));

            if (hasSearchTerms || hasWildcards) {
                const searchTermsLower = searchTerms.map(term => term.toLowerCase());
                results = results.filter(unit => {
                    const unitValue = dependencies.getProperty(unit, conf.key);
                    if (unitValue == null) return false;
                    const unitStr = String(unitValue).toLowerCase();

                    for (const regex of excludeMatchers) {
                        if (regex.test(unitStr)) return false;
                    }

                    for (const regex of andMatchers) {
                        if (!regex.test(unitStr)) return false;
                    }

                    if (!hasSearchTerms && includePatterns.length === 0) {
                        return true;
                    }

                    for (const term of searchTermsLower) {
                        if (unitStr === term) return true;
                    }

                    for (const regex of includeMatchers) {
                        if (regex.test(unitStr)) return true;
                    }

                    return false;
                });
            }
            continue;
        }

        if (conf.type === AdvFilterType.DROPDOWN && (Array.isArray(val) || wildcardPatterns?.length)) {
            const hasRegularValues = Array.isArray(val) && val.length > 0;
            const hasWildcards = wildcardPatterns && wildcardPatterns.length > 0;

            if (hasRegularValues || hasWildcards) {
                const valLowerSet = hasRegularValues
                    ? new Set((val as string[]).map(value => String(value).toLowerCase()))
                    : null;
                const orPatterns = wildcardPatterns?.filter(p => p.state === 'or') || [];
                const andPatterns = wildcardPatterns?.filter(p => p.state === 'and') || [];
                const notPatterns = wildcardPatterns?.filter(p => p.state === 'not') || [];
                const orMatchers = orPatterns.map(pattern => wildcardToRegex(pattern.pattern));
                const andMatchers = andPatterns.map(pattern => wildcardToRegex(pattern.pattern));
                const notMatchers = notPatterns.map(pattern => wildcardToRegex(pattern.pattern));

                results = results.filter(unit => {
                    const propertyValue = dependencies.getProperty(unit, conf.key);
                    const unitValues = Array.isArray(propertyValue) ? propertyValue : [propertyValue];
                    const unitStrings = unitValues.filter(value => value != null).map(value => String(value).toLowerCase());

                    for (const regex of notMatchers) {
                        for (const unitValue of unitStrings) {
                            if (regex.test(unitValue)) return false;
                        }
                    }

                    for (const regex of andMatchers) {
                        let hasMatch = false;
                        for (const unitValue of unitStrings) {
                            if (regex.test(unitValue)) {
                                hasMatch = true;
                                break;
                            }
                        }
                        if (!hasMatch) return false;
                    }

                    if (!valLowerSet && orPatterns.length === 0) {
                        return true;
                    }

                    if (valLowerSet) {
                        for (const unitValue of unitStrings) {
                            if (valLowerSet.has(unitValue)) return true;
                        }
                    }

                    for (const regex of orMatchers) {
                        for (const unitValue of unitStrings) {
                            if (regex.test(unitValue)) return true;
                        }
                    }

                    return false;
                });
            }
            continue;
        }

        if (conf.type === AdvFilterType.RANGE && Array.isArray(val)) {
            const excludeRanges = filterState.excludeRanges;
            const includeRanges = filterState.includeRanges;

            const isExcluded = (value: number): boolean => {
                if (!excludeRanges) return false;
                return excludeRanges.some(([min, max]) => value >= min && value <= max);
            };

            const isIncluded = (value: number): boolean => {
                if (!includeRanges) {
                    return value >= val[0] && value <= val[1];
                }
                return includeRanges.some(([min, max]) => value >= min && value <= max);
            };

            if (conf.key === 'bv') {
                results = results.filter(unit => {
                    const adjustedBV = dependencies.getAdjustedBV(unit);
                    if (isExcluded(adjustedBV)) return false;
                    return isIncluded(adjustedBV);
                });
            } else if (conf.key === 'as.PV') {
                results = results.filter(unit => {
                    const adjustedPV = dependencies.getAdjustedPV(unit);
                    if (isExcluded(adjustedPV)) return false;
                    return isIncluded(adjustedPV);
                });
            } else if (conf.key === 'as._mv') {
                const motiveFilterState = skipKey === 'as._motive' ? undefined : state['as._motive'];
                let selectedMotiveCodes: Set<string> | null = null;
                if (motiveFilterState?.interactedWith) {
                    const selectedDisplayNames = new Set(motiveFilterState.value as string[]);
                    selectedMotiveCodes = new Set(
                        Object.entries(AS_MOVEMENT_MODE_DISPLAY_NAMES)
                            .filter(([, displayName]) => selectedDisplayNames.has(displayName))
                            .map(([code]) => code),
                    );
                }

                results = results.filter(unit => {
                    const movementValues = unit.as?.MVm;
                    if (!movementValues) return false;

                    const valuesToCheck: number[] = selectedMotiveCodes === null
                        ? Object.values(movementValues)
                        : Object.entries(movementValues)
                            .filter(([code]) => selectedMotiveCodes!.has(code))
                            .map(([, value]) => value);

                    if (valuesToCheck.length === 0) return false;
                    return valuesToCheck.some(value => !isExcluded(value) && isIncluded(value));
                });
            } else {
                results = results.filter(unit => {
                    const unitValue = dependencies.getProperty(unit, conf.key) as number;
                    if (conf.ignoreValues && conf.ignoreValues.includes(unitValue)) {
                        return val[0] === 0;
                    }
                    if (isExcluded(unitValue)) return false;
                    return unitValue != null && isIncluded(unitValue);
                });
            }
        }
    }

    return results;
}
