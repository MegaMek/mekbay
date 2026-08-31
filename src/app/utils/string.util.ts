// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Shared string utility functions.
 * These are pure functions with no dependencies on Angular services.
 */

/**
 * Escape special regex characters in a string.
 * @param s The string to escape.
 * @returns The escaped string safe for use in a RegExp.
 */
export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WILDCARD_REGEX_CACHE_LIMIT = 256;
const wildcardRegexCache = new Map<string, RegExp>();

/**
 * Convert a wildcard pattern (e.g., "AC*" or "*/3/*") to a RegExp.
 * Supports * as a wildcard for any characters.
 * The small bound covers active search patterns without retaining query history forever.
 * @param pattern The wildcard pattern.
 * @returns A case-insensitive RegExp matching the pattern.
 */
export function wildcardToRegex(pattern: string): RegExp {
    const cached = wildcardRegexCache.get(pattern);
    if (cached) return cached;

    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
    const result = new RegExp(regexStr, 'i');
    if (wildcardRegexCache.size >= WILDCARD_REGEX_CACHE_LIMIT) {
        const oldest = wildcardRegexCache.keys().next().value;
        if (oldest !== undefined) wildcardRegexCache.delete(oldest);
    }
    wildcardRegexCache.set(pattern, result);
    return result;
}

/**
 * Remove diacritical marks (accents) from a string.
 * Handles common special characters like ł, ø, ß, æ, œ.
 * @param str The string to process.
 * @returns The string with accents removed.
 */
export function removeAccents(str: string): string {
    if (!str) return '';
    // Decompose combined characters, then remove diacritical marks.
    let s = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Handle specific characters that are not decomposed.
    s = s.replace(/ł/g, 'l').replace(/Ł/g, 'L');
    s = s.replace(/ø/g, 'o').replace(/Ø/g, 'O');
    s = s.replace(/ß/g, 'ss');
    s = s.replace(/æ/g, 'ae').replace(/Æ/g, 'AE');
    s = s.replace(/œ/g, 'oe').replace(/Œ/g, 'OE');
    s = s.replace(/[\u2018\u2019\u201B\u2032]/g, "'");
    s = s.replace(/[\u201C\u201D]/g, '"');
    s = s.replace(/[\u2010-\u2015\u2212]/g, '-');
    return s;
}

/**
 * Normalize a value for loose text matching.
 * Removes accents, lowercases, and strips non-alphanumeric characters.
 */
export function normalizeLooseText(str: string): string {
    return removeAccents(str)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param s The string to escape.
 * @returns The HTML-escaped string.
 */
export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
