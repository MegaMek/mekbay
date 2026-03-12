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
    OrgTypeRule,
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

/**
 * Author: Drake
 * 
 * Core logic for determining organizational structure from a set of units.
 */

export const EMPTY_RESULT: GroupSizeResult = { name: 'Force', type: null, countsAsType: null, tier: 0 };

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
    customMatchCache: WeakMap<OrgTypeRule, Map<string, number>>;
    ruleFilterCache: WeakMap<OrgTypeRule, Map<string, boolean>>;
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

function getCustomMatchMemo(rule: OrgTypeRule, context: SolverContext): Map<string, number> {
    let memo = context.customMatchCache.get(rule);
    if (!memo) {
        memo = new Map<string, number>();
        context.customMatchCache.set(rule, memo);
    }
    return memo;
}

function getRuleFilterMemo(rule: OrgTypeRule, context: SolverContext): Map<string, boolean> {
    let memo = context.ruleFilterCache.get(rule);
    if (!memo) {
        memo = new Map<string, boolean>();
        context.ruleFilterCache.set(rule, memo);
    }
    return memo;
}

function passesRuleFilter(rule: OrgTypeRule, unit: Unit, context: SolverContext): boolean {
    if (!rule.filter) return true;

    const memo = getRuleFilterMemo(rule, context);
    const cached = memo.get(unit.name);
    if (cached !== undefined) return cached;

    const passes = rule.filter(unit);
    memo.set(unit.name, passes);
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
    rule: OrgTypeRule,
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

    // Enumerate all combinations of counts (0..bucketSize) for each same-name bucket.
    const maxPerBucket = sameUnitCountBucketList.map(bucket => bucket.units.length);

    // Safety: cap total combinations at ~50k to prevent runaway enumeration
    let totalCombos = 1;
    for (const m of maxPerBucket) {
        totalCombos *= (m + 1);
        if (totalCombos > 50_000) {
            console.warn(`Too many combinations (${totalCombos}) for customMatch rule ${rule.type}, skipping shape enumeration`);
            return { sameUnitCountBuckets: sameUnitCountBucketList, shapes: [] };
        }
    }

    const current: number[] = new Array(sameUnitCountBucketList.length).fill(0);

    function enumerate(idx: number, used: number): void {
        if (idx === sameUnitCountBucketList.length) {
            if (used === 0) return;
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
                shapeMatchCache.set(shapeKey, matchScore);
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
    const raw = rule.modifiers[''] ?? Object.values(rule.modifiers)[0];
    return getModifierCount(raw);
}

/**
 * Resolve the effective tier for a rule given the matched modifier prefix.
 *
 * Priority:
 * 1. If the modifier is an OrgTypeModifier with an explicit `tier`, use it.
 * 2. If the rule has `dynamicTier > 0`, compute the tier adjustment:
 *    variation = (modCount - regularCount) / regularCount
 *    effectiveTier = rule.tier + variation * dynamicTier
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
            const variation = (modCount - regularCount) / regularCount;
            return rule.tier + variation * rule.dynamicTier;
        }
    }
    return rule.tier;
}

/** Get sorted modifiers for a rule: [prefix, count] sorted by count ascending. */
function sortedModifiers(rule: OrgTypeRule): [string, number][] {
    return Object.entries(rule.modifiers)
        .map(([prefix, mod]) => [prefix, getModifierCount(mod)] as [string, number])
        .sort((a, b) => a[1] - b[1]);
}

function getMinimumModifierCount(rule: OrgTypeRule): number {
    const mods = sortedModifiers(rule);
    return mods.length > 0 ? mods[0][1] : 0;
}

/**
 * Find the best sub-regular modifier for leftovers.
 * Returns the modifier whose count is the largest value <= leftoverCount
 * that is still < regularCount. Returns null if none found.
 */
function findSubRegularModifier(rule: OrgTypeRule, leftoverCount: number): [string, number] | null {
    const regular = getRegularCount(rule);
    const mods = sortedModifiers(rule);
    let best: [string, number] | null = null;
    for (const [prefix, count] of mods) {
        if (count < regular && count <= leftoverCount) {
            if (!best || count > best[1]) best = [prefix, count];
        }
    }
    return best;
}

/**
 * Find the modifier whose count is closest to `targetCount`.
 * When there's a tie, prefer the one with higher count.
 */
function findClosestModifier(rule: OrgTypeRule, targetCount: number): [string, number] {
    const mods = sortedModifiers(rule);
    let best = mods[0];
    let bestDist = Math.abs(best[1] - targetCount);
    for (let i = 1; i < mods.length; i++) {
        const d = Math.abs(mods[i][1] - targetCount);
        if (d < bestDist || (d === bestDist && mods[i][1] > best[1])) {
            best = mods[i];
            bestDist = d;
        }
    }
    return best;
}

/** Build the display name for a rule + modifier prefix. */
function buildName(rule: OrgTypeRule, prefix: string): string {
    return prefix ? prefix + rule.type : rule.type;
}

// ─── Foreign-type normalization ────────────────────────────────────────────────

/**
 * Find the closest tier in the tierMap to the target tier.
 */
function findClosestTierRule(targetTier: number, tierMap: Map<number, OrgTypeRule>, sortedTiers: number[]): OrgTypeRule | undefined {
    const exact = tierMap.get(targetTier);
    if (exact) return exact;
    if (sortedTiers.length === 0) return undefined;

    let lower: number | undefined;
    let upper: number | undefined;
    for (const t of sortedTiers) {
        if (t <= targetTier) lower = t;
        if (t >= targetTier && upper === undefined) upper = t;
    }

    if (lower === undefined && upper === undefined) return undefined;
    if (lower === undefined) return tierMap.get(upper!);
    if (upper === undefined) return tierMap.get(lower);

    const distLower = Math.abs(targetTier - lower);
    const distUpper = Math.abs(upper - targetTier);
    return distLower <= distUpper ? tierMap.get(lower) : tierMap.get(upper);
}

/**
 * Map GroupSizeResults whose types don't exist in the target org's rules
 * to their tier-equivalent types in the target org.
 */
function normalizeGroupsToOrg(groupResults: GroupSizeResult[], rules: OrgTypeRule[]): GroupSizeResult[] {
    const knownTypes = new Set(rules.map(r => r.type));
    const tierMap = new Map<number, OrgTypeRule>();
    for (const r of rules) {
        if (tierMap.has(r.tier)) continue;
        if (!r.strict && !r.filter) tierMap.set(r.tier, r);
    }
    for (const r of rules) {
        if (!tierMap.has(r.tier)) tierMap.set(r.tier, r);
    }
    const sortedTiers = Array.from(tierMap.keys()).sort((a, b) => a - b);

    return groupResults.map(g => {
        const typeKnown = (g.type && knownTypes.has(g.type)) ||
                          (g.countsAsType && knownTypes.has(g.countsAsType));
        if (typeKnown) return g;

        const equiv = findClosestTierRule(g.tier, tierMap, sortedTiers);
        if (!equiv) return g;

        let newName = equiv.type as string;
        if (g.type && g.name.endsWith(g.type)) {
            const prefix = g.name.slice(0, g.name.length - g.type.length);
            if (prefix && prefix in equiv.modifiers) {
                newName = prefix + equiv.type;
            }
        }

        return {
            name: newName,
            type: equiv.type,
            countsAsType: equiv.countsAs ?? null,
            tier: equiv.tier,
            children: g.children,
            units: g.units,
            leftoverUnits: g.leftoverUnits,
            tag: g.tag,
            priority: g.priority,
        };
    });
}

function collectUnassignedUnits(
    allUnits: ReadonlyArray<Unit>,
    groups: ReadonlyArray<GroupSizeResult>,
    context: SolverContext,
): Unit[] {
    if (groups.length === 0 || allUnits.length === 0) return [];

    return subtractUnitsByOccurrence(allUnits, collectAllUnits(groups, context));
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
    rule: OrgTypeRule,
    getPointRange: (u: Unit[]) => PointRange,
): GroupSizeResult[] {
    const totalPts = unitPointTotal(units, getPointRange);
    if (totalPts <= 0) return [];

    const regular = getRegularCount(rule);
    const n = Math.floor(totalPts / regular);

    if (n === 0) {
        const subMod = findSubRegularModifier(rule, totalPts);
        if (subMod) {
            return [{
                name: buildName(rule, subMod[0]),
                type: rule.type,
                countsAsType: rule.countsAs ?? null,
                tier: resolveTier(rule, subMod[0]),
                units,
                tag: rule.tag,
            }];
        }

        // Smaller than the minimum legal modifier: no valid formation exists.
        if (totalPts < getMinimumModifierCount(rule) - 1e-9) {
            return [];
        }

        const [prefix] = findClosestModifier(rule, totalPts);
        return [{
            name: buildName(rule, prefix),
            type: rule.type,
            countsAsType: rule.countsAs ?? null,
            tier: resolveTier(rule, prefix),
            units,
            tag: rule.tag,
        }];
    }

    const results: GroupSizeResult[] = [];

    // Greedy point-based distribution: fill each regular instance
    // up to `regular` points before moving to the next.
    let offset = 0;
    for (let i = 0; i < n && offset < units.length; i++) {
        const instanceUnits: Unit[] = [];
        let pts = 0;
        while (offset < units.length && pts < regular - 1e-9) {
            instanceUnits.push(units[offset]);
            pts = unitPointTotal(instanceUnits, getPointRange);
            offset++;
        }
        results.push({
            name: rule.type,
            type: rule.type,
            countsAsType: rule.countsAs ?? null,
            tier: resolveTier(rule, ''),
            units: instanceUnits,
            tag: rule.tag,
        });
    }

    if (offset < units.length) {
        const leftoverUnits = units.slice(offset);
        const leftoverPts = unitPointTotal(leftoverUnits, getPointRange);
        const subMod = findSubRegularModifier(rule, leftoverPts);
        if (subMod) {
            results.push({
                name: buildName(rule, subMod[0]),
                type: rule.type,
                countsAsType: rule.countsAs ?? null,
                tier: resolveTier(rule, subMod[0]),
                units: leftoverUnits,
                tag: rule.tag,
            });
        } else {
            // Assimilate: upgrade the last regular instance
            const upgradedCount = regular + leftoverPts;
            const [prefix] = findClosestModifier(rule, upgradedCount);
            const lastGroup = results[results.length - 1];
            results[results.length - 1] = {
                name: buildName(rule, prefix),
                type: rule.type,
                countsAsType: rule.countsAs ?? null,
                tier: resolveTier(rule, prefix),
                units: [...(lastGroup.units ?? []), ...leftoverUnits],
                tag: rule.tag,
            };
        }
    }

    return results;
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
    rules: OrgTypeRule[],
    getPointRange: (u: Unit[]) => PointRange,
    context: SolverContext,
): GroupSizeResult[][] {
    const cmRules = rules
        .filter(r => r.customMatch)
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
    rules: OrgTypeRule[],
    getPointRange: (u: Unit[]) => PointRange,
    context: SolverContext,
): GroupSizeResult[] {
    const results: GroupSizeResult[] = [];
    let remaining = [...units];

    // Leaf rules sorted by priority desc, then tier desc
    const leafRules = rules
        .filter(r => !r.composedOfAny && !r.customMatch)
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
    rules: OrgTypeRule[],
    getPointRange: (u: Unit[]) => PointRange,
    context: SolverContext,
): GroupSizeResult[] {
    let best: { rule: OrgTypeRule; allocation: GroupSizeResult[] } | null = null;
    for (const rule of rules) {
        if (rule.composedOfAny) continue;
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
function composeUpward(groups: GroupSizeResult[], rules: OrgTypeRule[], context: SolverContext): GroupSizeResult[] {
    let current = [...groups];

    for (let iter = 0; iter < 20 && current.length >= 2; iter++) {
        const best = findBestComposition(current, rules, context);
        if (!best) break;
        current = best;
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

function betterScore(a: CompositionScore, b: CompositionScore): boolean {
    if (a.composedTier !== b.composedTier) return a.composedTier > b.composedTier;
    if (a.consumed !== b.consumed) return a.consumed > b.consumed;
    if (a.canPromote !== b.canPromote) return a.canPromote;
    if (a.strictCount !== b.strictCount) return a.strictCount > b.strictCount;
    return a.prioritySum > b.prioritySum;
}

function canRuleComposeGroups(
    rule: OrgTypeRule,
    groups: ReadonlyArray<GroupSizeResult>,
    context: SolverContext,
): boolean {
    if (!rule.composedOfAny || groups.length === 0) return false;

    const acceptedTypes = new Set(rule.composedOfAny);
    for (const group of groups) {
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

function collectSubsetCompositionCandidates(
    rule: OrgTypeRule,
    availableGroups: GroupSizeResult[],
    context: SolverContext,
): SubsetCompositionCandidate[] {
    const buildCandidates = (includeSubRegular: boolean): SubsetCompositionCandidate[] => {
        const candidates: SubsetCompositionCandidate[] = [];

        for (const takeCount of getCandidateTakeCounts(rule, availableGroups.length, includeSubRegular)) {
            const combinations = collectIndexCombinations(availableGroups.length, takeCount);
            for (const indices of combinations) {
                const chosenGroups = indices.map(index => availableGroups[index]);
                if (!canRuleComposeGroups(rule, chosenGroups, context)) continue;

                const result = applyComposedRule(rule, chosenGroups, chosenGroups.length);
                if (!result || result.groups.length === 0) continue;

                candidates.push({ chosenIndices: indices, result });
            }
        }

        return candidates;
    };

    const regularCandidates = buildCandidates(false);
    if (regularCandidates.length > 0 || rule.strict) return regularCandidates;
    return buildCandidates(true);
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
function canPromoteFurther(groups: GroupSizeResult[], rules: OrgTypeRule[]): boolean {
    for (const rule of rules) {
        if (!rule.composedOfAny || rule.composedOfAny.length === 0) continue;
        const accepted = new Set(rule.composedOfAny);
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
            const sub = findSubRegularModifier(rule, matchCount);
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

/**
 * Apply a single composed rule to `matchingGroups`, producing composed instances.
 *
 * Strict rules only accept exact modifier counts — no sub-regular fallback,
 * no assimilation. Unconsumed groups remain available for other rules.
 */
function applyComposedRule(
    rule: OrgTypeRule,
    matchingGroups: GroupSizeResult[],
    count: number,
): ComposedResult | null {
    const regularCount = getRegularCount(rule);
    if (regularCount < 1 || count < 1) return null;

    // ── Strict rules: exact modifier counts only ──
    if (rule.strict) {
        const mods = sortedModifiers(rule);
        // Find the modifier that consumes the most groups (largest n * modCount)
        let bestPrefix = '';
        let bestModCount = 0;
        let bestN = 0;
        for (const [prefix, modCount] of mods) {
            if (modCount < 1 || modCount > count) continue;
            const n = Math.floor(count / modCount);
            if (n * modCount > bestN * bestModCount) {
                bestPrefix = prefix;
                bestModCount = modCount;
                bestN = n;
            }
        }
        if (bestN === 0) return null;

        const results: GroupSizeResult[] = [];
        for (let i = 0; i < bestN; i++) {
            const start = i * bestModCount;
            results.push({
                name: buildName(rule, bestPrefix),
                type: rule.type,
                countsAsType: rule.countsAs ?? null,
                tier: resolveTier(rule, bestPrefix),
                children: matchingGroups.slice(start, start + bestModCount),
                priority: rule.priority,
            });
        }
        return { groups: results, consumed: bestN * bestModCount };
    }

    // ── Non-strict rules: sub-regular and assimilation allowed ──
    const n = Math.floor(count / regularCount);
    const leftover = count - n * regularCount;

    if (n === 0) {
        const subMod = findSubRegularModifier(rule, leftover);
        if (!subMod) return null;
        return {
            groups: [{
                name: buildName(rule, subMod[0]),
                type: rule.type,
                countsAsType: rule.countsAs ?? null,
                tier: resolveTier(rule, subMod[0]),
                children: matchingGroups.slice(0, count),
                priority: rule.priority,
            }],
            consumed: count,
        };
    }

    const results: GroupSizeResult[] = [];
    for (let i = 0; i < n; i++) {
        const start = i * regularCount;
        results.push({
            name: rule.type,
            type: rule.type,
            countsAsType: rule.countsAs ?? null,
            tier: resolveTier(rule, ''),
            children: matchingGroups.slice(start, start + regularCount),
            priority: rule.priority,
        });
    }

    if (leftover > 0) {
        const leftoverGroups = matchingGroups.slice(n * regularCount, count);
        const subMod = findSubRegularModifier(rule, leftover);
        if (subMod) {
            results.push({
                name: buildName(rule, subMod[0]),
                type: rule.type,
                countsAsType: rule.countsAs ?? null,
                tier: resolveTier(rule, subMod[0]),
                children: leftoverGroups,
                priority: rule.priority,
            });
        } else {
            const lastIdx = results.length - 1;
            const lastGroup = results[lastIdx];
            const upgradedCount = regularCount + leftover;
            const [prefix] = findClosestModifier(rule, upgradedCount);
            results[lastIdx] = {
                name: buildName(rule, prefix),
                type: rule.type,
                countsAsType: rule.countsAs ?? null,
                tier: resolveTier(rule, prefix),
                children: [...(lastGroup.children ?? []), ...leftoverGroups],
                priority: rule.priority,
            };
        }
    }

    return { groups: results, consumed: count };
}

/**
 * Try all viable composed rules on the current set of groups.
 * Tries each rule independently AND combinations of same-tier rules
 * that share matching groups (e.g. Binary + Trinary for Clan Stars).
 *
 * Scoring prefers: higher composed tier → more consumed → promotability
 * → strict count → priority sum.
 */
function findBestComposition(groups: GroupSizeResult[], rules: OrgTypeRule[], context: SolverContext): GroupSizeResult[] | null {
    let bestResult: GroupSizeResult[] | null = null;
    let bestScore: CompositionScore = { composedTier: -1, consumed: 0, canPromote: false, strictCount: 0, prioritySum: 0 };

    const composedRules = rules
        .filter(r => r.composedOfAny && r.composedOfAny.length > 0)
        .sort((a, b) => a.tier - b.tier);

    // Collect viable rules with their matching indices
    interface ViableRule {
        rule: OrgTypeRule;
        matching: number[];
        nonMatching: number[];
    }
    const viable: ViableRule[] = [];

    for (const rule of composedRules) {
        const acceptedTypes = new Set(rule.composedOfAny!);
        const matching: number[] = [];
        const nonMatching: number[] = [];

        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if ((g.type && acceptedTypes.has(g.type)) ||
                (g.countsAsType && acceptedTypes.has(g.countsAsType))) {
                matching.push(i);
            } else {
                nonMatching.push(i);
            }
        }

        if (matching.length === 0) continue;
        if (getCandidateTakeCounts(rule, matching.length, true).length === 0) continue;
        viable.push({ rule, matching, nonMatching });
    }

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
    for (const { rule, matching, nonMatching } of viable) {
        const matchingGroups = matching.map(i => groups[i]);
        const nonMatchingGroups = nonMatching.map(i => groups[i]);

        if (canRuleComposeGroups(rule, matchingGroups, context)) {
            const result = applyComposedRule(rule, matchingGroups, matching.length);
            if (result) {
                const newGroups = [...nonMatchingGroups, ...result.groups];
                // Add back unconsumed matching groups
                for (let i = result.consumed; i < matching.length; i++) {
                    newGroups.push(matchingGroups[i]);
                }
                evaluateCandidate(newGroups, result.consumed, maxTier(result.groups), [rule]);
            }
        }

        for (const candidate of collectSubsetCompositionCandidates(rule, matchingGroups, context)) {
            if (candidate.chosenIndices.length === matching.length) continue;

            const chosenSet = new Set(candidate.chosenIndices);
            const newGroups = [...nonMatchingGroups, ...candidate.result.groups];
            for (let i = 0; i < matchingGroups.length; i++) {
                if (!chosenSet.has(i)) {
                    newGroups.push(matchingGroups[i]);
                }
            }

            evaluateCandidate(newGroups, candidate.result.consumed, maxTier(candidate.result.groups), [rule]);
        }
    }

    // Phase 2: Try combinations of same-tier rules that share matching groups.
    // Group viable rules by tier, then enumerate subset allocations within each tier.
    const byTier = new Map<number, ViableRule[]>();
    for (const v of viable) {
        const t = v.rule.tier;
        if (!byTier.has(t)) byTier.set(t, []);
        byTier.get(t)!.push(v);
    }

    for (const [, tierViable] of byTier) {
        if (tierViable.length < 2) continue;

        // Find the union of matching indices across all rules at this tier
        const unionMatching = new Set<number>();
        for (const v of tierViable) {
            for (const idx of v.matching) unionMatching.add(idx);
        }
        const matchingArr = Array.from(unionMatching);
        const totalMatching = matchingArr.length;
        const nonMatchingArr = groups.filter((_, i) => !unionMatching.has(i));
        const matchingGroups = matchingArr.map(i => groups[i]);

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
                const chosenSet = new Set(candidate.chosenIndices);
                const remainingGroups = availableGroups.filter((_, index) => !chosenSet.has(index));
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
function wrapResult(groups: GroupSizeResult[]): GroupSizeResult[] {
    if (groups.length === 0) return [EMPTY_RESULT];
    if (groups.length === 1) return groups;
    return [...groups].sort((a, b) => b.tier - a.tier);
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
        customMatchCache: new WeakMap<OrgTypeRule, Map<string, number>>(),
        ruleFilterCache: new WeakMap<OrgTypeRule, Map<string, boolean>>(),
    };

    constructor(private readonly org: OrgDefinition) {}

    resolveFromUnits(units: Unit[]): GroupSizeResult[] {
        if (units.length === 0) {
            return [EMPTY_RESULT];
        }

        const leafCandidates = allocateLeaves(units, this.org.rules, this.org.getPointRange, this.context);

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
            const composed = composeUpward(leafGroups, this.org.rules, this.context);
            const wrapped = wrapResult(composed);
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
        const normalized = normalizeGroupsToOrg(groupResults, this.org.rules);

        if (normalized.length === 1) {
            return attachTopLevelLeftovers([normalized[0]], allUnits, this.context);
        }

        const composed = composeUpward(normalized, this.org.rules, this.context);
        return attachTopLevelLeftovers(wrapResult(composed), allUnits, this.context);
    }
}

/**
 * Evaluate a single group of units and return the structural result.
 *
 * Wide combinator approach:
 * 1. Generate all leaf allocation candidates (customMatch branches)
 * 2. Compose each candidate upward
 * 3. Pick the best result (highest tier, fewest groups, highest priority)
 */
export function resolveFromUnits(units: Unit[], techBase: TechBase, factionName: string, hierarchicalAggregation: boolean = false): GroupSizeResult[] {
    return new OrgSolver(resolveOrg(techBase, factionName)).resolveFromUnits(units);
}

/**
 * Evaluate a force from pre-computed group results.
 * Groups are taken as-is (not deconstructed) and composed upward.
 */
export function resolveFromGroups(techBase: TechBase, factionName: string, groupResults: GroupSizeResult[], hierarchicalAggregation: boolean = false): GroupSizeResult[] {
    return new OrgSolver(resolveOrg(techBase, factionName)).resolveFromGroups(groupResults);
}
