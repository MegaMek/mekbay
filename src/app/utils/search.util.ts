// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { removeAccents, escapeHtml, escapeRegExp } from './string.util';

function normalizeSearchValue(value: string): string {
    return removeAccents(value.toLowerCase());
}

function toAlphanumericSearchValue(value: string): string {
    return normalizeSearchValue(value).replace(/[^a-z0-9]/gi, '');
}

interface AlphanumericProjection {
    collapsed: string;
    originalIndices: number[];
    startsAfterWhitespace: boolean[];
}

function isAlphanumericSearchChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function buildAlphanumericProjection(value: string): AlphanumericProjection {
    return buildAlphanumericProjectionFromNormalized(normalizeSearchValue(value));
}

function buildAlphanumericProjectionFromNormalized(normalized: string): AlphanumericProjection {
    let collapsed = '';
    const originalIndices: number[] = [];
    const startsAfterWhitespace: boolean[] = [];
    let sawWhitespaceSinceLastChar = false;

    for (let index = 0; index < normalized.length; index++) {
        const char = normalized[index];
        if (isAlphanumericSearchChar(char)) {
            collapsed += char;
            originalIndices.push(index);
            startsAfterWhitespace.push(originalIndices.length === 1 ? true : sawWhitespaceSinceLastChar);
            sawWhitespaceSinceLastChar = false;
            continue;
        }

        if (/\s/.test(char)) {
            sawWhitespaceSinceLastChar = true;
        }
    }

    return {
        collapsed,
        originalIndices,
        startsAfterWhitespace,
    };
}

function crossesWhitespaceBoundary(projection: AlphanumericProjection, start: number, end: number): boolean {
    for (let index = start + 1; index < end; index++) {
        if (projection.startsAfterWhitespace[index]) {
            return true;
        }
    }

    return false;
}

function collectHighlightRanges(text: string, tokens: string[]): Array<[number, number]> {
    const projection = buildAlphanumericProjection(text);
    if (!projection.collapsed) {
        return [];
    }

    const ranges: Array<[number, number]> = [];

    for (const rawToken of tokens) {
        const token = toAlphanumericSearchValue(rawToken);
        if (!token) {
            continue;
        }

        let searchStart = 0;
        while (searchStart <= projection.collapsed.length - token.length) {
            const collapsedIndex = projection.collapsed.indexOf(token, searchStart);
            if (collapsedIndex === -1) {
                break;
            }

            const collapsedEnd = collapsedIndex + token.length;
            const spansWhitespace = crossesWhitespaceBoundary(projection, collapsedIndex, collapsedEnd);
            if (spansWhitespace && !projection.startsAfterWhitespace[collapsedIndex]) {
                searchStart = collapsedIndex + 1;
                continue;
            }

            const start = projection.originalIndices[collapsedIndex];
            const end = projection.originalIndices[collapsedEnd - 1] + 1;
            const overlaps = ranges.some(([rangeStart, rangeEnd]) => !(end <= rangeStart || start >= rangeEnd));
            if (!overlaps) {
                ranges.push([start, end]);
            }

            searchStart = collapsedIndex + 1;
        }
    }

    return ranges.sort((left, right) => left[0] - right[0]);
}

function renderHighlightedRanges(text: string, ranges: Array<[number, number]>): string {
    if (ranges.length === 0) {
        return escapeHtml(text);
    }

    let cursor = 0;
    let output = '';

    for (const [start, end] of ranges) {
        if (start > cursor) {
            output += escapeHtml(text.slice(cursor, start));
        }
        output += `<span class="matchHighlight">${escapeHtml(text.slice(start, end))}</span>`;
        cursor = end;
    }

    if (cursor < text.length) {
        output += escapeHtml(text.slice(cursor));
    }

    return output;
}

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
                const cleaned = normalizeSearchValue(m[1].trim());
                if (cleaned) tokens.push({ token: cleaned, mode: 'exact' });
            } else if (m[2] !== undefined) {
                const cleaned = normalizeSearchValue(m[2].trim());
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
function tokensMatchNonOverlapping(text: string, tokens: readonly string[]): boolean {
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

function isSearchWhitespace(char: string): boolean {
    return /\s/.test(char);
}

function findAlphanumericTokenRange(
    normalizedText: string,
    token: string,
    taken: readonly [number, number][],
): [number, number] | null {
    let sawAlphanumeric = false;
    let sawWhitespaceSinceLastAlphanumeric = false;

    for (let start = 0; start < normalizedText.length; start++) {
        const startChar = normalizedText[start];
        if (!isAlphanumericSearchChar(startChar)) {
            if (isSearchWhitespace(startChar)) {
                sawWhitespaceSinceLastAlphanumeric = true;
            }
            continue;
        }

        const startsAfterWhitespace = !sawAlphanumeric || sawWhitespaceSinceLastAlphanumeric;
        sawAlphanumeric = true;
        sawWhitespaceSinceLastAlphanumeric = false;
        if (startChar !== token[0]) {
            continue;
        }

        let cursor = start;
        let tokenIndex = 0;
        let spansWhitespace = false;
        while (cursor < normalizedText.length && tokenIndex < token.length) {
            const char = normalizedText[cursor];
            if (isAlphanumericSearchChar(char)) {
                if (char !== token[tokenIndex]) {
                    break;
                }
                tokenIndex++;
            } else if (isSearchWhitespace(char)) {
                spansWhitespace = true;
            }
            cursor++;
        }

        if (tokenIndex !== token.length || (spansWhitespace && !startsAfterWhitespace)) {
            continue;
        }

        const overlaps = taken.some(([takenStart, takenEnd]) => (
            !(cursor <= takenStart || start >= takenEnd)
        ));
        if (!overlaps) {
            return [start, cursor];
        }
    }

    return null;
}

function alphanumericTokensMatchNonOverlapping(
    normalizedText: string,
    tokens: readonly string[],
): boolean {
    const taken: Array<[number, number]> = [];
    for (const token of tokens) {
        if (!token) {
            continue;
        }

        const range = findAlphanumericTokenRange(normalizedText, token, taken);
        if (!range) {
            return false;
        }
        taken.push(range);
    }

    return true;
}

interface CompiledSearchTokensGroup {
    readonly exactTokens: readonly string[];
    readonly partialTokens: readonly string[];
    readonly alphaNumExactTokens: readonly string[];
    readonly alphaNumPartialTokens: readonly string[];
}

/** Compile query-only work once when the same search is evaluated against many texts. */
export function createSearchMatcher(
    searchTokens: SearchTokensGroup[],
    alphanumericNormalization = false,
    textIsNormalized = false,
): (textToSearch: string, precomputedAlphanumericText?: string) => boolean {
    if (!searchTokens || searchTokens.length === 0) {
        return () => true;
    }

    const compiledGroups: CompiledSearchTokensGroup[] = searchTokens.map(group => {
        const exactTokens = group.tokens.filter(token => token.mode === 'exact').map(token => token.token);
        const partialTokens = group.tokens.filter(token => token.mode === 'partial').map(token => token.token);
        return {
            exactTokens,
            partialTokens,
            alphaNumExactTokens: alphanumericNormalization
                ? exactTokens.map(toAlphanumericSearchValue).filter(Boolean)
                : [],
            alphaNumPartialTokens: alphanumericNormalization
                ? partialTokens.map(toAlphanumericSearchValue).filter(Boolean)
                : [],
        };
    });

    return (textToSearch: string, precomputedAlphanumericText?: string): boolean => {
        const normalizedText = textIsNormalized ? textToSearch : normalizeSearchValue(textToSearch);
        let alphaNumText = precomputedAlphanumericText;
        const getAlphaNumText = (): string => {
            alphaNumText ??= normalizedText.replace(/[^a-z0-9]/g, '');
            return alphaNumText;
        };

        return compiledGroups.some(group => {
            if (group.exactTokens.length === 0 && group.partialTokens.length === 1) {
                const partialToken = group.partialTokens[0];
                if (normalizedText.includes(partialToken)) {
                    return true;
                }

                const alphaNumPartialToken = group.alphaNumPartialTokens[0];
                return Boolean(
                    alphanumericNormalization
                    && alphaNumPartialToken
                    && getAlphaNumText().includes(alphaNumPartialToken)
                    && findAlphanumericTokenRange(normalizedText, alphaNumPartialToken, [])
                );
            }

            if (group.exactTokens.length > 0) {
                const textWords = new Set(normalizedText.split(/\s+/));
                const alphaNumWords = alphanumericNormalization
                    ? new Set(
                        normalizedText
                            .split(/\s+/)
                            .map(toAlphanumericSearchValue)
                            .filter(Boolean),
                    )
                    : new Set<string>();
                for (let index = 0; index < group.exactTokens.length; index++) {
                    const exactToken = group.exactTokens[index];
                    if (!textWords.has(exactToken) && normalizedText !== exactToken) {
                        const alphaNumExactToken = group.alphaNumExactTokens[index];
                        if (
                            !alphanumericNormalization
                            || !alphaNumExactToken
                            || (!alphaNumWords.has(alphaNumExactToken) && getAlphaNumText() !== alphaNumExactToken)
                        ) {
                            return false;
                        }
                    }
                }
            }

            if (
                group.partialTokens.length > 0
                && !tokensMatchNonOverlapping(normalizedText, group.partialTokens)
                && (
                    !alphanumericNormalization
                    || group.alphaNumPartialTokens.length === 0
                    || !tokensMatchNonOverlapping(getAlphaNumText(), group.alphaNumPartialTokens)
                    || !alphanumericTokensMatchNonOverlapping(
                        normalizedText,
                        group.alphaNumPartialTokens,
                    )
                )
            ) {
                return false;
            }

            return true;
        });
    };
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
    return createSearchMatcher(searchTokens, alphanumericNormalization)(textToSearch);
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

    if (alphanumericNormalization) {
        return renderHighlightedRanges(text, collectHighlightRanges(text, tokens));
    }

    let pattern = tokens.map(escapeRegExp).join('|');
    
    if (!pattern) return escapeHtml(text);

    const regex = new RegExp(`(${pattern})`, 'gi');

    const parts = text.split(regex);
    return parts
        .map((part, index) => ((index % 2) === 1 ? `<span class="matchHighlight">${escapeHtml(part)}</span>` : escapeHtml(part)))
        .join('');
}
