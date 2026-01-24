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

import { Unit } from "../models/units.model";
import { escapeRegExp, removeAccents } from './string.util';

/*
 * Author: Drake
 */
type Part = { raw: string; normalized: string; isNum: boolean; num?: number };
type CacheEntry = { parts: Part[] };

let naturalCompareCache = new Map<string, CacheEntry>();

function tokenizeForNaturalCompare(s: string, isModel: boolean): CacheEntry {
    // Normalize input
    if (typeof s !== 'string') {
        if (s == null) s = '';
        else s = String(s);
    }
    s = s.trim();

    // Make 'Prime' and 'Standard' variants go first, but only if this is the entire model name
    if (isModel) {
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

function getCachedParts(s: string, isModel: boolean): CacheEntry {
    const token = (typeof s === 'string') ? s : (s == null ? '' : String(s));
    const key = token + (isModel ? '~model' : '');
    const existing = naturalCompareCache.get(key);
    if (existing) return existing;
    const entry = tokenizeForNaturalCompare(token, isModel);
    naturalCompareCache.set(key, entry);
    return entry;
}

/**
 * Compares two strings in a natural order ("CN9-A" < "CN9-D3" < "CN10-D").
 * @param a The first string to compare.
 * @param b The second string to compare.
 * @returns A negative number if a < b, a positive number if a > b, and 0 if they are equal.
 */
export function naturalCompare(a: string, b: string, isModel: boolean = false): number {
    if (a === b) return 0;

    const entryA = getCachedParts(a, isModel);
    const entryB = getCachedParts(b, isModel);

    const partsA = entryA.parts;
    const partsB = entryB.parts;

    const maxLen = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < maxLen; i++) {
        const pa = partsA[i] || { raw: '', normalized: '', isNum: true, num: 0};
        const pb = partsB[i] || { raw: '', normalized: '', isNum: true, num: 0};

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

export function compareUnitsByName(a: Unit, b: Unit) {
    let comparison = naturalCompare(a.chassis || '', b.chassis || '');
    if (comparison === 0) {
        comparison = naturalCompare(a.model || '', b.model || '', true);
        if (comparison === 0) {
            comparison = (a.year || 0) - (b.year || 0);
        }
    }
    return comparison;
};

type RelevanceNormalizedText = {
    lower: string;
    alphaNum: string;
};

const relevanceNormalizeCache = new Map<string, RelevanceNormalizedText>();
const relevanceFlexRegexCache = new Map<string, RegExp>();

function normalizeForRelevance(text: string): RelevanceNormalizedText {
    const token = (typeof text === 'string') ? text : (text == null ? '' : String(text));
    const cached = relevanceNormalizeCache.get(token);
    if (cached) return cached;

    const lower = removeAccents(token).toLowerCase();
    const alphaNum = lower.replace(/[^a-z0-9]/gi, '');
    const entry = { lower, alphaNum };
    relevanceNormalizeCache.set(token, entry);
    return entry;
}

function getFlexTokenRegex(tokenAlphaNum: string): RegExp {
    const cached = relevanceFlexRegexCache.get(tokenAlphaNum);
    if (cached) return cached;

    // Allow gaps made of non-alphanumerics between each character.
    // This matches things like "tia n" or "t (ian)".
    const parts = tokenAlphaNum.split('').map(ch => escapeRegExp(ch));
    const pattern = parts.join('[^a-z0-9]*');
    const re = new RegExp(pattern, 'i');
    relevanceFlexRegexCache.set(tokenAlphaNum, re);
    return re;
}

function isBoundaryChar(ch: string | undefined): boolean {
    if (!ch) return true;
    return !(/[a-z0-9]/i.test(ch));
}

function boundaryBonus(textLower: string, startIndex: number, matchLength: number): number {
    const prev = startIndex > 0 ? textLower[startIndex - 1] : undefined;
    const next = (startIndex + matchLength) < textLower.length ? textLower[startIndex + matchLength] : undefined;
    const prevBoundary = isBoundaryChar(prev);
    const nextBoundary = isBoundaryChar(next);

    let bonus = 0;
    if (startIndex === 0) bonus += 600;
    if (prevBoundary) bonus += 300;
    if (nextBoundary) bonus += 150;
    if (prevBoundary && nextBoundary) bonus += 250; // looks like a whole token/word
    return bonus;
}

function scoreTokenInText(
    textLower: string,
    textAlphaNum: string,
    token: { token: string; mode: 'exact' | 'partial' }
): number {
    const rawToken = token.token ?? '';
    if (!rawToken) return 0;

    const normalized = normalizeForRelevance(rawToken);
    const tokenLower = normalized.lower;
    const tokenAlpha = normalized.alphaNum;

    // Exact tokens: prioritize whole-token matches with boundaries.
    if (token.mode === 'exact') {
        const escaped = escapeRegExp(tokenLower);
        const re = new RegExp(`(^|[^a-z0-9])(${escaped})($|[^a-z0-9])`, 'i');
        const m = re.exec(textLower);
        if (m && typeof m.index === 'number') {
            const start = m.index + (m[1]?.length ?? 0);
            const len = tokenLower.length;
            const posPenalty = start * 8;
            const lengthPenalty = Math.max(0, textLower.length - len);
            return 16000 - posPenalty - lengthPenalty + boundaryBonus(textLower, start, len) + 1200;
        }
        // Fallback: if alphanumeric-normalized text equals token (rare but possible)
        if (tokenAlpha && textAlphaNum === tokenAlpha) {
            return 15000;
        }
        return -Infinity;
    }

    // Partial tokens: contiguous match in the original normalized text.
    const directIdx = tokenLower ? textLower.indexOf(tokenLower) : -1;
    if (directIdx !== -1) {
        const posPenalty = directIdx * 6;
        const lengthPenalty = Math.max(0, textLower.length - tokenLower.length);
        return 14000 - posPenalty - lengthPenalty + boundaryBonus(textLower, directIdx, tokenLower.length);
    }

    // Contiguous match after removing non-alphanumerics.
    if (tokenAlpha) {
        const alphaIdx = textAlphaNum.indexOf(tokenAlpha);
        if (alphaIdx !== -1) {
            const posPenalty = alphaIdx * 5;
            const lengthPenalty = Math.max(0, textAlphaNum.length - tokenAlpha.length);
            // Slightly lower than direct contiguous because it may cross separators.
            return 11000 - posPenalty - lengthPenalty + 250;
        }

        // Flexible match allowing punctuation/space between characters.
        const flexRe = getFlexTokenRegex(tokenAlpha);
        const flexMatch = flexRe.exec(textLower);
        if (flexMatch && typeof flexMatch.index === 'number') {
            const span = flexMatch[0].length;
            const start = flexMatch.index;
            const posPenalty = start * 7;
            const spanPenalty = Math.max(0, span - tokenAlpha.length) * 30;
            const lengthPenalty = Math.max(0, textLower.length - tokenAlpha.length);
            return 9000 - posPenalty - spanPenalty - lengthPenalty + boundaryBonus(textLower, start, span);
        }
    }

    return -Infinity;
}

/**
 * Check if tokens appear in order within the text, with bonus for proximity.
 * Returns a bonus score if tokens match in sequence, 0 otherwise.
 */
function sequentialMatchBonus(
    textLower: string,
    textAlphaNum: string,
    tokens: Array<{ token: string; mode: 'exact' | 'partial' }>
): number {
    if (tokens.length < 2) return 0;
    
    // Try to find all tokens in order in the alphanumeric text
    let lastEnd = 0;
    let allInOrder = true;
    let totalGap = 0;
    let matchCount = 0;
    
    for (const t of tokens) {
        const tokenAlpha = normalizeForRelevance(t.token).alphaNum;
        if (!tokenAlpha) continue;
        
        const idx = textAlphaNum.indexOf(tokenAlpha, lastEnd);
        if (idx === -1) {
            allInOrder = false;
            break;
        }
        
        if (matchCount > 0) {
            totalGap += idx - lastEnd;
        }
        lastEnd = idx + tokenAlpha.length;
        matchCount++;
    }
    
    if (allInOrder && matchCount >= 2) {
        // Bonus for sequential match, reduced by gaps between tokens
        // Small gap = high bonus, large gap = smaller bonus
        const gapPenalty = Math.min(totalGap * 100, 1500);
        return 2000 - gapPenalty;
    }
    
    return 0;
}

function bestGroupScore(
    chassis: RelevanceNormalizedText,
    model: RelevanceNormalizedText,
    group: { tokens: Array<{ token: string; mode: 'exact' | 'partial' }> }
): number {
    if (!group.tokens || group.tokens.length === 0) return 0;

    let total = 0;
    let chassisHitCount = 0;

    for (const t of group.tokens) {
        const chassisScore = scoreTokenInText(chassis.lower, chassis.alphaNum, t);
        const modelScore = scoreTokenInText(model.lower, model.alphaNum, t);

        if (chassisScore === -Infinity && modelScore === -Infinity) {
            return -Infinity;
        }

        // Chassis is substantially more important than model.
        const weightedChassis = chassisScore === -Infinity ? -Infinity : (chassisScore * 3);
        const weightedModel = modelScore === -Infinity ? -Infinity : (modelScore * 1);

        if (weightedChassis >= weightedModel) {
            total += weightedChassis;
            chassisHitCount++;
        } else {
            total += weightedModel;
        }
    }

    // Bonus if many/all tokens hit in chassis.
    if (chassisHitCount > 0) total += chassisHitCount * 700;
    if (chassisHitCount === group.tokens.length && group.tokens.length > 1) total += 1200;

    // Bonus for tokens appearing in sequential order in the combined text
    const combinedLower = chassis.lower + ' ' + model.lower;
    const combinedAlphaNum = chassis.alphaNum + model.alphaNum;
    total += sequentialMatchBonus(combinedLower, combinedAlphaNum, group.tokens);
    
    // Also check model alone for sequential bonus (for model-specific searches)
    total += sequentialMatchBonus(model.lower, model.alphaNum, group.tokens) / 2;

    return total;
}

/**
 * Computes a relevance score for a unit name (chassis+model) given parsed search tokens.
 * Higher is more relevant.
 */
export function computeRelevanceScore(
    chassisText: string,
    modelText: string,
    searchTokens: Array<{ tokens: Array<{ token: string; mode: 'exact' | 'partial' }> }>
): number {
    if (!searchTokens || searchTokens.length === 0) return 0;

    const chassis = normalizeForRelevance(chassisText ?? '');
    const model = normalizeForRelevance(modelText ?? '');

    let best = -Infinity;
    for (const group of searchTokens) {
        const score = bestGroupScore(chassis, model, group);
        if (score > best) best = score;
    }

    return best === -Infinity ? 0 : best;
}
