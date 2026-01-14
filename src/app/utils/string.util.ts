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

/**
 * Convert a wildcard pattern (e.g., "AC*" or "*/3/*") to a RegExp.
 * Supports * as a wildcard for any characters.
 * @param pattern The wildcard pattern.
 * @returns A case-insensitive RegExp matching the pattern.
 */
export function wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr, 'i');
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
    return s;
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
