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

import { GameSystem } from '../models/common.model';
import { SemanticFilterState } from '../utils/semantic-filter.util';

/*
 * Author: Drake
 *
 * Types, interfaces, enums, and constants for the unit search filter system.
 */

// ================== Types & Interfaces ==================

export interface SortOption {
    key: string;
    label: string;
    slotLabel?: string; // Optional label prefix to show in the slot (e.g., "BV")
    slotIcon?: string;  // Optional icon for the slot (e.g., '/images/calendar.svg')
    gameSystem?: GameSystem;
}

export enum AdvFilterType {
    DROPDOWN = 'dropdown',
    RANGE = 'range',
    SEMANTIC = 'semantic' // Semantic-only filters (not shown in UI, no advOptions entry)
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
    valueNormalizer?: (value: string) => string; // Optional function to normalize semantic filter values
}

// Use SemanticFilterState from semantic-filter.util as our FilterState
export type FilterState = SemanticFilterState;

/** Display item for semantic-only mode with state information */
export interface SemanticDisplayItem {
    text: string;
    state: 'or' | 'and' | 'not';
}

export type DropdownFilterOptions = {
    type: 'dropdown';
    label: string;
    options: { name: string, img?: string, displayName?: string }[];
    value: string[];
    interacted: boolean;
    semanticOnly?: boolean;  // True if this filter has semantic-only constraints (values not in options)
    displayText?: string;    // Display text for semantic-only values (plain string fallback)
    displayItems?: SemanticDisplayItem[];  // Structured display items with state for proper styling
};

export type RangeFilterOptions = {
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
    /** Unique identifier for storage/sync */
    id: string;
    /** Display name for the saved search */
    name: string;
    /** Game system this filter applies to: 'cbt' or 'as'. If not set, the search is game-agnostic. */
    gameSystem?: 'cbt' | 'as';
    /** Search query text */
    q?: string;
    /** Sort field key */
    sort?: string;
    /** Sort direction */
    sortDir?: 'asc' | 'desc';
    /** Advanced filter values */
    filters?: Record<string, any>;
    /** Pilot gunnery skill for BV/PV calculations */
    gunnery?: number;
    /** Pilot piloting skill for BV calculations */
    piloting?: number;
    /** Timestamp when saved (for sync ordering) */
    timestamp?: number;
}

export type AdvFilterOptions = DropdownFilterOptions | RangeFilterOptions;

// ================== Constants ==================

const DEFAULT_FILTER_CURVE = 0;
export const FACTION_EXTINCT = 3;

/** 
 * Alpha Strike movement mode display names.
 * Keys are the movement mode codes from MVm, values are human-readable names.
 * Empty string "" represents standard/ground movement.
 */
export const AS_MOVEMENT_MODE_DISPLAY_NAMES: Record<string, string> = {
    '': 'Standard',
    'j': 'Jump',
    'qt': 'QuadVee (Tracked)',
    'qw': 'QuadVee (Wheeled)',
    'i': 'Airship',
    'a': 'Aerodyne',
    'h': 'Hover',
    'n': 'Naval (Surface)',
    's': 'Submersible',
    'r': 'Rail',
    'k': 'Satellite',
    't': 'Tracked',
    'v': 'VTOL',
    'w': 'Wheeled',
    'w(b)': 'Wheeled (Bicycle)',
    'w(m)': 'Wheeled (Monocycle)',
    'g': 'WiGE',
    'p': 'Spheroid',
    'f': 'Foot',
    'm': 'Motorized',
};

/**
 * Normalize a motive value to its display name (case-insensitive).
 * Accepts a code ('j', 'J') or display name ('jump', 'JUMP', 'Jump', etc.).
 * Returns the canonical display name or the original value if not recognized.
 * 
 * O(n) but n≈20, so negligible vs Map overhead.
 */
export function normalizeMotiveValue(value: string): string {
    const lower = value.toLowerCase();
    for (const [code, displayName] of Object.entries(AS_MOVEMENT_MODE_DISPLAY_NAMES)) {
        if (code === lower || displayName.toLowerCase() === lower) {
            return displayName;
        }
    }
    return value;
}

// ================== Filter Configurations ==================

/** Dropdown filter configuration */
export interface DropdownFilterConfig {
    key: string;
    label: string;
    semanticKey?: string;
    game?: GameSystem;
    sortOptions?: string[];
    external?: boolean;
    multistate?: boolean;
    countable?: boolean;
    /** Optional function to normalize semantic filter values (e.g., motive code 'j' -> 'Jump') */
    valueNormalizer?: (value: string) => string;
}

/** Range filter configuration */
export interface RangeFilterConfig {
    key: string;
    label: string;
    semanticKey?: string;
    game?: GameSystem;
    curve?: number;
    stepSize?: number;
    ignoreValues?: any[];
}

/** Semantic-only filter configuration (not shown in UI) */
export interface SemanticFilterConfig {
    key: string;
    label: string;
    semanticKey?: string;
}

/** Dropdown filters - separated for clean iteration */
export const DROPDOWN_FILTERS: readonly DropdownFilterConfig[] = Object.freeze([
    { key: 'era', semanticKey: 'era', label: 'Era', external: true },
    { key: 'faction', semanticKey: 'faction', label: 'Faction', external: true, multistate: true },
    { key: 'type', semanticKey: 'type', label: 'Type', game: GameSystem.CLASSIC },
    { key: 'as.TP', semanticKey: 'type', label: 'Type', game: GameSystem.ALPHA_STRIKE },
    { key: 'subtype', semanticKey: 'subtype', label: 'Subtype', game: GameSystem.CLASSIC },
    { key: 'techBase', semanticKey: 'tech', label: 'Tech', sortOptions: ['Inner Sphere', 'Clan', 'Mixed'] },
    { key: 'role', semanticKey: 'role', label: 'Role' },
    { key: 'weightClass', semanticKey: 'weight', label: 'Weight Class', game: GameSystem.CLASSIC, sortOptions: ['Ultra Light*', 'Light', 'Medium', 'Heavy', 'Assault', 'Colossal*', 'Small*', 'Medium*', 'Large*'] },
    { key: 'level', semanticKey: 'rules', label: 'Rules', game: GameSystem.CLASSIC, sortOptions: ['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial'] },
    { key: 'c3', semanticKey: 'network', label: 'Network', game: GameSystem.CLASSIC },
    { key: 'moveType', semanticKey: 'motive', label: 'Motive', game: GameSystem.CLASSIC },
    { key: 'as._motive', semanticKey: 'motive', label: 'Motive', game: GameSystem.ALPHA_STRIKE, sortOptions: Object.values(AS_MOVEMENT_MODE_DISPLAY_NAMES), valueNormalizer: normalizeMotiveValue },
    { key: 'as.specials', semanticKey: 'specials', label: 'Specials', multistate: true, game: GameSystem.ALPHA_STRIKE },
    { key: 'componentName', semanticKey: 'equipment', label: 'Equipment', multistate: true, countable: true, game: GameSystem.CLASSIC },
    { key: 'features', semanticKey: 'features', label: 'Features', multistate: true, game: GameSystem.CLASSIC },
    { key: 'quirks', semanticKey: 'quirks', label: 'Quirks', multistate: true, game: GameSystem.CLASSIC },
    { key: 'source', semanticKey: 'source', label: 'Source' },
    { key: 'forcePack', semanticKey: 'pack', label: 'Force Packs', external: true },
    { key: '_tags', semanticKey: 'tags', label: 'Tags', multistate: true },
]);

/** Range filters - separated for clean iteration */
export const RANGE_FILTERS: readonly RangeFilterConfig[] = Object.freeze([
    { key: 'bv', semanticKey: 'bv', label: 'BV', curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'as.PV', semanticKey: 'pv', label: 'PV', curve: DEFAULT_FILTER_CURVE, game: GameSystem.ALPHA_STRIKE },
    { key: 'tons', semanticKey: 'tons', label: 'Tons', curve: DEFAULT_FILTER_CURVE, stepSize: 5, game: GameSystem.CLASSIC },
    { key: 'armor', semanticKey: 'armor', label: 'Armor', curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'armorPer', semanticKey: 'armorpct', label: 'Armor %', curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'internal', semanticKey: 'structure', label: 'Structure / Squad Size', curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: '_mdSumNoPhysical', semanticKey: 'firepower', label: 'Firepower', curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'dpt', semanticKey: 'dpt', label: 'Damage/Turn', curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'heat', semanticKey: 'heat', label: 'Total Weapons Heat', curve: DEFAULT_FILTER_CURVE, ignoreValues: [-1], game: GameSystem.CLASSIC },
    { key: 'dissipation', semanticKey: 'dissipation', label: 'Dissipation', curve: DEFAULT_FILTER_CURVE, ignoreValues: [-1], game: GameSystem.CLASSIC },
    { key: '_dissipationEfficiency', semanticKey: 'efficiency', label: 'Heat Efficiency', curve: 1, game: GameSystem.CLASSIC },
    { key: '_maxRange', semanticKey: 'range', label: 'Range', curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'walk', semanticKey: 'walk', label: 'Walk MP', curve: 0.9, game: GameSystem.CLASSIC },
    { key: 'run', semanticKey: 'run', label: 'Run MP', curve: 0.9, game: GameSystem.CLASSIC },
    { key: 'jump', semanticKey: 'jump', label: 'Jump MP', curve: 0.9, game: GameSystem.CLASSIC },
    { key: 'umu', semanticKey: 'umu', label: 'UMU MP', curve: 0.9, game: GameSystem.CLASSIC },
    { key: 'year', semanticKey: 'year', label: 'Year', curve: 1 },
    { key: 'cost', semanticKey: 'cost', label: 'Cost', curve: DEFAULT_FILTER_CURVE, game: GameSystem.CLASSIC },
    { key: 'as.SZ', semanticKey: 'sz', label: 'Size', curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.TMM', semanticKey: 'tmm', label: 'TMM', curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as._mv', semanticKey: 'mv', label: 'Movement', curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.OV', semanticKey: 'ov', label: 'Overheat Value', curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.Th', semanticKey: 'th', label: 'Threshold', curve: 1, ignoreValues: [-1], game: GameSystem.ALPHA_STRIKE },
    { key: 'as.dmg._dmgS', semanticKey: 'dmgs', label: 'Damage (Short)', curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.dmg._dmgM', semanticKey: 'dmgm', label: 'Damage (Medium)', curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.dmg._dmgL', semanticKey: 'dmgl', label: 'Damage (Long)', curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.dmg._dmgE', semanticKey: 'dmge', label: 'Damage (Extreme)', curve: 1, game: GameSystem.ALPHA_STRIKE },
    { key: 'as.Arm', semanticKey: 'a', label: 'Armor', curve: DEFAULT_FILTER_CURVE, ignoreValues: [-1], game: GameSystem.ALPHA_STRIKE },
    { key: 'as.Str', semanticKey: 's', label: 'Structure', curve: DEFAULT_FILTER_CURVE, ignoreValues: [-1], game: GameSystem.ALPHA_STRIKE },
]);

/** Semantic-only filters (not shown in UI, only for query parsing) */
export const SEMANTIC_FILTERS: readonly SemanticFilterConfig[] = Object.freeze([
    { key: 'name', semanticKey: 'name', label: 'Internal Name' },
    { key: 'id', semanticKey: 'mul', label: 'MUL ID' },
    { key: 'chassis', semanticKey: 'chassis', label: 'Chassis' },
    { key: 'model', semanticKey: 'model', label: 'Model' },
]);

/** Combined ADVANCED_FILTERS for backwards compatibility and semantic parsing */
export const ADVANCED_FILTERS: AdvFilterConfig[] = [
    ...DROPDOWN_FILTERS.map(f => ({ ...f, type: AdvFilterType.DROPDOWN as const })),
    ...RANGE_FILTERS.map(f => ({ ...f, type: AdvFilterType.RANGE as const })),
    ...SEMANTIC_FILTERS.map(f => ({ ...f, type: AdvFilterType.SEMANTIC as const })),
];

export const SORT_OPTIONS: SortOption[] = [
    { key: '', label: 'Relevance' },
    { key: 'name', label: 'Name' },
    ...ADVANCED_FILTERS
        .filter(f => !['era', 'faction', 'forcePack', 'componentName', 'source', '_tags', 'as.specials', 'name', 'chassis', 'model', 'as._motive', 'quirks', 'features'].includes(f.key))
        .map(f => ({
            key: f.key,
            label: f.label,
            slotLabel: f.label,
            gameSystem: f.game,
            // slotIcon: f.slotIcon
        } as SortOption))
];
