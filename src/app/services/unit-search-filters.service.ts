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

import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Unit } from '../models/units.model';
import { DataService } from './data.service';
import { CountOperator, MultiState, MultiStateSelection, MultiStateOption } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { ActivatedRoute, Router } from '@angular/router';
import { getForcePacks } from '../models/forcepacks.model';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { computeRelevanceScore, naturalCompare, compareUnitsByName } from '../utils/sort.util';
import { parseSearchQuery, SearchTokensGroup } from '../utils/search.util';
import { OptionsService } from './options.service';
import { LoggerService } from './logger.service';
import { matchesSearch } from '../utils/search.util';
import { GameSystem } from '../models/common.model';
import { GameService } from './game.service';
import { UrlStateService } from './url-state.service';
import { PVCalculatorUtil } from '../utils/pv-calculator.util';
import { applySemanticQuery, filterStateToSemanticText, ParsedSemanticQuery, parseSemanticQuery } from '../utils/semantic-filter.util';

/*
 * Author: Drake
 */
export interface SortOption {
    key: string;
    label: string;
    slotLabel?: string; // Optional label prefix to show in the slot (e.g., "BV")
    slotIcon?: string;  // Optional icon for the slot (e.g., '/images/calendar.svg')
    gameSystem?: GameSystem;
}

export enum AdvFilterType {
    DROPDOWN = 'dropdown',
    RANGE = 'range'
}
export interface AdvFilterConfig {
    game?: GameSystem;
    key: string;
    label: string;
    type: AdvFilterType;
    sortOptions?: string[]; // For dropdowns, can be pre-defined sort order, supports wildcard '*' at the end for prefix matching
    external?: boolean; // If true, this filter datasource is not from the local data, but from an external source (era, faction, etc.)
    curve?: number; // for range sliders, defines the curve of the slider
    ignoreValues?: any[]; // Values to ignore in the range filter, e.g. [-1] for heat/dissipation
    multistate?: boolean; // if true, the filter (dropdown) can have multiple states (OR, AND, NOT)
    countable?: boolean; // if true, show amount next to options
    stepSize?: number; // for range sliders, defines the step size
    semanticKey?: string; // Simplified key for semantic filter mode (e.g., 'tmm' instead of 'as.TMM')
    invisible?: boolean; // If true, this filter is only available via semantic mode (not shown in UI)
    textMatch?: boolean; // If true, this filter uses substring matching instead of exact match
}

/** Wildcard pattern for dropdown filter matching */
interface WildcardPattern {
    pattern: string;    // Pattern with * wildcards (e.g., "AC*")
    state: 'or' | 'and' | 'not';  // Include (OR), require all (AND), or exclude (NOT)
}

interface FilterState {
    [key: string]: {
        value: any;
        interactedWith: boolean;
        includeRanges?: [number, number][];  // For range filters: specific ranges to include (OR logic)
        excludeRanges?: [number, number][];  // For range filters: ranges to exclude (semantic-only)
        displayText?: string;                // For range filters: formatted effective ranges (e.g., "0-3, 5-99")
        semanticOnly?: boolean;              // True if this filter can't be shown in UI
        wildcardPatterns?: WildcardPattern[];  // For dropdown filters: wildcard patterns
    };
}

type DropdownFilterOptions = {
    type: 'dropdown';
    label: string;
    options: { name: string, img?: string, displayName?: string }[];
    value: string[];
    interacted: boolean;
    semanticOnly?: boolean;  // True if this filter has semantic-only constraints (values not in options)
    displayText?: string;    // Display text for semantic-only values
};

type RangeFilterOptions = {
    type: 'range';
    label: string;
    totalRange: [number, number];
    options: [number, number];
    value: [number, number];
    interacted: boolean;
    curve?: number;
    semanticOnly?: boolean;  // True if this filter has semantic-only constraints
    includeRanges?: [number, number][];  // Semantic include ranges (for display)
    excludeRanges?: [number, number][];  // Ranges to exclude (for display/filtering)
    displayText?: string;  // Formatted effective ranges (e.g., "0-3, 5-99")
};

export interface SerializedSearchFilter {
    name: string;
    q?: string;
    sort?: string;
    sortDir?: 'asc' | 'desc';
    filters?: Record<string, any>;
    gunnery?: number;
    piloting?: number;
}


type AdvFilterOptions = DropdownFilterOptions | RangeFilterOptions;

const DEFAULT_FILTER_CURVE = 0;
export const FACTION_EXTINCT = 3;

function sortAvailableDropdownOptions(options: string[], predefinedOrder?: string[]): string[] {
    if (predefinedOrder && predefinedOrder.length > 0) {
        const optionsSet = new Set(options);
        const sortedOptions: string[] = [];
        for (const predefinedOpt of predefinedOrder) {
            if (predefinedOpt.endsWith('*')) {
                const prefix = predefinedOpt.slice(0, -1);
                // Smart sort for matching options
                const matchingOptions = Array.from(optionsSet)
                    .filter(o => typeof o === 'string' && o.startsWith(prefix))
                    .sort((a, b) => naturalCompare(a, b));
                for (const match of matchingOptions) {
                    sortedOptions.push(match);
                    optionsSet.delete(match);
                }
            } else if (optionsSet.has(predefinedOpt)) {
                sortedOptions.push(predefinedOpt);
                optionsSet.delete(predefinedOpt);
            }
        }
        const remainingSorted = Array.from(optionsSet).sort(naturalCompare);
        return [...sortedOptions, ...remainingSorted];
    }
    return options.sort(naturalCompare);
}

/**
 * Get merged tags (name + chassis) for a unit.
 * Returns a deduplicated array combining both tag types.
 */
function getMergedTags(unit: Unit): string[] {
    const nameTags = unit._nameTags ?? [];
    const chassisTags = unit._chassisTags ?? [];
    // Merge and deduplicate
    return Array.from(new Set([...chassisTags, ...nameTags]));
}

/**
 * Convert a wildcard pattern (e.g., "AC*" or "*/3/*") to a RegExp.
 * Supports * as a wildcard for any characters.
 */
function wildcardToRegex(pattern: string): RegExp {
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Replace * with .*
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr, 'i'); // Case insensitive
}

function getProperty(obj: any, key?: string) {
    if (!obj || !key) return undefined;
    // Special handling for _tags: merge _nameTags and _chassisTags
    if (key === '_tags') {
        return getMergedTags(obj as Unit);
    }
    // If key does not contain dot, fast path
    if (key.indexOf('.') === -1) return (obj as any)[key];
    const parts = key.split('.');
    let cur: any = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

/**
 * Check if a unit's count satisfies a quantity constraint.
 * Supports include/exclude ranges for merged constraints.
 */
function checkQuantityConstraint(
    unitCount: number,
    item: MultiStateOption
): boolean {
    const { count, countOperator, countMax, countIncludeRanges, countExcludeRanges } = item;
    
    // If we have merged ranges, use those
    if (countIncludeRanges || countExcludeRanges) {
        // Check exclude ranges first
        if (countExcludeRanges) {
            for (const [min, max] of countExcludeRanges) {
                if (unitCount >= min && unitCount <= max) {
                    return false;  // Excluded
                }
            }
        }
        
        // Check include ranges
        if (countIncludeRanges && countIncludeRanges.length > 0) {
            for (const [min, max] of countIncludeRanges) {
                if (unitCount >= min && unitCount <= max) {
                    return true;  // Included
                }
            }
            return false;  // Not in any include range
        }
        
        // Only excludes, no includes - implicit include is 1+
        return unitCount >= 1;
    }
    
    // Single constraint handling
    const op = countOperator;
    
    // No operator means "at least N" (what UI does)
    if (!op) {
        return unitCount >= count;
    }
    
    // Range constraint (count to countMax)
    if (countMax !== undefined) {
        const inRange = unitCount >= count && unitCount <= countMax;
        return op === '!=' ? !inRange : inRange;
    }
    
    // Single value constraint with explicit operator
    switch (op) {
        case '=':
            return unitCount === count;  // Exact match
        case '!=':
            return unitCount !== count;
        case '>':
            return unitCount > count;
        case '>=':
            return unitCount >= count;
        case '<':
            return unitCount < count;
        case '<=':
            return unitCount <= count;
        default:
            return unitCount >= count;
    }
}

function filterUnitsByMultiState(units: Unit[], key: string, selection: MultiStateSelection, wildcardPatterns?: WildcardPattern[]): Unit[] {
    const orList: MultiStateOption[] = [];
    const andList: MultiStateOption[] = [];
    const notList: MultiStateOption[] = [];

    for (const [name, selectionValue] of Object.entries(selection)) {
        if (selectionValue.state === 'or') orList.push(selectionValue);
        else if (selectionValue.state === 'and') andList.push(selectionValue);
        else if (selectionValue.state === 'not') notList.push(selectionValue);
    }

    // Early return if no filters
    const hasWildcards = wildcardPatterns && wildcardPatterns.length > 0;
    if (orList.length === 0 && andList.length === 0 && notList.length === 0 && !hasWildcards) {
        return units;
    }

    // Check if we need quantity counting (any non-default constraint)
    const needsQuantityCounting = [...orList, ...andList, ...notList].some(
        item => item.count > 1 || item.countOperator || item.countMax !== undefined || 
                item.countIncludeRanges || item.countExcludeRanges
    );
    const isComponentFilter = key === 'componentName';

    return units.filter(unit => {
        let unitData: { names: Set<string>; counts?: Map<string, number> };

        if (isComponentFilter) {
            // Use cached component data for performance
            const cached = getUnitComponentData(unit);
            unitData = {
                names: cached.componentNames,
                counts: needsQuantityCounting ? cached.componentCounts : undefined
            };
        } else {
            const propValue = getProperty(unit, key);
            const unitValues = Array.isArray(propValue) ? propValue : [propValue];
            const names = new Set(unitValues.filter(v => v != null));

            unitData = { names };
            if (needsQuantityCounting) {
                const counts = new Map<string, number>();
                for (const value of unitValues) {
                    if (value != null) {
                        counts.set(value, (counts.get(value) || 0) + 1);
                    }
                }
                unitData.counts = counts;
            }
        }

        // Check wildcard patterns
        if (hasWildcards) {
            const orPatterns = wildcardPatterns!.filter(p => p.state === 'or');
            const andPatterns = wildcardPatterns!.filter(p => p.state === 'and');
            const notPatterns = wildcardPatterns!.filter(p => p.state === 'not');
            
            // Check NOT patterns - exclude if any value matches a NOT pattern
            for (const p of notPatterns) {
                const regex = wildcardToRegex(p.pattern);
                for (const name of unitData.names) {
                    if (regex.test(name)) return false;
                }
            }
            
            // Check AND patterns - must have at least one match for EACH AND pattern
            for (const p of andPatterns) {
                const regex = wildcardToRegex(p.pattern);
                let hasMatch = false;
                for (const name of unitData.names) {
                    if (regex.test(name)) {
                        hasMatch = true;
                        break;
                    }
                }
                if (!hasMatch) return false;
            }
            
            // Check OR patterns - if we have OR wildcard patterns and no regular OR, need at least one match
            if (orPatterns.length > 0 && orList.length === 0) {
                let hasMatch = false;
                for (const p of orPatterns) {
                    const regex = wildcardToRegex(p.pattern);
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

        // NOT: Exclude if any NOT constraint is satisfied
        if (notList.length > 0) {
            for (const item of notList) {
                if (!unitData.names.has(item.name)) continue;  // Item not present, OK
                
                // Item is present - check quantity constraint
                if (needsQuantityCounting && unitData.counts) {
                    const unitCount = unitData.counts.get(item.name) || 0;
                    // For NOT, we exclude if the quantity constraint IS satisfied
                    // e.g., equipment!=AC/2:2 means exclude units with exactly 2 AC/2s
                    if (checkQuantityConstraint(unitCount, item)) {
                        return false;
                    }
                } else {
                    // No quantity constraint or not counting - just presence check
                    return false;
                }
            }
        }

        // AND: Must have all items with satisfied quantity constraints
        if (andList.length > 0) {
            for (const item of andList) {
                if (!unitData.names.has(item.name)) return false;  // Must have item
                
                if (needsQuantityCounting && unitData.counts) {
                    const unitCount = unitData.counts.get(item.name) || 0;
                    if (!checkQuantityConstraint(unitCount, item)) {
                        return false;
                    }
                }
            }
        }

        // OR: Must have at least one with satisfied quantity constraint
        if (orList.length > 0) {
            let hasMatch = false;
            for (const item of orList) {
                if (!unitData.names.has(item.name)) continue;
                
                if (needsQuantityCounting && unitData.counts) {
                    const unitCount = unitData.counts.get(item.name) || 0;
                    if (checkQuantityConstraint(unitCount, item)) {
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

export const ADVANCED_FILTERS: AdvFilterConfig[] = [
    { key: 'era', semanticKey: 'era', label: 'Era', type: AdvFilterType.DROPDOWN, external: true },
    { key: 'faction', semanticKey: 'faction', label: 'Faction', type: AdvFilterType.DROPDOWN, external: true, multistate: true },
    { key: 'type', semanticKey: 'type', label: 'Type', type: AdvFilterType.DROPDOWN, game: GameSystem.CLASSIC },
    { key: 'as.TP', semanticKey: 'type', label: 'Type', type: AdvFilterType.DROPDOWN, game: GameSystem.ALPHA_STRIKE },
    { key: 'subtype', semanticKey: 'subtype', label: 'Subtype', type: AdvFilterType.DROPDOWN, game: GameSystem.CLASSIC },
    {
        key: 'techBase', semanticKey: 'tech', label: 'Tech', type: AdvFilterType.DROPDOWN,
        sortOptions: ['Inner Sphere', 'Clan', 'Mixed']
    },
    { key: 'role', semanticKey: 'role', label: 'Role', type: AdvFilterType.DROPDOWN },
    {
        key: 'weightClass', semanticKey: 'weight', label: 'Weight Class', type: AdvFilterType.DROPDOWN, game: GameSystem.CLASSIC,
        sortOptions: ['Ultra Light*', 'Light', 'Medium', 'Heavy', 'Assault', 'Colossal*', 'Small*', 'Medium*', 'Large*']
    },
    {
        key: 'level', semanticKey: 'rules', label: 'Rules', type: AdvFilterType.DROPDOWN, game: GameSystem.CLASSIC,
        sortOptions: ['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial']
    },
    { key: 'c3', semanticKey: 'network', label: 'Network', type: AdvFilterType.DROPDOWN, game: GameSystem.CLASSIC },
    { key: 'moveType', semanticKey: 'motive', label: 'Motive', type: AdvFilterType.DROPDOWN, game: GameSystem.CLASSIC },
    { key: 'as.MV', semanticKey: 'move', label: 'Move', type: AdvFilterType.DROPDOWN, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.specials', semanticKey: 'specials', label: 'Specials', type: AdvFilterType.DROPDOWN, multistate: true, game: GameSystem.ALPHA_STRIKE },
    { key: 'componentName', semanticKey: 'equipment', label: 'Equipment', type: AdvFilterType.DROPDOWN, multistate: true, countable: true, game: GameSystem.CLASSIC },
    { key: 'features', semanticKey: 'features', label: 'Features', type: AdvFilterType.DROPDOWN, multistate: true, game: GameSystem.CLASSIC },
    { key: 'quirks', semanticKey: 'quirks', label: 'Quirks', type: AdvFilterType.DROPDOWN, multistate: true, game: GameSystem.CLASSIC },
    { key: 'source', semanticKey: 'source', label: 'Source', type: AdvFilterType.DROPDOWN },
    { key: 'forcePack', semanticKey: 'pack', label: 'Force Packs', type: AdvFilterType.DROPDOWN, external: true },
    { key: '_tags', semanticKey: 'tags', label: 'Tags', type: AdvFilterType.DROPDOWN, multistate: true },
    { key: 'bv', semanticKey: 'bv', label: 'BV', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'as.PV', semanticKey: 'pv', label: 'PV', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.ALPHA_STRIKE },
    { key: 'tons', semanticKey: 'tons', label: 'Tons', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, stepSize: 5, game: GameSystem.CLASSIC },
    { key: 'armor', semanticKey: 'armor', label: 'Armor', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'armorPer', semanticKey: 'armorpct', label: 'Armor %', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'internal', semanticKey: 'structure', label: 'Structure / Squad Size', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: '_mdSumNoPhysical', semanticKey: 'firepower', label: 'Firepower', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'dpt', semanticKey: 'dpt', label: 'Damage/Turn', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'heat', semanticKey: 'heat', label: 'Total Weapons Heat', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, ignoreValues: [-1], game: GameSystem.CLASSIC },
    { key: 'dissipation', semanticKey: 'dissipation', label: 'Dissipation', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, ignoreValues: [-1], game: GameSystem.CLASSIC },
    { key: '_dissipationEfficiency', semanticKey: 'efficiency', label: 'Heat Efficiency', type: AdvFilterType.RANGE, curve: 1, game: GameSystem.CLASSIC },
    { key: '_maxRange', semanticKey: 'range', label: 'Range', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'walk', semanticKey: 'walk', label: 'Walk MP', type: AdvFilterType.RANGE, curve: 0.9, game: GameSystem.CLASSIC },
    { key: 'run', semanticKey: 'run', label: 'Run MP', type: AdvFilterType.RANGE, curve: 0.9, game: GameSystem.CLASSIC },
    { key: 'jump', semanticKey: 'jump', label: 'Jump MP', type: AdvFilterType.RANGE, curve: 0.9, game: GameSystem.CLASSIC },
    { key: 'umu', semanticKey: 'umu', label: 'UMU MP', type: AdvFilterType.RANGE, curve: 0.9, game: GameSystem.CLASSIC },
    { key: 'year', semanticKey: 'year', label: 'Year', type: AdvFilterType.RANGE, curve: 1 },
    { key: 'cost', semanticKey: 'cost', label: 'Cost', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },

    /* Alpha Strike specific filters (but some are above) */
    { key: 'as.SZ', semanticKey: 'sz', label: 'Size', type: AdvFilterType.RANGE, curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.TMM', semanticKey: 'tmm', label: 'TMM', type: AdvFilterType.RANGE, curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.OV', semanticKey: 'ov', label: 'Overheat Value', type: AdvFilterType.RANGE, curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.Th', semanticKey: 'th', label: 'Threshold', type: AdvFilterType.RANGE, curve: 1, ignoreValues: [-1], game: GameSystem.ALPHA_STRIKE },
    { key: 'as.dmg._dmgS', semanticKey: 'dmgs', label: 'Damage (Short)', type: AdvFilterType.RANGE, curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.dmg._dmgM', semanticKey: 'dmgm', label: 'Damage (Medium)', type: AdvFilterType.RANGE, curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.dmg._dmgL', semanticKey: 'dmgl', label: 'Damage (Long)', type: AdvFilterType.RANGE, curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.dmg._dmgE', semanticKey: 'dmge', label: 'Damage (Extreme)', type: AdvFilterType.RANGE, curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.Arm', semanticKey: 'a', label: 'Armor', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, ignoreValues: [-1], game: GameSystem.ALPHA_STRIKE },
    { key: 'as.Str', semanticKey: 's', label: 'Structure', type: AdvFilterType.RANGE, curve: DEFAULT_FILTER_CURVE, ignoreValues: [-1], game: GameSystem.ALPHA_STRIKE },

    /* Invisible filters (semantic mode only) */
    { key: 'name', semanticKey: 'name', label: 'Name', type: AdvFilterType.DROPDOWN, invisible: true, textMatch: true },
    { key: 'id', semanticKey: 'id', label: 'ID', type: AdvFilterType.RANGE, invisible: true },
    { key: 'chassis', semanticKey: 'chassis', label: 'Chassis', type: AdvFilterType.DROPDOWN, invisible: true, textMatch: true },
    { key: 'model', semanticKey: 'model', label: 'Model', type: AdvFilterType.DROPDOWN, invisible: true, textMatch: true },
];

export const SORT_OPTIONS: SortOption[] = [
    { key: '', label: 'Relevance' },
    { key: 'name', label: 'Name' },
    ...ADVANCED_FILTERS
        .filter(f => !['era', 'faction', 'forcePack', 'componentName', 'source'].includes(f.key))
        .map(f => ({
            key: f.key,
            label: f.label,
            slotLabel: f.label,
            gameSystem: f.game,
            // slotIcon: f.slotIcon
        } as SortOption))
];

const unitComponentCache = new WeakMap<Unit, {
    componentNames: Set<string>;
    componentCounts: Map<string, number>;
}>();

function getUnitComponentData(unit: Unit) {
    let cached = unitComponentCache.get(unit);
    if (!cached) {
        const componentNames = new Set<string>();
        const componentCounts = new Map<string, number>();

        for (const component of unit.comp) {
            const name = component.n;
            componentNames.add(name);
            componentCounts.set(name, (componentCounts.get(name) || 0) + component.q);
        }

        cached = { componentNames, componentCounts };
        unitComponentCache.set(unit, cached);
    }
    return cached;
}



@Injectable({ providedIn: 'root' })
export class UnitSearchFiltersService {
    dataService = inject(DataService);
    optionsService = inject(OptionsService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    gameService = inject(GameService);
    logger = inject(LoggerService);
    private urlStateService = inject(UrlStateService);

    ADVANCED_FILTERS = ADVANCED_FILTERS;
    pilotGunnerySkill = signal(4);
    pilotPilotingSkill = signal(5);
    searchText = signal('');
    filterState = signal<FilterState>({});
    selectedSort = signal<string>('');
    selectedSortDirection = signal<'asc' | 'desc'>('asc');
    expandedView = signal(false);
    advOpen = signal(false);
    private totalRangesCache: Record<string, [number, number]> = {};
    private availableNamesCache = new Map<string, string[]>();
    private urlStateInitialized = false;
    
    /** Signal that changes when unit tags are updated. Used to trigger reactivity in tag-dependent components. */
    readonly tagsVersion = signal(0);

    /** Whether to automatically convert UI filter changes to semantic text */
    readonly autoConvertToSemantic = computed(() => 
        this.optionsService.options().automaticallyConvertFiltersToSemantic
    );

    /** 
     * Flag to prevent feedback loops when programmatically updating search text.
     * Non-reactive to avoid triggering recomputation.
     */
    private isSyncingToText = false;

    /** Parsed semantic query */
    private readonly semanticParsed = computed((): ParsedSemanticQuery | null => {
        return parseSemanticQuery(this.searchText(), this.gameService.currentGameSystem());
    });

    /** 
     * Effective text search - extracts the text portion from semantic query.
     */
    readonly effectiveTextSearch = computed(() => {
        const parsed = this.semanticParsed();
        return parsed?.textSearch ?? this.searchText();
    });

    /**
     * Set of filter keys that currently have semantic representation in the search text.
     * Used to determine which filters are "linked" (UI changes should update text).
     */
    readonly semanticFilterKeys = computed((): Set<string> => {
        const parsed = this.semanticParsed();
        if (!parsed || parsed.tokens.length === 0) return new Set();
        
        const keys = new Set<string>();
        const gameSystem = this.gameService.currentGameSystem();
        
        for (const token of parsed.tokens) {
            // Find the config for this semantic key
            const conf = ADVANCED_FILTERS.find(f => 
                (f.semanticKey || f.key) === token.field &&
                (!f.game || f.game === gameSystem)
            );
            if (conf) {
                keys.add(conf.key);
            }
        }
        return keys;
    });

    /**
     * Semantic filter state derived from parsed tokens in the search text.
     * This is ALWAYS computed - semantic text is the source of truth for filters it contains.
     */
    private readonly semanticFilterState = computed((): FilterState => {
        const parsed = this.semanticParsed();
        if (!parsed || parsed.tokens.length === 0) return {};
        
        const result = applySemanticQuery(
            this.searchText(),
            this.gameService.currentGameSystem(),
            this.totalRangesCache
        );
        return result.filterState;
    });

    /**
     * Effective filter state - combines manual filterState with semantic filters.
     * - For filters in semantic text: semantic state is used (it's the source of truth)
     * - For filters only in UI: filterState is used
     * - UI filterState for linked filters is kept in sync for display purposes
     */
    readonly effectiveFilterState = computed((): FilterState => {
        const manual = this.filterState();
        const semantic = this.semanticFilterState();
        const semanticKeys = this.semanticFilterKeys();
        
        // Start with manual filters that are NOT in semantic text
        const result: FilterState = {};
        
        for (const [key, state] of Object.entries(manual)) {
            if (!semanticKeys.has(key)) {
                // This filter is UI-only, use it as-is
                result[key] = state;
            }
        }
        
        // Add all semantic filters - they take precedence
        for (const [key, state] of Object.entries(semantic)) {
            result[key] = state;
        }
        
        return result;
    });

    constructor() {
        // Register as a URL state consumer - must call markConsumerReady when done reading URL
        this.urlStateService.registerConsumer('unit-search-filters');
        
        effect(() => {
            if (this.isDataReady()) {
                this.calculateTotalRanges();
            }
        });
        effect(() => {
            this.dataService.tagsVersion(); // depend on tags version
            this.invalidateTagsCache();
        });
        effect(() => {
            const gunnery = this.pilotGunnerySkill();
            const piloting = this.pilotPilotingSkill();

            if (this.isDataReady()) {
                if (this.advOptions()['bv']) {
                    this.recalculateBVRange();
                }
                if (this.advOptions()['as.PV']) {
                    this.recalculatePVRange();
                }
            }
        });
        this.loadFiltersFromUrlOnStartup();
        this.updateUrlOnFiltersChange();
    }

    dynamicInternalLabel = computed(() => {
        const units = this.filteredUnits();
        if (units.length === 0) return 'Structure / Squad Size';
        const hasInfantry = units.some(u => u.type === 'Infantry');
        const hasNonInfantry = units.some(u => u.type !== 'Infantry');
        if (hasInfantry && !hasNonInfantry) return 'Squad Size';
        if (!hasInfantry) return 'Structure';
        return 'Structure / Squad Size';
    });

    searchTokens = computed((): SearchTokensGroup[] => {
        return parseSearchQuery(this.effectiveTextSearch());
    });

    private recalculateBVRange() {
        const units = this.units;
        if (units.length === 0) return;

        const bvValues = units
            .map(u => this.getAdjustedBV(u))
            .filter(bv => bv > 0)
            .sort((a, b) => a - b);

        if (bvValues.length === 0) return;

        const min = bvValues[0];
        const max = bvValues[bvValues.length - 1];

        // Update the totalRangesCache which the computed signal depends on
        this.totalRangesCache['bv'] = [min, max];

        // Adjust current filter value to fit within new range if it exists
        const currentFilter = this.filterState()['bv'];
        if (currentFilter?.interactedWith) {
            const currentValue = currentFilter.value as [number, number];
            const adjustedValue: [number, number] = [
                Math.max(min, currentValue[0]),
                Math.min(max, currentValue[1])
            ];

            // Only update if the value actually changed
            if (adjustedValue[0] !== currentValue[0] || adjustedValue[1] !== currentValue[1]) {
                this.setFilter('bv', adjustedValue);
            }
        }
    }

    private recalculatePVRange() {
        const units = this.units;
        if (units.length === 0) return;

        const pvValues = units
            .map(u => this.getAdjustedPV(u))
            .filter(pv => pv > 0)
            .sort((a, b) => a - b);

        if (pvValues.length === 0) return;

        const min = pvValues[0];
        const max = pvValues[pvValues.length - 1];

        // Update the totalRangesCache which the computed signal depends on
        this.totalRangesCache['as.PV'] = [min, max];
        // Adjust current filter value to fit within new range if it exists
        const currentFilter = this.filterState()['as.PV'];
        if (currentFilter?.interactedWith) {
            const currentValue = currentFilter.value as [number, number];
            const adjustedValue: [number, number] = [
                Math.max(min, currentValue[0]),
                Math.min(max, currentValue[1])
            ];

            // Only update if the value actually changed
            if (adjustedValue[0] !== currentValue[0] || adjustedValue[1] !== currentValue[1]) {
                this.setFilter('as.PV', adjustedValue);
            }
        }
    }

    private calculateTotalRanges() {
        const rangeFilters = ADVANCED_FILTERS.filter(f => f.type === AdvFilterType.RANGE);
        for (const conf of rangeFilters) {
            if (conf.key === 'bv') {
                // Special handling for BV to use adjusted values
                const bvValues = this.units
                    .map(u => this.getAdjustedBV(u))
                    .filter(bv => bv > 0);
                if (bvValues.length > 0) {
                    this.totalRangesCache['bv'] = [Math.min(...bvValues), Math.max(...bvValues)];
                } else {
                    this.totalRangesCache['bv'] = [0, 0];
                }
            } else if (conf.key === 'as.PV') {
                // Special handling for BV to use adjusted values
                const pvValues = this.units
                    .map(u => this.getAdjustedPV(u))
                    .filter(pv => pv > 0);
                if (pvValues.length > 0) {
                    this.totalRangesCache['as.PV'] = [Math.min(...pvValues), Math.max(...pvValues)];
                } else {
                    this.totalRangesCache['as.PV'] = [0, 0];
                }
            } else {
                const allValues = this.getValidFilterValues(this.units, conf);
                if (allValues.length > 0) {
                    this.totalRangesCache[conf.key] = [Math.min(...allValues), Math.max(...allValues)];
                } else {
                    this.totalRangesCache[conf.key] = [0, 0];
                }
            }
        }
    }

    get isDataReady() { return this.dataService.isDataReady; }
    get units() { return this.isDataReady() ? this.dataService.getUnits() : []; }

    public setSortOrder(key: string) {
        this.selectedSort.set(key);
    }

    public setSortDirection(direction: 'asc' | 'desc') {
        this.selectedSortDirection.set(direction);
    }

    private getUnitIdsForSelectedEras(selectedEraNames: string[]): Set<number> | null {
        if (!selectedEraNames || selectedEraNames.length === 0) return null;
        const unitIds = new Set<number>();

        const extinctFaction = this.dataService.getFactions().find(f => f.id === FACTION_EXTINCT);

        for (const eraName of selectedEraNames) {
            const era = this.dataService.getEraByName(eraName);
            if (era) {
                const extinctUnitIdsForEra = extinctFaction?.eras[era.id] as Set<number> || new Set<number>();
                (era.units as Set<number>).forEach(id => {
                    if (!extinctUnitIdsForEra.has(id)) {
                        unitIds.add(id);
                    }
                });
            }
        }
        return unitIds;
    }

    private getUnitIdsForFaction(factionName: string, contextEraIds?: Set<number>): Set<number> {
        const unitIds = new Set<number>();
        const faction = this.dataService.getFactionByName(factionName);
        if (faction) {
            for (const eraIdStr in faction.eras) {
                const eraId = Number(eraIdStr);
                if (!contextEraIds || contextEraIds.has(eraId)) {
                    (faction.eras[eraId] as Set<number>).forEach(id => unitIds.add(id));
                }
            }
        }
        return unitIds;
    }

    private getAllUnitIdsInContext(contextEraIds?: Set<number>): Set<number> {
        if (!contextEraIds || contextEraIds.size === 0) {
            // No era filter, get all unit IDs from the master list
            return new Set(this.units.map(u => u.id));
        }

        // Era filter is present. We can reuse the logic from getUnitIdsForSelectedEras
        const contextEraNames = this.dataService.getEras()
            .filter(e => contextEraIds.has(e.id))
            .map(e => e.name);

        return this.getUnitIdsForSelectedEras(contextEraNames) || new Set<number>();
    }

    private getUnitIdsForSelectedFactions(selectedFactionEntries: MultiStateSelection, contextEraIds?: Set<number>): Set<number> | null {
        const orFactions: string[] = [];
        const andFactions: string[] = [];
        const notFactions: string[] = [];
        for (const [name, selection] of Object.entries(selectedFactionEntries)) {
            if (!selection.state) continue;
            if (selection.state === 'or') orFactions.push(selection.name);
            else if (selection.state === 'and') andFactions.push(selection.name);
            else if (selection.state === 'not') notFactions.push(selection.name);
        }        
        if (orFactions.length === 0 && andFactions.length === 0 && notFactions.length === 0) {
            return null;
        }

        let resultSet: Set<number> | null = null;

        // Handle OR selections to create the base set of unit IDs.
        if (orFactions.length > 0) {
            resultSet = new Set<number>();
            for (const factionName of orFactions) {
                this.getUnitIdsForFaction(factionName, contextEraIds)
                    .forEach(id => resultSet!.add(id));
            }
        }

        // Intersect with AND selections.
        for (const factionName of andFactions) {
            const factionUnitIds = this.getUnitIdsForFaction(factionName, contextEraIds);
            if (resultSet === null) {
                // If no ORs, the first AND sets the initial list.
                resultSet = new Set(factionUnitIds);
            } else {
                // Intersect with the existing results.
                resultSet = new Set([...resultSet].filter(id => factionUnitIds.has(id)));
            }
        }

        // Subtract NOT selections.
        if (notFactions.length > 0) {
            if (resultSet === null) {
                // If no ORs or ANDs, start with all units in context.
                resultSet = this.getAllUnitIdsInContext(contextEraIds);
            }
            for (const factionName of notFactions) {
                this.getUnitIdsForFaction(factionName, contextEraIds)
                    .forEach(id => resultSet!.delete(id));
            }
        }

        return resultSet;
    }

    private applyFilters(units: Unit[], state: FilterState): Unit[] {
        let results = units;
        const activeFilters = Object.entries(state)
            .filter(([, s]) => s.interactedWith)
            .reduce((acc, [key, s]) => ({ ...acc, [key]: s.value }), {} as Record<string, any>);

        const currentGame = this.gameService.currentGameSystem();

        // Handle external (ID-based) filters first
        const selectedEraNames = activeFilters['era'] as string[] || [];
        const selectedFactionEntries = activeFilters['faction'] as MultiStateSelection || {};

        let eraUnitIds: Set<number> | null = null;
        let factionUnitIds: Set<number> | null = null;
        if (Object.values(selectedFactionEntries).some(s => s.state)) {
            const selectedEraIds = new Set(this.dataService.getEras().filter(e => selectedEraNames.includes(e.name)).map(e => e.id));
            factionUnitIds = this.getUnitIdsForSelectedFactions(selectedFactionEntries, selectedEraIds.size > 0 ? selectedEraIds : undefined);
        } else
            if (selectedEraNames.length > 0) {
                eraUnitIds = this.getUnitIdsForSelectedEras(selectedEraNames);
            }

        if (eraUnitIds || factionUnitIds) {
            let finalIds: Set<number> | null;
            if (eraUnitIds && factionUnitIds) {
                finalIds = new Set([...eraUnitIds].filter(id => factionUnitIds!.has(id)));
            } else {
                finalIds = eraUnitIds || factionUnitIds;
            }
            results = results.filter(u => finalIds!.has(u.id));
        }

        // Handle forcePack filter (chassis-based)
        const selectedForcePackNames = activeFilters['forcePack'] as string[] || [];
        if (selectedForcePackNames.length > 0) {
            const chassisTypeSet = new Set<string>();
            for (const packName of selectedForcePackNames) {
                const pack = getForcePacks().find(p => p.name === packName);
                if (pack) {
                    for (const packUnit of pack.units) {
                        // Find the full Unit object by name to get its type
                        const fullUnit = this.units.find(u => u.name === packUnit.name);
                        if (fullUnit) {
                            // Create a composite key of chassis + type
                            const key = `${fullUnit.chassis}|${fullUnit.type}`;
                            chassisTypeSet.add(key);
                        }
                    }
                }
            }
            results = results.filter(u => {
                const key = `${u.chassis}|${u.type}`;
                return chassisTypeSet.has(key);
            });
        }

        // Handle standard (property-based) filters
        for (const conf of ADVANCED_FILTERS) {
            if (conf.game && conf.game !== currentGame) continue;
            if (conf.external) continue;

            const filterState = state[conf.key];
            // Only apply filter if it has been interacted with
            if (!filterState || !filterState.interactedWith) continue;

            const val = filterState.value;
            const wildcardPatterns = filterState.wildcardPatterns;

            if (conf.type === AdvFilterType.DROPDOWN && conf.multistate && val && typeof val === 'object') {
                if (!conf.external) {
                    results = filterUnitsByMultiState(results, conf.key, val, wildcardPatterns);
                    continue;
                }
            }

            // Handle text matching filters (invisible filters like name, chassis, model)
            if (conf.type === AdvFilterType.DROPDOWN && conf.textMatch && val) {
                const searchTerms: string[] = Array.isArray(val) ? val : (typeof val === 'object' ? Object.keys(val) : [String(val)]);
                if (searchTerms.length > 0) {
                    results = results.filter(u => {
                        const unitValue = getProperty(u, conf.key);
                        if (!unitValue) return false;
                        const unitStr = String(unitValue).toLowerCase();
                        // Any of the search terms must match (substring, case-insensitive)
                        return searchTerms.some(term => unitStr.includes(term.toLowerCase()));
                    });
                }
                continue;
            }

            if (conf.type === AdvFilterType.DROPDOWN && (Array.isArray(val) || wildcardPatterns?.length)) {
                // Handle regular dropdown with possible wildcards
                const hasRegularValues = Array.isArray(val) && val.length > 0;
                const hasWildcards = wildcardPatterns && wildcardPatterns.length > 0;
                
                if (hasRegularValues || hasWildcards) {
                    results = results.filter(u => {
                        const v = getProperty(u, conf.key);
                        const unitValues = Array.isArray(v) ? v : [v];
                        
                        // Check regular values first
                        if (hasRegularValues) {
                            for (const uv of unitValues) {
                                if (val.includes(uv)) return true;
                            }
                        }
                        
                        // Check wildcard patterns
                        if (hasWildcards) {
                            for (const p of wildcardPatterns!) {
                                if (p.state === 'or') {
                                    const regex = wildcardToRegex(p.pattern);
                                    for (const uv of unitValues) {
                                        if (uv && regex.test(String(uv))) return true;
                                    }
                                }
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
                
                // Helper function to check if value is in any exclude range
                const isExcluded = (v: number): boolean => {
                    if (!excludeRanges) return false;
                    return excludeRanges.some(([exMin, exMax]) => v >= exMin && v <= exMax);
                };

                // Helper function to check if value is in any include range (when specified)
                const isIncluded = (v: number): boolean => {
                    if (!includeRanges) {
                        // No specific include ranges, use the min/max from value
                        return v >= val[0] && v <= val[1];
                    }
                    // Check if value is in any of the include ranges
                    return includeRanges.some(([incMin, incMax]) => v >= incMin && v <= incMax);
                };
                
                // Special handling for BV range to use adjusted values
                if (conf.key === 'bv') {
                    results = results.filter(u => {
                        const adjustedBV = this.getAdjustedBV(u);
                        if (isExcluded(adjustedBV)) return false;
                        return isIncluded(adjustedBV);
                    });
                } else if (conf.key === 'as.PV') {
                    results = results.filter(u => {
                        const adjustedPV = this.getAdjustedPV(u);
                        if (isExcluded(adjustedPV)) return false;
                        return isIncluded(adjustedPV);
                    });
                } else {
                    results = results.filter(u => {
                        const unitValue = getProperty(u, conf.key);
                        if (conf.ignoreValues && conf.ignoreValues.includes(unitValue)) {
                            if (val[0] === 0) return true; // If the range starts at 0, we allow -1 values
                            return false; // Ignore this unit if it has an ignored value
                        }
                        if (isExcluded(unitValue)) return false;
                        return unitValue != null && isIncluded(unitValue);
                    });
                }
                continue;
            }
        }
        return results;
    }

    filteredUnitsBySearchTextTokens = computed(() => {
        if (!this.isDataReady()) return [];
        const searchTokens = this.searchTokens();
        if (searchTokens.length === 0) return this.units;

        return this.units.filter(unit =>
            matchesSearch(`${unit._chassis ?? ''} ${unit._model ?? ''}`, searchTokens, true)
        );
    });

    // All filters applied
    filteredUnits = computed(() => {
        if (!this.isDataReady()) return [];

        let results = this.filteredUnitsBySearchTextTokens();
        results = this.applyFilters(results, this.effectiveFilterState());

        const sortKey = this.selectedSort();
        const sortDirection = this.selectedSortDirection();

        const sorted = [...results];

        // Precompute relevance scores once per sort (avoids recomputing inside comparator).
        let relevanceScores: WeakMap<Unit, number> | null = null;
        if (sortKey === '') {
            const tokens = this.searchTokens();
            relevanceScores = new WeakMap<Unit, number>();
            for (const u of sorted) {
                const chassis = (u._chassis ?? u.chassis ?? '') as string;
                const model = (u._model ?? u.model ?? '') as string;
                relevanceScores.set(u, computeRelevanceScore(chassis, model, tokens));
            }
        }

        sorted.sort((a: Unit, b: Unit) => {
            let comparison = 0;

            if (sortKey === '') {
                const aScore = relevanceScores?.get(a) ?? 0;
                const bScore = relevanceScores?.get(b) ?? 0;

                // Higher score = more relevant. Default sort direction is 'asc',
                // but for relevance we want best-first by default.
                comparison = bScore - aScore;

                if (comparison === 0) {
                    comparison = compareUnitsByName(a, b);
                }
            } else if (sortKey === 'name') {
                comparison = compareUnitsByName(a, b);
            } else if (sortKey === 'bv') {
                // Use adjusted BV for sorting
                const aBv = this.getAdjustedBV(a);
                const bBv = this.getAdjustedBV(b);
                comparison = aBv - bBv;
            } else if (sortKey === 'as.PV') {
                // Use adjusted PV for sorting
                const aPv = this.getAdjustedPV(a);
                const bPv = this.getAdjustedPV(b);
                comparison = aPv - bPv;
            } else if (sortKey in a && sortKey in b) {
                const key = sortKey as keyof Unit;
                const aValue = a[key];
                const bValue = b[key];
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    comparison = naturalCompare(aValue, bValue);
                }
                if (typeof aValue === 'number' && typeof bValue === 'number') {
                    comparison = aValue - bValue;
                }
            }

            if (sortDirection === 'desc') {
                return -comparison;
            }
            return comparison;
        });

        return sorted;
    });

    // Advanced filter options
    advOptions = computed(() => {
        if (!this.isDataReady()) return {};

        const result: Record<string, AdvFilterOptions> = {};
        const state = this.effectiveFilterState();
        const _tagsVersion = this.tagsVersion();

        let baseUnits = this.filteredUnitsBySearchTextTokens();
        const activeFilters = Object.entries(state)
            .filter(([, s]) => s.interactedWith)
            .reduce((acc, [key, s]) => ({ ...acc, [key]: s.value }), {} as Record<string, any>);

        const selectedEraNames = activeFilters['era'] as string[] || [];
        const selectedFactionEntries = activeFilters['faction'] as MultiStateSelection || {};
        const selectedFactionNames: string[] = Object.entries(selectedFactionEntries)
            .filter(([_, sel]) => sel.state !== 'not')
            .map(([name, _]) => name);

        for (const conf of ADVANCED_FILTERS) {
            // Skip invisible filters (they're only available via semantic mode)
            if (conf.invisible) continue;

            let label = conf.label;
            if (conf.key === 'internal') {
                label = this.dynamicInternalLabel();
            }
            const contextState = { ...state };
            delete contextState[conf.key];
            let contextUnits = this.applyFilters(baseUnits, contextState);
            let availableOptions: { name: string, img?: string }[] = [];
            if (conf.type === AdvFilterType.DROPDOWN) {
                if (conf.external) {
                    const contextUnitIds = new Set(contextUnits.filter(u => u.id !== -1).map(u => u.id));
                    if (conf.key === 'era') {
                        const selectedFactionsAvailableEraIds: Set<number> = new Set(
                            this.dataService.getFactions()
                                .filter(faction => selectedFactionNames.includes(faction.name))
                                .flatMap(faction =>
                                    Object.entries(faction.eras)
                                        .filter(([_, unitIds]) => unitIds.size > 0)
                                        .map(([eraId]) => Number(eraId))
                                )
                        );
                        availableOptions = this.dataService.getEras()
                            .filter(era => {
                                if (selectedFactionsAvailableEraIds.size > 0) {
                                    if (!selectedFactionsAvailableEraIds.has(era.id)) return false;
                                }
                                return [...(era.units as Set<number>)].some(id => contextUnitIds.has(id))
                            }).map(era => ({ name: era.name, img: era.img }));
                    } else 
                    if (conf.key === 'faction') {
                        const selectedEraIds: Set<number> = new Set(this.dataService.getEras().filter(e => selectedEraNames.includes(e.name)).map(e => e.id));
                        availableOptions = this.dataService.getFactions()
                            .filter(faction => {
                                for (const eraIdStr in faction.eras) {
                                    if (selectedEraIds.size > 0) {
                                        if (!selectedEraIds.has(Number(eraIdStr))) continue;
                                    }
                                    if ([...(faction.eras[eraIdStr] as Set<number>)].some(id => contextUnitIds.has(id))) return true;
                                }
                                return false;
                            })
                            .map(faction => ({ name: faction.name, img: faction.img }));
                    } else if (conf.key === 'forcePack') {
                        // Build a set of unit names from context units for quick lookup
                        const contextUnitNames = new Set(contextUnits.map(u => u.name));
                        availableOptions = getForcePacks()
                            .filter(pack => pack.units.some(pu => {
                                const unit = this.dataService.getUnitByName(pu.name);
                                return unit && contextUnitNames.has(unit.name);
                            }))
                            .map(pack => ({ name: pack.name }));
                    }
                }
                else if (conf.multistate) {
                    const isComponentFilter = conf.key === 'componentName';
                    const isTagsFilter = conf.key === '_tags';
                    const currentFilter = state[conf.key];
                    const hasQuantityFilters = conf.countable && isComponentFilter
                        && currentFilter?.interactedWith && currentFilter.value &&
                        Object.values(currentFilter.value as MultiStateSelection).some(selection => selection.count > 1);

                    const namesCacheKey = isTagsFilter
                        ? `${conf.key}-${contextUnits.length}-${JSON.stringify(currentFilter?.value || {})}-${_tagsVersion}`
                        : `${conf.key}-${contextUnits.length}-${JSON.stringify(currentFilter?.value || {})}`;

                    let availableNames = this.availableNamesCache.get(namesCacheKey);
                    if (!availableNames) {
                        // Collect unique values efficiently
                        const nameSet = new Set<string>();

                        if (isComponentFilter) {
                            for (const unit of contextUnits) {
                                for (const component of unit.comp) {
                                    nameSet.add(component.n);
                                }
                            }
                        } else {
                            for (const unit of contextUnits) {
                                const propValue = getProperty(unit, conf.key);
                                const values = Array.isArray(propValue) ? propValue : [propValue];
                                for (const value of values) {
                                    if (value) nameSet.add(value);
                                }
                            }
                        }

                        availableNames = Array.from(nameSet);
                        this.availableNamesCache.set(namesCacheKey, availableNames);
                    }

                    let filteredAvailableNames = availableNames;

                    if (currentFilter?.interactedWith && currentFilter.value) {
                        const selection = currentFilter.value as MultiStateSelection;
                        const andEntries = Object.entries(selection).filter(([_, sel]) => sel.state === 'and');

                        if (andEntries.length > 0) {
                            const andMap = new Map(andEntries.map(([name, sel]) => [name, sel.count]));
                            const notSet = new Set(
                                Object.entries(selection)
                                    .filter(([_, sel]) => sel.state === 'not')
                                    .map(([name]) => name)
                            );

                            // Pre-filter units that satisfy AND conditions
                            const validUnits = contextUnits.filter(unit => {
                                if (isComponentFilter) {
                                    const cached = getUnitComponentData(unit);

                                    // Check NOT conditions
                                    for (const notName of notSet) {
                                        if (cached.componentNames.has(notName)) return false;
                                    }

                                    // Check AND conditions
                                    for (const [name, requiredCount] of andMap) {
                                        if ((cached.componentCounts.get(name) || 0) < requiredCount) return false;
                                    }
                                } else {
                                    // Handle other properties (simplified for brevity)
                                    const propValue = getProperty(unit, conf.key);
                                    const values = Array.isArray(propValue) ? propValue : [propValue];
                                    const valueSet = new Set(values);

                                    for (const notName of notSet) {
                                        if (valueSet.has(notName)) return false;
                                    }

                                    for (const [name] of andMap) {
                                        if (!valueSet.has(name)) return false;
                                    }
                                }
                                return true;
                            });

                            // Collect available names from valid units
                            const filteredNameSet = new Set<string>();
                            for (const unit of validUnits) {
                                if (isComponentFilter) {
                                    for (const component of unit.comp) {
                                        filteredNameSet.add(component.n);
                                    }
                                } else {
                                    const propValue = getProperty(unit, conf.key);
                                    const values = Array.isArray(propValue) ? propValue : [propValue];
                                    for (const value of values) {
                                        if (value) filteredNameSet.add(value);
                                    }
                                }
                            }
                            filteredAvailableNames = Array.from(filteredNameSet);
                        }
                    }

                    const sortedNames = sortAvailableDropdownOptions(availableNames);
                    const filteredSet = new Set(filteredAvailableNames);

                    // Create options with availability flag and count
                    const optionsWithAvailability = sortedNames.map(name => {
                        const option: { name: string; available: boolean; count?: number } = {
                            name,
                            available: filteredSet.has(name)
                        };

                        // Add count only if needed and for component filters
                        if (hasQuantityFilters) {
                            let totalCount = 0;
                            for (const unit of contextUnits) {
                                const cached = getUnitComponentData(unit);
                                totalCount += cached.componentCounts.get(name) || 0;
                            }
                            option.count = totalCount;
                        }

                        return option;
                    });

                    // Check for semantic-only mode (advanced quantity constraints or wildcard patterns)
                    const filterStateEntry = state[conf.key];
                    const currentFilterValue = filterStateEntry?.interactedWith ? filterStateEntry.value : {};
                    const currentSelection = currentFilterValue as MultiStateSelection;
                    const wildcardPatternsMultistate = filterStateEntry?.wildcardPatterns;
                    let semanticOnlyMultistate = false;
                    let displayTextMultistate: string | undefined;
                    
                    // Check for wildcard patterns first
                    if (wildcardPatternsMultistate && wildcardPatternsMultistate.length > 0) {
                        semanticOnlyMultistate = true;
                        const wildcardTexts = wildcardPatternsMultistate.map(wp => {
                            const prefix = wp.state === 'not' ? '!' : (wp.state === 'and' ? '&' : '');
                            return prefix + wp.pattern;
                        });
                        // Also include any regular selections
                        if (currentSelection && typeof currentSelection === 'object') {
                            const selectionTexts = Object.entries(currentSelection)
                                .filter(([_, sel]) => sel.state !== false)
                                .map(([name, sel]) => {
                                    const prefix = sel.state === 'not' ? '!' : (sel.state === 'and' ? '&' : '');
                                    return prefix + name;
                                });
                            displayTextMultistate = [...wildcardTexts, ...selectionTexts].join(', ');
                        } else {
                            displayTextMultistate = wildcardTexts.join(', ');
                        }
                    } else if (currentSelection && typeof currentSelection === 'object') {
                        const activeSelections = Object.entries(currentSelection)
                            .filter(([_, sel]) => sel.state !== false);
                        
                        // Check for quantity constraints that can't be shown in UI
                        // UI can only represent: no operator (implicit >=1) or >= operator
                        // Semantic-only: =, !=, >, <, <=, ranges, merged ranges
                        const hasAdvancedQuantity = activeSelections.some(([_, sel]) => {
                            // Has merged ranges → semantic-only
                            if (sel.countIncludeRanges || sel.countExcludeRanges) return true;
                            // Has countMax (range) → semantic-only
                            if (sel.countMax !== undefined) return true;
                            // Has operator that isn't >= → semantic-only
                            if (sel.countOperator && sel.countOperator !== '>=') return true;
                            return false;
                        });
                        
                        if (hasAdvancedQuantity) {
                            semanticOnlyMultistate = true;
                            displayTextMultistate = activeSelections.map(([name, sel]) => {
                                const prefix = sel.state === 'not' ? '!' : '';
                                let suffix = '';
                                
                                // For single constraint, prefer showing original operator/count
                                // Only use ranges for display when there are multiple merged constraints
                                if (sel.countOperator && sel.countOperator !== '=') {
                                    // Single constraint with operator - show as written
                                    if (sel.countMax !== undefined) {
                                        // Range constraint like :3-5
                                        const rangePrefix = sel.countOperator === '!=' ? '!' : '';
                                        suffix = `:${rangePrefix}${sel.count}-${sel.countMax}`;
                                    } else {
                                        // Operator constraint like :>3 or :>=4
                                        suffix = `:${sel.countOperator}${sel.count}`;
                                    }
                                } else if (sel.countIncludeRanges || sel.countExcludeRanges) {
                                    // Multiple merged constraints - use ranges for display
                                    const parts: string[] = [];
                                    if (sel.countIncludeRanges) {
                                        for (const [min, max] of sel.countIncludeRanges) {
                                            if (min === max) {
                                                parts.push(`${min}`);
                                            } else if (max === Infinity) {
                                                parts.push(`>=${min}`);
                                            } else {
                                                parts.push(`${min}-${max}`);
                                            }
                                        }
                                    }
                                    if (sel.countExcludeRanges) {
                                        for (const [min, max] of sel.countExcludeRanges) {
                                            if (min === max) {
                                                parts.push(`!${min}`);
                                            } else {
                                                parts.push(`!${min}-${max}`);
                                            }
                                        }
                                    }
                                    if (parts.length > 0) {
                                        suffix = `:${parts.join(',')}`;
                                    }
                                } else if (sel.count > 1) {
                                    suffix = `:${sel.count}`;
                                }
                                
                                return prefix + name + suffix;
                            }).join(', ');
                        }
                    }

                    result[conf.key] = {
                        type: 'dropdown',
                        label,
                        options: optionsWithAvailability,
                        value: currentFilterValue,
                        interacted: filterStateEntry?.interactedWith ?? false,
                        semanticOnly: semanticOnlyMultistate,
                        displayText: displayTextMultistate
                    };
                    continue;
                } else {
                    let allOptions: string[];
                    // For source filter, flatten the array of sources per unit
                    if (conf.key === 'source') {
                        allOptions = Array.from(new Set(contextUnits
                            .flatMap(u => {
                                const val = getProperty(u, conf.key);
                                return Array.isArray(val) ? val : (val ? [val] : []);
                            })
                            .filter(v => v != null && v !== '')));
                    } else {
                        allOptions = Array.from(new Set(contextUnits
                            .map(u => getProperty(u, conf.key))
                            .filter(v => v != null && v !== '')));
                    }
                    const sortedOptions = sortAvailableDropdownOptions(allOptions, conf.sortOptions);
                    
                    // For source filter, add displayName from sourcebook lookup
                    if (conf.key === 'source') {
                        availableOptions = sortedOptions.map(name => ({
                            name,
                            displayName: this.dataService.getSourcebookTitle(name)
                        }));
                    } else {
                        availableOptions = sortedOptions.map(name => ({ name }));
                    }
                }
                
                // Get the filter state value
                const filterStateEntry = state[conf.key];
                const isInteracted = filterStateEntry?.interactedWith ?? false;
                const filterValue = isInteracted ? filterStateEntry.value : [];
                
                // Check for semantic-only: values in the filter that aren't in available options,
                // OR if there are wildcard patterns (which are always semantic-only)
                let semanticOnly = filterStateEntry?.semanticOnly ?? false;
                let displayText: string | undefined;
                const availableOptionNames = new Set(availableOptions.map(o => o.name));
                const wildcardPatterns = filterStateEntry?.wildcardPatterns;
                
                // If there are wildcard patterns, this is semantic-only
                if (wildcardPatterns && wildcardPatterns.length > 0) {
                    semanticOnly = true;
                    displayText = wildcardPatterns.map(wp => {
                        const prefix = wp.state === 'not' ? '!' : '';
                        return prefix + wp.pattern;
                    }).join(', ');
                } else if (conf.multistate) {
                    // For multistate dropdowns, check MultiStateSelection
                    const selection = filterValue as MultiStateSelection;
                    if (selection && typeof selection === 'object') {
                        const activeSelections = Object.entries(selection)
                            .filter(([_, sel]) => sel.state !== false);
                        const unavailableSelections = activeSelections
                            .filter(([name, _]) => !availableOptionNames.has(name));
                        
                        // Check for quantity constraints that can't be shown in UI
                        // UI can only represent: no operator (implicit >=1) or >= operator
                        const hasAdvancedQuantity = activeSelections.some(([_, sel]) => {
                            if (sel.countIncludeRanges || sel.countExcludeRanges) return true;
                            if (sel.countMax !== undefined) return true;
                            if (sel.countOperator && sel.countOperator !== '>=') return true;
                            return false;
                        });
                        
                        if ((unavailableSelections.length > 0 && unavailableSelections.length === activeSelections.length) || hasAdvancedQuantity) {
                            // Semantic only mode - either unavailable values or advanced quantity constraints
                            semanticOnly = true;
                            displayText = activeSelections.map(([name, sel]) => {
                                const prefix = sel.state === 'not' ? '!' : '';
                                let suffix = '';
                                if (conf.countable) {
                                    // For single constraint, prefer showing original operator/count
                                    // Only use ranges for display when there are multiple merged constraints
                                    if (sel.countOperator && sel.countOperator !== '=') {
                                        // Single constraint with operator - show as written
                                        if (sel.countMax !== undefined) {
                                            // Range constraint like :3-5
                                            const rangePrefix = sel.countOperator === '!=' ? '!' : '';
                                            suffix = `:${rangePrefix}${sel.count}-${sel.countMax}`;
                                        } else {
                                            // Operator constraint like :>3 or :>=4
                                            suffix = `:${sel.countOperator}${sel.count}`;
                                        }
                                    } else if (sel.countIncludeRanges || sel.countExcludeRanges) {
                                        // Multiple merged constraints - use ranges for display
                                        const parts: string[] = [];
                                        if (sel.countIncludeRanges) {
                                            for (const [min, max] of sel.countIncludeRanges) {
                                                if (min === max) {
                                                    parts.push(`${min}`);
                                                } else if (max === Infinity) {
                                                    parts.push(`>=${min}`);
                                                } else {
                                                    parts.push(`${min}-${max}`);
                                                }
                                            }
                                        }
                                        if (sel.countExcludeRanges) {
                                            for (const [min, max] of sel.countExcludeRanges) {
                                                if (min === max) {
                                                    parts.push(`!${min}`);
                                                } else {
                                                    parts.push(`!${min}-${max}`);
                                                }
                                            }
                                        }
                                        if (parts.length > 0) {
                                            suffix = `:${parts.join(',')}`;
                                        }
                                    } else if (sel.count > 1) {
                                        suffix = `:${sel.count}`;
                                    }
                                }
                                return prefix + name + suffix;
                            }).join(', ');
                        }
                    }
                } else {
                    // For regular dropdowns, check string array
                    const selectedValues = filterValue as string[];
                    if (selectedValues && Array.isArray(selectedValues) && selectedValues.length > 0) {
                        const unavailableValues = selectedValues.filter(v => !availableOptionNames.has(v));
                        if (unavailableValues.length > 0 && unavailableValues.length === selectedValues.length) {
                            // All selected values are unavailable - semantic only mode
                            semanticOnly = true;
                            displayText = unavailableValues.join(', ');
                        }
                    }
                }
                
                result[conf.key] = {
                    type: 'dropdown',
                    label,
                    options: availableOptions,
                    value: filterValue,
                    interacted: isInteracted,
                    semanticOnly,
                    displayText
                };
            }
            else if (conf.type === AdvFilterType.RANGE) {
                const totalRange = this.totalRangesCache[conf.key] || [0, 0];

                // Special handling for BV to use adjusted values
                let vals: number[];
                if (conf.key === 'bv') {
                    vals = contextUnits
                        .map(u => this.getAdjustedBV(u))
                        .filter(bv => bv > 0);
                } else if (conf.key === 'as.PV') {
                    vals = contextUnits
                        .map(u => this.getAdjustedPV(u))
                        .filter(pv => pv > 0);
                } else {
                    vals = this.getValidFilterValues(contextUnits, conf);
                }

                const availableRange = vals.length ? [Math.min(...vals), Math.max(...vals)] : totalRange;

                // Get the original filter value (before clamping) for visualization
                const filterStateEntry = state[conf.key];
                const isInteracted = filterStateEntry?.interactedWith ?? false;
                const originalValue: [number, number] = isInteracted ? filterStateEntry.value : availableRange;

                // Clamp both min and max to the available range for thumb positions
                let clampedMin = Math.max(availableRange[0], Math.min(originalValue[0], availableRange[1]));
                let clampedMax = Math.min(availableRange[1], Math.max(originalValue[1], availableRange[0]));
                if (clampedMin > clampedMax) [clampedMin, clampedMax] = [clampedMax, clampedMin];
                const clampedValue: [number, number] = [clampedMin, clampedMax];

                // Get semantic-only properties from filter state
                const semanticOnly = filterStateEntry?.semanticOnly ?? false;
                
                // For visualization: show the ORIGINAL set range (before clamping) as includeRanges
                // If semantic has multiple disjoint ranges, use those; otherwise use original value
                const semanticIncludeRanges = filterStateEntry?.includeRanges;
                const includeRanges: [number, number][] | undefined = 
                    semanticIncludeRanges ?? (isInteracted ? [originalValue] : undefined);
                
                const excludeRanges = filterStateEntry?.excludeRanges;
                const displayText = filterStateEntry?.displayText;

                result[conf.key] = {
                    type: 'range',
                    label,
                    totalRange: totalRange,
                    options: availableRange as [number, number],
                    value: clampedValue,
                    interacted: isInteracted,
                    semanticOnly,
                    includeRanges,
                    excludeRanges,
                    displayText
                };
            }
        }
        return result;
    });


    private getValidFilterValues(units: Unit[], conf: AdvFilterConfig): number[] {
        let vals = units
            .map(u => getProperty(u, conf.key))
            .filter(v => typeof v === 'number') as number[];
        if (conf.ignoreValues && conf.ignoreValues.length > 0) {
            vals = vals.filter(v => !conf.ignoreValues!.includes(v));
        }
        return vals;
    }

    private loadFiltersFromUrlOnStartup() {
        effect(() => {
            const isDataReady = this.dataService.isDataReady();
            if (isDataReady && !this.urlStateInitialized) {
                // Use UrlStateService to get initial URL params (captured before any routing effects)
                let hasFilters = false;
                
                // Load search query (may contain semantic filters)
                const searchParam = this.urlStateService.getInitialParam('q');
                if (searchParam) {
                    this.searchText.set(decodeURIComponent(searchParam));
                    hasFilters = true;
                }

                // Load sort settings
                const sortParam = this.urlStateService.getInitialParam('sort');
                if (sortParam && SORT_OPTIONS.some(opt => opt.key === sortParam)) {
                    this.selectedSort.set(sortParam);
                }

                const sortDirParam = this.urlStateService.getInitialParam('sortDir');
                if (sortDirParam === 'desc' || sortDirParam === 'asc') {
                    this.selectedSortDirection.set(sortDirParam);
                }

                // Load UI filters from filters param (these are separate from semantic filters in q)
                const filtersParam = this.urlStateService.getInitialParam('filters');
                if (filtersParam) {
                    hasFilters = true;
                    try {
                        const parsedFilters = this.parseCompactFiltersFromUrl(filtersParam);
                        const validFilters: FilterState = {};

                        for (const [key, state] of Object.entries(parsedFilters)) {
                            const conf = ADVANCED_FILTERS.find(f => f.key === key);
                            if (!conf) continue; // Skip unknown filter keys

                            if (conf.type === AdvFilterType.DROPDOWN) {
                                // Get all available values for this dropdown
                                const availableValues = this.getAvailableDropdownValues(conf);

                                if (conf.multistate) {
                                    const selection = state.value as MultiStateSelection;
                                    const validSelection: MultiStateSelection = {};

                                    for (const [name, selectionValue] of Object.entries(selection)) {
                                        if (availableValues.has(name)) {
                                            validSelection[name] = selectionValue;
                                        }
                                    }

                                    if (Object.keys(validSelection).length > 0) {
                                        validFilters[key] = { value: validSelection, interactedWith: true };
                                    }
                                } else {
                                    const values = state.value as string[];
                                    const validValues = values.filter(v => availableValues.has(v));

                                    if (validValues.length > 0) {
                                        validFilters[key] = { value: validValues, interactedWith: true };
                                    }
                                }
                            } else {
                                // For range filters, just keep them as-is
                                // They'll be clamped automatically by advOptions
                                validFilters[key] = state;
                            }
                        }
                        this.filterState.set(validFilters);
                    } catch (error) {
                        this.logger.warn('Failed to parse filters from URL: ' + error);
                    }
                }

                const expandedParam = this.urlStateService.getInitialParam('expanded');
                const suggestExpanded = !this.urlStateService.hasInitialParam('instance') && !this.urlStateService.hasInitialParam('units') && hasFilters;
                if (expandedParam === 'true' || suggestExpanded) {
                    this.expandedView.set(true);
                }

                if (this.urlStateService.hasInitialParam('gunnery')) {
                    const gunneryParam = this.urlStateService.getInitialParam('gunnery');
                    if (gunneryParam) {
                        const gunnery = parseInt(gunneryParam);
                        if (!isNaN(gunnery) && gunnery >= 0 && gunnery <= 8) {
                            this.pilotGunnerySkill.set(gunnery);
                        }
                    }
                }

                if (this.urlStateService.hasInitialParam('piloting')) {
                    const pilotingParam = this.urlStateService.getInitialParam('piloting');
                    if (pilotingParam) {
                        const piloting = parseInt(pilotingParam);
                        if (!isNaN(piloting) && piloting >= 0 && piloting <= 8) {
                            this.pilotPilotingSkill.set(piloting);
                        }
                    }
                }
                this.urlStateInitialized = true;
                // Signal that we're done reading URL state
                this.urlStateService.markConsumerReady('unit-search-filters');
            }
        });
    }

    private getAvailableDropdownValues(conf: AdvFilterConfig): Set<string> {
        const values = new Set<string>();

        if (conf.external) {
            if (conf.key === 'era') {
                this.dataService.getEras().forEach(era => values.add(era.name));
            } else if (conf.key === 'faction') {
                this.dataService.getFactions().forEach(faction => values.add(faction.name));
            }
        } else {
            if (conf.key === 'componentName') {
                for (const unit of this.units) {
                    for (const component of unit.comp) {
                        values.add(component.n);
                    }
                }
            } else {
                for (const unit of this.units) {
                    const propValue = getProperty(unit, conf.key);
                    if (Array.isArray(propValue)) {
                        propValue.forEach(v => { if (v != null && v !== '') values.add(v); });
                    } else if (propValue != null && propValue !== '') {
                        values.add(propValue);
                    }
                }
            }
        }

        return values;
    }

    queryParameters = computed(() => {
        const search = this.searchText();
        const filterState = this.filterState();
        const semanticKeys = this.semanticFilterKeys();
        const selectedSort = this.selectedSort();
        const selectedSortDirection = this.selectedSortDirection();
        const expanded = this.expandedView();
        const gunnery = this.pilotGunnerySkill();
        const piloting = this.pilotPilotingSkill();

        const queryParams: any = {};

        // Add search query if present (contains semantic filters)
        queryParams.q = search.trim() ? encodeURIComponent(search.trim()) : null;
        
        // UI-only filters (not in semantic text) are saved in filters param
        // Exclude any filters that are represented in semantic text
        const uiOnlyFilters: FilterState = {};
        for (const [key, state] of Object.entries(filterState)) {
            if (!semanticKeys.has(key)) {
                uiOnlyFilters[key] = state;
            }
        }
        const filtersParam = this.generateCompactFiltersParam(uiOnlyFilters);
        queryParams.filters = filtersParam ? filtersParam : null;

        // Add sort if not default
        queryParams.sort = (selectedSort !== '') ? selectedSort : null;
        queryParams.sortDir = (selectedSortDirection !== 'asc') ? selectedSortDirection : null;

        
        // Add pilot skills if not default
        queryParams.gunnery = (gunnery !== 4) ? gunnery : null;
        queryParams.piloting = (piloting !== 5) ? piloting : null;

        queryParams.expanded = (expanded ? 'true' : null);
        return queryParams;
    });


    private updateUrlOnFiltersChange() {
        effect(() => {
            const queryParameters = this.queryParameters();
            if (!this.urlStateInitialized) {
                return;
            }
            this.router.navigate([], {
                relativeTo: this.route,
                queryParams: Object.keys(queryParameters).length > 0 ? queryParameters : {},
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        });
    }

    private generateCompactFiltersParam(state: FilterState): string | null {
        const parts: string[] = [];

        for (const [key, filterState] of Object.entries(state)) {
            if (!filterState.interactedWith) continue;

            const conf = ADVANCED_FILTERS.find(f => f.key === key);
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
                            // URL encode names that might contain spaces or special characters
                            let part = encodeURIComponent(name);

                            // Use single characters for states
                            if (selectionValue.state === 'and') part += '.';
                            else if (selectionValue.state === 'not') part += '!';
                            // 'or' state is default, no suffix needed


                            if (selectionValue.count > 1) {
                                part += `~${selectionValue.count}`;
                            }
                            subParts.push(part);
                        }
                    }

                    if (subParts.length > 0) {
                        parts.push(`${key}:${subParts.join(',')}`);
                    }
                } else {
                    const values = filterState.value as string[];
                    if (values.length > 0) {
                        // URL encode each value to handle spaces and special characters
                        const encodedValues = values.map(v => encodeURIComponent(v));
                        parts.push(`${key}:${encodedValues.join(',')}`);
                    }
                }
            }
        }

        return parts.length > 0 ? parts.join('|') : null;
    }

    private parseCompactFiltersFromUrl(filtersParam: string): FilterState {
        const filterState: FilterState = {};

        try {
            const parts = filtersParam.split('|');

            for (const part of parts) {
                const colonIndex = part.indexOf(':');
                if (colonIndex === -1) continue;

                const key = part.substring(0, colonIndex);
                const valueStr = part.substring(colonIndex + 1);

                const conf = ADVANCED_FILTERS.find(f => f.key === key);
                if (!conf) continue;

                if (conf.type === AdvFilterType.RANGE) {
                    const match = valueStr.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
                    if (match) {
                        const min = parseFloat(match[1]);
                        const max = parseFloat(match[2]);
                        if (!isNaN(min) && !isNaN(max)) {
                            filterState[key] = {
                                value: [min, max],
                                interactedWith: true
                            };
                        }
                    }
                } else if (conf.type === AdvFilterType.DROPDOWN) {
                    if (conf.multistate) {
                        const selection: MultiStateSelection = {};
                        const items = valueStr.split(',');

                        for (const item of items) {
                            let encodedName = item;
                            let state: MultiState = 'or';
                            let count = 1;

                            // Parse count first
                            const starIndex = encodedName.indexOf('~');
                            if (starIndex !== -1) {
                                count = parseInt(encodedName.substring(starIndex + 1)) || 1;
                                encodedName = encodedName.substring(0, starIndex);
                            }

                            // Parse state suffix
                            if (encodedName.endsWith('.')) {
                                state = 'and';
                                encodedName = encodedName.slice(0, -1);
                            } else if (encodedName.endsWith('!')) {
                                state = 'not';
                                encodedName = encodedName.slice(0, -1);
                            } else {
                                state = 'or'; // default state
                            }

                            // Decode the name to restore spaces and special characters
                            const name = decodeURIComponent(encodedName);
                            selection[name] = { name, state, count };
                        }

                        if (Object.keys(selection).length > 0) {
                            filterState[key] = {
                                value: selection,
                                interactedWith: true
                            };
                        }
                    } else {
                        // Decode each value to restore spaces and special characters
                        const values = valueStr.split(',')
                            .filter(Boolean)
                            .map(v => decodeURIComponent(v));
                        if (values.length > 0) {
                            filterState[key] = {
                                value: values,
                                interactedWith: true
                            };
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.warn('Failed to parse compact filters from URL: ' + error);
        }

        return filterState;
    }

    setFilter(key: string, value: any) {
        const conf = ADVANCED_FILTERS.find(f => f.key === key);
        if (!conf) return;

        let interacted = true;
        let atLeftBoundary = false;
        let atRightBoundary = false;

        if (conf.type === AdvFilterType.RANGE) {
            // For range filters, check which boundaries the value matches.
            const availableRange = this.advOptions()[key]?.options;
            if (availableRange) {
                atLeftBoundary = value[0] === availableRange[0];
                atRightBoundary = value[1] === availableRange[1];
                // Only "not interacted" if BOTH boundaries match
                if (atLeftBoundary && atRightBoundary) {
                    interacted = false;
                }
            }
        } else if (conf.type === AdvFilterType.DROPDOWN) {
            if (conf.multistate) {
                // For multistate dropdowns, check if all states are false or object is empty
                if (!value || typeof value !== 'object' || Object.keys(value).length === 0 ||
                    Object.values(value).every((selectionValue: any) => selectionValue.state === false)) {
                    interacted = false;
                }
            } else {
                // For regular dropdowns, if the value is an empty array, it's not interacted.
                if (Array.isArray(value) && value.length === 0) {
                    interacted = false;
                }
            }
        }

        // Determine if we should sync this filter to semantic text:
        // 1. If autoConvertToSemantic is enabled: always sync
        // 2. If this filter already exists in semantic text: sync to keep them linked
        const shouldSyncToText = this.autoConvertToSemantic() || this.semanticFilterKeys().has(key);

        if (shouldSyncToText) {
            // Update the semantic text for this specific filter
            this.updateSemanticTextForFilter(key, value, interacted, conf);
        } else {
            // Just update filterState (UI-only filter)
            this.filterState.update(current => ({
                ...current,
                [key]: { value, interactedWith: interacted }
            }));
        }
    }

    /**
     * Update the semantic text to reflect a filter value change.
     * This replaces/adds/removes the token for the specified filter key.
     */
    private updateSemanticTextForFilter(key: string, value: any, interacted: boolean, conf: AdvFilterConfig): void {
        if (this.isSyncingToText) return; // Prevent re-entry
        
        this.isSyncingToText = true;
        try {
            const semanticKey = conf.semanticKey || conf.key;
            const currentText = this.searchText();
            const gameSystem = this.gameService.currentGameSystem();
            
            // Parse current query to get text search and existing tokens
            const parsed = parseSemanticQuery(currentText, gameSystem);
            
            // Filter out any existing tokens for this filter key
            const otherTokens = parsed.tokens.filter(t => {
                const tokenConf = ADVANCED_FILTERS.find(f => 
                    (f.semanticKey || f.key) === t.field &&
                    (!f.game || f.game === gameSystem)
                );
                return tokenConf?.key !== key;
            });
            
            // Build new semantic text with updated filter
            // For range filters, always generate token text to handle partial boundaries
            // (generateSemanticTokenText will return empty if both boundaries match)
            // For other filter types, only generate if interacted
            let newTokenText = '';
            
            if (conf.type === AdvFilterType.RANGE || interacted) {
                // Generate the new token text for this filter
                // For range filters, use the available range (context-filtered) for boundary detection
                const availableRange = conf.type === AdvFilterType.RANGE 
                    ? this.advOptions()[key]?.options as [number, number] | undefined
                    : undefined;
                newTokenText = this.generateSemanticTokenText(key, value, conf, availableRange);
            }
            
            // Rebuild the search text: text search + other tokens + new token (if any)
            const parts: string[] = [];
            
            if (parsed.textSearch) {
                parts.push(parsed.textSearch);
            }
            
            // Add back other filter tokens
            for (const token of otherTokens) {
                parts.push(token.rawText);
            }
            
            // Add the new/updated token
            if (newTokenText) {
                parts.push(newTokenText);
            }
            
            this.searchText.set(parts.join(' ').trim());
            
            // Also clear the filterState for this key since semantic is now the source of truth
            this.filterState.update(current => {
                const updated = { ...current };
                delete updated[key];
                return updated;
            });
        } finally {
            this.isSyncingToText = false;
        }
    }

    /**
     * Generate semantic token text for a filter value.
     * E.g., for PV range [50, 100] with available [0, 200], generates "pv>=50 pv<=100" or "pv=50-100"
     * @param availableRange For range filters, the context-filtered available range for boundary detection
     */
    private generateSemanticTokenText(key: string, value: any, conf: AdvFilterConfig, availableRange?: [number, number]): string {
        const semanticKey = conf.semanticKey || conf.key;
        const parts: string[] = [];
        
        if (conf.type === AdvFilterType.RANGE) {
            const [min, max] = value as [number, number];
            // Use available range (context-filtered) for boundary detection
            // This ensures dragging to the visible boundary removes the constraint
            const boundaryRange = availableRange || this.totalRangesCache[key] || [0, 100];
            
            if (min === max) {
                parts.push(`${semanticKey}=${min}`);
            } else if (min !== boundaryRange[0] && max !== boundaryRange[1]) {
                parts.push(`${semanticKey}=${min}-${max}`);
            } else if (min !== boundaryRange[0]) {
                parts.push(`${semanticKey}>=${min}`);
            } else if (max !== boundaryRange[1]) {
                parts.push(`${semanticKey}<=${max}`);
            }
            // If both match available range, nothing to add (filter removed)
            
        } else if (conf.type === AdvFilterType.DROPDOWN) {
            if (conf.multistate) {
                const selection = value as MultiStateSelection;
                const orValues: string[] = [];
                const andValues: string[] = [];
                const notValues: string[] = [];
                
                for (const [name, sel] of Object.entries(selection)) {
                    // Format: quote the name if needed, then append quantity suffix outside quotes
                    const quotedName = this.formatSemanticValue(name);
                    let quantitySuffix = '';
                    
                    if (conf.countable && sel.count > 1) {
                        // Format with quantity suffix
                        // UI spinner represents "at least N", so use >= unless there's a specific operator
                        if (sel.countOperator && sel.countOperator !== '=') {
                            quantitySuffix = `:${sel.countOperator}${sel.count}`;
                        } else if (sel.countMax !== undefined) {
                            quantitySuffix = `:${sel.count}-${sel.countMax}`;
                        } else if (sel.countOperator === '=') {
                            // Explicit exact match
                            quantitySuffix = `:${sel.count}`;
                        } else {
                            // No operator = UI spinner = "at least N"
                            quantitySuffix = `:>=${sel.count}`;
                        }
                    } else if (conf.countable && sel.countOperator && sel.countOperator !== '=') {
                        // Non-equality operator with count 1
                        quantitySuffix = `:${sel.countOperator}${sel.count}`;
                    } else if (conf.countable && sel.countMax !== undefined) {
                        // Range constraint
                        quantitySuffix = `:${sel.count}-${sel.countMax}`;
                    }
                    
                    const formattedName = quotedName + quantitySuffix;
                    
                    if (sel.state === 'not') {
                        notValues.push(formattedName);
                    } else if (sel.state === 'and') {
                        andValues.push(formattedName);
                    } else if (sel.state === 'or') {
                        orValues.push(formattedName);
                    }
                }
                
                if (orValues.length > 0) {
                    // OR uses = operator
                    parts.push(`${semanticKey}=${orValues.join(',')}`);
                }
                if (andValues.length > 0) {
                    // AND uses &= operator
                    parts.push(`${semanticKey}&=${andValues.join(',')}`);
                }
                if (notValues.length > 0) {
                    // NOT uses != operator
                    parts.push(`${semanticKey}!=${notValues.join(',')}`);
                }
            } else {
                const values = value as string[];
                if (values.length > 0) {
                    const formatted = values.map(v => this.formatSemanticValue(v)).join(',');
                    parts.push(`${semanticKey}=${formatted}`);
                }
            }
        }
        
        return parts.join(' ');
    }

    /**
     * Format a value for semantic text output, adding quotes if needed.
     */
    private formatSemanticValue(value: string): string {
        if (/[\s,=!<>]/.test(value)) {
            const escaped = value.replace(/"/g, '\\"');
            return `"${escaped}"`;
        }
        return value;
    }

    public resetFilters() {
        this.clearFilters();
    }

    private clearFilters() {
        this.searchText.set('');
        this.filterState.set({});
        this.selectedSort.set('');
        this.selectedSortDirection.set('asc');
        this.pilotGunnerySkill.set(4);
        this.pilotPilotingSkill.set(5);
    }

    /**
     * Get the total ranges cache for semantic filter conversion.
     */
    public getTotalRanges(): Record<string, [number, number]> {
        return this.totalRangesCache;
    }

    /**
     * Convert current filter state to semantic text.
     * @deprecated Use updateSemanticTextForFilter for targeted updates instead.
     */
    public getSemanticText(): string {
        return filterStateToSemanticText(
            this.effectiveFilterState(),
            this.effectiveTextSearch(),
            this.gameService.currentGameSystem(),
            this.totalRangesCache
        );
    }

    /**
     * Update search text with semantic text representation of current filters.
     * @deprecated Use updateSemanticTextForFilter for targeted updates instead.
     */
    public syncSearchTextFromFilters(): void {
        if (this.isSyncingToText) return;
        this.isSyncingToText = true;
        try {
            const semanticText = this.getSemanticText();
            this.searchText.set(semanticText);
        } finally {
            this.isSyncingToText = false;
        }
    }

    // Collect all unique tags from all units (merged name + chassis)
    getAllTags(): string[] {
        const allUnits = this.dataService.getUnits();
        const existingTags = new Set<string>();

        for (const u of allUnits) {
            if (u._nameTags) {
                u._nameTags.forEach(tag => existingTags.add(tag));
            }
            if (u._chassisTags) {
                u._chassisTags.forEach(tag => existingTags.add(tag));
            }
        }
        // Convert to sorted array
        return Array.from(existingTags).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
    }

    // Collect all unique name-specific tags
    getAllNameTags(): string[] {
        const allUnits = this.dataService.getUnits();
        const existingTags = new Set<string>();

        for (const u of allUnits) {
            if (u._nameTags) {
                u._nameTags.forEach(tag => existingTags.add(tag));
            }
        }
        return Array.from(existingTags).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
    }

    // Collect all unique chassis-wide tags
    getAllChassisTags(): string[] {
        const allUnits = this.dataService.getUnits();
        const existingTags = new Set<string>();

        for (const u of allUnits) {
            if (u._chassisTags) {
                u._chassisTags.forEach(tag => existingTags.add(tag));
            }
        }
        return Array.from(existingTags).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
    }

    public invalidateTagsCache(): void {
        // Increment version to trigger recomputation of tag-dependent computed signals
        this.tagsVersion.update(v => v + 1);

        // Clear any cached tag-related data
        for (const [key] of this.availableNamesCache) {
            if (key.includes('_tags')) {
                this.availableNamesCache.delete(key);
            }
        }
    }

    public async saveTagsToStorage(): Promise<void> {
        await this.dataService.saveUnitTags(this.dataService.getUnits());
    }

    setPilotSkills(gunnery: number, piloting: number) {
        this.pilotGunnerySkill.set(gunnery);
        this.pilotPilotingSkill.set(piloting);
    }

    getAdjustedBV(unit: Unit): number {
        const gunnery = this.pilotGunnerySkill();
        let piloting = this.pilotPilotingSkill();
        if (unit.type === 'ProtoMek') {
            piloting = 5; // ProtoMeks always use Piloting 5
        }
        // Use default skills - no adjustment needed
        if (gunnery === 4 && piloting === 5) {
            return unit.bv;
        }

        return BVCalculatorUtil.calculateAdjustedBV(unit.bv, gunnery, piloting);
    }

    getAdjustedPV(unit: Unit): number {
        let skill = this.pilotGunnerySkill();
        // Use default skill - no adjustment needed
        if (skill === 4) {
            return unit.as.PV;
        }

        return PVCalculatorUtil.calculateAdjustedPV(unit.as.PV, skill);
    }


    public serializeCurrentSearchFilter(name: string): SerializedSearchFilter {
        const filter: SerializedSearchFilter = { name };

        const q = this.searchText();
        if (q && q.trim().length > 0) filter.q = q.trim();

        const sort = this.selectedSort();
        if (sort && sort !== '') filter.sort = sort;

        const sortDir = this.selectedSortDirection();
        if (sortDir && sortDir !== 'asc') filter.sortDir = sortDir;

        const g = this.pilotGunnerySkill();
        if (typeof g === 'number' && g !== 4) filter.gunnery = g;

        const p = this.pilotPilotingSkill();
        if (typeof p === 'number' && p !== 5) filter.piloting = p;

        // Save only interacted filters
        const state = this.filterState();
        const savedFilters: Record<string, any> = {};
        for (const [key, val] of Object.entries(state)) {
            if (val.interactedWith) {
                savedFilters[key] = val.value;
            }
        }
        if (Object.keys(savedFilters).length > 0) {
            filter.filters = savedFilters;
        }
        return filter;
    }

    public applySerializedSearchFilter(filter: SerializedSearchFilter): void {
        // Reset all filters first
        this.clearFilters();
        // Apply search text
        if (filter.q) {
            this.searchText.set(filter.q);
        }
        // Apply filters
        if (filter.filters) {
            for (const [key, value] of Object.entries(filter.filters)) {
                this.setFilter(key, value);
            }
        }
        // Apply sort
        if (filter.sort) this.setSortOrder(filter.sort);
        if (filter.sortDir) this.setSortDirection(filter.sortDir);

        // Apply pilot skills if provided
        if (typeof filter.gunnery === 'number' || typeof filter.piloting === 'number') {
            const g = typeof filter.gunnery === 'number' ? filter.gunnery : this.pilotGunnerySkill();
            const p = typeof filter.piloting === 'number' ? filter.piloting : this.pilotPilotingSkill();
            this.setPilotSkills(g, p);
        }
    }
}
