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
import { MultiState, MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';

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

export type SemanticOperator = '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface SemanticToken {
    field: string;           // The semantic key (e.g., 'tmm', 'faction')
    operator: SemanticOperator;
    values: string[];        // Parsed values (already unquoted)
    rawText: string;         // Original text for this token
}

export interface ParsedSemanticQuery {
    textSearch: string;      // Remaining text that doesn't match filter syntax
    tokens: SemanticToken[]; // Parsed filter tokens
}

export interface FilterState {
    [key: string]: {
        value: any;
        interactedWith: boolean;
    };
}

/**
 * Extended filter state that includes exclusion ranges for semantic-only filters.
 * These are filters that can't be represented in the standard UI.
 */
export interface SemanticFilterState extends FilterState {
    [key: string]: {
        value: any;
        interactedWith: boolean;
        includeRanges?: [number, number][];  // For range filters: multiple include ranges (OR logic)
        excludeRanges?: [number, number][];  // For range filters: multiple exclude ranges
        displayText?: string;                // For range filters: formatted effective ranges (e.g., "0-10, 20-30")
        semanticOnly?: boolean;              // True if this filter can't be shown in UI
    };
}

// Build a lookup map from semanticKey to config
function buildSemanticKeyMap(gameSystem: GameSystem): Map<string, AdvFilterConfig> {
    const map = new Map<string, AdvFilterConfig>();
    for (const conf of ADVANCED_FILTERS) {
        // Only include filters for current game system or filters without game system
        if (conf.game && conf.game !== gameSystem) continue;
        const key = conf.semanticKey || conf.key;
        // If key already exists, the first one wins (game-specific takes priority)
        if (!map.has(key)) {
            map.set(key, conf);
        }
    }
    return map;
}

/**
 * Check if an array of numbers forms a contiguous range (each value differs by 1).
 */
function isContiguousRange(values: number[]): boolean {
    if (values.length <= 1) return true;
    const sorted = [...values].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] !== 1) {
            return false;
        }
    }
    return true;
}

/**
 * Format the effective ranges after applying exclusions.
 * E.g., range [0,99] with excludes [4] → "0-3, 5-99"
 */
function formatEffectiveRanges(min: number, max: number, excludes: number[]): string {
    if (excludes.length === 0) {
        return min === max ? `${min}` : `${min}-${max}`;
    }

    // Build list of included segments
    const segments: [number, number][] = [];
    let segmentStart = min;
    const sortedExcludes = [...new Set(excludes)].sort((a, b) => a - b);

    for (const ex of sortedExcludes) {
        if (ex > segmentStart && ex <= max) {
            // End current segment before the exclusion
            if (segmentStart <= ex - 1) {
                segments.push([segmentStart, ex - 1]);
            }
            segmentStart = ex + 1;
        }
    }
    
    // Add final segment after last exclusion
    if (segmentStart <= max) {
        segments.push([segmentStart, max]);
    }

    // Format segments
    return segments.map(([s, e]) => s === e ? `${s}` : `${s}-${e}`).join(', ');
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
 */
function parseValues(valueStr: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuote: '"' | "'" | null = null;
    let i = 0;

    while (i < valueStr.length) {
        const char = valueStr[i];

        if (inQuote) {
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
 * Check if a value string represents a range (e.g., "2-5", "100-200")
 * Returns [min, max] if it's a range, null otherwise
 */
function parseRange(value: string): [number, number] | null {
    // Match patterns like "2-5", "100-200", "-5-10" (negative min)
    // Be careful with negative numbers: -5--2 means -5 to -2
    const match = value.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
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
 * Parse semantic query from input text.
 * Extracts filter expressions and returns remaining text search.
 */
export function parseSemanticQuery(input: string, gameSystem: GameSystem): ParsedSemanticQuery {
    const semanticKeyMap = buildSemanticKeyMap(gameSystem);
    const tokens: SemanticToken[] = [];
    const textParts: string[] = [];

    // Regex to match field + operator + value
    // Field: word characters (a-z, 0-9, _)
    // Operator: = != >= <= > <
    // Value: everything until next whitespace or field=, handling quotes
    const tokenRegex = /(\w+)(!=|>=|<=|=|>|<)("[^"]*"|'[^']*'|[^\s]+)/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // First pass: find all potential filter expressions
    const matches: Array<{ match: RegExpExecArray; isFilter: boolean }> = [];

    while ((match = tokenRegex.exec(input)) !== null) {
        const field = match[1].toLowerCase();

        // Check if this field exists in our semantic map
        const conf = semanticKeyMap.get(field);

        matches.push({
            match,
            isFilter: !!conf
        });
    }

    // Reset and rebuild with proper text extraction
    lastIndex = 0;
    for (const { match: m, isFilter } of matches) {
        // Add text before this match
        if (m.index > lastIndex) {
            const textBefore = input.slice(lastIndex, m.index).trim();
            if (textBefore) {
                textParts.push(textBefore);
            }
        }

        if (isFilter) {
            const field = m[1].toLowerCase();
            const operator = m[2] as SemanticOperator;
            const rawValue = m[3];

            // Remove outer quotes if present
            let cleanValue = rawValue;
            if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
                (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
                cleanValue = rawValue.slice(1, -1);
            }

            const values = parseValues(cleanValue);

            tokens.push({
                field,
                operator,
                values,
                rawText: m[0]
            });
        } else {
            // Not a recognized filter, treat as text search
            textParts.push(m[0]);
        }

        lastIndex = m.index + m[0].length;
    }

    // Add remaining text after last match
    if (lastIndex < input.length) {
        const remaining = input.slice(lastIndex).trim();
        if (remaining) {
            textParts.push(remaining);
        }
    }

    return {
        textSearch: textParts.join(' ').trim(),
        tokens
    };
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
                const value = token.values[0]; // Range filters use first value

                if (token.operator === '=' || token.operator === '!=') {
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
                } else {
                    // Comparison operators (>, <, >=, <=)
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

            if (hasMultipleRanges || hasExclusions) {
                semanticOnly = true;
                
                // Apply exclusions to each include range
                let effectiveSegments: [number, number][] = [];
                for (const range of mergedRanges) {
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
                    finalIncludeRanges = effectiveSegments;
                    displayText = formatRangeSegments(effectiveSegments);
                }
                
                // Store exclude ranges for reference
                if (mergedExcludeRanges.length > 0) {
                    finalExcludeRanges = mergedExcludeRanges;
                }
            }

            // Compute the overall min/max for UI display (covers all include ranges)
            let min = totalRange[0];
            let max = totalRange[1];
            if (mergedRanges.length > 0) {
                min = Math.min(...mergedRanges.map(r => r[0]));
                max = Math.max(...mergedRanges.map(r => r[1]));
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
            if (conf.multistate) {
                // Handle multistate dropdowns (supports include/exclude)
                const selection: MultiStateSelection = {};

                for (const token of fieldTokens) {
                    const state: MultiState = token.operator === '!=' ? 'not' : 'or';

                    for (const val of token.values) {
                        // If already exists as 'or' and we're adding as 'or', keep it
                        // If adding as 'not', it overrides
                        if (selection[val] && state === 'not') {
                            selection[val].state = 'not';
                        } else if (!selection[val]) {
                            selection[val] = { name: val, state, count: 1 };
                        }
                    }
                }

                if (Object.keys(selection).length > 0) {
                    filterState[conf.key] = {
                        value: selection,
                        interactedWith: true
                    };
                }

            } else {
                // Handle regular dropdowns (only include, no exclude)
                const values: string[] = [];

                for (const token of fieldTokens) {
                    if (token.operator === '=') {
                        values.push(...token.values);
                    }
                    // != for non-multistate dropdowns is not supported in UI
                }

                if (values.length > 0) {
                    filterState[conf.key] = {
                        value: [...new Set(values)], // Deduplicate
                        interactedWith: true
                    };
                }
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
    filterState: FilterState | SemanticFilterState,
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
        if (conf.game && conf.game !== gameSystem) continue;

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
                    if (sel.state === 'not') {
                        excludeValues.push(name);
                    } else if (sel.state === 'or' || sel.state === 'and') {
                        includeValues.push(name);
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
    // Add quotes if value contains spaces, commas, or special chars
    if (/[\s,=!<>]/.test(value)) {
        // Use double quotes, escape any internal double quotes
        const escaped = value.replace(/"/g, '\\"');
        return `"${escaped}"`;
    }
    return value;
}

/**
 * Merge semantic filter changes with existing filters.
 * Clears filters not present in the semantic query.
 */
export function applySemanticQuery(
    input: string,
    gameSystem: GameSystem,
    totalRanges: Record<string, [number, number]>
): { textSearch: string; filterState: SemanticFilterState } {
    const parsed = parseSemanticQuery(input, gameSystem);
    const filterState = tokensToFilterState(parsed.tokens, gameSystem, totalRanges);

    return {
        textSearch: parsed.textSearch,
        filterState
    };
}

/**
 * Check if a filter state entry has semantic-only features that can't be shown in UI.
 */
export function isSemanticOnly(state: FilterState[string]): boolean {
    const extState = state as SemanticFilterState[string];
    return !!extState.semanticOnly || (!!extState.excludeRanges && extState.excludeRanges.length > 0);
}
