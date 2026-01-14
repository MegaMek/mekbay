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

import { removeAccents, escapeHtml, escapeRegExp } from './string.util';

/**
 * Represents a single token from a search query.
 */
export interface SearchToken {
    token: string;
    mode: 'exact' | 'partial';
}

/**
 * Represents a group of tokens from a search query.
 * Tokens within a group are treated with AND logic.
 * Multiple groups are treated with OR logic.
 */
export interface SearchTokensGroup {
    tokens: SearchToken[];
}

/**
 * Parses a search query string into an array of token groups.
 * - Handles comma/semicolon for OR conditions (new groups).
 * - Handles double quotes for exact-match tokens.
 * - Removes accents and converts to lowercase.
 * @param query The search query string.
 * @returns An array of SearchTokensGroup.
 */
export function parseSearchQuery(query: string): SearchTokensGroup[] {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return [];

    // Split top-level on commas/semicolons but ignore those inside double quotes
    const groups: string[] = [];
    let buf = '';
    let inQuotes = false;
    for (let i = 0; i < trimmedQuery.length; i++) {
        const ch = trimmedQuery[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            buf += ch;
        } else if ((ch === ',' || ch === ';') && !inQuotes) {
            const trimmed = buf.trim();
            if (trimmed) groups.push(trimmed);
            buf = '';
        } else {
            buf += ch;
        }
    }
    const last = buf.trim();
    if (last) groups.push(last);

    const results = groups.map(group => {
        const tokens: SearchToken[] = [];
        // Extract quoted tokens (exact) and unquoted tokens (partial)
        const re = /"([^"]+)"|(\S+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(group)) !== null) {
            if (m[1] !== undefined) {
                // Quoted exact token
                const cleaned = removeAccents(m[1].trim());
                if (cleaned) tokens.push({ token: cleaned, mode: 'exact' });
            } else if (m[2] !== undefined) {
                const cleaned = removeAccents(m[2].trim());
                if (cleaned) tokens.push({ token: cleaned, mode: 'partial' });
            }
        }

        // Deduplicate tokens, preserving longest-first for partials
        const uniqueMap = new Map<string, SearchToken>();
        tokens.sort((a, b) => b.token.length - a.token.length);
        for (const t of tokens) {
            if (!uniqueMap.has(t.token)) uniqueMap.set(t.token, t);
        }

        return { tokens: Array.from(uniqueMap.values()) };
    });
    return results;
}

/**
 * Checks if a set of partial tokens match a text without overlapping.
 * @param text The text to search within.
 * @param tokens The partial tokens to match.
 * @returns True if all tokens are found non-overlappingly, false otherwise.
 */
function tokensMatchNonOverlapping(text: string, tokens: string[]): boolean {
    const hay = text; // Already lowercased by caller
    const taken: Array<[number, number]> = [];
    for (const token of tokens) {
        if (!token) continue;
        let start = 0;
        let found = false;
        while (start <= hay.length - token.length) {
            const idx = hay.indexOf(token, start);
            if (idx === -1) break;
            const end = idx + token.length;
            const overlaps = taken.some(([s, e]) => !(end <= s || idx >= e));
            if (!overlaps) {
                taken.push([idx, end]);
                found = true;
                break;
            }
            start = idx + 1;
        }
        if (!found) return false;
    }
    return true;
}

/**
 * Checks if a given text matches the search tokens.
 * @param textToSearch The text to check.
 * @param searchTokens The parsed search token groups.
 * @returns True if the text matches, false otherwise.
 */
export function matchesSearch(
    textToSearch: string, 
    searchTokens: SearchTokensGroup[],
    alphanumericNormalization = false
): boolean {
    if (!searchTokens || searchTokens.length === 0) return true;

    const normalizedText = removeAccents(textToSearch.toLowerCase());
    const alphaNumText = alphanumericNormalization 
        ? normalizedText.replace(/[^a-z0-9]/gi, '') 
        : '';

    // The text matches if it matches ANY of the OR groups
    return searchTokens.some(group => {
        const exactTokens = group.tokens.filter(t => t.mode === 'exact').map(t => t.token);
        const partialTokens = group.tokens.filter(t => t.mode === 'partial').map(t => t.token);

        // All exact tokens must match as whole words
        if (exactTokens.length > 0) {
            const textWords = new Set(normalizedText.split(/\s+/));
            const alphaNumToken = alphanumericNormalization ? new Set(alphaNumText.split(/\s+/)) : new Set();
            for (const et of exactTokens) {
                if (!textWords.has(et) && normalizedText !== et) {
                    if (!alphanumericNormalization || (!alphaNumToken.has(et) && alphaNumText !== et)) {
                        return false;
                    }
                }
            }
        }

        // All partial tokens must match non-overlappingly
        if (partialTokens.length > 0) {
            if (!tokensMatchNonOverlapping(normalizedText, partialTokens)) {
                if (!alphanumericNormalization || !tokensMatchNonOverlapping(alphaNumText, partialTokens)) {
                    return false;
                }
            }
        }

        return true;
    });
}

/**
 * Highlights the matching tokens in a given text.
 * @param text The text to highlight.
 * @param searchTokens The parsed search token groups.
 * @returns An HTML string with matches wrapped in <b> tags.
 */
export function highlightMatches(
    text: string, 
    searchTokens: SearchTokensGroup[],
    alphanumericNormalization = false
): string {
    if (!text) return '';
    if (!searchTokens || searchTokens.length === 0) return escapeHtml(text);

    // Flatten all tokens from all groups for highlighting
    const tokenMap = new Map<string, 'exact' | 'partial'>();
    for (const group of searchTokens) {
        for (const t of group.tokens) {
            const existing = tokenMap.get(t.token);
            if (!existing || (existing === 'partial' && t.mode === 'exact')) {
                tokenMap.set(t.token, t.mode);
            }
        }
    }

    const tokens = Array.from(tokenMap.keys())
        .sort((a, b) => b.length - a.length) // Longest first to avoid partial overlaps
        .filter(Boolean);

    if (tokens.length === 0) return escapeHtml(text);

    let pattern = tokens.map(escapeRegExp).join('|');

    if (alphanumericNormalization) {
        const alphaNumTokens = tokens.map(token => {
            const chars = token.split('');
            return chars.map((char, index) => {
                const isLastChar = index === chars.length - 1;
                return `${escapeRegExp(char)}${isLastChar ? '' : '[^a-zA-Z0-9]*'}`;
            }).join('');
        });
        pattern += '|' + alphaNumTokens.join('|');
    }
    
    if (!pattern) return escapeHtml(text);

    const regex = new RegExp(`(${pattern})`, 'gi');

    const parts = text.split(regex);
    return parts
        .map((part, index) => ((index % 2) === 1 ? `<span class="matchHighlight">${escapeHtml(part)}</span>` : escapeHtml(part)))
        .join('');
}
