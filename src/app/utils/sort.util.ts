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

/*
 * Author: Drake
 */
type Part = { raw: string; normalized: string; isNum: boolean; num?: number };
type CacheEntry = { parts: Part[] };

let naturalCompareCache = new Map<string, CacheEntry>();

function tokenizeForNaturalCompare(s: string, is_model: boolean): CacheEntry {
    // Normalize input
    if (typeof s !== 'string') {
        if (s == null) s = '';
        else s = String(s);
    }
    s = s.trim();

    // Make 'Prime' and 'Standard' variants go first, but only if this is the entire model name
    if (is_model) {
        if (s == 'Prime') {
            const part: Part = {
                raw: s,
                normalized: '0',
                isNum: false,
                num: 0
            };
            return {parts: [part]};
        }
        if (s == '') {
            const part: Part = {
                raw: s,
                normalized: '0',
                isNum: true,
                num: 0
            };
            return {parts: [part]};
        }
    }

    // Otherwise, tokenize and compare the strings piecewise.
    const re = /(\d+|[A-Za-z]+|[^A-Za-z\d]+)/g;
    const rawParts = s.match(re) || [s];
    const parts: Part[] = rawParts.map(p => {
        const isNum = /^\d+$/.test(p);
        return {
            raw: p,
            normalized: isNum ? p : p.replace(/[^A-Za-z0-9]+/g, '').toLowerCase(),
            isNum,
            num: isNum ? parseInt(p, 10) : undefined
        };
    });
    return { parts };
}

function getCachedParts(s: string, is_model: boolean): CacheEntry {
    const key = (typeof s === 'string') ? s : (s == null ? '' : String(s));
    const existing = naturalCompareCache.get(key + is_model);
    if (existing) return existing;
    const entry = tokenizeForNaturalCompare(key, is_model);
    naturalCompareCache.set(key, entry);
    return entry;
}

/**
 * Compares two strings in a natural order ("CN9-A" < "CN9-D3" < "CN10-D").
 * @param a The first string to compare.
 * @param b The second string to compare.
 * @returns A negative number if a < b, a positive number if a > b, and 0 if they are equal.
 */
export function naturalCompare(a: string, b: string, is_model: boolean = false): number {
    if (a === b) return 0;

    const entryA = getCachedParts(a, is_model);
    const entryB = getCachedParts(b, is_model);

    const partsA = entryA.parts;
    const partsB = entryB.parts;

    const maxLen = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < maxLen; i++) {
        const pa = partsA[i] || { raw: '', normalized: '', isNum: false };
        const pb = partsB[i] || { raw: '', normalized: '', isNum: false };

        const isNumA = pa.isNum;
        const isNumB = pb.isNum;

        if (isNumA && isNumB) {
            const na = pa.num!;
            const nb = pb.num!;
            if (na !== nb) return na - nb;
            continue;
        }

        if (!isNumA && !isNumB) {
            if (pa.normalized !== pb.normalized) {
                return pa.normalized.localeCompare(pb.normalized);
            }
            continue;
        }

        // If one is numeric and the other is not, numeric comes first
        return isNumA ? -1 : 1;
    }

    // Fallback to locale compare if all tokens equal
    return a.localeCompare(b);
}
