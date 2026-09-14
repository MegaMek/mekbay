// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Pattern bounds, enumeration, matching, and scoring shared by leaf and composition rules. */

import { visitOrgSearch, type SolverGuard } from './org-solve-session';
import type {
    OrgBucketValue,
    OrgPatternBucketMatcher,
    OrgPatternReferenceName,
    OrgPatternScoreTerm,
    OrgPatternSpec,
} from './org-types';

export interface PatternCandidate {
    readonly allocation: ReadonlyMap<string, number>;
    readonly score: number;
}

function resolvePatternBucketValues(
    matcher: OrgPatternBucketMatcher,
    availableBucketValues: readonly string[],
): readonly string[] {
    if (isPatternBucketListMatcher(matcher)) {
        return matcher.map(String);
    }

    return availableBucketValues.filter((bucketValue) => bucketValue.startsWith(matcher.prefix));
}

export function getPatternRefBucketValues(
    ref: OrgPatternReferenceName,
    pattern: OrgPatternSpec,
    availableBucketValues: readonly string[],
): readonly string[] {
    const matcher = pattern.bucketGroups?.[ref];
    return matcher
        ? resolvePatternBucketValues(matcher, availableBucketValues)
        : [String(ref)];
}

function isPatternBucketListMatcher(
    matcher: OrgPatternBucketMatcher,
): matcher is readonly OrgBucketValue[] {
    return Array.isArray(matcher);
}

function getPatternRefTotal(
    ref: OrgPatternReferenceName,
    allocation: ReadonlyMap<string, number>,
    pattern: OrgPatternSpec,
    availableBucketValues: readonly string[],
): number {
    const values = getPatternRefBucketValues(ref, pattern, availableBucketValues);

    return values.reduce((sum, bucketValue) => sum + (allocation.get(bucketValue) ?? 0), 0);
}

function parseBucketNumericValue(bucketValue: string): number {
    const match = /:(\d+)$/.exec(bucketValue);
    return match ? Number(match[1]) : 0;
}

function getPatternRefNumericTotal(
    ref: OrgPatternReferenceName,
    allocation: ReadonlyMap<string, number>,
    pattern: OrgPatternSpec,
    availableBucketValues: readonly string[],
): number {
    const values = getPatternRefBucketValues(ref, pattern, availableBucketValues);

    return values.reduce(
        (sum, bucketValue) => sum + parseBucketNumericValue(bucketValue) * (allocation.get(bucketValue) ?? 0),
        0,
    );
}

function getTargetDistance(value: number, target: number | { min: number; max: number }): number {
    if (typeof target === 'number') {
        return Math.abs(value - target);
    }
    if (value < target.min) return target.min - value;
    if (value > target.max) return value - target.max;
    return 0;
}

function evaluatePatternScore(
    pattern: OrgPatternSpec,
    allocation: ReadonlyMap<string, number>,
    availableBucketValues: readonly string[],
): number {
    if (pattern.matchMode !== 'score') {
        return 0;
    }

    return pattern.scoreTerms.reduce((total, term) => total + evaluatePatternScoreTerm(term, allocation, pattern, availableBucketValues), 0);
}

function evaluatePatternScoreTerm(
    term: OrgPatternScoreTerm,
    allocation: ReadonlyMap<string, number>,
    pattern: OrgPatternSpec,
    availableBucketValues: readonly string[],
): number {
    const weight = term.weight ?? 1;

    switch (term.kind) {
        case 'target': {
            return getTargetDistance(getPatternRefTotal(term.ref, allocation, pattern, availableBucketValues), term.target) * weight;
        }
        case 'positive-diff': {
            const left = getPatternRefTotal(term.left, allocation, pattern, availableBucketValues);
            const right = getPatternRefTotal(term.right, allocation, pattern, availableBucketValues);
            return Math.max(0, left - right) * weight;
        }
        case 'numeric-target': {
            const value = getPatternRefNumericTotal(term.ref, allocation, pattern, availableBucketValues);
            const divisor = term.divisor ?? 1;
            return (getTargetDistance(value, term.target) / divisor) * weight;
        }
    }
}

function evaluateConstraintOperand(
    operand: number | boolean | string,
    allocation: ReadonlyMap<string, number>,
    pattern: OrgPatternSpec,
    availableBucketValues: readonly string[],
): number | boolean | string {
    if (typeof operand !== 'string') {
        return operand;
    }
    if (operand.startsWith('sum:')) {
        return getPatternRefTotal(operand.slice('sum:'.length), allocation, pattern, availableBucketValues);
    }
    return operand;
}

function passesPatternConstraints(
    pattern: OrgPatternSpec,
    allocation: ReadonlyMap<string, number>,
    availableBucketValues: readonly string[],
): boolean {
    if (!pattern.constraints || pattern.constraints.length === 0) {
        return true;
    }

    return pattern.constraints.every((constraint) => {
        const left = evaluateConstraintOperand(constraint.left.startsWith('sum:') ? constraint.left : constraint.left, allocation, pattern, availableBucketValues);
        const right = evaluateConstraintOperand(constraint.right, allocation, pattern, availableBucketValues);
        switch (constraint.op) {
            case '<=':
                return Number(left) <= Number(right);
            case '>=':
                return Number(left) >= Number(right);
            case '=':
                return left === right;
        }
    });
}

export function passesPatternBounds(
    pattern: OrgPatternSpec,
    allocation: ReadonlyMap<string, number>,
    availableBucketValues: readonly string[],
): boolean {
    const demandEntries = Object.entries(pattern.demands ?? {});
    for (const [ref, count] of demandEntries) {
        if (count === undefined) {
            continue;
        }
        if (getPatternRefTotal(ref, allocation, pattern, availableBucketValues) < count) {
            return false;
        }
    }

    const minEntries = Object.entries(pattern.minSums ?? {});
    for (const [ref, count] of minEntries) {
        if (count === undefined) {
            continue;
        }
        if (getPatternRefTotal(ref, allocation, pattern, availableBucketValues) < count) {
            return false;
        }
    }

    const maxEntries = Object.entries(pattern.maxSums ?? {});
    for (const [ref, count] of maxEntries) {
        if (count === undefined) {
            continue;
        }
        if (getPatternRefTotal(ref, allocation, pattern, availableBucketValues) > count) {
            return false;
        }
    }

    return passesPatternConstraints(pattern, allocation, availableBucketValues);
}

export function enumeratePatternCandidates(
    bucketCounts: ReadonlyMap<string, number>,
    pattern: OrgPatternSpec,
    guard: SolverGuard,
): PatternCandidate[] {
    const bucketEntries = Array.from(bucketCounts.entries()).filter(([, count]) => count > 0);
    const availableBucketValues = bucketEntries.map(([bucketValue]) => bucketValue);
    const candidates: PatternCandidate[] = [];
    const working = new Map<string, number>();

    function visit(bucketIndex: number, remaining: number): void {
        if (!visitOrgSearch(guard, 'pattern')) {
            return;
        }
        if (remaining < 0) {
            return;
        }
        if (bucketIndex === bucketEntries.length) {
            if (remaining !== 0) {
                return;
            }
            if (!passesPatternBounds(pattern, working, availableBucketValues)) {
                return;
            }
            candidates.push({
                allocation: new Map(working),
                score: evaluatePatternScore(pattern, working, availableBucketValues),
            });
            return;
        }

        const [bucketValue, availableCount] = bucketEntries[bucketIndex];
        const maxTake = Math.min(availableCount, remaining);
        for (let count = 0; count <= maxTake; count += 1) {
            if (count > 0) {
                working.set(bucketValue, count);
            } else {
                working.delete(bucketValue);
            }
            visit(bucketIndex + 1, remaining - count);
        }
        working.delete(bucketValue);
    }

    visit(0, pattern.copySize);
    return candidates.sort((left, right) => left.score - right.score);
}
