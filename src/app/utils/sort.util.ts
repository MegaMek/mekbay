// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from "../models/unit-summary.model";
import { escapeRegExp, removeAccents } from './string.util';


type Part = { raw: string; normalized: string; isNum: boolean; num?: number };
type NaturalSortKey = { raw: string; parts: Part[] };

// The checked-in 9,876-unit corpus needs 7,419 distinct chassis/model keys.
// 16K leaves room for the expected ~15K catalog without retaining arbitrary input forever.
const NATURAL_SORT_CACHE_LIMIT = 16_384;
const naturalSortKeyCache = new Map<string, NaturalSortKey>();

function tokenizeForNaturalCompare(s: string, isModel: boolean): NaturalSortKey {
    // Normalize input
    if (typeof s !== 'string') {
        if (s == null) s = '';
        else s = String(s);
    }
    const raw = s;
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
            return { raw, parts: [part] };
        }
        if (s == '') {
            const part: Part = {
                raw: s,
                normalized: '0',
                isNum: true,
                num: 0
            };
            return { raw, parts: [part] };
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
    return { raw, parts };
}

function naturalSortKey(value: string, isModel: boolean): NaturalSortKey {
    const token = typeof value === 'string' ? value : (value == null ? '' : String(value));
    const cacheKey = `${token}\0${isModel ? 'model' : 'plain'}`;
    const cached = naturalSortKeyCache.get(cacheKey);
    if (cached) return cached;

    const result = tokenizeForNaturalCompare(token, isModel);
    if (naturalSortKeyCache.size >= NATURAL_SORT_CACHE_LIMIT) {
        const oldest = naturalSortKeyCache.keys().next().value;
        if (oldest !== undefined) naturalSortKeyCache.delete(oldest);
    }
    naturalSortKeyCache.set(cacheKey, result);
    return result;
}

/**
 * Compares two strings in a natural order ("CN9-A" < "CN9-D3" < "CN10-D").
 * @param a The first string to compare.
 * @param b The second string to compare.
 * @returns A negative number if a < b, a positive number if a > b, and 0 if they are equal.
 */
export function naturalCompare(a: string, b: string, isModel: boolean = false): number {
    if (a === b) return 0;

    const entryA = naturalSortKey(a, isModel);
    const entryB = naturalSortKey(b, isModel);

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
    return entryA.raw.localeCompare(entryB.raw);
}

export function compareUnitsByName(
    a: Pick<UnitSummary, 'chassis' | 'model' | 'year'>,
    b: Pick<UnitSummary, 'chassis' | 'model' | 'year'>,
) {
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

export interface RelevanceSearchToken {
    readonly token: string;
    readonly mode: 'exact' | 'partial';
}

export interface RelevanceSearchGroup {
    readonly tokens: readonly RelevanceSearchToken[];
}

export interface CompiledRelevanceSearchGroup {
    readonly tokens: readonly CompiledRelevanceSearchToken[];
}

interface CompiledRelevanceSearchToken extends RelevanceSearchToken {
    readonly lower: string;
    readonly alphaNum: string;
    readonly exactRegex: RegExp | null;
    readonly flexRegex: RegExp | null;
}

function normalizeForRelevance(text: string): RelevanceNormalizedText {
    const token = (typeof text === 'string') ? text : (text == null ? '' : String(text));
    const lower = removeAccents(token).toLowerCase();
    const alphaNum = lower.replace(/[^a-z0-9]/gi, '');
    return { lower, alphaNum };
}

function getFlexTokenRegex(tokenAlphaNum: string): RegExp {
    // Allow gaps made of non-alphanumerics between each character.
    // This matches things like "tia n" or "t (ian)".
    const parts = tokenAlphaNum.split('').map(ch => escapeRegExp(ch));
    const pattern = parts.join('[^a-z0-9]*');
    return new RegExp(pattern, 'i');
}

/** Compile immutable search text once before scoring a unit collection. */
export function compileRelevanceSearchGroups(
    groups: readonly RelevanceSearchGroup[],
): readonly CompiledRelevanceSearchGroup[] {
    return Object.freeze(groups.map(group => Object.freeze({
        tokens: Object.freeze(group.tokens.map(token => {
            const normalized = normalizeForRelevance(token.token);
            return Object.freeze({
                ...token,
                lower: normalized.lower,
                alphaNum: normalized.alphaNum,
                exactRegex: token.mode === 'exact' && normalized.lower
                    ? new RegExp(`(^|[^a-z0-9])(${escapeRegExp(normalized.lower)})($|[^a-z0-9])`, 'i')
                    : null,
                flexRegex: normalized.alphaNum ? getFlexTokenRegex(normalized.alphaNum) : null,
            });
        })),
    })));
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
    token: CompiledRelevanceSearchToken,
): number {
    if (!token.token) return 0;

    // Exact tokens: prioritize whole-token matches with boundaries.
    if (token.mode === 'exact') {
        const m = token.exactRegex?.exec(textLower);
        if (m && typeof m.index === 'number') {
            const start = m.index + (m[1]?.length ?? 0);
            const len = token.lower.length;
            const posPenalty = start * 8;
            const lengthPenalty = Math.max(0, textLower.length - len);
            return 16000 - posPenalty - lengthPenalty + boundaryBonus(textLower, start, len) + 1200;
        }
        // Fallback: if alphanumeric-normalized text equals token (rare but possible)
        if (token.alphaNum && textAlphaNum === token.alphaNum) {
            return 15000;
        }
        return -Infinity;
    }

    // Partial tokens: contiguous match in the original normalized text.
    const directIdx = token.lower ? textLower.indexOf(token.lower) : -1;
    if (directIdx !== -1) {
        const posPenalty = directIdx * 6;
        const lengthPenalty = Math.max(0, textLower.length - token.lower.length);
        return 14000 - posPenalty - lengthPenalty + boundaryBonus(textLower, directIdx, token.lower.length);
    }

    // Contiguous match after removing non-alphanumerics.
    if (token.alphaNum) {
        const alphaIdx = textAlphaNum.indexOf(token.alphaNum);
        if (alphaIdx !== -1) {
            const posPenalty = alphaIdx * 5;
            const lengthPenalty = Math.max(0, textAlphaNum.length - token.alphaNum.length);
            // Slightly lower than direct contiguous because it may cross separators.
            return 11000 - posPenalty - lengthPenalty + 250;
        }

        // Flexible match allowing punctuation/space between characters.
        const flexMatch = token.flexRegex?.exec(textLower);
        if (flexMatch && typeof flexMatch.index === 'number') {
            const span = flexMatch[0].length;
            const start = flexMatch.index;
            const posPenalty = start * 7;
            const spanPenalty = Math.max(0, span - token.alphaNum.length) * 30;
            const lengthPenalty = Math.max(0, textLower.length - token.alphaNum.length);
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
    _textLower: string,
    textAlphaNum: string,
    tokens: readonly CompiledRelevanceSearchToken[],
): number {
    if (tokens.length < 2) return 0;
    
    // Try to find all tokens in order in the alphanumeric text
    let lastEnd = 0;
    let allInOrder = true;
    let totalGap = 0;
    let matchCount = 0;
    
    for (const t of tokens) {
        const tokenAlpha = t.alphaNum;
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
    group: CompiledRelevanceSearchGroup,
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
    searchTokens: readonly CompiledRelevanceSearchGroup[],
): number {
    const chassis = normalizeForRelevance(chassisText ?? '');
    const model = normalizeForRelevance(modelText ?? '');

    return computeRelevanceScoreFromPrepared(
        chassis.lower,
        chassis.alphaNum,
        model.lower,
        model.alphaNum,
        searchTokens,
    );
}

/** Score catalog-prepared name fields without normalizing every search. */
export function computeRelevanceScoreFromPrepared(
    chassisLower: string,
    chassisAlphaNum: string,
    modelLower: string,
    modelAlphaNum: string,
    searchTokens: readonly CompiledRelevanceSearchGroup[],
): number {
    if (!searchTokens || searchTokens.length === 0) return 0;

    const chassis = { lower: chassisLower, alphaNum: chassisAlphaNum };
    const model = { lower: modelLower, alphaNum: modelAlphaNum };

    let best = -Infinity;
    for (const group of searchTokens) {
        const score = bestGroupScore(chassis, model, group);
        if (score > best) best = score;
    }

    return best === -Infinity ? 0 : best;
}
