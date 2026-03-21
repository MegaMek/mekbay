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

import type { MultiStateOption, MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import type { Unit } from '../models/units.model';
import { ADVANCED_FILTERS, AS_MOVEMENT_MODE_DISPLAY_NAMES, type AdvFilterConfig, AdvFilterType, type FilterState } from '../services/unit-search-filters.model';
import type { WildcardPattern } from './semantic-filter.util';
import { wildcardToRegex } from './string.util';
import { checkQuantityConstraint, getUnitComponentData } from './unit-search-shared.util';

export interface UnitFilterKernelDependencies {
    getProperty: (unit: Unit, key?: string) => unknown;
    getAdjustedBV: (unit: Unit) => number;
    getAdjustedPV: (unit: Unit) => number;
    getUnitIdsForSelectedEras: (selectedEraNames: string[]) => Set<number> | null;
    getUnitIdsForSelectedFactions: (
        selectedFactionEntries: MultiStateSelection,
        contextEraNames?: string[],
        wildcardPatterns?: WildcardPattern[],
    ) => Set<number> | null;
    getForcePackChassisTypeSet: (packName: string) => ReadonlySet<string> | undefined;
}

interface ApplyUnitFilterStateRequest {
    units: Unit[];
    state: FilterState;
    dependencies: UnitFilterKernelDependencies;
    skipKey?: string;
}

const ADVANCED_FILTER_CONFIG_BY_KEY = new Map(ADVANCED_FILTERS.map(conf => [conf.key, conf]));

function filterUnitsByMultiState(
    units: Unit[],
    key: string,
    selection: MultiStateSelection,
    getProperty: UnitFilterKernelDependencies['getProperty'],
    wildcardPatterns?: WildcardPattern[],
): Unit[] {
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
    const isComponentFilter = key === 'componentName';
    const compiledOrPatterns = wildcardPatterns?.filter(p => p.state === 'or').map(pattern => ({ pattern, regex: wildcardToRegex(pattern.pattern) })) ?? [];
    const compiledAndPatterns = wildcardPatterns?.filter(p => p.state === 'and').map(pattern => ({ pattern, regex: wildcardToRegex(pattern.pattern) })) ?? [];
    const compiledNotPatterns = wildcardPatterns?.filter(p => p.state === 'not').map(pattern => ({ pattern, regex: wildcardToRegex(pattern.pattern) })) ?? [];

    return units.filter(unit => {
        let unitData: { names: Set<string>; counts?: Map<string, number> };

        if (isComponentFilter) {
            const cached = getUnitComponentData(unit);
            unitData = {
                names: cached.names,
                counts: needsQuantityCounting ? cached.counts : undefined,
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

function getSelectedDropdownNames(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string');
    }

    if (!value || typeof value !== 'object') {
        return [];
    }

    const selection = value as MultiStateSelection;
    return Object.entries(selection)
        .filter(([, option]) => option.state === 'or' || option.state === 'and')
        .map(([name]) => name);
}

export function applyFilterStateToUnits(request: ApplyUnitFilterStateRequest): Unit[] {
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

    const selectedEraNames = getSelectedDropdownNames(activeFilters['era']);
    const selectedFactionEntries = activeFilters['faction'] as MultiStateSelection || {};

    let eraUnitIds: Set<number> | null = null;
    let factionUnitIds: Set<number> | null = null;
    const factionFilterState = skipKey === 'faction' ? undefined : state['faction'];
    const factionWildcardPatterns = factionFilterState?.wildcardPatterns;
    if (Object.values(selectedFactionEntries).some(selection => selection.state) || (factionWildcardPatterns && factionWildcardPatterns.length > 0)) {
        factionUnitIds = dependencies.getUnitIdsForSelectedFactions(
            selectedFactionEntries,
            selectedEraNames.length > 0 ? selectedEraNames : undefined,
            factionWildcardPatterns,
        );
    } else if (selectedEraNames.length > 0) {
        eraUnitIds = dependencies.getUnitIdsForSelectedEras(selectedEraNames);
    }

    if (eraUnitIds || factionUnitIds) {
        let finalIds: Set<number>;
        if (eraUnitIds && factionUnitIds) {
            const [smaller, larger] = eraUnitIds.size <= factionUnitIds.size
                ? [eraUnitIds, factionUnitIds]
                : [factionUnitIds, eraUnitIds];
            finalIds = new Set<number>();
            for (const id of smaller) {
                if (larger.has(id)) finalIds.add(id);
            }
        } else {
            finalIds = (eraUnitIds || factionUnitIds)!;
        }
        results = results.filter(unit => finalIds.has(unit.id));
    }

    const selectedForcePackNames = activeFilters['forcePack'] as string[] || [];
    if (selectedForcePackNames.length > 0) {
        const chassisTypeSet = new Set<string>();
        for (const packName of selectedForcePackNames) {
            const packSet = dependencies.getForcePackChassisTypeSet(packName);
            if (packSet) {
                for (const key of packSet) chassisTypeSet.add(key);
            }
        }
        results = results.filter(unit => chassisTypeSet.has(`${unit.chassis}|${unit.type}`));
    }

    for (const { conf, filterState } of activeStandardFilters) {
        const val = filterState.value;
        const wildcardPatterns = filterState.wildcardPatterns;

        if (conf.type === AdvFilterType.DROPDOWN && conf.multistate && val && typeof val === 'object') {
            results = filterUnitsByMultiState(results, conf.key, val as MultiStateSelection, dependencies.getProperty, wildcardPatterns);
            continue;
        }

        if (conf.type === AdvFilterType.SEMANTIC) {
            const searchTerms: string[] = Array.isArray(val) ? val : (typeof val === 'object' ? Object.keys(val) : [String(val)]);
            const hasSearchTerms = searchTerms.length > 0;
            const hasWildcards = wildcardPatterns && wildcardPatterns.length > 0;
            const includePatterns = wildcardPatterns?.filter(p => p.state === 'or') || [];
            const excludePatterns = wildcardPatterns?.filter(p => p.state === 'not') || [];
            const andPatterns = wildcardPatterns?.filter(p => p.state === 'and') || [];

            if (hasSearchTerms || hasWildcards) {
                const searchTermsLower = searchTerms.map(term => term.toLowerCase());
                results = results.filter(unit => {
                    const unitValue = dependencies.getProperty(unit, conf.key);
                    if (unitValue == null) return false;
                    const unitStr = String(unitValue).toLowerCase();

                    for (const pattern of excludePatterns) {
                        const regex = wildcardToRegex(pattern.pattern);
                        if (regex.test(unitStr)) return false;
                    }

                    for (const pattern of andPatterns) {
                        const regex = wildcardToRegex(pattern.pattern);
                        if (!regex.test(unitStr)) return false;
                    }

                    if (!hasSearchTerms && includePatterns.length === 0) {
                        return true;
                    }

                    for (const term of searchTermsLower) {
                        if (unitStr === term) return true;
                    }

                    for (const pattern of includePatterns) {
                        const regex = wildcardToRegex(pattern.pattern);
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

                results = results.filter(unit => {
                    const propertyValue = dependencies.getProperty(unit, conf.key);
                    const unitValues = Array.isArray(propertyValue) ? propertyValue : [propertyValue];
                    const unitStrings = unitValues.filter(value => value != null).map(value => String(value).toLowerCase());

                    for (const pattern of notPatterns) {
                        const regex = wildcardToRegex(pattern.pattern);
                        for (const unitValue of unitStrings) {
                            if (regex.test(unitValue)) return false;
                        }
                    }

                    for (const pattern of andPatterns) {
                        const regex = wildcardToRegex(pattern.pattern);
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

                    for (const pattern of orPatterns) {
                        const regex = wildcardToRegex(pattern.pattern);
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