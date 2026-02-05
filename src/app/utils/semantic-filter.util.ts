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
import { ADVANCED_FILTERS, AdvFilterConfig, AdvFilterType } from '../services/unit-search-filters.service';
import { CountOperator, MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';

// Cache for semantic key maps
const semanticKeyMapCache = new Map<GameSystem, Map<string, AdvFilterConfig>>();

/*
 * Author: Drake
 * 
 * Semantic Filter Parser
 * 
 * Syntax: field + operator + value
 * 
 * Operators:
 *   =   Include/equal (supports range syntax for numeric: field=min-max)
 *   !=  Exclude/not equal (supports range syntax for numeric: field!=min-max)
 *   >   Greater than (single value only)
 *   <   Less than (single value only)
 *   >=  Greater than or equal (single value only)
 *   <=  Less than or equal (single value only)
 * 
 * Values:
 *   - Plain text: field=value
 *   - Quoted (for spaces): field="value with spaces" or field='value'
 *   - Multiple values (comma): field=val1,val2,"val 3"
 *   - Range (for = and != only): field=min-max (e.g., tmm=2-5)
 * 
 * Examples:
 *   crab                           -> text search for "crab"
 *   crab tmm=2                     -> text "crab" + TMM exactly 2
 *   tmm=2-5                        -> TMM range 2 to 5 (include)
 *   tmm!=2-3                       -> TMM excludes range 2 to 3
 *   tmm>=2 tmm<=5                  -> TMM >= 2 AND <= 5
 *   faction=ComStar,"Draconis Combine"  -> faction includes both
 *   faction!=ComStar               -> faction excludes ComStar
 *   bv>=1000 bv<=2000              -> BV range 1000-2000
 */

export type SemanticOperator = '=' | '!=' | '&=' | '>' | '<' | '>=' | '<=';

export interface SemanticToken {
    field: string;           // The semantic key (e.g., 'tmm', 'faction')
    operator: SemanticOperator;
    values: string[];        // Parsed values (already unquoted)
    rawText: string;         // Original text for this token
}

/**
 * Filter state that includes all filter properties including semantic-only features.
 * Stores current filter values with metadata about interaction and special ranges.
 */
export interface SemanticFilterState {
    [key: string]: {
        value: any;
        interactedWith: boolean;
        includeRanges?: [number, number][];  // For range filters: multiple include ranges (OR logic)
        excludeRanges?: [number, number][];  // For range filters: multiple exclude ranges
        displayText?: string;                // For range filters: formatted effective ranges (e.g., "0-10, 20-30")
        semanticOnly?: boolean;              // True if this filter can't be shown in UI
        wildcardPatterns?: WildcardPattern[];  // For dropdown filters: wildcard patterns (e.g., "AC*")
    };
}

/**
 * Represents a wildcard pattern for dropdown filter matching.
 */
export interface WildcardPattern {
    pattern: string;    // Original pattern (e.g., "AC*")
    state: 'or' | 'and' | 'not';  // Include (OR), require all (AND), or exclude (NOT)
}

/**
 * Virtual semantic key configuration.
 * - keys: Individual semantic keys that form the virtual key
 * - format: How values are combined ('slash' = value1/value2/...)
 * - implicit: Keys that are omitted unless explicitly set (use wildcard in their place)
 */
export interface VirtualSemanticKeyConfig {
    keys: string[];
    format: 'slash';
    implicit?: string[];  // Keys to omit if no value (use * placeholder)
}

/**
 * Virtual semantic keys that map to multiple actual filters.
 * For example, 'dmg' maps to dmgS, dmgM, dmgL, dmgE.
 */
export const VIRTUAL_SEMANTIC_KEYS: Record<string, VirtualSemanticKeyConfig> = {
    'dmg': { 
        keys: ['dmgs', 'dmgm', 'dmgl', 'dmge'], 
        format: 'slash',
        implicit: ['dmge']  // Extreme range omitted by default
    }
};

/**
 * Build a lookup map from semanticKey to config.
 * Includes all filters regardless of game mode for semantic filtering,
 * but gives priority to filters matching the current game mode when there are duplicates.
 * Results are cached per game system for performance.
 */
export function buildSemanticKeyMap(gameSystem: GameSystem): Map<string, AdvFilterConfig> {
    // Return cached map if available
    const cached = semanticKeyMapCache.get(gameSystem);
    if (cached) return cached;

    const map = new Map<string, AdvFilterConfig>();
    
    // First pass: add all filters without a game restriction
    for (const conf of ADVANCED_FILTERS) {
        if (conf.game) continue; // Skip game-specific filters in first pass
        const key = conf.semanticKey || conf.key;
        if (!map.has(key)) {
            map.set(key, conf);
        }
    }
    
    // Second pass: add game-specific filters (non-current game mode)
    // These will fill in any gaps but won't override existing entries
    for (const conf of ADVANCED_FILTERS) {
        if (!conf.game || conf.game === gameSystem) continue;
        const key = conf.semanticKey || conf.key;
        if (!map.has(key)) {
            map.set(key, conf);
        }
    }
    
    // Third pass: add/override with current game mode filters (highest priority)
    for (const conf of ADVANCED_FILTERS) {
        if (conf.game !== gameSystem) continue;
        const key = conf.semanticKey || conf.key;
        map.set(key, conf); // Always set, overriding any previous
    }
    
    // Cache for future calls
    semanticKeyMapCache.set(gameSystem, map);
    return map;
}

/**
 * Merge and sort an array of ranges. Overlapping or adjacent ranges are combined.
 */
function mergeAndSortRanges(ranges: [number, number][]): [number, number][] {
    if (ranges.length === 0) return [];
    
    // Sort by start value
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [sorted[0]];
    
    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        const current = sorted[i];
        
        // Merge if overlapping or adjacent
        if (current[0] <= last[1] + 1) {
            last[1] = Math.max(last[1], current[1]);
        } else {
            merged.push(current);
        }
    }
    
    return merged;
}

/**
 * Apply exclusion ranges to an include range, returning the remaining segments.
 */
function applyExclusionsToRange(
    min: number,
    max: number,
    excludeRanges: [number, number][]
): [number, number][] {
    if (excludeRanges.length === 0) {
        return [[min, max]];
    }
    
    // Sort exclusions by start
    const sortedExcludes = [...excludeRanges].sort((a, b) => a[0] - b[0]);
    const segments: [number, number][] = [];
    let current = min;
    
    for (const [exMin, exMax] of sortedExcludes) {
        // Skip exclusions outside our range
        if (exMax < min || exMin > max) continue;
        
        // Add segment before exclusion
        if (current < exMin) {
            segments.push([current, Math.min(exMin - 1, max)]);
        }
        
        // Move past exclusion
        current = Math.max(current, exMax + 1);
    }
    
    // Add final segment after last exclusion
    if (current <= max) {
        segments.push([current, max]);
    }
    
    return segments;
}

/**
 * Format an array of range segments as a display string.
 * E.g., [[0,10], [20,30]] → "0-10, 20-30"
 */
function formatRangeSegments(segments: [number, number][]): string {
    return segments.map(([s, e]) => s === e ? `${s}` : `${s}-${e}`).join(', ');
}

/**
 * Parse a single value string that may contain:
 * - Comma-separated values
 * - Quoted values with spaces
 * - Escaped quotes within quoted values (\")
 */
export function parseValues(valueStr: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuote: '"' | "'" | null = null;
    let i = 0;

    while (i < valueStr.length) {
        const char = valueStr[i];

        if (inQuote) {
            if (char === '\\' && i + 1 < valueStr.length) {
                // Escaped character - include the next char literally
                const nextChar = valueStr[i + 1];
                if (nextChar === '"' || nextChar === "'" || nextChar === '\\') {
                    current += nextChar;
                    i += 2;
                    continue;
                }
            }
            if (char === inQuote) {
                // End of quoted string
                inQuote = null;
            } else {
                current += char;
            }
        } else if (char === '"' || char === "'") {
            // Start of quoted string
            inQuote = char;
        } else if (char === ',') {
            // Value separator
            if (current.trim()) {
                values.push(current.trim());
            }
            current = '';
        } else {
            current += char;
        }
        i++;
    }

    // Add last value
    if (current.trim()) {
        values.push(current.trim());
    }

    return values;
}

/**
 * Check if a value string represents a range (e.g., "2-5", "100-200", "2~5")
 * Supports both - and ~ as range separators.
 * Returns [min, max] if it's a range, null otherwise
 */
function parseRange(value: string): [number, number] | null {
    // Match patterns like "2-5", "100-200", "-5-10" (negative min), or "2~5"
    // Be careful with negative numbers: -5--2 means -5 to -2
    // Supports both - and ~ as range separators
    const match = value.match(/^(-?\d+(?:\.\d+)?)[-~](-?\d+(?:\.\d+)?)$/);
    if (match) {
        const min = parseFloat(match[1]);
        const max = parseFloat(match[2]);
        if (!isNaN(min) && !isNaN(max)) {
            // Ensure min <= max
            return min <= max ? [min, max] : [max, min];
        }
    }
    return null;
}

/**
 * Parsed quantity constraint from value string.
 * Supports: :N, :=N, :>N, :>=N, :<N, :<=N, :!N, :!=N, :N-M, :!N-M, :!=N-M
 */
export interface QuantityConstraint {
    operator: CountOperator;
    count: number;
    countMax?: number;  // For range constraints like :2-5
}

/**
 * Parse quantity constraint from value suffix.
 * Format: value:constraint where constraint is one of:
 *   N or =N      → exactly N
 *   >N           → more than N
 *   >=N          → at least N
 *   <N           → less than N
 *   <=N          → at most N
 *   !N or !=N    → not equal to N
 *   N-M          → range from N to M (inclusive)
 *   !N-M or !=N-M → not in range N to M
 * 
 * Returns { name, constraint } or { name, constraint: null } if no quantity suffix
 */
export function parseValueWithQuantity(value: string): { name: string; constraint: QuantityConstraint | null } {
    // Find the last colon that's followed by a valid quantity pattern
    const colonIndex = value.lastIndexOf(':');
    if (colonIndex === -1 || colonIndex === value.length - 1) {
        return { name: value, constraint: null };
    }

    const namePart = value.slice(0, colonIndex);
    const quantityPart = value.slice(colonIndex + 1);

    // Try to parse quantity constraint
    let operator: CountOperator = '=';
    let numStr = quantityPart;

    // Check for operators at the start
    if (quantityPart.startsWith('>=')) {
        operator = '>=';
        numStr = quantityPart.slice(2);
    } else if (quantityPart.startsWith('<=')) {
        operator = '<=';
        numStr = quantityPart.slice(2);
    } else if (quantityPart.startsWith('!=')) {
        operator = '!=';
        numStr = quantityPart.slice(2);
    } else if (quantityPart.startsWith('>')) {
        operator = '>';
        numStr = quantityPart.slice(1);
    } else if (quantityPart.startsWith('<')) {
        operator = '<';
        numStr = quantityPart.slice(1);
    } else if (quantityPart.startsWith('!')) {
        operator = '!=';
        numStr = quantityPart.slice(1);
    } else if (quantityPart.startsWith('=')) {
        operator = '=';
        numStr = quantityPart.slice(1);
    }

    // Check for range (N-M or N~M)
    const rangeMatch = numStr.match(/^(\d+)[-~](\d+)$/);
    if (rangeMatch) {
        const min = parseInt(rangeMatch[1], 10);
        const max = parseInt(rangeMatch[2], 10);
        if (!isNaN(min) && !isNaN(max)) {
            // For ranges, operator can only be = (include) or != (exclude)
            // Other operators don't make sense with ranges
            if (operator !== '=' && operator !== '!=') {
                operator = '=';  // Default to include for ranges
            }
            return {
                name: namePart,
                constraint: {
                    operator,
                    count: Math.min(min, max),
                    countMax: Math.max(min, max)
                }
            };
        }
    }

    // Parse single number
    const num = parseInt(numStr, 10);
    if (isNaN(num) || num < 0) {
        // Not a valid quantity, treat colon as part of the name
        return { name: value, constraint: null };
    }

    return {
        name: namePart,
        constraint: {
            operator,
            count: num
        }
    };
}

/**
 * Convert a quantity constraint to a range [min, max].
 * For operators like > or >=, the max will be Infinity.
 * For operators like < or <=, the min will be 0 or 1.
 */
function constraintToRange(constraint: QuantityConstraint): [number, number] {
    const { operator, count, countMax } = constraint;
    
    // Range constraint
    if (countMax !== undefined) {
        return [count, countMax];
    }
    
    // Single value or comparison operators
    switch (operator) {
        case '=':
            return [count, count];
        case '!=':
            return [count, count];  // Will be added to exclude list
        case '>':
            return [count + 1, Infinity];
        case '>=':
            return [count, Infinity];
        case '<':
            return [0, count - 1];
        case '<=':
            return [0, count];
        default:
            return [count, count];
    }
}

/**
 * Convert parsed semantic tokens to filter state.
 * Handles merging multiple tokens for the same field.
 */
export function tokensToFilterState(
    tokens: SemanticToken[],
    gameSystem: GameSystem,
    totalRanges: Record<string, [number, number]>
): SemanticFilterState {
    const semanticKeyMap = buildSemanticKeyMap(gameSystem);
    const filterState: SemanticFilterState = {};

    // Group tokens by field for merging
    const tokensByField = new Map<string, SemanticToken[]>();
    for (const token of tokens) {
        const existing = tokensByField.get(token.field) || [];
        existing.push(token);
        tokensByField.set(token.field, existing);
    }

    for (const [field, fieldTokens] of tokensByField) {
        const conf = semanticKeyMap.get(field);
        if (!conf) continue;

        if (conf.type === AdvFilterType.RANGE) {
            // Handle range filters with support for multiple ranges (OR logic) and exclusions
            const totalRange = totalRanges[conf.key] || [0, 100];
            
            // Collect all include ranges and exclude ranges
            const includeRanges: [number, number][] = [];
            const excludeRanges: [number, number][] = [];
            const excludeValues: number[] = [];
            let hasComparisonOps = false;
            let comparisonMin = totalRange[0];
            let comparisonMax = totalRange[1];

            for (const token of fieldTokens) {
                if (token.operator === '=' || token.operator === '!=') {
                    // For = and != operators, support comma-separated values (already parsed into token.values)
                    for (const value of token.values) {
                        // Check if value is a range (e.g., "2-5") - only for = and !=
                        const range = parseRange(value);
                        if (range) {
                            if (token.operator === '=') {
                                includeRanges.push(range);
                            } else {
                                excludeRanges.push(range);
                            }
                            continue;
                        }

                        // Parse as single number (treat as single-value range)
                        const num = parseFloat(value);
                        if (isNaN(num)) continue;

                        if (token.operator === '=') {
                            includeRanges.push([num, num]);
                        } else {
                            excludeValues.push(num);
                        }
                    }
                } else {
                    // Comparison operators (>, <, >=, <=) - use first value only
                    const value = token.values[0];
                    hasComparisonOps = true;
                    const num = parseFloat(value);
                    if (isNaN(num)) continue;

                    switch (token.operator) {
                        case '>':
                            comparisonMin = Math.max(comparisonMin, num + 1);
                            break;
                        case '>=':
                            comparisonMin = Math.max(comparisonMin, num);
                            break;
                        case '<':
                            comparisonMax = Math.min(comparisonMax, num - 1);
                            break;
                        case '<=':
                            comparisonMax = Math.min(comparisonMax, num);
                            break;
                    }
                }
            }

            // Add comparison range if present
            if (hasComparisonOps) {
                includeRanges.push([comparisonMin, comparisonMax]);
            }

            // Convert single exclude values to ranges [val, val]
            for (const val of excludeValues) {
                excludeRanges.push([val, val]);
            }
            
            // Merge exclude ranges
            const mergedExcludeRanges = mergeAndSortRanges(excludeRanges);

            // Now compute the final state
            let finalIncludeRanges: [number, number][] | undefined;
            let finalExcludeRanges: [number, number][] | undefined;
            let displayText: string | undefined;
            let semanticOnly = false;

            // Determine if we need semantic-only mode
            // - Multiple disjoint include ranges → semantic only
            // - Any exclusions → semantic only
            const mergedRanges = mergeAndSortRanges(includeRanges);
            const hasExclusions = mergedExcludeRanges.length > 0;
            const hasMultipleRanges = mergedRanges.length > 1;
            
            // If we only have exclusions (no explicit includes), the implicit include is the full range
            const effectiveIncludeRanges = mergedRanges.length > 0 ? mergedRanges : [totalRange as [number, number]];

            if (hasMultipleRanges || hasExclusions) {
                semanticOnly = true;
                
                // Apply exclusions to each include range to compute effective segments for displayText
                let effectiveSegments: [number, number][] = [];
                for (const range of effectiveIncludeRanges) {
                    // Get exclude ranges that overlap with this include range
                    const relevantExcludes = mergedExcludeRanges.filter(
                        ex => ex[1] >= range[0] && ex[0] <= range[1]
                    );
                    const segments = applyExclusionsToRange(range[0], range[1], relevantExcludes);
                    effectiveSegments.push(...segments);
                }
                
                // Merge adjacent segments
                effectiveSegments = mergeAndSortRanges(effectiveSegments);
                
                if (effectiveSegments.length > 0) {
                    // For visualization: store the ORIGINAL include ranges (before exclusions)
                    // The slider will show these in cyan, with red overlays for exclusions
                    finalIncludeRanges = effectiveIncludeRanges;
                    displayText = formatRangeSegments(effectiveSegments);
                }
                
                // Store exclude ranges for reference
                if (mergedExcludeRanges.length > 0) {
                    finalExcludeRanges = mergedExcludeRanges;
                }
            }
            // Note: For single contiguous ranges, includeRanges is not set here.
            // advOptions will set includeRanges based on the current value for visualization.

            // Compute the overall min/max for UI display (covers all include ranges)
            let min = totalRange[0];
            let max = totalRange[1];
            if (mergedRanges.length > 0) {
                min = mergedRanges[0][0];
                max = mergedRanges[0][1];
                for (let i = 1; i < mergedRanges.length; i++) {
                    if (mergedRanges[i][0] < min) min = mergedRanges[i][0];
                    if (mergedRanges[i][1] > max) max = mergedRanges[i][1];
                }
            }

            filterState[conf.key] = {
                value: [min, max],
                interactedWith: true,
                includeRanges: finalIncludeRanges,
                excludeRanges: finalExcludeRanges,
                displayText,
                semanticOnly
            };

        } else if (conf.type === AdvFilterType.DROPDOWN) {
            // Get the value normalizer if defined (for motive codes -> display names)
            const normalizeValue = conf.valueNormalizer || ((v: string) => v);
            
            if (conf.multistate) {
                // Handle multistate dropdowns (supports include/exclude, wildcards, and quantity constraints)
                const selection: MultiStateSelection = {};
                const wildcardPatterns: WildcardPattern[] = [];
                let semanticOnly = false;
                
                // For countable filters, collect all constraints per name first, then merge
                const countableConstraints = new Map<string, {
                    state: 'or' | 'and' | 'not';
                    constraints: QuantityConstraint[];
                }>();

                for (const token of fieldTokens) {
                    const state: 'or' | 'and' | 'not' = token.operator === '!=' ? 'not' : (token.operator === '&=' ? 'and' : 'or');

                    for (const val of token.values) {
                        // Check if this is a wildcard pattern
                        if (val.includes('*')) {
                            wildcardPatterns.push({ pattern: val, state });
                            semanticOnly = true;
                        } else if (conf.countable) {
                            // For countable filters, parse quantity constraint (e.g., "AC/2:>1")
                            const { name, constraint } = parseValueWithQuantity(val);
                            
                            // Get or create constraint entry for this name
                            let entry = countableConstraints.get(name);
                            if (!entry) {
                                entry = { state, constraints: [] };
                                countableConstraints.set(name, entry);
                            } else {
                                // Update state if this token has a different state
                                // Priority: not > and > or
                                if (state === 'not') {
                                    entry.state = 'not';
                                } else if (state === 'and' && entry.state === 'or') {
                                    entry.state = 'and';
                                }
                            }
                            
                            if (constraint) {
                                entry.constraints.push(constraint);
                            }
                            // If no constraint, it means "has at least one" which is the default
                        } else {
                            // Regular value (non-countable)
                            const normalizedVal = normalizeValue(val);
                            // If already exists, update state with priority: not > and > or
                            if (selection[normalizedVal]) {
                                if (state === 'not') {
                                    selection[normalizedVal].state = 'not';
                                } else if (state === 'and' && selection[normalizedVal].state === 'or') {
                                    selection[normalizedVal].state = 'and';
                                }
                            } else {
                                selection[normalizedVal] = { name: normalizedVal, state, count: 1 };
                            }
                        }
                    }
                }
                
                // Convert collected countable constraints to selection entries
                for (const [name, entry] of countableConstraints) {
                    const constraints = entry.constraints;
                    
                    // Determine if this is a simple UI-representable case
                    // UI can represent: no constraint (>=1) or single >= constraint
                    const isUIRepresentable = constraints.length === 0 || 
                        (constraints.length === 1 && constraints[0].operator === '>=');
                    
                    if (isUIRepresentable) {
                        // Simple case - no merging needed
                        if (constraints.length === 0) {
                            // No constraint means "has at least one"
                            selection[name] = {
                                name,
                                state: entry.state,
                                count: 1
                            };
                        } else {
                            // Single >= constraint
                            const c = constraints[0];
                            selection[name] = {
                                name,
                                state: entry.state,
                                count: c.count,
                                countOperator: '>='
                            };
                        }
                    } else {
                        // Complex case - need to merge constraints into ranges
                        semanticOnly = true;
                        
                        const includeRanges: [number, number][] = [];
                        const excludeRanges: [number, number][] = [];
                        
                        // If there are any include constraints, use them; otherwise implicit include is 1+
                        let hasInclude = false;
                        for (const c of constraints) {
                            const range = constraintToRange(c);
                            if (c.operator === '!=') {
                                excludeRanges.push(range);
                            } else {
                                includeRanges.push(range);
                                hasInclude = true;
                            }
                        }
                        
                        if (!hasInclude && excludeRanges.length > 0) {
                            // Only exclusions, implicit include is 1+
                            includeRanges.push([1, Infinity]);
                        }
                        
                        const mergedIncludes = mergeAndSortRanges(includeRanges);
                        const mergedExcludes = mergeAndSortRanges(excludeRanges);
                        
                        // Apply exclusions to includes to get effective ranges
                        let effectiveRanges: [number, number][] = [];
                        for (const incRange of mergedIncludes) {
                            const segments = applyExclusionsToRange(incRange[0], incRange[1], mergedExcludes);
                            effectiveRanges.push(...segments);
                        }
                        effectiveRanges = mergeAndSortRanges(effectiveRanges);
                        
                        // For single constraint cases, preserve the original operator
                        if (constraints.length === 1) {
                            const c = constraints[0];
                            selection[name] = {
                                name,
                                state: entry.state,
                                count: c.count,
                                countOperator: c.operator,
                                countMax: c.countMax,
                                countIncludeRanges: mergedIncludes.length > 0 ? mergedIncludes : undefined,
                                countExcludeRanges: mergedExcludes.length > 0 ? mergedExcludes : undefined
                            };
                        } else {
                            // Multiple constraints - use effective ranges for display
                            selection[name] = {
                                name,
                                state: entry.state,
                                count: effectiveRanges[0]?.[0] ?? 1,
                                countIncludeRanges: mergedIncludes.length > 0 ? mergedIncludes : undefined,
                                countExcludeRanges: mergedExcludes.length > 0 ? mergedExcludes : undefined
                            };
                        }
                    }
                }

                if (Object.keys(selection).length > 0 || wildcardPatterns.length > 0) {
                    filterState[conf.key] = {
                        value: selection,
                        interactedWith: true,
                        wildcardPatterns: wildcardPatterns.length > 0 ? wildcardPatterns : undefined,
                        semanticOnly: semanticOnly || undefined
                    };
                }

            } else {
                // Handle regular dropdowns (include, exclude, and wildcards support)
                const values: string[] = [];
                const wildcardPatterns: WildcardPattern[] = [];
                let semanticOnly = false;

                for (const token of fieldTokens) {
                    const state: 'or' | 'and' | 'not' = token.operator === '!=' ? 'not' : (token.operator === '&=' ? 'and' : 'or');
                    
                    // Mark as semantic-only if using exclude or AND operators (not representable in simple UI)
                    if (token.operator === '!=' || token.operator === '&=') {
                        semanticOnly = true;
                    }
                    
                    for (const val of token.values) {
                        if (val.includes('*')) {
                            wildcardPatterns.push({ pattern: val, state });
                            semanticOnly = true;
                        } else {
                            if (state === 'or') {
                                values.push(normalizeValue(val));
                            } else {
                                // NOT and AND values also go to wildcard patterns for proper handling
                                wildcardPatterns.push({ pattern: normalizeValue(val), state });
                            }
                        }
                    }
                }

                if (values.length > 0 || wildcardPatterns.length > 0) {
                    filterState[conf.key] = {
                        value: Array.from(new Set(values)), // Deduplicate
                        interactedWith: true,
                        wildcardPatterns: wildcardPatterns.length > 0 ? wildcardPatterns : undefined,
                        semanticOnly: semanticOnly || undefined
                    };
                }
            }
        } else if (conf.type === AdvFilterType.SEMANTIC) {
            // Handle semantic-only filters (exact match text search with wildcards support)
            // These support: =, !=, &=, and wildcards
            const orValues: string[] = [];
            const andValues: string[] = [];
            const wildcardPatterns: WildcardPattern[] = [];

            for (const token of fieldTokens) {
                const state: 'or' | 'and' | 'not' = token.operator === '!=' ? 'not' : (token.operator === '&=' ? 'and' : 'or');
                
                for (const val of token.values) {
                    if (val.includes('*')) {
                        // Wildcard pattern
                        wildcardPatterns.push({ pattern: val, state });
                    } else {
                        // Exact value
                        if (state === 'not') {
                            // Store NOT as wildcard pattern for uniform handling
                            wildcardPatterns.push({ pattern: val, state: 'not' });
                        } else if (state === 'and') {
                            andValues.push(val);
                        } else {
                            orValues.push(val);
                        }
                    }
                }
            }

            // Combine OR and AND values into the value array, with AND values as patterns
            const allPatterns: WildcardPattern[] = wildcardPatterns.slice();
            for (const andVal of andValues) {
                allPatterns.push({ pattern: andVal, state: 'and' });
            }

            if (orValues.length > 0 || allPatterns.length > 0) {
                filterState[conf.key] = {
                    value: Array.from(new Set(orValues)), // Deduplicate OR values
                    interactedWith: true,
                    wildcardPatterns: allPatterns.length > 0 ? allPatterns : undefined,
                    semanticOnly: true // SEMANTIC filters are always semantic-only
                };
            }
        }
    }

    return filterState;
}

/**
 * Convert current filter state back to semantic text.
 * Used to sync the text input with current filter settings.
 */
export function filterStateToSemanticText(
    filterState: SemanticFilterState,
    textSearch: string,
    gameSystem: GameSystem,
    totalRanges: Record<string, [number, number]>
): string {
    const parts: string[] = [];

    // Add text search first
    if (textSearch) {
        parts.push(textSearch);
    }

    for (const [key, state] of Object.entries(filterState)) {
        if (!state.interactedWith) continue;

        const conf = ADVANCED_FILTERS.find(f => f.key === key);
        if (!conf) continue;
        // Allow all filters to be serialized - semantic mode works across game modes

        const semanticKey = conf.semanticKey || conf.key;

        if (conf.type === AdvFilterType.RANGE) {
            const [min, max] = state.value as [number, number];
            const totalRange = totalRanges[key] || [0, 100];
            const extState = state as SemanticFilterState[string];

            // Handle exclude ranges (semantic-only)
            if (extState.excludeRanges && extState.excludeRanges.length > 0) {
                for (const [exMin, exMax] of extState.excludeRanges) {
                    if (exMin === exMax) {
                        parts.push(`${semanticKey}!=${exMin}`);
                    } else {
                        parts.push(`${semanticKey}!=${exMin}-${exMax}`);
                    }
                }
            }

            // Output include range if different from total range
            const isFullRange = min === totalRange[0] && max === totalRange[1];
            if (!isFullRange) {
                if (min === max) {
                    parts.push(`${semanticKey}=${min}`);
                } else if (min !== totalRange[0] && max !== totalRange[1]) {
                    parts.push(`${semanticKey}=${min}-${max}`);
                } else if (min !== totalRange[0]) {
                    parts.push(`${semanticKey}>=${min}`);
                } else if (max !== totalRange[1]) {
                    parts.push(`${semanticKey}<=${max}`);
                }
            }

        } else if (conf.type === AdvFilterType.DROPDOWN) {
            if (conf.multistate) {
                const selection = state.value as MultiStateSelection;
                const includeValues: string[] = [];
                const excludeValues: string[] = [];

                for (const [name, sel] of Object.entries(selection)) {
                    // Format value with quantity constraint if present
                    let formattedValue = name;
                    if (conf.countable && (sel.count > 1 || sel.countOperator || sel.countMax !== undefined)) {
                        formattedValue = formatValueWithQuantity(name, sel.countOperator, sel.count, sel.countMax);
                    }
                    
                    if (sel.state === 'not') {
                        excludeValues.push(formattedValue);
                    } else if (sel.state === 'or' || sel.state === 'and') {
                        includeValues.push(formattedValue);
                    }
                }

                if (includeValues.length > 0) {
                    const formatted = includeValues.map(v => formatValue(v)).join(',');
                    parts.push(`${semanticKey}=${formatted}`);
                }
                if (excludeValues.length > 0) {
                    const formatted = excludeValues.map(v => formatValue(v)).join(',');
                    parts.push(`${semanticKey}!=${formatted}`);
                }

            } else {
                const values = state.value as string[];
                if (values.length > 0) {
                    const formatted = values.map(v => formatValue(v)).join(',');
                    parts.push(`${semanticKey}=${formatted}`);
                }
            }
        }
    }

    return parts.join(' ');
}

/**
 * Format a value for output, adding quotes if needed.
 */
function formatValue(value: string): string {
    // Add quotes if value contains spaces, commas, special chars, or quotes
    if (/[\s,=!<>"']/.test(value)) {
        // Use double quotes, escape any internal double quotes and backslashes
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `"${escaped}"`;
    }
    return value;
}

/**
 * Format a value with quantity constraint suffix.
 * E.g., "AC/2" with count=3, operator=">" → "AC/2:>3"
 */
function formatValueWithQuantity(
    name: string,
    operator: CountOperator | undefined,
    count: number,
    countMax?: number
): string {
    const formattedName = formatValue(name);
    
    // Range constraint
    if (countMax !== undefined) {
        const rangeStr = `${count}-${countMax}`;
        if (operator === '!=') {
            return `${formattedName}:!${rangeStr}`;
        }
        return `${formattedName}:${rangeStr}`;
    }
    
    // Single value constraint
    const op = operator ?? '=';
    if (op === '=' && count === 1) {
        // Default case, no suffix needed
        return formattedName;
    }
    
    // Format operator
    let opStr: string;
    switch (op) {
        case '=':
            opStr = '';  // Implicit
            break;
        case '!=':
            opStr = '!';  // Shorthand
            break;
        default:
            opStr = op;
    }
    
    return `${formattedName}:${opStr}${count}`;
}
