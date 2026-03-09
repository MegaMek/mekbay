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

import { Unit } from '../models/units.model';
import {
    ForceComposition,
    OrgType,
    OrgTypeRule,
    getForceCompositionFromUnits,
    OrgDefinition,
    ORG_REGISTRY,
    DEFAULT_ORG,
    PointRange,
    GroupSizeResult,
    getRegularCount,
    getModifierPrefix,
} from './org-definitions.util';

/*
 * Author: Drake
 *
 * Org solver: force type identification shared between force size naming
 * and group size naming.
 *
 * Solver uses a bottom-up recursive approach:
 * 1. Compute points from ForceComposition via getPointRange
 * 2. Match leaf rules (Point, Single, Flight, etc.) or customMatch rules (Nova, etc.)
 * 3. Divide points by the leaf's regular count to get N virtual sub-groups
 * 4. Feed those groups into evaluateForceByGroups to find the next level up
 * 5. Repeat until no higher level matches
 * 6. Only the final (top) level applies non-regular modifiers (Reinforced, etc.)
 *
 * Org definitions (OrgType, OrgTypeRule, org classes) live in
 * org-definitions.util.ts.
 */

export type { OrgType, GroupSizeResult } from './org-definitions.util';

/** Internal result of a force evaluation, carrying the distance for comparison. */
interface EvaluationResult {
    name: string;
    dist: number;
    matchedRule: OrgTypeRule | null;
}

/** Returns true if candidate is a better match than current (lower dist, or same dist with higher regularCount). */
function isBetterMatch(candidate: EvaluationResult, current: EvaluationResult): boolean {
    if (!candidate.matchedRule) return false;
    if (candidate.dist < current.dist) return true;
    if (candidate.dist > current.dist) return false;
    // Same distance — higher priority wins
    const candPriority = candidate.matchedRule.priority ?? 0;
    const currPriority = current.matchedRule?.priority ?? 0;
    if (candPriority !== currPriority) return candPriority > currPriority;
    // Same priority — higher regularCount wins
    return getRegularCount(candidate.matchedRule) > (current.matchedRule ? getRegularCount(current.matchedRule) : 0);
}

// ─── Leaf evaluation ───────────────────────────────────────────────────────────

/**
 * Find the best-matching leaf rule for a composition.
 * Leaf rules have no composedOfAny — they match raw points directly.
 * Also matches customMatch rules (Nova, Squad, Platoon, etc.).
 *
 * Returns the matched rule + the pts value from getPointRange.
 */
function evaluateLeaf(
    comp: ForceComposition,
    rules: OrgTypeRule[],
    getPointRange: (comp: ForceComposition) => PointRange,
    minDistance = 2,
    distanceFactor = 0.2,
): EvaluationResult {
    const range = getPointRange(comp);
    const midPts = (range.min + range.max) / 2;

    if (range.max === 0) return { name: 'Force', dist: Infinity, matchedRule: null };

    let bestDist = Infinity;
    let bestModName = '';
    let bestRule: OrgTypeRule | null = null;

    for (const rule of rules) {
        if (rule.filter && !rule.filter(comp)) continue;

        let dist = -1;
        if (rule.customMatch) {
            const customDist = rule.customMatch(comp);
            if (customDist === Infinity) continue;
            if (customDist >= 0) {
                if (rule.strict && customDist !== 0) continue;
                if (customDist < bestDist ||
                    (customDist === bestDist && rule.strict && !bestRule?.strict)) {
                    bestDist = customDist;
                    bestRule = rule;
                    bestModName = customDist === 0
                        ? ''
                        : getModifierPrefix(rule, midPts);
                }
                continue;
            }
            // customDist === -1: fall through to range-based evaluation
        }

        // Only leaf rules (no composedOfAny) use range-based matching against raw pts.
        // Composed rules have modifier counts that represent sub-unit counts, not pts.
        if (rule.composedOfAny) continue;

        // For leaf rules, modifier counts are absolute pts
        const counts = Object.values(rule.modifiers);
        const ruleMin = Math.min(...counts);
        const ruleMax = Math.max(...counts);

        if (range.max >= ruleMin && range.min <= ruleMax) {
            dist = 0;
        } else if (range.max < ruleMin) {
            dist = ruleMin - range.max;
        } else {
            dist = range.min - ruleMax;
        }

        if (rule.strict && dist !== 0) continue;

        const strictUpgrade = dist === bestDist && rule.strict && !bestRule?.strict;
        if (dist < bestDist || strictUpgrade ||
            (dist === bestDist && !(!rule.strict && bestRule?.strict) && getRegularCount(rule) > (bestRule ? getRegularCount(bestRule) : 0))) {
            bestDist = dist;
            bestRule = rule;
            bestModName = getModifierPrefix(rule, midPts);
        }
    }

    const maxAllowedDistance = Math.max(minDistance, midPts * distanceFactor);
    if (bestDist <= maxAllowedDistance) {
        const name = bestModName ? bestModName + bestRule!.type : bestRule!.type;
        return { name, dist: bestDist, matchedRule: bestRule };
    }

    return { name: 'Force', dist: Infinity, matchedRule: null };
}

// ─── Group-based evaluation ────────────────────────────────────────────────────

/**
 * Group-based force evaluation.
 *
 * Counts how many groups matched each rule type. Looks for rules whose
 * composedOfAny types match the group types and compares the group count
 * against the rule's modifier counts.
 *
 * Example: 6 groups each identified as "Level II" → Level III has
 * composedOfAny = ['Level II'] and modifier count 6 → "Level III".
 */
function evaluateForceByGroups(
    groupResults: GroupSizeResult[],
    rules: OrgTypeRule[],
    groupMinDistance = 1,
    groupDistanceFactor = 0.25,
): EvaluationResult {
    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (const rule of rules) {
        if (!rule.composedOfAny || rule.composedOfAny.length === 0) continue;

        if (rule.groupFilter && !rule.groupFilter(groupResults)) continue;

        const acceptedTypeSet = new Set(rule.composedOfAny);
        let count = 0;
        for (const result of groupResults) {
            if (result.type && acceptedTypeSet.has(result.type)) {
                count++;
            } else if (result.countsAsType && acceptedTypeSet.has(result.countsAsType)) {
                count++;
            }
        }
        if (count === 0) continue;

        const modCounts = Object.values(rule.modifiers);
        const rawMin = Math.min(...modCounts);
        const rawMax = Math.max(...modCounts);

        let dist: number;
        if (count >= rawMin && count <= rawMax) {
            dist = 0;
        } else if (count < rawMin) {
            dist = rawMin - count;
        } else {
            dist = count - rawMax;
        }

        // Penalize for groups not accounted for by this rule.
        const unmatchedCount = groupResults.length - count;
        dist += unmatchedCount;

        const bestPriority = best.matchedRule?.priority ?? 0;
        if (dist < best.dist ||
            (dist === best.dist && (rule.priority ?? 0) > bestPriority) ||
            (dist === best.dist && (rule.priority ?? 0) === bestPriority && getRegularCount(rule) > (best.matchedRule ? getRegularCount(best.matchedRule) : 0))) {
            const modPrefix = getModifierPrefix(rule, count);
            best = {
                name: modPrefix ? modPrefix + rule.type : rule.type,
                dist,
                matchedRule: rule,
            };
        }
    }

    const maxAllowed = Math.max(groupMinDistance, groupResults.length * groupDistanceFactor);
    if (best.dist <= maxAllowed) {
        return best;
    }

    return { name: 'Force', dist: Infinity, matchedRule: null };
}

// ─── Hierarchical group split ──────────────────────────────────────────────────

/**
 * Hierarchical group split: when direct group evaluation doesn't find a good
 * match, try splitting groups into K sub-batches, evaluate each batch to find
 * an intermediate formation, then see if K intermediate formations compose
 * into a higher-level formation.
 *
 * Example: 4 Novas => K=2 => [Nova,Nova] + [Nova,Nova]
 *   => each batch = Supernova Binary (2 Novas) => 2 x SN Binary
 *   => SN Binary countsAs Binary => Under-Strength Cluster (2 Binaries).
 */
function trySplitGroupEvaluation(
    groupResults: GroupSizeResult[],
    rules: OrgTypeRule[],
    groupMinDistance: number,
    groupDistanceFactor: number,
): EvaluationResult {
    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (let k = 2; k <= 5; k++) {
        if (groupResults.length < k * 2) break;

        const batchSize = Math.floor(groupResults.length / k);
        const remainder = groupResults.length % k;

        const batches: GroupSizeResult[][] = [];
        let offset = 0;
        for (let i = 0; i < k; i++) {
            const size = batchSize + (i < remainder ? 1 : 0);
            batches.push(groupResults.slice(offset, offset + size));
            offset += size;
        }

        const batchResults: GroupSizeResult[] = [];
        let allMatched = true;
        for (const batch of batches) {
            const result = evaluateForceByGroups(batch, rules, groupMinDistance, groupDistanceFactor);
            if (!result.matchedRule) {
                allMatched = false;
                break;
            }
            batchResults.push({
                name: result.name,
                type: result.matchedRule.type,
                countsAsType: result.matchedRule.countsAs ?? null,
                tier: result.matchedRule.tier,
            });
        }
        if (!allMatched) continue;

        const higherResult = evaluateForceByGroups(batchResults, rules, groupMinDistance, groupDistanceFactor);
        if (isBetterMatch(higherResult, best)) {
            best = higherResult;
        }

        if (best.dist === 0) break;
    }

    return best;
}

// ─── Promotive group evaluation ────────────────────────────────────────────────

/** Look up the tier for an OrgType from the rules array. */
function getRuleTier(type: OrgType, rules: OrgTypeRule[]): number {
    return rules.find(r => r.type === type)?.tier ?? 0;
}

// ─── Foreign-type normalization ────────────────────────────────────────────────

/**
 * Find the closest tier in the tierMap to the target tier.
 * When tiers are floating-point (e.g. 1.2) and the map only has
 * e.g. [1, 2, 3], finds the nearest neighbor(s) and picks the one
 * with the smallest absolute distance. Ties go to the lower tier.
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
 *
 * Example: a "Level II" (ComStar, tier 1) fed into ISOrg rules becomes
 * a "Lance" (IS, tier 1) so that group-based evaluation can count it
 * as a sub-unit of "Company" (composedOfAny: ['Lance']).
 *
 * Only remaps when the type is truly foreign (not in any rule). Keeps
 * the original name prefix (e.g. "Reinforced") by replacing only the
 * type suffix in the display name.
 *
 * When tiers are floating-point, finds the closest available tier
 * (ties go to the lower neighbor).
 */
function normalizeGroupsToOrg(groupResults: GroupSizeResult[], rules: OrgTypeRule[]): GroupSizeResult[] {
    const knownTypes = new Set(rules.map(r => r.type));
    // Pre-compute: for each tier, pick the best general-purpose rule (no filter, no strict)
    const tierMap = new Map<number, OrgTypeRule>();
    for (const r of rules) {
        if (tierMap.has(r.tier)) continue; // first rule at each tier wins (rules are ordered)
        if (!r.strict && !r.filter) tierMap.set(r.tier, r);
    }
    // Fallback: if no filter-free rule exists at a tier, use any rule at that tier
    for (const r of rules) {
        if (!tierMap.has(r.tier)) tierMap.set(r.tier, r);
    }
    const sortedTiers = Array.from(tierMap.keys()).sort((a, b) => a - b);

    return groupResults.map(g => {
        const typeKnown = (g.type && knownTypes.has(g.type)) ||
                          (g.countsAsType && knownTypes.has(g.countsAsType));
        if (typeKnown) return g;

        // Foreign type — find equivalent rule by closest tier
        const equiv = findClosestTierRule(g.tier, tierMap, sortedTiers);
        if (!equiv) return g;

        // Rebuild name: extract modifier prefix from original, apply to new type
        let newName = equiv.type;
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
        };
    });
}

/**
 * Derive the sub-unit count of a group from its display name and the matching rule.
 * E.g. "Under-Strength Cluster" + Cluster rule → modifier {prefix:'Under-Strength ', count:2} → 2.
 */
function getSubUnitCountFromName(group: GroupSizeResult, rule: OrgTypeRule): number {
    for (const [prefix, count] of Object.entries(rule.modifiers)) {
        const expectedName = prefix ? prefix + rule.type : rule.type;
        if (group.name === expectedName) return count;
    }
    return getRegularCount(rule);
}

/**
 * Try to absorb lower-tier groups into higher-tier groups when the lower-tier
 * type is a valid sub-unit of the higher-tier type.
 *
 * Example: [Binary] absorbed into [Under-Strength Cluster]
 *   → Cluster composedOfAny includes 'Binary'
 *   → Under-Strength Cluster has 2 sub-units + 1 Binary = 3 → regular Cluster
 */
function tryAbsorbIntoHigherTier(
    lowerGroups: GroupSizeResult[],
    higherGroups: GroupSizeResult[],
    rules: OrgTypeRule[],
): GroupSizeResult[] {
    const result = [...higherGroups];
    const remaining = [...lowerGroups];

    for (let hi = 0; hi < result.length && remaining.length > 0; hi++) {
        const hGroup = result[hi];
        // Find the rule for the higher-tier group
        const hRule = hGroup.type
            ? rules.find(r => r.type === hGroup.type && r.composedOfAny && r.composedOfAny.length > 0)
            : null;
        if (!hRule || !hRule.composedOfAny) continue;

        const acceptedSet = new Set(hRule.composedOfAny);
        let absorbed = 0;
        const toRemove: number[] = [];

        for (let li = 0; li < remaining.length; li++) {
            const lGroup = remaining[li];
            if ((lGroup.type && acceptedSet.has(lGroup.type)) ||
                (lGroup.countsAsType && acceptedSet.has(lGroup.countsAsType))) {
                absorbed++;
                toRemove.push(li);
            }
        }

        if (absorbed > 0) {
            const currentCount = getSubUnitCountFromName(hGroup, hRule);
            const newCount = currentCount + absorbed;
            const newPrefix = getModifierPrefix(hRule, newCount);
            const newName = newPrefix ? newPrefix + hRule.type : hRule.type;
            result[hi] = { name: newName, type: hGroup.type, countsAsType: hGroup.countsAsType, tier: hGroup.tier };

            // Remove absorbed groups (reverse order to preserve indices)
            for (let i = toRemove.length - 1; i >= 0; i--) {
                remaining.splice(toRemove[i], 1);
            }
        }
    }

    // Any remaining lower-tier groups that couldn't be absorbed stay in the result
    return [...result, ...remaining];
}

/**
 * Promotive group evaluation: iteratively promotes lowest-tier groups
 * up the composition hierarchy, then evaluates the result.
 *
 * Algorithm:
 * 1. Find the highest-tier group — that's the floor (minimum result)
 * 2. Separate lowest-tier groups from higher-tier groups
 * 3. Promote lowest-tier groups via evaluateForceByGroups / trySplitGroupEvaluation
 * 4. Merge promoted result with remaining groups
 * 5. Repeat until all groups are at the same tier or no promotion possible
 * 6. Evaluate the final set; floor guarantees result ≥ highest input tier
 *
 * Example: [Cluster, Binary, Star, Star]
 *   → Stars promote to Binary → [Cluster, Binary, Binary]
 *   → Binaries promote to Under-Strength Cluster → [Cluster, Cluster]
 *   → 2 Clusters → Under-Strength Galaxy
 */
function promotiveGroupEvaluation(
    groupResults: GroupSizeResult[],
    rules: OrgTypeRule[],
    groupMinDistance: number,
    groupDistanceFactor: number,
): EvaluationResult {
    const groupTier = (g: GroupSizeResult): number => g.tier;

    // Floor: highest-tier group present
    let maxTier = 0;
    let floorGroup: GroupSizeResult | null = null;
    for (const g of groupResults) {
        const t = groupTier(g);
        if (t > maxTier) { maxTier = t; floorGroup = g; }
    }

    let groups = [...groupResults];

    // Iteratively promote lowest-tier groups
    for (let iter = 0; iter < 10 && groups.length >= 2; iter++) {
        const tiers = groups.map(g => groupTier(g));
        const minTier = Math.min(...tiers);
        if (minTier === Math.max(...tiers)) break; // All at same tier

        const lowest: GroupSizeResult[] = [];
        const rest: GroupSizeResult[] = [];
        for (let i = 0; i < groups.length; i++) {
            if (tiers[i] === minTier) lowest.push(groups[i]);
            else rest.push(groups[i]);
        }

        if (lowest.length < 2) {
            // Try absorbing single lower-tier groups into higher-tier groups
            // E.g. [Under-Strength Cluster, Binary] → Binary is a sub-unit of Cluster
            // → absorb: Under-Strength(2) + 1 Binary = 3 → regular Cluster
            groups = tryAbsorbIntoHigherTier(lowest, rest, rules);
            break;
        }

        // Try both direct group eval and split, prefer the one with higher tier
        let promoted = evaluateForceByGroups(lowest, rules, groupMinDistance, groupDistanceFactor);
        if (lowest.length >= 4) {
            const split = trySplitGroupEvaluation(lowest, rules, groupMinDistance, groupDistanceFactor);
            if (split.matchedRule) {
                const splitTier = split.matchedRule.tier;
                const promotedTier = promoted.matchedRule?.tier ?? -1;
                // Prefer higher tier; on same tier prefer lower distance
                if (splitTier > promotedTier ||
                    (splitTier === promotedTier && split.dist < promoted.dist)) {
                    promoted = split;
                }
            }
        }
        if (!promoted.matchedRule) break;

        groups = [...rest, {
            name: promoted.name,
            type: promoted.matchedRule.type,
            countsAsType: promoted.matchedRule.countsAs ?? null,
            tier: promoted.matchedRule.tier,
        }];
    }

    // After promotion/absorption, a single remaining group IS the result
    if (groups.length === 1) {
        const g = groups[0];
        const matchedRule = g.type ? rules.find(r => r.type === g.type) ?? null : null;
        return { name: g.name, dist: 0, matchedRule };
    }

    // Final evaluation on the resulting groups
    let result = evaluateForceByGroups(groups, rules, groupMinDistance, groupDistanceFactor);
    if (groups.length >= 4) {
        const split = trySplitGroupEvaluation(groups, rules, groupMinDistance, groupDistanceFactor);
        if (isBetterMatch(split, result)) {
            result = split;
        }
    }

    // Floor guarantee: never return a result lower-tier than the highest input group.
    // Re-derive floor from current groups (may have been updated by absorption).
    let currentFloor: GroupSizeResult | null = null;
    let currentMaxTier = 0;
    for (const g of groups) {
        const t = groupTier(g);
        if (t > currentMaxTier) { currentMaxTier = t; currentFloor = g; }
    }
    if (!currentFloor) { currentFloor = floorGroup; currentMaxTier = maxTier; }

    if (currentFloor) {
        const resultTier = result.matchedRule?.tier ?? -1;
        if (resultTier < currentMaxTier) {
            const floorRule = currentFloor.type
                ? rules.find(r => r.type === currentFloor!.type) ?? null
                : null;
            return { name: currentFloor.name, dist: 0, matchedRule: floorRule };
        }
    }

    return result;
}

// ─── Recursive bottom-up split ─────────────────────────────────────────────────

/**
 * Find all leaf rules (no composedOfAny) that pass the composition filter.
 * These are the base units: Point, Single, Flight, Squad, Level I, etc.
 * Excludes customMatch-only rules (Nova, Platoon, etc.) since they need
 * per-sub-group composition data we don't have when doing virtual splits.
 */
function findLeafRules(rules: OrgTypeRule[], comp: ForceComposition): OrgTypeRule[] {
    return rules.filter(r => !r.composedOfAny && !r.customMatch && (!r.filter || r.filter(comp)));
}

/**
 * Recursive bottom-up evaluation: given a total point value, find the highest
 * structural formation by recursively dividing by the regular count of each level.
 *
 * Algorithm:
 * 1. Divide pts by each leaf rule's regularCount to get N virtual groups
 * 2. Feed N groups into evaluateForceByGroups to find the next level
 * 3. If matched, take that level's regularCount, divide the group count by it
 *    to get M virtual groups at the next-next level
 * 4. Repeat until no higher level matches
 * 5. At the final level, apply non-regular modifiers (Reinforced, etc.)
 *
 * Example (ClanOrg, 40 mechs = 40 pts):
 *   40 / 1 (Point regular) = 40 Points
 *   40 Points → Star (composedOfAny: ['Point'], regular=5) → 40/5 = 8 Stars
 *   8 Stars → Binary (composedOfAny: ['Star'], regular=2, priority=0) → 8/2 = 4 Binaries
 *          or Trinary (composedOfAny: ['Star'], regular=3, priority=0) → 8/3 = 2.67
 *   Pick Binary (priority tie-break: both 0, but Binary count=4 vs Trinary count=2, try both)
 *   4 Binaries → Cluster (composedOfAny: ['Binary','Trinary',...], regular=3, modifiers 2-5)
 *   → 4 = Reinforced Cluster
 */
function trySplitEvaluation(
    range: PointRange,
    rules: OrgTypeRule[],
    comp: ForceComposition,
    groupMinDistance?: number,
    groupDistanceFactor?: number,
): EvaluationResult {
    const leafRules = findLeafRules(rules, comp);
    if (leafRules.length === 0) return { name: 'Force', dist: Infinity, matchedRule: null };

    // Pre-filter composed rules by composition so virtual-group evaluation
    // respects composition filters (e.g. infantry-only Century vs non-infantry Century).
    const filteredRules = rules.filter(r => !r.filter || r.filter(comp));

    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (const leaf of leafRules) {
        const leafRegular = getRegularCount(leaf);
        const minLeaf = Math.max(2, Math.floor(range.min / leafRegular));
        const maxLeaf = Math.ceil(range.max / leafRegular);

        for (let leafCount = maxLeaf; leafCount >= minLeaf; leafCount--) {

        // Start with leafCount virtual groups of the leaf type
        let currentGroups: GroupSizeResult[] = [];
        for (let i = 0; i < leafCount; i++) {
            currentGroups.push({
                name: leaf.type,
                type: leaf.type,
                countsAsType: leaf.countsAs ?? null,
                tier: leaf.tier,
            });
        }

        // Recursively build up: evaluate groups → get next level → divide → repeat
        let lastResult: EvaluationResult | null = null;

        for (let depth = 0; depth < 10; depth++) { // safety limit
            if (currentGroups.length < 2) break;

            // Try to find the best one-level-up rule using only regular ('') counts.
            // We do this by finding which rule's regularCount evenly (or nearly) divides
            // the current group count, producing the most groups at the next level.
            const nextLevel = findBestNextLevel(currentGroups, filteredRules);
            if (!nextLevel) break;

            const { rule: nextRule, groupCount: nextCount, remainder } = nextLevel;

            if (nextCount < 1) break;

            // Build next-level groups
            const nextGroups: GroupSizeResult[] = [];
            for (let i = 0; i < nextCount; i++) {
                nextGroups.push({
                    name: nextRule.type,
                    type: nextRule.type,
                    countsAsType: nextRule.countsAs ?? null,
                    tier: nextRule.tier,
                });
            }

            // If there's a remainder, check if it can be accounted for at a higher level
            // For now, carry the remainder as extra distance
            if (nextCount >= 2) {
                // Save this level as a candidate — we might go higher
                currentGroups = nextGroups;
                lastResult = {
                    name: nextRule.type,
                    dist: remainder,
                    matchedRule: nextRule,
                };
            } else {
                // Only 1 group at next level — this is our final level
                // Apply modifier
                const totalSubGroups = currentGroups.length;
                const modPrefix = getModifierPrefix(nextRule, totalSubGroups);
                lastResult = {
                    name: modPrefix ? modPrefix + nextRule.type : nextRule.type,
                    dist: 0,
                    matchedRule: nextRule,
                };
                break;
            }
        }

        // Try group-based evaluation on current groups to find a match with modifiers.
        // This handles cases like 3 Points → "Short Star" (count 3 within Star's 2–7 range)
        // where findBestNextLevel fails because regularCount (5) doesn't divide evenly.
        if (currentGroups.length >= 2) {
            const finalUp = evaluateForceByGroups(currentGroups, filteredRules);
            if (finalUp.matchedRule &&
                (!lastResult?.matchedRule ||
                 finalUp.dist < lastResult.dist ||
                 (finalUp.dist === lastResult.dist &&
                  getRegularCount(finalUp.matchedRule) > getRegularCount(lastResult.matchedRule)))) {
                lastResult = finalUp;
            }
        }

        if (lastResult?.matchedRule && isBetterMatch(lastResult, best)) {
            best = lastResult;
        }
        } // end leafCount loop
    }

    // Scale every numeric field in a ForceComposition by a factor.
    const scaleComp = (c: ForceComposition, factor: number): ForceComposition => {
        const scaled = {} as ForceComposition;
        for (const key of Object.keys(c) as (keyof ForceComposition)[]) {
            scaled[key] = c[key] * factor;
        }
        return scaled;
    };

    // Try customMatch rules as virtual group generators.
    // E.g. 10 BM + 50 BA_troopers can be split into 2 Novas → Supernova Binary.
    for (const cmRule of filteredRules) {
        if (!cmRule.customMatch) continue;

        const midPts = (range.min + range.max) / 2;
        const ruleRegular = getRegularCount(cmRule);
        if (ruleRegular <= 0) continue;

        const maxN = Math.min(10, Math.ceil(midPts / ruleRegular) + 1);
        for (let n = 2; n <= maxN; n++) {
            // Divide composition evenly into n sub-compositions
            const subComp = scaleComp(comp, 1 / n);

            if (cmRule.filter && !cmRule.filter(subComp)) continue;

            const customDist = cmRule.customMatch(subComp);
            if (customDist === Infinity) continue;
            if (cmRule.strict && customDist !== 0) continue;
            if (customDist > 1) continue;

            // Create n virtual groups of this customMatch type
            const virtualGroups: GroupSizeResult[] = [];
            for (let i = 0; i < n; i++) {
                virtualGroups.push({
                    name: cmRule.type,
                    type: cmRule.type,
                    countsAsType: cmRule.countsAs ?? null,
                    tier: cmRule.tier,
                });
            }

            // Direct group evaluation (handles 2 Novas → SN Binary, 3 → SN Trinary)
            let cmResult = evaluateForceByGroups(virtualGroups, filteredRules);

            // For larger counts, try hierarchical split (e.g. 6 Novas → 2 SN Trinaries → ...)
            if (n >= 4) {
                const split = trySplitGroupEvaluation(virtualGroups, filteredRules,
                    groupMinDistance ?? 1, groupDistanceFactor ?? 0.25);
                if (isBetterMatch(split, cmResult)) {
                    cmResult = split;
                }
            }

            if (cmResult.matchedRule && isBetterMatch(cmResult, best)) {
                best = cmResult;
            }
        }
    }

    return best;
}

/**
 * Find the best next-level rule for a set of groups.
 * Returns the rule whose composedOfAny accepts the group types,
 * along with how many groups of that rule type we can form using
 * its regular ('') count, and the remainder.
 *
 * Uses priority to break ties (higher priority wins).
 */
function findBestNextLevel(
    groups: GroupSizeResult[],
    rules: OrgTypeRule[],
): { rule: OrgTypeRule; groupCount: number; remainder: number } | null {
    let best: { rule: OrgTypeRule; groupCount: number; remainder: number } | null = null;

    for (const rule of rules) {
        if (!rule.composedOfAny || rule.composedOfAny.length === 0) continue;

        const acceptedTypeSet = new Set(rule.composedOfAny);
        let matchingCount = 0;
        for (const g of groups) {
            if (g.type && acceptedTypeSet.has(g.type)) {
                matchingCount++;
            } else if (g.countsAsType && acceptedTypeSet.has(g.countsAsType)) {
                matchingCount++;
            }
        }
        if (matchingCount === 0) continue;

        // Use the regular count to divide
        const regCount = getRegularCount(rule);
        if (regCount < 1) continue;

        const nextGroupCount = Math.floor(matchingCount / regCount);
        const remainder = matchingCount % regCount;

        if (nextGroupCount < 1) continue;

        // Prefer: more groups at next level, then higher priority, then higher regularCount
        if (!best ||
            nextGroupCount > best.groupCount ||
            (nextGroupCount === best.groupCount && (rule.priority ?? 0) > (best.rule.priority ?? 0)) ||
            (nextGroupCount === best.groupCount && (rule.priority ?? 0) === (best.rule.priority ?? 0) && remainder < best.remainder)) {
            best = { rule, groupCount: nextGroupCount, remainder };
        }
    }

    return best;
}

// ─── Org Resolution ────────────────────────────────────────────────────────────

/**
 * Resolve the org rules and point-range function for the given tech base / faction.
 */
function resolveOrg(techBase: string, factionName: string): OrgDefinition {
    return ORG_REGISTRY.find(e => e.match(techBase, factionName))?.org ?? DEFAULT_ORG;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate a single group of units and return the structural result
 * (name + matched OrgType). This is the data each UnitGroup can cache
 * in a computed signal so the force-level evaluator doesn't redo it.
 *
 * Strategy:
 * 1. Try leaf matching (Point, Single, customMatch rules like Nova)
 * 2. If leaf didn't match or pts is large, try recursive bottom-up split
 */
export function resolveFromUnits(units: Unit[], techBase: string, factionName: string): GroupSizeResult {
    if (units.length === 0) return { name: 'Force', type: null, countsAsType: null, tier: 0 };
    const { rules, getPointRange, minDistance, distanceFactor, groupMinDistance, groupDistanceFactor } = resolveOrg(techBase, factionName);
    const comp = getForceCompositionFromUnits(units);
    let result = evaluateLeaf(comp, rules, getPointRange, minDistance, distanceFactor);

    const range = getPointRange(comp);
    if (range.max > 0) {
        const splitResult = trySplitEvaluation(range, rules, comp, groupMinDistance, groupDistanceFactor);
        if (isBetterMatch(splitResult, result)) {
            result = splitResult;
        }
    }

    return {
        name: result.name,
        type: result.matchedRule?.type ?? null,
        countsAsType: result.matchedRule?.countsAs ?? null,
        tier: result.matchedRule?.tier ?? 0,
    };
}

export function resolveFromGroups(techBase: string, factionName: string, groupResults: GroupSizeResult[]): GroupSizeResult {
    if (groupResults.length === 0) return { name: 'Force', type: null, countsAsType: null, tier: 0 };
    const { rules, groupMinDistance, groupDistanceFactor } = resolveOrg(techBase, factionName);
    // Normalize foreign types (e.g. Level II → Lance) so they can participate
    // in group-based evaluation against this org's composition hierarchy.
    const normalized = normalizeGroupsToOrg(groupResults, rules);
    if (normalized.length === 1) {
        const single = normalized[0];
        return {
            name: single.name,
            type: single.type,
            countsAsType: single.countsAsType,
            tier: single.tier,
        };
    }
    const groupResult = promotiveGroupEvaluation(normalized, rules, groupMinDistance, groupDistanceFactor);

    if (groupResult.matchedRule) {
        return {
            name: groupResult.name,
            type: groupResult.matchedRule?.type ?? null,
            countsAsType: groupResult.matchedRule?.countsAs ?? null,
            tier: groupResult.matchedRule?.tier ?? 0,
        };
    } else {
        return { name: 'Force', type: null, countsAsType: null, tier: 0 };
    }
}