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

import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import type { GameSystem } from '../models/common.model';
import type { Unit } from '../models/units.model';
import type { WildcardPattern } from './semantic-filter.util';
import { getAdvOptionsContextSnapshot, getSnapshotAvailabilityNames, getSnapshotAvailableNames, getSnapshotComponentCounts, getSnapshotUnitIds, type AdvOptionsContextSnapshot } from './unit-search-adv-options.util';
import { applyFilterStateToUnits, type UnitFilterKernelDependencies } from './unit-filter-kernel.util';
import { matchesSearch, parseSearchQuery } from './search.util';
import { getNowMs, getProperty, normalizeMultiStateSelection } from './unit-search-shared.util';
import { isComponentBackedDropdown, usesIndexedDropdownAvailability, usesIndexedDropdownUniverse } from './unit-search-filter-config.util';
import { sortAvailableDropdownOptions, sortDropdownOptionObjects } from './unit-search-dropdown-sort.util';
import { AdvFilterType, type AdvFilterConfig, type AdvFilterOptions, type AdvOptionsTelemetryFilterStage, type AdvOptionsTelemetrySnapshot, type FilterState, type SemanticDisplayItem } from '../services/unit-search-filters.model';

interface BuildUnitSearchAdvOptionsRequest {
    advancedFilters: readonly AdvFilterConfig[];
    state: FilterState;
    units: Unit[];
    queryText: string;
    textSearch: string;
    isComplexQuery: boolean;
    totalRanges: Record<string, [number, number]>;
    dynamicInternalLabel: string;
    gameSystem: GameSystem;
    getUnitFilterKernelDependencies: () => UnitFilterKernelDependencies;
    buildIndexedDropdownOptions: (
        conf: AdvFilterConfig,
        contextUnits: Unit[],
        displayNameFn?: (value: string) => string | undefined,
        contextUnitIds?: ReadonlySet<string>,
    ) => { name: string; img?: string; displayName?: string; available?: boolean }[];
    buildForcePackDropdownOptions: (
        snapshot: AdvOptionsContextSnapshot,
        contextUnits: Unit[],
    ) => { name: string; available: boolean }[];
    buildCustomDropdownOptions?: (
        conf: AdvFilterConfig,
        contextUnits: Unit[],
        state: FilterState,
    ) => { name: string; img?: string; displayName?: string; available?: boolean }[] | null;
    getIndexedUniverseNames: (filterKey: string) => string[];
    getSortedIndexedUniverseNames: (conf: AdvFilterConfig) => string[];
    collectIndexedAvailabilityNames: (
        filterKey: string,
        optionNames: readonly string[],
        contextUnitIds: ReadonlySet<string>,
        isComponentFilter: boolean,
    ) => Set<string>;
    collectConstrainedMultistateAvailabilityNames: (
        filterKey: string,
        units: Unit[],
        selection: MultiStateSelection,
        isComponentFilter: boolean,
    ) => Set<string> | null;
    getAvailableRangeForUnits: (
        units: Unit[],
        conf: AdvFilterConfig,
        fallbackRange: [number, number],
    ) => [number, number];
    getDisplayName: (filterKey: string, value: string) => string | undefined;
}

interface BuildUnitSearchAdvOptionsResult {
    options: Record<string, AdvFilterOptions>;
    telemetry: AdvOptionsTelemetrySnapshot;
}

function hasAdvancedQuantitySelections(selection: MultiStateSelection): boolean {
    return Object.values(selection).some(sel => {
        if (!sel || sel.state === false) {
            return false;
        }
        if (sel.countIncludeRanges || sel.countExcludeRanges) return true;
        if (sel.countMax !== undefined) return true;
        if (sel.countOperator && sel.countOperator !== '>=') return true;
        return false;
    });
}

function getSemanticSelectionSuffix(selection: MultiStateSelection[string], countable: boolean): string {
    if (!selection || !countable) {
        return '';
    }

    if (selection.countOperator && selection.countOperator !== '=') {
        if (selection.countMax !== undefined) {
            const rangePrefix = selection.countOperator === '!=' ? '!' : '';
            return `:${rangePrefix}${selection.count}-${selection.countMax}`;
        }

        return `:${selection.countOperator}${selection.count}`;
    }

    if (selection.countIncludeRanges || selection.countExcludeRanges) {
        const parts: string[] = [];

        if (selection.countIncludeRanges) {
            for (const [min, max] of selection.countIncludeRanges) {
                if (min === max) {
                    parts.push(`${min}`);
                } else if (max === Infinity) {
                    parts.push(`>=${min}`);
                } else {
                    parts.push(`${min}-${max}`);
                }
            }
        }

        if (selection.countExcludeRanges) {
            for (const [min, max] of selection.countExcludeRanges) {
                if (min === max) {
                    parts.push(`!${min}`);
                } else {
                    parts.push(`!${min}-${max}`);
                }
            }
        }

        return parts.length > 0 ? `:${parts.join(',')}` : '';
    }

    return selection.count > 1 ? `:${selection.count}` : '';
}

function buildSemanticDisplayItems(
    selection: MultiStateSelection,
    countable: boolean,
    exclusive: boolean,
    wildcardPatterns?: WildcardPattern[],
): SemanticDisplayItem[] | undefined {
    const items: SemanticDisplayItem[] = [];
    const hasWildcards = !!wildcardPatterns && wildcardPatterns.length > 0;
    const hasAdvancedQuantity = hasAdvancedQuantitySelections(selection);

    if (!hasWildcards && !hasAdvancedQuantity && !exclusive) {
        return undefined;
    }

    if (hasWildcards) {
        for (const wildcardPattern of wildcardPatterns ?? []) {
            items.push({
                text: wildcardPattern.pattern,
                state: wildcardPattern.state,
            });
        }
    }

    for (const [name, sel] of Object.entries(selection)) {
        if (!sel || sel.state === false) {
            continue;
        }

        items.push({
            text: name + (hasWildcards ? '' : getSemanticSelectionSuffix(sel, countable)),
            state: sel.state as SemanticDisplayItem['state'],
        });
    }

    if (exclusive && items.length > 0) {
        items[0] = {
            ...items[0],
            text: `==${items[0].text}`,
        };
    }

    return items.length > 0 ? items : undefined;
}

function semanticDisplayItemsToText(items: SemanticDisplayItem[]): string {
    return items.map(item => {
        if (item.text.startsWith('==') && item.state === 'not') {
            return `==!${item.text.slice(2)}`;
        }

        if (item.state === 'not') {
            return `!${item.text}`;
        }

        return item.text;
    }).join(', ');
}

export function buildUnitSearchAdvOptions(request: BuildUnitSearchAdvOptionsRequest): BuildUnitSearchAdvOptionsResult {
    const advOptionsStartedAt = getNowMs();
    const result: Record<string, AdvFilterOptions> = {};
    const filterTelemetry: AdvOptionsTelemetryFilterStage[] = [];

    let baseUnits = request.units;
    const baseUnitCount = baseUnits.length;

    if (request.textSearch) {
        const textTokens = parseSearchQuery(request.textSearch);
        baseUnits = baseUnits.filter(unit => {
            const searchableText = unit._searchKey || `${unit.chassis ?? ''} ${unit.model ?? ''}`.toLowerCase();
            return matchesSearch(searchableText, textTokens, true);
        });
    }

    const activeFilterKeys = new Set(
        Object.entries(request.state)
            .filter(([, filterState]) => filterState.interactedWith)
            .map(([key]) => key),
    );

    const fullyFilteredUnits = activeFilterKeys.size === 0
        ? baseUnits
        : applyFilterStateToUnits({
            units: baseUnits,
            state: request.state,
            dependencies: request.getUnitFilterKernelDependencies(),
        });

    const contextUnitsCache = new Map<string, Unit[]>();
    const contextSnapshotCache = new WeakMap<Unit[], AdvOptionsContextSnapshot>();

    const pushAdvOptionsTelemetry = (
        conf: AdvFilterConfig,
        startedAt: number,
        contextDerivationMs: number,
        contextUnitCount: number,
        contextStrategy: 'fully-filtered' | 'base-units' | 'excluded-filter',
        options?: { available?: boolean }[],
    ) => {
        const stage: AdvOptionsTelemetryFilterStage = {
            key: conf.key,
            type: conf.type === AdvFilterType.RANGE ? 'range' : 'dropdown',
            durationMs: getNowMs() - startedAt,
            contextDerivationMs,
            contextUnitCount,
            contextStrategy,
            interacted: request.state[conf.key]?.interactedWith ?? false,
        };

        if (options) {
            stage.optionCount = options.length;
            stage.availableOptionCount = options.filter(option => option.available !== false).length;
        }

        filterTelemetry.push(stage);
    };

    for (const conf of request.advancedFilters) {
        if (conf.type === AdvFilterType.SEMANTIC) continue;

        const filterStartedAt = getNowMs();

        let label = conf.label;
        if (conf.key === 'internal') {
            label = request.dynamicInternalLabel;
        }

        const filterStateEntry = request.state[conf.key];
        let contextStrategy: 'fully-filtered' | 'base-units' | 'excluded-filter' = 'fully-filtered';
        const contextDerivationStartedAt = getNowMs();
        let contextUnits = fullyFilteredUnits;

        if (filterStateEntry?.interactedWith) {
            if (activeFilterKeys.size === 1) {
                contextStrategy = 'base-units';
                contextUnits = baseUnits;
            } else {
                contextStrategy = 'excluded-filter';
                let cachedContextUnits = contextUnitsCache.get(conf.key);
                if (!cachedContextUnits) {
                    cachedContextUnits = applyFilterStateToUnits({
                        units: baseUnits,
                        state: request.state,
                        skipKey: conf.key,
                        dependencies: request.getUnitFilterKernelDependencies(),
                    });
                    contextUnitsCache.set(conf.key, cachedContextUnits);
                }
                contextUnits = cachedContextUnits;
            }
        }

        const contextDerivationMs = getNowMs() - contextDerivationStartedAt;
        let availableOptions: { name: string; img?: string; displayName?: string; available?: boolean }[] = [];

        if (conf.type === AdvFilterType.DROPDOWN) {
            const displayNameFn = (value: string) => request.getDisplayName(conf.key, value);
            const contextSnapshot = getAdvOptionsContextSnapshot(contextSnapshotCache, contextUnits);
            const contextUnitIds = getSnapshotUnitIds(contextSnapshot, contextUnits);
            const customOptions = request.buildCustomDropdownOptions?.(conf, contextUnits, request.state);

            if (customOptions) {
                availableOptions = customOptions;
            } else if (usesIndexedDropdownUniverse(conf) && !conf.multistate) {
                availableOptions = request.buildIndexedDropdownOptions(conf, contextUnits, displayNameFn, contextUnitIds);
            } else if (conf.multistate) {
                const isComponentFilter = isComponentBackedDropdown(conf);
                const currentFilter = request.state[conf.key];
                const normalizedCurrentSelection = currentFilter?.interactedWith
                    ? normalizeMultiStateSelection(currentFilter.value)
                    : {};
                const hasQuantityFilters = conf.countable && isComponentFilter
                    && Object.values(normalizedCurrentSelection).some(selection => selection.count > 1);
                const indexedUniverse = usesIndexedDropdownUniverse(conf);
                const availableNames = indexedUniverse
                    ? request.getIndexedUniverseNames(conf.key)
                    : getSnapshotAvailableNames(contextSnapshot, conf.key, contextUnits, isComponentFilter);
                const constrainedAvailableNameSet = Object.keys(normalizedCurrentSelection).length > 0
                    ? request.collectConstrainedMultistateAvailabilityNames(
                        conf.key,
                        contextUnits,
                        normalizedCurrentSelection,
                        isComponentFilter,
                    )
                    : null;

                const sortedNames = indexedUniverse
                    ? request.getSortedIndexedUniverseNames(conf)
                    : availableNames;
                const availableNameSet = constrainedAvailableNameSet
                    ?? (indexedUniverse
                        ? (usesIndexedDropdownAvailability(conf)
                            ? request.collectIndexedAvailabilityNames(conf.key, sortedNames, contextUnitIds, isComponentFilter)
                            : getSnapshotAvailabilityNames(contextSnapshot, conf.key, contextUnits, isComponentFilter))
                        : getSnapshotAvailabilityNames(contextSnapshot, conf.key, contextUnits, isComponentFilter));
                const indexedOptionMetadata = indexedUniverse
                    ? new Map(
                        request.buildIndexedDropdownOptions(conf, contextUnits, displayNameFn, contextUnitIds)
                            .map(option => [option.name, option] as const)
                    )
                    : null;

                let totalCountsMap: Map<string, number> | null = null;
                if (hasQuantityFilters) {
                    totalCountsMap = getSnapshotComponentCounts(contextSnapshot, contextUnits);
                }

                const optionsWithAvailability = sortedNames.map(name => {
                    const normalizedName = isComponentFilter ? name.toLowerCase() : name;
                    const metadata = indexedOptionMetadata?.get(name);
                    const option: { name: string; img?: string; displayName?: string; available: boolean; count?: number } = {
                        name,
                        ...(metadata?.img ? { img: metadata.img } : {}),
                        ...(metadata?.displayName ? { displayName: metadata.displayName } : {}),
                        available: availableNameSet.has(normalizedName),
                    };

                    if (totalCountsMap) {
                        option.count = totalCountsMap.get(normalizedName) || 0;
                    }

                    return option;
                });

                const currentFilterValue = filterStateEntry?.interactedWith ? filterStateEntry.value : {};
                const currentSelection = normalizeMultiStateSelection(currentFilterValue);
                const wildcardPatternsMultistate = filterStateEntry?.wildcardPatterns;
                const isExclusiveSemantic = filterStateEntry?.exclusive ?? false;
                const displayItemsMultistate = Object.keys(currentSelection).length > 0
                    ? buildSemanticDisplayItems(
                        currentSelection,
                        !!conf.countable,
                        isExclusiveSemantic,
                        wildcardPatternsMultistate,
                    )
                    : undefined;
                const semanticOnlyMultistate = displayItemsMultistate !== undefined;

                result[conf.key] = {
                    type: 'dropdown',
                    label,
                    options: optionsWithAvailability,
                    value: currentSelection,
                    interacted: filterStateEntry?.interactedWith ?? false,
                    semanticOnly: semanticOnlyMultistate,
                    displayItems: displayItemsMultistate,
                };
                pushAdvOptionsTelemetry(conf, filterStartedAt, contextDerivationMs, contextUnits.length, contextStrategy, optionsWithAvailability);
                continue;
            } else if (conf.external) {
                if (conf.key === 'forcePack') {
                    availableOptions = request.buildForcePackDropdownOptions(contextSnapshot, contextUnits);
                }
            } else {
                const optionSet = new Set<string>();
                for (const unit of contextUnits) {
                    const unitValue = getProperty(unit, conf.key);
                    const values = Array.isArray(unitValue) ? unitValue : [unitValue];
                    for (const value of values) {
                        if (value != null && value !== '') {
                            optionSet.add(String(value));
                        }
                    }
                }

                availableOptions = sortAvailableDropdownOptions(Array.from(optionSet), conf.sortOptions).map(name => ({
                    name,
                    ...(displayNameFn(name) ? { displayName: displayNameFn(name) } : {}),
                }));
            }

            const isInteracted = filterStateEntry?.interactedWith ?? false;
            const filterValue = isInteracted ? filterStateEntry.value : [];
            let semanticOnly = filterStateEntry?.semanticOnly ?? false;
            let displayText: string | undefined;
            let displayItems: SemanticDisplayItem[] | undefined;
            const availableOptionNames = new Set(availableOptions.map(option => option.name));
            const wildcardPatterns = filterStateEntry?.wildcardPatterns;
            const isExclusiveSemantic = filterStateEntry?.exclusive ?? false;

            if (wildcardPatterns && wildcardPatterns.length > 0) {
                semanticOnly = true;
                if (conf.multistate) {
                    const selection = normalizeMultiStateSelection(filterValue);
                    if (Object.keys(selection).length > 0) {
                        displayItems = buildSemanticDisplayItems(
                            selection,
                            !!conf.countable,
                            isExclusiveSemantic,
                            wildcardPatterns,
                        );
                    }
                } else {
                    displayText = wildcardPatterns.map(pattern => {
                        const prefix = pattern.state === 'not' ? '!' : '';
                        return prefix + pattern.pattern;
                    }).join(', ');
                    if (isExclusiveSemantic) {
                        displayText = `==${displayText}`;
                    }
                }
            } else if (conf.multistate) {
                const selection = normalizeMultiStateSelection(filterValue);
                if (Object.keys(selection).length > 0) {
                    const activeSelections = Object.entries(selection)
                        .filter(([, selectionValue]) => selectionValue.state !== false);
                    const unavailableSelections = activeSelections.filter(([name]) => !availableOptionNames.has(name));
                    const hasAdvancedQuantity = hasAdvancedQuantitySelections(selection);

                    if (unavailableSelections.length > 0) {
                        for (const [name] of unavailableSelections) {
                            availableOptions.push({
                                name,
                                available: false,
                                ...(displayNameFn(name) ? { displayName: displayNameFn(name) } : {}),
                            });
                        }
                    }

                    if (hasAdvancedQuantity) {
                        semanticOnly = true;
                        displayItems = buildSemanticDisplayItems(selection, !!conf.countable, false);
                        displayText = displayItems ? semanticDisplayItemsToText(displayItems) : undefined;
                    } else if (isExclusiveSemantic && activeSelections.length > 0) {
                        semanticOnly = true;
                        displayText = `==${activeSelections.map(([name]) => name).join(', ')}`;
                    }
                }
            } else {
                const selectedValues = filterValue as string[];
                if (selectedValues && Array.isArray(selectedValues) && selectedValues.length > 0) {
                    for (const value of selectedValues) {
                        if (!availableOptionNames.has(value)) {
                            availableOptions.push({
                                name: value,
                                available: false,
                                ...(displayNameFn(value) ? { displayName: displayNameFn(value) } : {}),
                            });
                        }
                    }

                    if (isExclusiveSemantic) {
                        semanticOnly = true;
                        displayText = `==${selectedValues.join(', ')}`;
                    }
                }
            }

            availableOptions = sortDropdownOptionObjects(availableOptions, conf.sortOptions);

            result[conf.key] = {
                type: 'dropdown',
                label,
                options: availableOptions,
                value: filterValue,
                interacted: isInteracted,
                semanticOnly,
                displayText,
                displayItems,
            };
            pushAdvOptionsTelemetry(conf, filterStartedAt, contextDerivationMs, contextUnits.length, contextStrategy, availableOptions);
        } else if (conf.type === AdvFilterType.RANGE) {
            const totalRange = request.totalRanges[conf.key] || [0, 0];
            const availableRange = request.getAvailableRangeForUnits(
                contextUnits,
                conf,
                totalRange as [number, number],
            );

            const isInteracted = filterStateEntry?.interactedWith ?? false;
            const originalValue: [number, number] = isInteracted ? filterStateEntry.value : availableRange;

            let clampedMin = Math.max(availableRange[0], Math.min(originalValue[0], availableRange[1]));
            let clampedMax = Math.min(availableRange[1], Math.max(originalValue[1], availableRange[0]));
            if (clampedMin > clampedMax) [clampedMin, clampedMax] = [clampedMax, clampedMin];
            const clampedValue: [number, number] = [clampedMin, clampedMax];

            const semanticOnly = filterStateEntry?.semanticOnly ?? false;
            const semanticIncludeRanges = filterStateEntry?.includeRanges;
            const includeRanges: [number, number][] | undefined =
                semanticIncludeRanges ?? (isInteracted ? [originalValue] : undefined);

            result[conf.key] = {
                type: 'range',
                label,
                totalRange: totalRange,
                options: availableRange as [number, number],
                value: clampedValue,
                interacted: isInteracted,
                semanticOnly,
                includeRanges,
                excludeRanges: filterStateEntry?.excludeRanges,
                displayText: filterStateEntry?.displayText,
            };
            pushAdvOptionsTelemetry(conf, filterStartedAt, contextDerivationMs, contextUnits.length, contextStrategy);
        }
    }

    return {
        options: result,
        telemetry: {
            timestamp: Date.now(),
            query: request.queryText.trim(),
            gameSystem: request.gameSystem,
            complex: request.isComplexQuery,
            baseUnitCount,
            textFilteredUnitCount: baseUnits.length,
            visibleFilterCount: Object.keys(result).length,
            filters: filterTelemetry,
            totalMs: getNowMs() - advOptionsStartedAt,
        },
    };
}