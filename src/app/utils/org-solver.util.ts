/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import type { Unit } from '../models/units.model';
import type {
    OrgType,
    OrgTypeRule,
    OrgTypeLeaf,
    OrgTypeComposed,
    OrgTypeModifier,
    OrgDefinition,
    PointRange,
    GroupSizeResult,
} from './org-types';
import {
    ORG_REGISTRY,
    DEFAULT_ORG,
} from './org-definitions.util';
import { TechBase } from '../models/tech.model';
import { getDynamicTierForModifier, getRepeatCountForTierDelta } from './org-tier.util';

/**
 * Author: Drake
 * 
 * Core logic for determining organizational structure from a set of units.
 */

export const EMPTY_RESULT: GroupSizeResult = { name: 'Force', type: null, modifierKey: '', countsAsType: null, tier: 0 };
const FOREIGN_EVALUATION = true;
const FLATTEN_REEVALUATED_FOREIGN_GROUPS_BEFORE_COMPOSITION = false;
const ASSIMILATE_FIRST_FOR_SUBOPTIMAL_GROUPS = true;
const ASSIMILATE_SUBOPTIMAL_GROUPS_LOWEST_TIER_FIRST = true;

// ─── Unit helpers ──────────────────────────────────────────────────────────────

function unitPointTotal(units: Unit[], getPointRange: (u: Unit[]) => PointRange): number {
    const range = getPointRange(units);
    return (range.min + range.max) / 2;
}

/**
 * Collect all leaf-level units from a GroupSizeResult tree.
 */
interface SolverContext {
    groupUnitCache: WeakMap<GroupSizeResult, Unit[]>;
}

const GLOBAL_CUSTOM_MATCH_CACHE = new WeakMap<OrgTypeRule, Map<string, number>>();
const GLOBAL_RULE_FILTER_CACHE = new WeakMap<OrgTypeRule, Map<string, boolean>>();
const GLOBAL_CUSTOM_MATCH_CACHE_MAX_SIZE = 1000;
const GLOBAL_RULE_FILTER_CACHE_MAX_SIZE = 1000;

function getOrCreateGlobalRuleCache<T>(
    store: WeakMap<OrgTypeRule, Map<string, T>>,
    rule: OrgTypeRule,
): Map<string, T> {
    let memo = store.get(rule);
    if (!memo) {
        memo = new Map<string, T>();
        store.set(rule, memo);
    }
    return memo;
}

function setBoundedCacheValue<T>(memo: Map<string, T>, key: string, value: T, maxSize: number): void {
    if (memo.has(key)) {
        memo.delete(key);
    }
    memo.set(key, value);

    if (memo.size > maxSize) {
        const oldestKey = memo.keys().next().value;
        if (oldestKey !== undefined) {
            memo.delete(oldestKey);
        }
    }
}

function collectGroupUnits(group: GroupSizeResult, context: SolverContext): Unit[] {
    const cached = context.groupUnitCache.get(group);
    if (cached) return cached;

    const result: Unit[] = [];
    if (group.units) result.push(...group.units);
    if (group.children) {
        for (const child of group.children) {
            result.push(...collectGroupUnits(child, context));
        }
    }

    context.groupUnitCache.set(group, result);
    return result;
}

function collectAllUnits(groups: ReadonlyArray<GroupSizeResult>, context: SolverContext): Unit[] {
    const result: Unit[] = [];
    for (const g of groups) {
        result.push(...collectGroupUnits(g, context));
    }
    return result;
}

// ─── Combinator (same-name count enumeration for customMatch) ─────────────────

/**
 * Same-name units are structurally identical, so customMatch only needs the
 * count per unit name, not the original unit ordering.
 */
interface SameUnitCountBucket {
    key: string;
    units: Unit[];
}

interface RequiredChildTypeCountEntry {
    type: OrgType;
    count: number;
}

interface CompiledRuleMetadata {
    rawRule: OrgTypeRule;
    sortedModifierEntries: ReadonlyArray<[string, number]>;
    regularCount: number;
    minimumModifierCount: number;
    maximumModifierCount: number;
}

interface CompiledLeafRule extends OrgTypeLeaf, CompiledRuleMetadata {
    rawRule: OrgTypeLeaf;
}

interface CompiledComposedRule extends OrgTypeComposed, CompiledRuleMetadata {
    rawRule: OrgTypeComposed;
    acceptedChildTypes: ReadonlySet<OrgType>;
    requiredChildTypeCountEntries: ReadonlyArray<RequiredChildTypeCountEntry>;
    allowedChildTagSet?: ReadonlySet<string>;
}

type CompiledOrgRule = CompiledLeafRule | CompiledComposedRule;

function hasCompiledRuleMetadata(rule: OrgTypeRule): rule is CompiledOrgRule {
    return 'rawRule' in rule;
}

function getCacheRule(rule: OrgTypeRule): OrgTypeRule {
    return hasCompiledRuleMetadata(rule) ? rule.rawRule : rule;
}

function isLeafRule(rule: OrgTypeRule): rule is OrgTypeLeaf {
    return rule.kind === 'leaf';
}

function isComposedRule(rule: OrgTypeRule): rule is OrgTypeComposed {
    return rule.kind === 'composed';
}

function hasCustomMatch(rule: OrgTypeRule): rule is OrgTypeLeaf & Required<Pick<OrgTypeLeaf, 'customMatch'>> {
    return isLeafRule(rule) && typeof rule.customMatch === 'function';
}

function compileRule(rule: OrgTypeLeaf): CompiledLeafRule;
function compileRule(rule: OrgTypeComposed): CompiledComposedRule;
function compileRule(rule: OrgTypeRule): CompiledOrgRule {
    const sortedModifierEntries = Object.entries(rule.modifiers)
        .map(([prefix, mod]) => [prefix, getModifierCount(mod)] as [string, number])
        .sort((a, b) => a[1] - b[1]);
    const regularModifier = rule.modifiers[''] ?? Object.values(rule.modifiers)[0];
    const regularCount = getModifierCount(regularModifier);
    const minimumModifierCount = sortedModifierEntries.length > 0 ? sortedModifierEntries[0][1] : 0;
    const maximumModifierCount = sortedModifierEntries.length > 0 ? sortedModifierEntries[sortedModifierEntries.length - 1][1] : 0;
    if (isLeafRule(rule)) {
        return {
            ...rule,
            rawRule: rule,
            sortedModifierEntries,
            regularCount,
            minimumModifierCount,
            maximumModifierCount,
        };
    }

    return {
        ...rule,
        rawRule: rule,
        sortedModifierEntries,
        regularCount,
        minimumModifierCount,
        maximumModifierCount,
        acceptedChildTypes: new Set(rule.composedOfAny),
        requiredChildTypeCountEntries: Object.entries(rule.requiredChildTypeCounts ?? {})
            .map(([type, count]) => ({ type: type as OrgType, count: count ?? 0 }))
            .filter(entry => entry.count > 0),
        allowedChildTagSet: rule.allowedChildTagsAll ? new Set(rule.allowedChildTagsAll) : undefined,
    };
}

function compileRules(rules: ReadonlyArray<OrgTypeRule>): CompiledOrgRule[] {
    return rules.map(rule => isLeafRule(rule) ? compileRule(rule) : compileRule(rule));
}

function getCustomMatchMemo(rule: OrgTypeLeaf, context: SolverContext): Map<string, number> {
    return getOrCreateGlobalRuleCache(GLOBAL_CUSTOM_MATCH_CACHE, getCacheRule(rule) as OrgTypeLeaf);
}

function getRuleFilterMemo(rule: OrgTypeRule, context: SolverContext): Map<string, boolean> {
    return getOrCreateGlobalRuleCache(GLOBAL_RULE_FILTER_CACHE, getCacheRule(rule));
}

function passesRuleFilter(rule: OrgTypeRule, unit: Unit, context: SolverContext): boolean {
    if (!rule.filter) return true;

    const memo = getRuleFilterMemo(rule, context);
    const cached = memo.get(unit.name);
    if (cached !== undefined) return cached;

    const passes = rule.filter(unit);
    setBoundedCacheValue(memo, unit.name, passes, GLOBAL_RULE_FILTER_CACHE_MAX_SIZE);
    return passes;
}

function buildUnitNameCountKey(
    sameUnitCountBuckets: ReadonlyArray<SameUnitCountBucket>,
    counts: ReadonlyArray<number>,
): string {
    const parts: string[] = [];
    for (let i = 0; i < sameUnitCountBuckets.length; i++) {
        if (counts[i] > 0) {
            parts.push(`${sameUnitCountBuckets[i].key}:${counts[i]}`);
        }
    }
    return parts.join('|');
}

function getAllowedCustomMatchUnitCounts(
    rule: OrgTypeLeaf,
    totalUnits: number,
): number[] | null {
    if (!rule.customMatchUnitCounts || rule.customMatchUnitCounts.length === 0) {
        return null;
    }

    const filtered = Array.from(new Set(rule.customMatchUnitCounts))
        .filter(count => Number.isInteger(count) && count > 0 && count <= totalUnits)
        .sort((a, b) => a - b);

    return filtered.length > 0 ? filtered : [];
}

function countConstrainedCombinations(
    maxPerBucket: ReadonlyArray<number>,
    allowedTotals: ReadonlyArray<number>,
    cap: number,
): number {
    if (allowedTotals.length === 0) return 0;

    const suffixCapacity = new Array(maxPerBucket.length + 1).fill(0);
    for (let i = maxPerBucket.length - 1; i >= 0; i--) {
        suffixCapacity[i] = suffixCapacity[i + 1] + maxPerBucket[i];
    }

    const allowedSet = new Set(allowedTotals);
    const memo = new Map<string, number>();

    function visit(idx: number, used: number): number {
        const key = `${idx}:${used}`;
        const cached = memo.get(key);
        if (cached !== undefined) return cached;

        const remainingCapacity = suffixCapacity[idx];
        const canStillReachAllowed = allowedTotals.some(total => total >= used && total <= used + remainingCapacity);
        if (!canStillReachAllowed) {
            memo.set(key, 0);
            return 0;
        }

        if (idx === maxPerBucket.length) {
            const result = allowedSet.has(used) ? 1 : 0;
            memo.set(key, result);
            return result;
        }

        let total = 0;
        for (let count = 0; count <= maxPerBucket[idx]; count++) {
            total += visit(idx + 1, used + count);
            if (total > cap) {
                memo.set(key, cap + 1);
                return cap + 1;
            }
        }

        memo.set(key, total);
        return total;
    }

    return visit(0, 0);
}

/** A shape defines how many units from each same-name bucket are needed. */
type Shape = number[]; // shape[i] = count from sameUnitCountBuckets[i]

/**
 * Find valid shapes (unit-count combinations) for a customMatch rule.
 *
 * Groups eligible units into same-name count buckets, then enumerates all
 * feasible count combinations. A shape is "valid" when
 * customMatch returns 0 for a representative subset of those counts.
 */
function findValidShapes(
    eligible: Unit[],
    rule: OrgTypeLeaf & Required<Pick<OrgTypeLeaf, 'customMatch'>>,
    context: SolverContext,
): { sameUnitCountBuckets: SameUnitCountBucket[]; shapes: Shape[] } {
    const sameUnitCountBuckets = new Map<string, Unit[]>();
    for (const u of eligible) {
        const k = u.name;
        if (!sameUnitCountBuckets.has(k)) sameUnitCountBuckets.set(k, []);
        sameUnitCountBuckets.get(k)!.push(u);
    }
    const sameUnitCountBucketList: SameUnitCountBucket[] = Array.from(sameUnitCountBuckets.entries())
        .map(([key, units]) => ({ key, units }))
        .sort((a, b) => a.key.localeCompare(b.key));

    if (sameUnitCountBucketList.length === 0) {
        return { sameUnitCountBuckets: sameUnitCountBucketList, shapes: [] };
    }

    const shapes: Shape[] = [];
    const totalUnits = eligible.length;
    const shapeMatchCache = getCustomMatchMemo(rule, context);
    const allowedUnitCounts = getAllowedCustomMatchUnitCounts(rule, totalUnits);

    // Enumerate all combinations of counts (0..bucketSize) for each same-name bucket.
    const maxPerBucket = sameUnitCountBucketList.map(bucket => bucket.units.length);

    // Safety: cap total combinations at ~50k to prevent runaway enumeration.
    let totalCombos = 0;
    if (allowedUnitCounts) {
        totalCombos = countConstrainedCombinations(maxPerBucket, allowedUnitCounts, 50_000);
    } else {
        totalCombos = 1;
        for (const m of maxPerBucket) {
            totalCombos *= (m + 1);
            if (totalCombos > 50_000) break;
        }
    }
    if (totalCombos > 50_000) {
        console.warn(`Too many combinations (${totalCombos}) for customMatch rule ${rule.type}, skipping shape enumeration`);
        return { sameUnitCountBuckets: sameUnitCountBucketList, shapes: [] };
    }

    const allowedUnitCountSet = allowedUnitCounts ? new Set(allowedUnitCounts) : null;
    const suffixCapacity = new Array(maxPerBucket.length + 1).fill(0);
    for (let i = maxPerBucket.length - 1; i >= 0; i--) {
        suffixCapacity[i] = suffixCapacity[i + 1] + maxPerBucket[i];
    }

    const current: number[] = new Array(sameUnitCountBucketList.length).fill(0);

    function enumerate(idx: number, used: number): void {
        if (allowedUnitCounts) {
            const remainingCapacity = suffixCapacity[idx];
            const canStillReachAllowed = allowedUnitCounts.some(total => total >= used && total <= used + remainingCapacity);
            if (!canStillReachAllowed) return;
        }

        if (idx === sameUnitCountBucketList.length) {
            if (used === 0) return;
            if (allowedUnitCountSet && !allowedUnitCountSet.has(used)) return;
            const shapeKey = buildUnitNameCountKey(sameUnitCountBucketList, current);
            let matchScore = shapeMatchCache.get(shapeKey);
            if (matchScore === undefined) {
                const testUnits: Unit[] = [];
                for (let i = 0; i < sameUnitCountBucketList.length; i++) {
                    for (let j = 0; j < current[i]; j++) {
                        testUnits.push(sameUnitCountBucketList[i].units[j]);
                    }
                }
                matchScore = rule.customMatch!(testUnits);
                setBoundedCacheValue(shapeMatchCache, shapeKey, matchScore, GLOBAL_CUSTOM_MATCH_CACHE_MAX_SIZE);
            }
            if (matchScore === 0) {
                shapes.push([...current]);
            }
            return;
        }
        for (let c = 0; c <= maxPerBucket[idx]; c++) {
            if (used + c > totalUnits) break;
            current[idx] = c;
            enumerate(idx + 1, used + c);
        }
    }

    enumerate(0, 0);
    shapes.sort((a, b) => {
        const totalA = a.reduce((sum, count) => sum + count, 0);
        const totalB = b.reduce((sum, count) => sum + count, 0);
        if (totalA !== totalB) return totalB - totalA;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return b[i] - a[i];
        }
        return 0;
    });
    return { sameUnitCountBuckets: sameUnitCountBucketList, shapes };
}

/**
 * Find k non-overlapping instances from the available buckets, allowing
 * different shapes per instance. Returns the list of shapes chosen (one per
 * instance), or null if impossible.
 *
 * Tries uniform shapes first (fast path), then mixed shapes via backtracking.
 */
function findPartition(
    sameUnitCountBuckets: SameUnitCountBucket[],
    shapes: Shape[],
    k: number,
): Shape[] | null {
    const bucketSizes = sameUnitCountBuckets.map(bucket => bucket.units.length);

    // Fast path: try a single shape repeated k times
    for (const shape of shapes) {
        let fits = true;
        for (let i = 0; i < sameUnitCountBuckets.length; i++) {
            if (shape[i] * k > bucketSizes[i]) { fits = false; break; }
        }
        if (fits) return Array(k).fill(shape);
    }

    if (k <= 1 || shapes.length <= 1) return null;

    // Slow path: backtracking to find k instances with mixed shapes
    const remaining = [...bucketSizes];
    const chosen: Shape[] = [];

    function backtrack(): boolean {
        if (chosen.length === k) return true;
        for (const shape of shapes) {
            let fits = true;
            for (let i = 0; i < sameUnitCountBuckets.length; i++) {
                if (shape[i] > remaining[i]) { fits = false; break; }
            }
            if (!fits) continue;
            // Consume
            for (let i = 0; i < sameUnitCountBuckets.length; i++) remaining[i] -= shape[i];
            chosen.push(shape);
            if (backtrack()) return true;
            chosen.pop();
            for (let i = 0; i < sameUnitCountBuckets.length; i++) remaining[i] += shape[i];
        }
        return false;
    }

    return backtrack() ? [...chosen] : null;
}

/**
 * Given a partition (list of shapes, one per instance),
 * extract actual Unit[] subsets — one per shape.
 */
function pickUnitsFromPartition(
    sameUnitCountBuckets: SameUnitCountBucket[],
    partition: Shape[],
): Unit[][] {
    const offsets = new Array(sameUnitCountBuckets.length).fill(0);
    const results: Unit[][] = [];

    for (const shape of partition) {
        const subset: Unit[] = [];
        for (let i = 0; i < sameUnitCountBuckets.length; i++) {
            for (let j = 0; j < shape[i]; j++) {
                subset.push(sameUnitCountBuckets[i].units[offsets[i]++]);
            }
        }
        results.push(subset);
    }
    return results;
}

function subtractUnitsByOccurrence(
    source: ReadonlyArray<Unit>,
    consumed: ReadonlyArray<Unit>,
): Unit[] {
    if (source.length === 0 || consumed.length === 0) return [...source];

    const counts = new Map<Unit, number>();
    for (const unit of consumed) {
        counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }

    const remaining: Unit[] = [];
    for (const unit of source) {
        const count = counts.get(unit) ?? 0;
        if (count > 0) {
            counts.set(unit, count - 1);
            continue;
        }
        remaining.push(unit);
    }

    return remaining;
}

/**
 * Collect all units consumed by the partition, preserving duplicate instances.
 */
function consumedUnitsFromPartition(
    sameUnitCountBuckets: SameUnitCountBucket[],
    partition: Shape[],
): Unit[] {
    return pickUnitsFromPartition(sameUnitCountBuckets, partition).flat();
}

// ─── Modifier helpers ──────────────────────────────────────────────────────────

/** Extract the numeric count from a modifier value (number or OrgTypeModifier). */
function getModifierCount(mod: number | OrgTypeModifier): number {
    return typeof mod === 'object' ? mod.count : mod;
}

/** The regular ('') modifier's count, or the first modifier if no regular exists. */
function getRegularCount(rule: OrgTypeRule): number {
    if (hasCompiledRuleMetadata(rule)) return rule.regularCount;
    const raw = rule.modifiers[''] ?? Object.values(rule.modifiers)[0];
    return getModifierCount(raw);
}

/**
 * Resolve the effective tier for a rule given the matched modifier prefix.
 *
 * Priority:
 * 1. If the modifier is an OrgTypeModifier with an explicit `tier`, use it.
 * 2. If the rule has `dynamicTier > 0`, scale the adjustment in base-3 space:
 *    effectiveTier = rule.tier + log_3(modCount / regularCount) * dynamicTier
 * 3. Otherwise, return `rule.tier`.
 */
function resolveTier(rule: OrgTypeRule, prefix: string): number {
    const mod = rule.modifiers[prefix];
    // Explicit tier on the modifier always wins
    if (mod != null && typeof mod === 'object' && mod.tier != null) {
        return mod.tier;
    }
    // Dynamic tier adjustment based on deviation from regular count
    if (rule.dynamicTier && rule.dynamicTier > 0) {
        const regularCount = getRegularCount(rule);
        const modCount = mod != null ? getModifierCount(mod) : regularCount;
        if (regularCount > 0 && modCount !== regularCount) {
            return getDynamicTierForModifier(rule.tier, regularCount, modCount, rule.dynamicTier);
        }
    }
    return rule.tier;
}

/** Get sorted modifiers for a rule: [prefix, count] sorted by count ascending. */
function sortedModifiers(rule: OrgTypeRule): [string, number][] {
    if (hasCompiledRuleMetadata(rule)) return [...rule.sortedModifierEntries];
    return Object.entries(rule.modifiers)
        .map(([prefix, mod]) => [prefix, getModifierCount(mod)] as [string, number])
        .sort((a, b) => a[1] - b[1]);
}

type ModifierSelectionMode = 'exact' | 'closest' | 'sub-regular';

function selectModifier(
    rule: OrgTypeRule,
    targetCount: number,
    mode: ModifierSelectionMode,
): [string, number] | null {
    const modifiers = sortedModifiers(rule);
    if (modifiers.length === 0) return null;

    if (mode === 'exact') {
        const exactMatches = modifiers.filter(([, count]) => Math.abs(count - targetCount) < 1e-9);
        if (exactMatches.length === 0) return null;
        return exactMatches.find(([prefix]) => prefix === '') ?? exactMatches[0];
    }

    if (mode === 'sub-regular') {
        const regularCount = getRegularCount(rule);
        let best: [string, number] | null = null;
        for (const [prefix, count] of modifiers) {
            if (count < regularCount && count <= targetCount) {
                if (!best || count > best[1]) best = [prefix, count];
            }
        }
        return best;
    }

    let best = modifiers[0];
    let bestDistance = Math.abs(best[1] - targetCount);
    for (let i = 1; i < modifiers.length; i++) {
        const distance = Math.abs(modifiers[i][1] - targetCount);
        if (distance < bestDistance || (distance === bestDistance && modifiers[i][1] > best[1])) {
            best = modifiers[i];
            bestDistance = distance;
        }
    }
    return best;
}

function getModifierExtremeCount(rule: OrgTypeRule, mode: 'min' | 'max'): number {
    if (hasCompiledRuleMetadata(rule)) {
        return mode === 'min' ? rule.minimumModifierCount : rule.maximumModifierCount;
    }
    const modifiers = sortedModifiers(rule);
    if (modifiers.length === 0) return 0;
    return mode === 'min' ? modifiers[0][1] : modifiers[modifiers.length - 1][1];
}

function getAcceptedChildTypes(rule: OrgTypeComposed): ReadonlySet<OrgType> {
    return hasCompiledRuleMetadata(rule) ? rule.acceptedChildTypes : new Set(rule.composedOfAny);
}

function getRequiredChildTypeCountEntries(rule: OrgTypeComposed): ReadonlyArray<RequiredChildTypeCountEntry> {
    if (hasCompiledRuleMetadata(rule)) return rule.requiredChildTypeCountEntries;

    return Object.entries(rule.requiredChildTypeCounts ?? {})
        .map(([type, count]) => ({ type: type as OrgType, count: count ?? 0 }))
        .filter(entry => entry.count > 0);
}

function getAllowedChildTagSet(rule: OrgTypeComposed): ReadonlySet<string> | undefined {
    return hasCompiledRuleMetadata(rule)
        ? rule.allowedChildTagSet
        : (rule.allowedChildTagsAll ? new Set(rule.allowedChildTagsAll) : undefined);
}

function getMinimumModifierCount(rule: OrgTypeRule): number {
    return getModifierExtremeCount(rule, 'min');
}

function getMaximumModifierCount(rule: OrgTypeRule): number {
    return getModifierExtremeCount(rule, 'max');
}

/** Build the display name for a rule + modifier prefix. */
function buildName(rule: OrgTypeRule, prefix: string): string {
    return prefix ? prefix + rule.type : rule.type;
}

interface AllocationPlanEntry {
    prefix: string;
    count: number;
}

interface FlexibleAllocationPlan {
    entries: AllocationPlanEntry[];
    consumesAllUnits: boolean;
}

function buildRuleGroup(
    rule: OrgTypeRule,
    prefix: string,
    extra: Partial<GroupSizeResult>,
): GroupSizeResult {
    return {
        name: buildName(rule, prefix),
        type: rule.type,
        modifierKey: prefix,
        countsAsType: rule.countsAs ?? null,
        tier: resolveTier(rule, prefix),
        ...extra,
    };
}

function buildStrictAllocationPlan(rule: OrgTypeRule, totalCount: number): AllocationPlanEntry[] | null {
    const regularCount = getRegularCount(rule);
    if (regularCount < 1 || totalCount < 1) return null;

    let bestPrefix = '';
    let bestModCount = 0;
    let bestInstances = 0;
    for (const [prefix, modCount] of sortedModifiers(rule)) {
        if (modCount < 1 || modCount > totalCount) continue;
        const instances = Math.floor(totalCount / modCount);
        if (instances * modCount > bestInstances * bestModCount) {
            bestPrefix = prefix;
            bestModCount = modCount;
            bestInstances = instances;
        }
    }

    if (bestInstances === 0) return null;
    return Array.from({ length: bestInstances }, () => ({ prefix: bestPrefix, count: bestModCount }));
}

function buildFlexibleAllocationPlan(
    rule: OrgTypeRule,
    totalCount: number,
    preferExactMatch: boolean,
): FlexibleAllocationPlan | null {
    if (totalCount <= 0) return null;

    if (preferExactMatch) {
        const exactModifier = selectModifier(rule, totalCount, 'exact');
        if (exactModifier) {
            return {
                entries: [{ prefix: exactModifier[0], count: exactModifier[1] }],
                consumesAllUnits: true,
            };
        }
    }

    const regularCount = getRegularCount(rule);
    const regularInstances = Math.floor(totalCount / regularCount);

    if (regularInstances === 0) {
        const subRegularModifier = selectModifier(rule, totalCount, 'sub-regular');
        if (subRegularModifier) {
            return {
                entries: [{ prefix: subRegularModifier[0], count: subRegularModifier[1] }],
                consumesAllUnits: true,
            };
        }

        if (totalCount < getMinimumModifierCount(rule) - 1e-9) {
            return null;
        }

        const [prefix, count] = selectModifier(rule, totalCount, 'closest')!;
        return {
            entries: [{ prefix, count }],
            consumesAllUnits: true,
        };
    }

    const entries: AllocationPlanEntry[] = Array.from(
        { length: regularInstances },
        () => ({ prefix: '', count: regularCount }),
    );
    const leftoverCount = totalCount - regularInstances * regularCount;
    if (leftoverCount <= 0) {
        return { entries, consumesAllUnits: true };
    }

    const subRegularModifier = selectModifier(rule, leftoverCount, 'sub-regular');
    if (subRegularModifier) {
        entries.push({ prefix: subRegularModifier[0], count: subRegularModifier[1] });
        return { entries, consumesAllUnits: true };
    }

    if (getMaximumModifierCount(rule) > regularCount) {
        const [prefix, count] = selectModifier(rule, regularCount + leftoverCount, 'closest')!;
        entries[entries.length - 1] = { prefix, count };
        return { entries, consumesAllUnits: true };
    }

    return { entries, consumesAllUnits: false };
}

function splitUnitsByTargetCounts(
    units: ReadonlyArray<Unit>,
    targetCounts: ReadonlyArray<number>,
    getPointRange: (u: Unit[]) => PointRange,
    consumeAllInLastPartition: boolean,
): Unit[][] {
    const partitions: Unit[][] = [];
    let offset = 0;

    for (let i = 0; i < targetCounts.length; i++) {
        if (consumeAllInLastPartition && i === targetCounts.length - 1) {
            partitions.push(units.slice(offset));
            break;
        }

        const targetCount = targetCounts[i];
        const partition: Unit[] = [];
        let totalPoints = 0;
        while (offset < units.length && totalPoints < targetCount - 1e-9) {
            partition.push(units[offset]);
            totalPoints = unitPointTotal(partition, getPointRange);
            offset++;
        }
        partitions.push(partition);
    }

    return partitions;
}

function sumAllocationPlanCounts(plan: ReadonlyArray<AllocationPlanEntry>): number {
    return plan.reduce((sum, entry) => sum + entry.count, 0);
}

// ─── Foreign-type normalization ────────────────────────────────────────────────

interface NormalizationTarget {
    rule: OrgTypeRule;
    prefix: string;
    tier: number;
    name: string;
}

function canUseRuleAsNormalizationTarget(
    rule: OrgTypeRule,
    group: GroupSizeResult,
    context: SolverContext,
): boolean {
    if (isLeafRule(rule) && rule.customMatch) return false;
    if (isComposedRule(rule) && getRequiredChildTypeCountEntries(rule).length > 0) return false;
    if (!rule.filter) return true;

    const groupUnits = collectGroupUnits(group, context);
    if (groupUnits.length === 0) return false;

    return groupUnits.every(unit => passesRuleFilter(rule, unit, context));
}

function collectNormalizationTargets(
    rules: ReadonlyArray<OrgTypeRule>,
    group: GroupSizeResult,
    context: SolverContext,
): NormalizationTarget[] {
    const targets: NormalizationTarget[] = [];

    for (const rule of rules) {
        if (!canUseRuleAsNormalizationTarget(rule, group, context)) continue;

        if (rule.dynamicTier && rule.dynamicTier > 0) {
            for (const [prefix] of sortedModifiers(rule)) {
                targets.push({
                    rule,
                    prefix,
                    tier: resolveTier(rule, prefix),
                    name: buildName(rule, prefix),
                });
            }
            continue;
        }

        targets.push({
            rule,
            prefix: '',
            tier: resolveTier(rule, ''),
            name: buildName(rule, ''),
        });
    }

    return targets.sort((a, b) => a.tier - b.tier);
}

function pickNormalizationTargets(
    sourceTier: number,
    targets: ReadonlyArray<NormalizationTarget>,
): NormalizationTarget[] {
    if (targets.length === 0) return [];

    const highestTarget = targets[targets.length - 1];
    if (sourceTier > highestTarget.tier) {
        const repeatCount = getRepeatCountForTierDelta(sourceTier, highestTarget.tier);
        return Array.from({ length: repeatCount }, () => highestTarget);
    }

    let bestTarget = targets[0];
    let bestDistance = Math.abs(sourceTier - bestTarget.tier);

    for (let i = 1; i < targets.length; i++) {
        const candidate = targets[i];
        const candidateDistance = Math.abs(sourceTier - candidate.tier);
        if (candidateDistance < bestDistance) {
            bestTarget = candidate;
            bestDistance = candidateDistance;
            continue;
        }

        if (candidateDistance === bestDistance && candidate.tier < bestTarget.tier) {
            bestTarget = candidate;
        }
    }

    return [bestTarget];
}
/**
 * Map GroupSizeResults whose types don't exist in the target org's rules
 * to their tier-equivalent types in the target org.
 */
function normalizeGroupsToOrg(
    groupResults: GroupSizeResult[],
    rules: ReadonlyArray<OrgTypeRule>,
    context: SolverContext,
): GroupSizeResult[] {
    const knownTypes = new Set(rules.map(r => r.type));

    return groupResults.flatMap((g) => {
        const typeKnown = (g.type && knownTypes.has(g.type)) ||
                          (g.countsAsType && knownTypes.has(g.countsAsType));
        if (typeKnown) return [g];

        const normalizationTargets = collectNormalizationTargets(rules, g, context);
        const targets = pickNormalizationTargets(g.tier, normalizationTargets);
        if (targets.length === 0) return [g];

        return targets.map((target, index) => ({
            name: target.name,
            type: target.rule.type,
            modifierKey: target.prefix,
            countsAsType: target.rule.countsAs ?? null,
            tier: target.tier,
            children: index === 0 ? g.children : undefined,
            units: index === 0 ? g.units : undefined,
            leftoverUnits: index === 0 ? g.leftoverUnits : undefined,
            tag: target.rule.tag,
            priority: target.rule.priority,
        }));
    });
}

function isKnownGroupType(group: GroupSizeResult, rules: ReadonlyArray<OrgTypeRule>): boolean {
    const knownTypes = new Set(rules.map(rule => rule.type));
    return Boolean(
        (group.type && knownTypes.has(group.type)) ||
        (group.countsAsType && knownTypes.has(group.countsAsType)),
    );
}

function collectUnassignedUnits(
    allUnits: ReadonlyArray<Unit>,
    groups: ReadonlyArray<GroupSizeResult>,
    context: SolverContext,
): Unit[] {
    if (groups.length === 0 || allUnits.length === 0) return [];

    return subtractUnitsByOccurrence(allUnits, collectAllUnits(groups, context));
}

function flattenReevaluatedForeignGroups(groups: ReadonlyArray<GroupSizeResult>): GroupSizeResult[] {
    return groups.flatMap(group => {
        const children = group.children;
        if (!children || children.length === 0) return [group];

        const flattenedChildren = children.map(child => ({ ...child }));
        if (group.leftoverUnits && group.leftoverUnits.length > 0) {
            flattenedChildren[0] = {
                ...flattenedChildren[0],
                leftoverUnits: [
                    ...(flattenedChildren[0].leftoverUnits ?? []),
                    ...group.leftoverUnits,
                ],
            };
        }

        return flattenedChildren;
    });
}

function attachTopLevelLeftovers(
    groups: GroupSizeResult[],
    allUnits: ReadonlyArray<Unit>,
    context: SolverContext,
): GroupSizeResult[] {
    const leftoverUnits = collectUnassignedUnits(allUnits, groups, context);
    if (groups.length === 0 || leftoverUnits.length === 0) return groups;

    return [
        {
            ...groups[0],
            leftoverUnits,
        },
        ...groups.slice(1),
    ];
}

// ─── Leaf allocation ───────────────────────────────────────────────────────────

/**
 * Allocate a set of units into a single leaf rule.
 *
 * 1. N = floor(totalPoints / regularCount) regular instances
 * 2. leftover = totalPoints - N * regularCount
 * 3. If leftover > 0:
 *    a. Try sub-regular modifier (highest count < regular that fits)
 *    b. If no sub-regular fits, assimilate by upgrading last instance
 */
function allocateLeaf(
    units: Unit[],
    rule: OrgTypeLeaf,
    getPointRange: (u: Unit[]) => PointRange,
): GroupSizeResult[] {
    const totalPts = unitPointTotal(units, getPointRange);
    const plan = buildFlexibleAllocationPlan(rule, totalPts, true);
    if (!plan || plan.entries.length === 0) return [];

    const partitions = splitUnitsByTargetCounts(
        units,
        plan.entries.map(entry => entry.count),
        getPointRange,
        plan.consumesAllUnits,
    );

    return plan.entries.map((entry, index) => buildRuleGroup(rule, entry.prefix, {
        units: partitions[index],
        tag: rule.tag,
    }));
}



/**
 * Allocate units into leaf-level groups using a wide combinator.
 *
 * Strategy:
 * 1. Enumerate customMatch rule consumption choices (use/skip per rule)
 * 2. For each choice, allocate remaining via type-affinity split
 * 3. Return ALL candidate leaf allocations for upward comparison
 */
function allocateLeaves(
    units: Unit[],
    rules: ReadonlyArray<OrgTypeRule>,
    getPointRange: (u: Unit[]) => PointRange,
    context: SolverContext,
): GroupSizeResult[][] {
    const cmRules = rules
        .filter(hasCustomMatch)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.tier - a.tier);

    const candidates: GroupSizeResult[][] = [];

    function branchCustomMatch(
        ruleIdx: number,
        pool: Unit[],
        accumulated: GroupSizeResult[],
    ): void {
        if (ruleIdx === cmRules.length) {
            // All customMatch rules processed, allocate remaining via affinity split
            const remaining = pool.length > 0
                ? allocateSplitByAffinity(pool, rules, getPointRange, context)
                : [];
            candidates.push([...accumulated, ...remaining]);
            return;
        }

        const rule = cmRules[ruleIdx];
        const eligible = pool.filter(u => passesRuleFilter(rule, u, context));

        // Branch 1: skip this rule entirely
        branchCustomMatch(ruleIdx + 1, pool, accumulated);

        // Branch 2+: try consuming via this rule (various k values)
        if (eligible.length > 0) {
            const { sameUnitCountBuckets, shapes } = findValidShapes(eligible, rule, context);
            if (shapes.length > 0) {
                const regularPts = getRegularCount(rule);
                const totalPts = unitPointTotal(pool, getPointRange);
                const maxCopies = regularPts > 0 ? Math.max(1, Math.floor(totalPts / regularPts)) : 1;

                for (let k = maxCopies; k >= 1; k--) {
                    const partition = findPartition(sameUnitCountBuckets, shapes, k);
                    if (!partition) continue;

                    const unitSubsets = pickUnitsFromPartition(sameUnitCountBuckets, partition);
                    const consumed = consumedUnitsFromPartition(sameUnitCountBuckets, partition);
                    const newPool = subtractUnitsByOccurrence(pool, consumed);

                    const newGroups: GroupSizeResult[] = [];
                    for (const subset of unitSubsets) {
                        newGroups.push({
                            name: rule.type,
                            type: rule.type,
                            modifierKey: '',
                            countsAsType: rule.countsAs ?? null,
                            tier: resolveTier(rule, ''),
                            units: subset,
                            tag: rule.tag,
                            priority: rule.priority,
                        });
                    }
                    branchCustomMatch(ruleIdx + 1, newPool, [...accumulated, ...newGroups]);
                    break; // Only the best k that fits; lower k are strictly worse
                }
            }
        }
    }

    branchCustomMatch(0, units, []);

    return candidates.length > 0 ? candidates : [allocateSplitByAffinity(units, rules, getPointRange, context)];
}

/**
 * Allocate units to leaf rules using each rule's own filter to partition.
 * Iterates leaf rules by priority (highest first). When a rule's filter
 * accepts some units but rejects others, the accepted units are allocated
 * to that rule and removed from the pool. Remaining units go to the
 * best-matching leaf rule.
 */
function allocateSplitByAffinity(
    units: Unit[],
    rules: ReadonlyArray<OrgTypeRule>,
    getPointRange: (u: Unit[]) => PointRange,
    context: SolverContext,
): GroupSizeResult[] {
    const results: GroupSizeResult[] = [];
    let remaining = [...units];

    // Leaf rules sorted by priority desc, then tier desc
    const leafRules = rules
        .filter((rule): rule is OrgTypeLeaf => isLeafRule(rule) && !rule.customMatch)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.tier - a.tier);

    for (const rule of leafRules) {
        if (remaining.length === 0) break;
        if (!rule.filter) continue; // no filter = accepts everything, handle at the end

        const accepted = remaining.filter(u => passesRuleFilter(rule, u, context));
        const rejected = remaining.filter(u => !passesRuleFilter(rule, u, context));

        // Only split if this rule creates a genuine partition
        if (accepted.length === 0 || rejected.length === 0) continue;

        results.push(...allocateLeaf(accepted, rule, getPointRange));
        remaining = rejected;
    }

    // Remaining: all pass the same filters: use best matching leaf rule
    if (remaining.length > 0) {
        const allocated = findBestLeafAllocation(remaining, rules, getPointRange, context);
        if (allocated.length > 0) {
            results.push(...allocated);
        } else {
            for (const u of remaining) {
                const allocated = findBestLeafAllocation([u], rules, getPointRange, context);
                if (allocated.length > 0) {
                    results.push(...allocated);
                }
            }
        }
    }

    return results;
}

/**
 * Find the best valid leaf allocation (no composedOfAny, no customMatch) for a set of units.
 * All units must pass the rule's per-unit filter. Rules that cannot allocate the
 * current point total are ignored. Prefers higher priority, then higher tier.
 */
function findBestLeafAllocation(
    units: Unit[],
    rules: ReadonlyArray<OrgTypeRule>,
    getPointRange: (u: Unit[]) => PointRange,
    context: SolverContext,
): GroupSizeResult[] {
    let best: { rule: OrgTypeLeaf; allocation: GroupSizeResult[] } | null = null;
    for (const rule of rules) {
        if (!isLeafRule(rule)) continue;
        if (rule.customMatch) continue;
        if (!units.every(u => passesRuleFilter(rule, u, context))) continue;

        const allocation = allocateLeaf(units, rule, getPointRange);
        if (allocation.length === 0) continue;

        if (!best ||
            (rule.priority ?? 0) > (best.rule.priority ?? 0) ||
            ((rule.priority ?? 0) === (best.rule.priority ?? 0) && rule.tier > best.rule.tier)) {
            best = { rule, allocation };
        }
    }
    return best?.allocation ?? [];
}

// ─── Upward composition ────────────────────────────────────────────────────────

/**
 * Compose groups upward through the hierarchy using exact partitioning.
 *
 * At each tier, finds composed rules whose composedOfAny includes the
 * available group types, then:
 * 1. N = floor(matchingCount / regularCount) regular instances
 * 2. Handle leftovers (sub-regular or assimilation)
 * 3. Groups not consumed stay as-is
 * 4. Repeat until no more composition possible
 *
 * Tries ALL viable composed rules at each step and picks the one that
 * produces the highest-tier, most regular result.
 */
function composeUpward(groups: GroupSizeResult[], rules: ReadonlyArray<OrgTypeRule>, context: SolverContext): GroupSizeResult[] {
    let current = [...groups];

    for (let iter = 0; iter < 20 && current.length >= 2; iter++) {
        if (ASSIMILATE_FIRST_FOR_SUBOPTIMAL_GROUPS) {
            const assimilated = tryAssimilateExistingGroup(current, rules, context, true);
            if (assimilated) {
                current = assimilated;
                continue;
            }
        }

        const repacked = tryRepackFractionalSameTypeGroups(current, rules);
        if (repacked) {
            current = repacked;
            continue;
        }

        const best = findBestComposition(current, rules, context);
        if (best) {
            current = best;
            continue;
        }

        const assimilated = tryAssimilateExistingGroup(current, rules, context, false);
        if (assimilated) {
            current = assimilated;
            continue;
        }

        break;
    }

    return current;
}

/**
 * Scoring tuple for comparing composition candidates.
 * Fields are compared in order: higher is better.
 */
interface CompositionScore {
    /** Max tier among the newly created groups (not inherited non-matching groups). */
    composedTier: number;
    /** Total number of input groups consumed. */
    consumed: number;
    /** Whether the result can be further composed into higher tiers. */
    canPromote: boolean;
    /** Number of strict-rule groups in the result. */
    strictCount: number;
    /** Sum of priorities of rules used. */
    prioritySum: number;
}

function maxTier(groups: ReadonlyArray<GroupSizeResult>): number {
    let tier = -1;
    for (const group of groups) {
        if (group.tier > tier) tier = group.tier;
    }
    return tier;
}

// ─── Upward Collapse ────────────────────────────────────────────────────────

function findRuleForGroup(group: GroupSizeResult, rules: ReadonlyArray<OrgTypeRule>): OrgTypeRule | undefined {
    if (!group.type) return undefined;

    const candidates = rules.filter(rule => rule.type === group.type);
    if (candidates.length === 0) return undefined;

    return candidates.find(rule => getGroupModifier(rule, group) !== null) ?? candidates[0];
}

function getGroupModifier(rule: OrgTypeRule, group: GroupSizeResult): [string, number] | null {
    if (group.type === rule.type && group.modifierKey !== undefined) {
        const modifier = rule.modifiers[group.modifierKey];
        if (modifier != null) {
            return [group.modifierKey, getModifierCount(modifier)];
        }
        if (group.modifierKey === '') {
            return ['', getRegularCount(rule)];
        }
    }

    return null;
}

interface AssimilationCandidate {
    result: GroupSizeResult[];
    regularizesSuboptimalGroup: boolean;
    sourceTier: number;
    targetTier: number;
    absorbedCount: number;
    targetCount: number;
}

function getAssimilationTargetModifier(
    rule: OrgTypeComposed,
    currentCount: number,
    maxCount: number,
): [string, number] | null {
    const modifiers = sortedModifiers(rule);
    const regularCount = getRegularCount(rule);

    if (currentCount < regularCount) {
        for (const [prefix, count] of modifiers) {
            if (count >= regularCount && count <= maxCount) {
                return [prefix, count];
            }
        }
    }

    for (const [prefix, count] of modifiers) {
        if (count > currentCount && count <= maxCount) {
            return [prefix, count];
        }
    }

    return null;
}

function compareAssimilationCandidates(a: AssimilationCandidate, b: AssimilationCandidate): boolean {
    if (a.regularizesSuboptimalGroup !== b.regularizesSuboptimalGroup) {
        return a.regularizesSuboptimalGroup;
    }
    if (ASSIMILATE_SUBOPTIMAL_GROUPS_LOWEST_TIER_FIRST && a.sourceTier !== b.sourceTier) {
        return a.sourceTier < b.sourceTier;
    }
    if (a.targetTier !== b.targetTier) return a.targetTier > b.targetTier;
    if (a.absorbedCount !== b.absorbedCount) return a.absorbedCount < b.absorbedCount;
    return a.targetCount > b.targetCount;
}

function tryAssimilateExistingGroup(
    groups: GroupSizeResult[],
    rules: ReadonlyArray<OrgTypeRule>,
    context: SolverContext,
    regularizeSuboptimalOnly: boolean,
): GroupSizeResult[] | null {
    let bestCandidate: AssimilationCandidate | null = null;

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        const rule = findRuleForGroup(group, rules);
        if (!rule || !isComposedRule(rule) || rule.strict) continue;

        const modifier = getGroupModifier(rule, group);
        if (!modifier) continue;

    const regularCount = getRegularCount(rule);
    const isSubregular = modifier[1] < regularCount;
    if (regularizeSuboptimalOnly && !isSubregular) continue;
    if (!regularizeSuboptimalOnly && isSubregular) continue;

        const currentChildren = group.children;
        if (!currentChildren || currentChildren.length === 0) continue;

        const siblings = groups
            .map((candidate, candidateIndex) => ({ group: candidate, candidateIndex }))
            .filter(({ candidateIndex, group: candidate }) => {
                if (candidateIndex === groupIndex) return false;
                if (!groupMatchesSubsetConstraints(rule, candidate)) return false;

                const acceptedTypes = getAcceptedChildTypes(rule);
                return (
                    (candidate.type && acceptedTypes.has(candidate.type)) ||
                    (candidate.countsAsType && acceptedTypes.has(candidate.countsAsType))
                );
            });
        if (siblings.length === 0) continue;

        const targetModifier = getAssimilationTargetModifier(rule, modifier[1], modifier[1] + siblings.length);
        if (!targetModifier) continue;

        if (regularizeSuboptimalOnly && targetModifier[1] > regularCount) continue;

        const absorbedCount = targetModifier[1] - modifier[1];
        if (absorbedCount <= 0 || absorbedCount > siblings.length) continue;

        for (const combination of collectValueCombinations(
            siblings.map((_, index) => index),
            absorbedCount,
        )) {
            const absorbedEntries = combination.map(index => siblings[index]);
            const absorbedGroups = absorbedEntries.map(entry => entry.group);
            const combinedChildren = [...currentChildren, ...absorbedGroups];
            if (!canRuleComposeGroups(rule, combinedChildren, context)) continue;

            const absorbedIndexSet = new Set(absorbedEntries.map(entry => entry.candidateIndex));
            const upgradedGroup = buildRuleGroup(rule, targetModifier[0], {
                children: combinedChildren,
                priority: rule.priority,
            });
            const nextGroups = groups
                .filter((_, candidateIndex) => candidateIndex !== groupIndex && !absorbedIndexSet.has(candidateIndex));
            nextGroups.push(upgradedGroup);

            const candidate: AssimilationCandidate = {
                result: nextGroups,
                regularizesSuboptimalGroup: isSubregular && targetModifier[1] >= regularCount,
                sourceTier: group.tier,
                targetTier: resolveTier(rule, targetModifier[0]),
                absorbedCount,
                targetCount: targetModifier[1],
            };

            if (!bestCandidate || compareAssimilationCandidates(candidate, bestCandidate)) {
                bestCandidate = candidate;
            }
        }
    }

    return bestCandidate?.result ?? null;
}

function compareCountPartitions(
    a: ReadonlyArray<number>,
    b: ReadonlyArray<number>,
    regular: number,
): boolean {
    if (a.length !== b.length) return a.length < b.length;

    const aSpread = a[0] - a[a.length - 1];
    const bSpread = b[0] - b[b.length - 1];
    if (aSpread !== bSpread) return aSpread < bSpread;

    const aRegularDist = a.reduce((sum, count) => sum + Math.abs(count - regular), 0);
    const bRegularDist = b.reduce((sum, count) => sum + Math.abs(count - regular), 0);
    if (aRegularDist !== bRegularDist) return aRegularDist < bRegularDist;

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }

    return false;
}

function partitionCountToModifiers(rule: OrgTypeRule, totalCount: number): number[] | null {
    const counts = Array.from(new Set(sortedModifiers(rule).map(([, count]) => count))).sort((a, b) => b - a);
    const regular = getRegularCount(rule);
    let best: number[] | null = null;

    function visit(remaining: number, current: number[], startIndex: number): void {
        if (remaining === 0) {
            const candidate = [...current].sort((a, b) => b - a);
            if (!best || compareCountPartitions(candidate, best, regular)) {
                best = candidate;
            }
            return;
        }

        if (best && current.length >= best.length) return;

        for (let i = startIndex; i < counts.length; i++) {
            const count = counts[i];
            if (count > remaining) continue;
            current.push(count);
            visit(remaining - count, current, i);
            current.pop();
        }
    }

    visit(totalCount, [], 0);
    return best;
}

function assignGroupsToCounts(
    groups: ReadonlyArray<{ group: GroupSizeResult; count: number }>,
    targetCounts: ReadonlyArray<number>,
): GroupSizeResult[][] | null {
    const sortedGroups = [...groups].sort((a, b) => b.count - a.count);
    const buckets = targetCounts.map(target => ({ target, groups: [] as GroupSizeResult[], total: 0 }));

    function visit(index: number): boolean {
        if (index === sortedGroups.length) {
            return buckets.every(bucket => bucket.total === bucket.target);
        }

        const entry = sortedGroups[index];
        for (const bucket of buckets) {
            if (bucket.total + entry.count > bucket.target) continue;
            bucket.groups.push(entry.group);
            bucket.total += entry.count;
            if (visit(index + 1)) return true;
            bucket.groups.pop();
            bucket.total -= entry.count;
        }

        return false;
    }

    return visit(0) ? buckets.map(bucket => bucket.groups) : null;
}

function repackSameTypeGroups(
    groups: ReadonlyArray<GroupSizeResult>,
    rules: ReadonlyArray<OrgTypeRule>,
): GroupSizeResult[] | null {
    if (groups.length < 2) return null;

    const rule = findRuleForGroup(groups[0], rules);
    if (!rule || groups.some(group => group.type !== groups[0].type)) return null;

    const entries = groups.map(group => {
        const modifier = getGroupModifier(rule, group);
        return modifier ? { group, count: modifier[1] } : null;
    });
    if (entries.some(entry => entry === null)) return null;

    const typedEntries = entries as Array<{ group: GroupSizeResult; count: number }>;
    const totalCount = typedEntries.reduce((sum, entry) => sum + entry.count, 0);
    const targetCounts = partitionCountToModifiers(rule, totalCount);
    if (!targetCounts || targetCounts.length >= groups.length) return null;

    const assigned = assignGroupsToCounts(typedEntries, targetCounts);
    if (!assigned) return null;

    const modifierLookup = new Map<number, string[]>();
    for (const [prefix, count] of sortedModifiers(rule)) {
        if (!modifierLookup.has(count)) modifierLookup.set(count, []);
        modifierLookup.get(count)!.push(prefix);
    }

    return assigned.map(children => {
        const childCount = children.reduce((sum, child) => {
            const modifier = getGroupModifier(rule, child);
            return sum + (modifier?.[1] ?? 0);
        }, 0);
        const prefixes = modifierLookup.get(childCount) ?? [''];
        const prefix = prefixes.includes('') ? '' : prefixes[0];

        return {
            name: buildName(rule, prefix),
            type: rule.type,
            modifierKey: prefix,
            countsAsType: rule.countsAs ?? null,
            tier: resolveTier(rule, prefix),
            children,
            tag: rule.tag,
            priority: rule.priority,
        };
    });
}

function ruleUsesFractionalModifiers(rule: OrgTypeRule): boolean {
    return sortedModifiers(rule).some(([, count]) => !Number.isInteger(count));
}

function tryRepackFractionalSameTypeGroups(
    groups: ReadonlyArray<GroupSizeResult>,
    rules: ReadonlyArray<OrgTypeRule>,
): GroupSizeResult[] | null {
    let repacked = false;
    const byType = new Map<string, GroupSizeResult[]>();

    for (const group of groups) {
        const key = group.type ?? 'null';
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key)!.push(group);
    }

    const nextGroups: GroupSizeResult[] = [];
    for (const bucket of byType.values()) {
        const rule = bucket[0] ? findRuleForGroup(bucket[0], rules) : undefined;
        const repackedBucket = rule && ruleUsesFractionalModifiers(rule)
            ? repackSameTypeGroups(bucket, rules)
            : null;
        if (repackedBucket && repackedBucket.length < bucket.length) {
            nextGroups.push(...repackedBucket);
            repacked = true;
        } else {
            nextGroups.push(...bucket);
        }
    }

    return repacked ? nextGroups : null;
}

function collapseHighestTierGroups(
    groups: GroupSizeResult[],
    rules: ReadonlyArray<OrgTypeRule>,
    context: SolverContext,
): GroupSizeResult[] {
    let current = [...groups];

    for (let iter = 0; iter < 20 && current.length > 1; iter++) {
        current.sort((a, b) => b.tier - a.tier);
        const highestTier = current[0].tier;
        const highestGroups = current.filter(group => group.tier === highestTier);
        const lowerGroups = current.filter(group => group.tier !== highestTier);

        const composedHighest = composeUpward(highestGroups, rules, context);
        if (
            composedHighest.length < highestGroups.length ||
            maxTier(composedHighest) > highestTier
        ) {
            current = [...lowerGroups, ...composedHighest];
            continue;
        }

        let repacked = false;
        const byType = new Map<string, GroupSizeResult[]>();
        for (const group of highestGroups) {
            const key = `${group.type ?? 'null'}:${group.name}`;
            if (!byType.has(key)) byType.set(key, []);
            byType.get(key)!.push(group);
        }

        const nextHighest: GroupSizeResult[] = [];
        for (const bucket of byType.values()) {
            const repackedBucket = repackSameTypeGroups(bucket, rules);
            if (repackedBucket && repackedBucket.length < bucket.length) {
                nextHighest.push(...repackedBucket);
                repacked = true;
            } else {
                nextHighest.push(...bucket);
            }
        }

        if (!repacked) break;
        current = [...lowerGroups, ...nextHighest];
    }

    return current.sort((a, b) => b.tier - a.tier);
}

function hierarchicallyAggregateGroups(
    groups: GroupSizeResult[],
    rules: ReadonlyArray<OrgTypeRule>,
    context: SolverContext,
): GroupSizeResult[] {
    const collapsed = collapseHighestTierGroups(groups, rules, context);
    return collapsed;
}

// ───────────────────────────────────────────────────────────────────────────────

function betterScore(a: CompositionScore, b: CompositionScore): boolean {
    if (a.composedTier !== b.composedTier) return a.composedTier > b.composedTier;
    if (a.consumed !== b.consumed) return a.consumed > b.consumed;
    if (a.canPromote !== b.canPromote) return a.canPromote;
    if (a.strictCount !== b.strictCount) return a.strictCount > b.strictCount;
    return a.prioritySum > b.prioritySum;
}

function groupMatchesType(group: GroupSizeResult, type: string): boolean {
    return group.type === type || group.countsAsType === type;
}

function groupMatchesSubsetConstraints(rule: OrgTypeComposed, group: GroupSizeResult): boolean {
    const allowedChildTagSet = getAllowedChildTagSet(rule);
    if (allowedChildTagSet && allowedChildTagSet.size > 0) {
        if (!group.tag || !allowedChildTagSet.has(group.tag)) {
            return false;
        }
    }

    return true;
}

function canRulePossiblyComposeSubset(
    rule: OrgTypeComposed,
    availableGroups: ReadonlyArray<GroupSizeResult>,
): boolean {
    if (availableGroups.length === 0) return false;

    const eligibleGroups = availableGroups.filter(group => groupMatchesSubsetConstraints(rule, group));
    if (eligibleGroups.length === 0) return false;
    const requiredEntries = getRequiredChildTypeCountEntries(rule);
    if (requiredEntries.length === 0) return true;

    return requiredEntries.every(({ type, count: required }) => {
        let matchingCount = 0;
        for (const group of eligibleGroups) {
            if (groupMatchesType(group, type)) {
                matchingCount++;
                if (matchingCount >= required) return true;
            }
        }

        return false;
    });
}

function canRuleComposeGroups(
    rule: OrgTypeComposed,
    groups: ReadonlyArray<GroupSizeResult>,
    context: SolverContext,
): boolean {
    if (!rule.composedOfAny || groups.length === 0) return false;
    if (!canRulePossiblyComposeSubset(rule, groups)) return false;

    const acceptedTypes = getAcceptedChildTypes(rule);
    for (const group of groups) {
        if (!groupMatchesSubsetConstraints(rule, group)) {
            return false;
        }
        if (
            !(group.type && acceptedTypes.has(group.type)) &&
            !(group.countsAsType && acceptedTypes.has(group.countsAsType))
        ) {
            return false;
        }
    }

    if (rule.filter) {
        const allUnits = collectAllUnits(groups, context);
        if (allUnits.some(unit => !passesRuleFilter(rule, unit, context))) return false;
    }

    if (rule.groupFilter && !rule.groupFilter(groups)) return false;

    return true;
}

function getCandidateTakeCounts(
    rule: OrgTypeRule,
    maxAvailable: number,
    includeSubRegular: boolean = false,
): number[] {
    if (maxAvailable < 1) return [];

    const counts = new Set<number>();
    const regular = getRegularCount(rule);
    const minimum = getMinimumModifierCount(rule);

    if (rule.strict) {
        for (const [, count] of sortedModifiers(rule)) {
            if (count <= maxAvailable) counts.add(count);
        }
        return Array.from(counts).sort((a, b) => b - a);
    }

    for (let count = Math.max(regular, 1); count <= maxAvailable; count++) {
        counts.add(count);
    }

    if (includeSubRegular) {
        for (let count = Math.max(minimum, 1); count < Math.min(regular, maxAvailable + 1); count++) {
            counts.add(count);
        }
    }

    return Array.from(counts).sort((a, b) => b - a);
}

interface SubsetCompositionCandidate {
    chosenIndices: number[];
    result: ComposedResult;
}

interface ViableComposedRule {
    rule: OrgTypeComposed;
    matchingGroups: GroupSizeResult[];
    nonMatchingGroups: GroupSizeResult[];
}

function collectValueCombinations(values: ReadonlyArray<number>, size: number): number[][] {
    if (size < 1 || size > values.length) return [];

    const results: number[][] = [];
    const current: number[] = [];

    function visit(start: number): void {
        if (current.length === size) {
            results.push([...current]);
            return;
        }

        for (let idx = start; idx <= values.length - (size - current.length); idx++) {
            current.push(values[idx]);
            visit(idx + 1);
            current.pop();
        }
    }

    visit(0);
    return results;
}

function collectConstrainedIndexCombinations(
    rule: OrgTypeComposed,
    eligibleGroups: ReadonlyArray<GroupSizeResult>,
    takeCount: number,
): number[][] | null {
    const requiredEntries = getRequiredChildTypeCountEntries(rule);
    if (requiredEntries.length === 0) return null;

    const totalRequired = requiredEntries.reduce((sum, entry) => sum + entry.count, 0);
    if (takeCount < totalRequired) return [];

    const buckets = requiredEntries.map(entry => ({
        ...entry,
        indices: eligibleGroups.flatMap((group, index) => groupMatchesType(group, entry.type) ? [index] : []),
    }));
    if (buckets.some(bucket => bucket.indices.length < bucket.count)) return [];

    const results: number[][] = [];
    const seen = new Set<string>();
    const chosen: number[] = [];
    const used = new Set<number>();

    function pushResult(indices: ReadonlyArray<number>): void {
        const sorted = [...indices].sort((a, b) => a - b);
        const key = sorted.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        results.push(sorted);
    }

    function visitBuckets(bucketIndex: number): void {
        if (bucketIndex === buckets.length) {
            const remainingNeeded = takeCount - chosen.length;
            if (remainingNeeded < 0) return;

            const remainingIndices: number[] = [];
            for (let index = 0; index < eligibleGroups.length; index++) {
                if (!used.has(index)) remainingIndices.push(index);
            }
            if (remainingNeeded > remainingIndices.length) return;

            if (remainingNeeded === 0) {
                pushResult(chosen);
                return;
            }

            for (const extra of collectValueCombinations(remainingIndices, remainingNeeded)) {
                pushResult([...chosen, ...extra]);
            }
            return;
        }

        const bucket = buckets[bucketIndex];
        const availableIndices = bucket.indices.filter(index => !used.has(index));
        if (availableIndices.length < bucket.count) return;

        for (const combination of collectValueCombinations(availableIndices, bucket.count)) {
            for (const index of combination) {
                used.add(index);
                chosen.push(index);
            }
            visitBuckets(bucketIndex + 1);
            for (let i = combination.length - 1; i >= 0; i--) {
                used.delete(combination[i]);
                chosen.pop();
            }
        }
    }

    visitBuckets(0);
    return results;
}

function collectSubsetCompositionCandidates(
    rule: OrgTypeComposed,
    availableGroups: GroupSizeResult[],
    context: SolverContext,
): SubsetCompositionCandidate[] {
    if (!canRulePossiblyComposeSubset(rule, availableGroups)) return [];

    const eligibleEntries = availableGroups
        .map((group, index) => ({ group, index }))
        .filter(entry => groupMatchesSubsetConstraints(rule, entry.group));

    const buildCandidates = (includeSubRegular: boolean): SubsetCompositionCandidate[] => {
        const candidates: SubsetCompositionCandidate[] = [];

        for (const takeCount of getCandidateTakeCounts(rule, eligibleEntries.length, includeSubRegular)) {
            const combinations = collectConstrainedIndexCombinations(
                rule,
                eligibleEntries.map(entry => entry.group),
                takeCount,
            ) ?? collectIndexCombinations(eligibleEntries.length, takeCount);
            for (const indices of combinations) {
                const chosenGroups = indices.map(index => eligibleEntries[index].group);
                if (!canRuleComposeGroups(rule, chosenGroups, context)) continue;

                const result = applyComposedRule(rule, chosenGroups, chosenGroups.length);
                if (!result || result.groups.length === 0) continue;

                candidates.push({ chosenIndices: indices.map(index => eligibleEntries[index].index), result });
            }
        }

        return candidates;
    };

    const regularCandidates = buildCandidates(false);
    if (regularCandidates.length > 0 || rule.strict) return regularCandidates;
    return buildCandidates(true);
}

function collectSingleRuleCompositionCandidates(
    rule: OrgTypeComposed,
    availableGroups: GroupSizeResult[],
    context: SolverContext,
): SubsetCompositionCandidate[] {
    if (canRuleComposeGroups(rule, availableGroups, context)) {
        const wholeResult = applyComposedRule(rule, availableGroups, availableGroups.length);
        if (wholeResult && wholeResult.groups.length > 0) {
            return [{
                chosenIndices: Array.from({ length: availableGroups.length }, (_, index) => index),
                result: wholeResult,
            }];
        }
    }

    return collectSubsetCompositionCandidates(rule, availableGroups, context)
        .filter(candidate => candidate.chosenIndices.length !== availableGroups.length);
}

function collectIndexCombinations(length: number, size: number): number[][] {
    if (size < 1 || size > length) return [];

    const results: number[][] = [];
    const current: number[] = [];

    function visit(start: number): void {
        if (current.length === size) {
            results.push([...current]);
            return;
        }

        for (let idx = start; idx <= length - (size - current.length); idx++) {
            current.push(idx);
            visit(idx + 1);
            current.pop();
        }
    }

    visit(0);
    return results;
}

/** Check whether any composed rule can consume groups from the result set. */
function canPromoteFurther(groups: GroupSizeResult[], rules: ReadonlyArray<OrgTypeRule>): boolean {
    for (const rule of rules) {
        if (!isComposedRule(rule) || rule.composedOfAny.length === 0) continue;
        const accepted = getAcceptedChildTypes(rule);
        let matchCount = 0;
        for (const g of groups) {
            if ((g.type && accepted.has(g.type)) || (g.countsAsType && accepted.has(g.countsAsType))) {
                matchCount++;
            }
        }
        if (matchCount < 1) continue;
        if (rule.strict) {
            // Strict: matchCount must exactly equal one of the modifier values
            const mods = sortedModifiers(rule);
            if (mods.some(([, c]) => matchCount >= c)) return true;
        } else {
            const regular = getRegularCount(rule);
            if (matchCount >= regular) return true;
            const sub = selectModifier(rule, matchCount, 'sub-regular');
            if (sub) return true;
        }
    }
    return false;
}

interface ComposedResult {
    groups: GroupSizeResult[];
    /** Number of matchingGroups actually consumed into composed formations. */
    consumed: number;
}

function collectViableComposedRules(
    groups: ReadonlyArray<GroupSizeResult>,
    rules: ReadonlyArray<OrgTypeRule>,
): ViableComposedRule[] {
    const composedRules = rules
        .filter((rule): rule is OrgTypeComposed => isComposedRule(rule) && rule.composedOfAny.length > 0)
        .sort((a, b) => a.tier - b.tier);

    const viable: ViableComposedRule[] = [];

    for (const rule of composedRules) {
        const acceptedTypes = getAcceptedChildTypes(rule);
        const matchingGroups: GroupSizeResult[] = [];
        const nonMatchingGroups: GroupSizeResult[] = [];

        for (const group of groups) {
            if ((group.type && acceptedTypes.has(group.type)) ||
                (group.countsAsType && acceptedTypes.has(group.countsAsType))) {
                matchingGroups.push(group);
            } else {
                nonMatchingGroups.push(group);
            }
        }

        if (matchingGroups.length === 0) continue;
        if (getCandidateTakeCounts(rule, matchingGroups.length, true).length === 0) continue;
        if (!canRulePossiblyComposeSubset(rule, matchingGroups)) continue;

        viable.push({ rule, matchingGroups, nonMatchingGroups });
    }

    return viable;
}

function mergeCompositionCandidate(
    availableGroups: ReadonlyArray<GroupSizeResult>,
    candidate: SubsetCompositionCandidate,
    prefixGroups: ReadonlyArray<GroupSizeResult> = [],
): GroupSizeResult[] {
    const chosenSet = new Set(candidate.chosenIndices);
    const merged = [...prefixGroups, ...candidate.result.groups];

    for (let i = 0; i < availableGroups.length; i++) {
        if (!chosenSet.has(i)) {
            merged.push(availableGroups[i]);
        }
    }

    return merged;
}

function getRemainingGroupsAfterCandidate(
    availableGroups: ReadonlyArray<GroupSizeResult>,
    candidate: SubsetCompositionCandidate,
): GroupSizeResult[] {
    const chosenSet = new Set(candidate.chosenIndices);
    return availableGroups.filter((_, index) => !chosenSet.has(index));
}

/**
 * Apply a single composed rule to `matchingGroups`, producing composed instances.
 *
 * Strict rules only accept exact modifier counts — no sub-regular fallback,
 * no assimilation. Unconsumed groups remain available for other rules.
 */
function applyComposedRule(
    rule: OrgTypeComposed,
    matchingGroups: GroupSizeResult[],
    count: number,
): ComposedResult | null {
    const plan = rule.strict
        ? buildStrictAllocationPlan(rule, count)
        : buildFlexibleAllocationPlan(rule, count, false)?.entries;
    if (!plan || plan.length === 0) return null;

    const results: GroupSizeResult[] = [];
    let offset = 0;
    for (const entry of plan) {
        results.push(buildRuleGroup(rule, entry.prefix, {
            children: matchingGroups.slice(offset, offset + entry.count),
            priority: rule.priority,
        }));
        offset += entry.count;
    }

    return { groups: results, consumed: sumAllocationPlanCounts(plan) };
}

/**
 * Try all viable composed rules on the current set of groups.
 * Tries each rule independently AND combinations of same-tier rules
 * that share matching groups (e.g. Binary + Trinary for Clan Stars).
 *
 * Scoring prefers: higher composed tier → more consumed → promotability
 * → strict count → priority sum.
 */
function findBestComposition(groups: GroupSizeResult[], rules: ReadonlyArray<OrgTypeRule>, context: SolverContext): GroupSizeResult[] | null {
    let bestResult: GroupSizeResult[] | null = null;
    let bestScore: CompositionScore = { composedTier: -1, consumed: 0, canPromote: false, strictCount: 0, prioritySum: 0 };

    const viable = collectViableComposedRules(groups, rules);

    if (viable.length === 0) return null;

    /** Evaluate a candidate result and compete against current best. */
    function evaluateCandidate(newGroups: GroupSizeResult[], consumed: number, composedTier: number, usedRules: OrgTypeRule[]) {
        const promote = canPromoteFurther(newGroups, rules);
        const strict = usedRules.reduce((s, r) => s + (r.strict ? 1 : 0), 0);
        const prio = usedRules.reduce((s, r) => s + (r.priority ?? 0), 0);
        const score: CompositionScore = {
            composedTier: composedTier,
            consumed,
            canPromote: promote,
            strictCount: strict,
            prioritySum: prio,
        };
        if (betterScore(score, bestScore)) {
            bestResult = newGroups;
            bestScore = score;
        }
    }

    // Phase 1: Try each rule independently (single-rule allocation)
    for (const { rule, matchingGroups, nonMatchingGroups } of viable) {
        for (const candidate of collectSingleRuleCompositionCandidates(rule, matchingGroups, context)) {
            const newGroups = mergeCompositionCandidate(matchingGroups, candidate, nonMatchingGroups);
            evaluateCandidate(newGroups, candidate.result.consumed, maxTier(candidate.result.groups), [rule]);
        }
    }

    // Phase 2: Try combinations of same-tier rules that share matching groups.
    // Group viable rules by tier, then enumerate subset allocations within each tier.
    const byTier = new Map<number, ViableComposedRule[]>();
    for (const v of viable) {
        const t = v.rule.tier;
        if (!byTier.has(t)) byTier.set(t, []);
        byTier.get(t)!.push(v);
    }

    for (const [, tierViable] of byTier) {
        if (tierViable.length < 2) continue;

        // Find the union of matching groups across all rules at this tier
        const unionMatching = new Set<GroupSizeResult>();
        for (const v of tierViable) {
            for (const group of v.matchingGroups) unionMatching.add(group);
        }
        const matchingGroups = Array.from(unionMatching);
        const totalMatching = matchingGroups.length;
        const nonMatchingArr = groups.filter(group => !unionMatching.has(group));

        function exploreTierAllocations(
            ruleIndex: number,
            availableGroups: GroupSizeResult[],
            createdGroups: GroupSizeResult[],
            usedRules: OrgTypeRule[],
            totalConsumed: number,
        ): void {
            if (ruleIndex === tierViable.length) {
                if (createdGroups.length === 0) return;
                const newGroups = [...nonMatchingArr, ...createdGroups, ...availableGroups];
                evaluateCandidate(newGroups, totalConsumed, maxTier(createdGroups), usedRules);
                return;
            }

            exploreTierAllocations(ruleIndex + 1, availableGroups, createdGroups, usedRules, totalConsumed);

            const currentRule = tierViable[ruleIndex].rule;
            for (const candidate of collectSubsetCompositionCandidates(currentRule, availableGroups, context)) {
                const remainingGroups = getRemainingGroupsAfterCandidate(availableGroups, candidate);
                exploreTierAllocations(
                    ruleIndex + 1,
                    remainingGroups,
                    [...createdGroups, ...candidate.result.groups],
                    [...usedRules, currentRule],
                    totalConsumed + candidate.result.consumed,
                );
            }
        }

        if (totalMatching > 0) {
            exploreTierAllocations(0, matchingGroups, [], [], 0);
        }
    }

    return bestResult;
}

// ─── Wrap result ───────────────────────────────────────────────────────────────

/**
 * Wrap a list of composed groups into a an ordered list by tier.
 * If there's exactly one group, return it directly.
 * If nothing, return a single empty result.
 */
function wrapResult(
    groups: GroupSizeResult[],
    rules: ReadonlyArray<OrgTypeRule>,
    context: SolverContext,
    hierarchicalAggregation: boolean,
): GroupSizeResult[] {
    if (groups.length === 0) return [EMPTY_RESULT];
    if (groups.length === 1) return groups;
    if (!hierarchicalAggregation) {
        return [...groups].sort((a, b) => b.tier - a.tier);
    }
    return hierarchicallyAggregateGroups(groups, rules, context);
}

// ─── Org Resolution ────────────────────────────────────────────────────────────

function resolveOrg(techBase: TechBase, factionName: string): OrgDefinition {
    return ORG_REGISTRY.find(e => e.match(techBase, factionName))?.org ?? DEFAULT_ORG;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Score a wrapped result for candidate comparison.
 * Priority only applies when the candidate resolves into a single complete
 * top-level formation with no unassigned units. Split top-level results like
 * "Nova + Point" should compete on tier/grouping, not inherit priority from
 * one favored subgroup.
 */
function scoreResult(
    groups: GroupSizeResult[],
    allUnits: ReadonlyArray<Unit>,
    context: SolverContext,
): {
    priorityWithoutLeftovers: number;
    maxTier: number;
    rawPriority: number;
    groupCount: number;
    tierSum: number;
} {
    let mTier = 0;
    let rawPriority = 0;
    let tierSum = 0;
    for (const g of groups) {
        if (g.tier > mTier) mTier = g.tier;
        if ((g.priority ?? 0) > rawPriority) rawPriority = g.priority!;
        tierSum += g.tier;
    }
    const isSingleCompleteFormation =
        groups.length === 1 && collectUnassignedUnits(allUnits, groups, context).length === 0;
    const effectivePriority = isSingleCompleteFormation ? rawPriority : 0;

    return {
        priorityWithoutLeftovers: effectivePriority,
        maxTier: mTier,
        rawPriority: effectivePriority,
        groupCount: groups.length,
        tierSum,
    };
}

function betterResult(
    a: { priorityWithoutLeftovers: number; maxTier: number; rawPriority: number; groupCount: number; tierSum: number },
    b: { priorityWithoutLeftovers: number; maxTier: number; rawPriority: number; groupCount: number; tierSum: number },
): boolean {
    if (a.priorityWithoutLeftovers !== b.priorityWithoutLeftovers) {
        return a.priorityWithoutLeftovers > b.priorityWithoutLeftovers;
    }
    if (a.maxTier !== b.maxTier) return a.maxTier > b.maxTier;
    if (a.rawPriority !== b.rawPriority) return a.rawPriority > b.rawPriority;
    if (a.groupCount !== b.groupCount) return a.groupCount < b.groupCount;
    return a.tierSum > b.tierSum;
}

class OrgSolver {
    private readonly context: SolverContext = {
        groupUnitCache: new WeakMap<GroupSizeResult, Unit[]>(),
    };
    private readonly rules: CompiledOrgRule[];

    constructor(
        private readonly org: OrgDefinition,
        private readonly hierarchicalAggregation: boolean
    ) {
        this.rules = compileRules(org.rules);
    }

    resolveFromUnits(units: Unit[]): GroupSizeResult[] {
        if (units.length === 0) {
            return [EMPTY_RESULT];
        }

        const leafCandidates = allocateLeaves(units, this.rules, this.org.getPointRange, this.context);

        let bestComposed: GroupSizeResult[] | null = null;
        let bestScore: {
            priorityWithoutLeftovers: number;
            maxTier: number;
            rawPriority: number;
            groupCount: number;
            tierSum: number;
        } | null = null;

        for (const leafGroups of leafCandidates) {
            if (leafGroups.length === 0) continue;
            const composed = composeUpward(leafGroups, this.rules, this.context);
            const wrapped = wrapResult(composed, this.rules, this.context, this.hierarchicalAggregation);
            const score = scoreResult(wrapped, units, this.context);

            if (!bestScore || betterResult(score, bestScore)) {
                bestComposed = wrapped;
                bestScore = score;
            }
        }

        if (!bestComposed) {
            return [];
        }

        return attachTopLevelLeftovers(bestComposed, units, this.context);
    }

    resolveFromGroups(groupResults: GroupSizeResult[]): GroupSizeResult[] {
        if (groupResults.length === 0) {
            return [EMPTY_RESULT];
        }

        const allUnits = collectAllUnits(groupResults, this.context);
        let normalized: GroupSizeResult[];

        if (FOREIGN_EVALUATION) {
            normalized = groupResults.flatMap(group => {
                if (isKnownGroupType(group, this.rules)) {
                    return [group];
                }

                const groupUnits = collectGroupUnits(group, this.context);
                if (groupUnits.length > 0) {
                    const reevaluated = this.resolveFromUnits(groupUnits);
                    return FLATTEN_REEVALUATED_FOREIGN_GROUPS_BEFORE_COMPOSITION
                        ? flattenReevaluatedForeignGroups(reevaluated)
                        : reevaluated;
                }

                return normalizeGroupsToOrg([group], this.rules, this.context);
            });
        } else {
            normalized = normalizeGroupsToOrg(groupResults, this.rules, this.context);
        }

        if (normalized.length === 1) {
            return attachTopLevelLeftovers([normalized[0]], allUnits, this.context);
        }

        const composed = composeUpward(normalized, this.rules, this.context);
        return attachTopLevelLeftovers(
            wrapResult(composed, this.rules, this.context, this.hierarchicalAggregation),
            allUnits,
            this.context,
        );
    }
}

/**
 * Evaluate a single group of units and return the structural result.
 */
export function resolveFromUnits(units: Unit[], techBase: TechBase, factionName: string, hierarchicalAggregation: boolean = false): GroupSizeResult[] {
    return new OrgSolver(resolveOrg(techBase, factionName), hierarchicalAggregation).resolveFromUnits(units);
}

/**
 * Evaluate a force from pre-computed group results.
 * Groups are taken as-is (not deconstructed) and composed upward.
 */
export function resolveFromGroups(techBase: TechBase, factionName: string, groupResults: GroupSizeResult[], hierarchicalAggregation: boolean = false): GroupSizeResult[] {
    return new OrgSolver(resolveOrg(techBase, factionName), hierarchicalAggregation).resolveFromGroups(groupResults);
}
