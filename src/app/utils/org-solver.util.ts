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

import { ForceUnit } from '../models/force-unit.model';
import {
    ForceComposition,
    ForceType,
    ForceTypeRule,
    getForceComposition,
    OrgDefinition,
    ORG_REGISTRY,
    DEFAULT_ORG,
    PointRange,
} from './org-definitions.util';

/*
 * Author: Drake
 *
 * Org solver: force type identification shared between force size naming
 * and group size naming.
 *
 * Org definitions (ForceType, ForceTypeRule, org classes) live in
 * org-definitions.util.ts.
 */

export type { ForceType } from './org-definitions.util';

/** Internal result of a force evaluation, carrying the distance for comparison. */
interface EvaluationResult {
    name: string;
    dist: number;
    matchedRule: ForceTypeRule | null;
}

/**
 * Exported result of a group-level size evaluation.
 * Carries the matched ForceType so force-level evaluation can
 * count groups by type without re-evaluating them.
 */
export interface GroupSizeResult {
    name: string;
    type: ForceType | null;
    /** Alias type for group-based counting (e.g. Nova also counts as Star). */
    countsAsType: ForceType | null;
}

/**
 * Core evaluation: given a composition, find the best-matching rule and modifier.
 * Returns the full result including distance so callers can compare approaches.
 */
function evaluateForceDetailed(
    comp: ForceComposition,
    rules: ForceTypeRule[],
    getPointRange: (comp: ForceComposition) => PointRange,
    minDistance = 2,
    distanceFactor = 0.2,
): EvaluationResult {
    const range = getPointRange(comp);
    const midPts = (range.min + range.max) / 2;

    if (range.max === 0) return { name: 'Force', dist: Infinity, matchedRule: null };

    let bestType: string = 'Force';
    let bestDist = Infinity;
    let bestNominal = 0;
    let bestModName = '';
    let bestRule: ForceTypeRule | null = null;

    for (const rule of rules) {
        // Composition filter — skip rules that don't apply to this force type
        if (rule.filter && !rule.filter(comp)) continue;

        let dist = -1;
        if (rule.customMatch) {
            const customDist = rule.customMatch(comp);
            if (customDist === Infinity) continue;
            if (customDist >= 0) {
                if (rule.strict && customDist !== 0) continue;
                if (customDist < bestDist) {
                    bestDist = customDist;
                    bestNominal = rule.nominalPts;
                    bestType = rule.type;
                    bestRule = rule;
                    // Perfect custom match = regular; otherwise derive from modifier table
                    bestModName = customDist === 0
                        ? ''
                        : rule.getModifierPrefix(range);
                }
                continue;
            }
            // customDist === -1: fall through to range-based evaluation
        }

        // Rule range from first to last modifier resolved pts
        const ruleMin = rule.resolveModPts(rule.modifiers[0]);
        const ruleMax = rule.resolveModPts(rule.modifiers[rule.modifiers.length - 1]);

        // Check overlap between force point range and rule modifier range
        if (range.max >= ruleMin && range.min <= ruleMax) {
            dist = 0;
        } else if (range.max < ruleMin) {
            dist = ruleMin - range.max;
        } else {
            dist = range.min - ruleMax;
        }

        if (rule.strict && dist !== 0) continue;

        // On equal distance, prefer the larger formation (higher nominalPts)
        if (dist < bestDist || (dist === bestDist && rule.nominalPts > bestNominal)) {
            bestDist = dist;
            bestNominal = rule.nominalPts;
            bestType = rule.type;
            bestRule = rule;
            bestModName = rule.getModifierPrefix(range);
        }
    }

    const maxAllowedDistance = Math.max(minDistance, midPts * distanceFactor);
    if (bestDist <= maxAllowedDistance) {
        const name = bestModName ? bestModName + bestType : bestType;
        return { name, dist: bestDist, matchedRule: bestRule };
    }

    return { name: 'Force', dist: Infinity, matchedRule: null };
}

/**
 * Group-based force evaluation.
 *
 * Instead of flattening all units, this evaluates each group individually,
 * then counts how many groups matched each rule type. It looks for higher-level
 * rules whose `composedOf` type equals a group type and matches the group count
 * against the rule's raw modifier counts (without the composedOf multiplication).
 *
 * Example: 6 groups each identified as "Level II" → Level III has
 * composedOf = Level II and modifier count 6 → "Level III".
 */
function evaluateForceByGroups(
    groupResults: GroupSizeResult[],
    rules: ForceTypeRule[],
    groupMinDistance = 1,
    groupDistanceFactor = 0.25,
): EvaluationResult {
    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (const rule of rules) {
        // Determine which types this rule accepts as sub-units for group-based evaluation.
        // composedOfAny takes precedence (e.g. Cluster accepts Binaries OR Trinaries),
        // otherwise fall back to the single composedOf type.
        const acceptedTypes = rule.composedOfAny
            ? rule.composedOfAny
            : rule.composedOf
                ? [rule.composedOf]
                : [];
        if (acceptedTypes.length === 0) continue;

        // Count groups matching any accepted type (each group counted at most once).
        // A group matches if its direct type OR its countsAs alias is in the accepted set.
        const acceptedTypeSet = new Set(acceptedTypes.map(r => r.type));
        let count = 0;
        for (const result of groupResults) {
            if (result.type && acceptedTypeSet.has(result.type)) {
                count++;
            } else if (result.countsAsType && acceptedTypeSet.has(result.countsAsType)) {
                count++;
            }
        }
        if (count === 0) continue;

        // Compare group count against raw modifier counts (not resolved through composedOf)
        const rawMin = rule.modifiers[0].count;
        const rawMax = rule.modifiers[rule.modifiers.length - 1].count;

        let dist: number;
        if (count >= rawMin && count <= rawMax) {
            dist = 0;
        } else if (count < rawMin) {
            dist = rawMin - count;
        } else {
            dist = count - rawMax;
        }

        // Penalize for groups not accounted for by this rule.
        // E.g. Supernova Binary expects 2 Novas — if there's also a Binary group,
        // that unmatched group adds 1 to the distance so more inclusive rules can win.
        const unmatchedCount = groupResults.length - count;
        dist += unmatchedCount;

        const bestPriority = best.matchedRule?.priority ?? 0;
        if (dist < best.dist ||
            (dist === best.dist && rule.priority > bestPriority) ||
            (dist === best.dist && rule.priority === bestPriority && rule.nominalPts > (best.matchedRule?.nominalPts ?? 0))) {
            const modPrefix = rule.getModifierPrefixByRawCount(count);
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
    rules: ForceTypeRule[],
    groupMinDistance: number,
    groupDistanceFactor: number,
): EvaluationResult {
    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (let k = 2; k <= 5; k++) {
        if (groupResults.length < k * 2) break; // Need at least 2 groups per batch

        const batchSize = Math.floor(groupResults.length / k);
        const remainder = groupResults.length % k;

        // Split into K batches
        const batches: GroupSizeResult[][] = [];
        let offset = 0;
        for (let i = 0; i < k; i++) {
            const size = batchSize + (i < remainder ? 1 : 0);
            batches.push(groupResults.slice(offset, offset + size));
            offset += size;
        }

        // Evaluate each batch via group-based evaluation
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
                countsAsType: result.matchedRule.countsAs?.type ?? null,
            });
        }
        if (!allMatched) continue;

        // Evaluate the batch results as a higher-level grouping
        const higherResult = evaluateForceByGroups(batchResults, rules, groupMinDistance, groupDistanceFactor);
        if (higherResult.matchedRule &&
            (higherResult.dist < best.dist ||
             (higherResult.dist === best.dist &&
              (higherResult.matchedRule.nominalPts) > (best.matchedRule?.nominalPts ?? 0)))) {
            best = higherResult;
        }

        if (best.dist === 0) break;
    }

    return best;
}

/**
 * Evaluate a virtual point value against rules, skipping customMatch.
 * Only matches when the point falls within a rule's modifier range (dist === 0).
 * Used by the virtual split fallback to identify what type a sub-group of
 * a given size would be without knowing the actual unit composition.
 */
function evaluateVirtualGroup(
    pts: number,
    rules: ForceTypeRule[],
    comp: ForceComposition,
): EvaluationResult {
    let bestRule: ForceTypeRule | null = null;
    let bestNominal = 0;

    for (const rule of rules) {
        // Skip rules requiring per-sub-group composition (e.g. Nova's BM+BA split)
        if (rule.customMatch) continue;

        // Apply composition filters so we don't match e.g. Lance for pure-aero groups
        if (rule.filter && !rule.filter(comp)) continue;

        const ruleMin = rule.resolveModPts(rule.modifiers[0]);
        const ruleMax = rule.resolveModPts(rule.modifiers[rule.modifiers.length - 1]);

        // Only accept when the point falls within the modifier range
        if (pts < ruleMin || pts > ruleMax) continue;

        // Prefer the rule with higher nominalPts (larger formation)
        if (!bestRule || rule.nominalPts > bestNominal) {
            bestNominal = rule.nominalPts;
            bestRule = rule;
        }
    }

    if (bestRule) {
        return { name: bestRule.type, dist: 0, matchedRule: bestRule };
    }
    return { name: 'Force', dist: Infinity, matchedRule: null };
}

/**
 * Virtual split fallback: when flat evaluation fails to identify a group,
 * try splitting the total points into K equal sub-groups and check if those
 * virtual sub-groups form a recognized composed formation.
 *
 * Example: 11 Clan pts → K=2 → 5.5 each → Star (within 2–7) → 2 Stars → Binary.
 * Example: 16 Clan pts → K=2 → 8 each → no match; K=3 → 5.33 → Star → 3 Stars → Trinary.
 */
function trySplitEvaluation(
    pts: number,
    rules: ForceTypeRule[],
    comp: ForceComposition,
): EvaluationResult {
    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (let k = 2; k <= 5; k++) {
        const subPts = pts / k;
        if (subPts < 1) break; // Sub-groups too small to match anything meaningful

        const subResult = evaluateVirtualGroup(subPts, rules, comp);
        if (!subResult.matchedRule) continue;

        // Build K identical virtual group results
        const virtualResults: GroupSizeResult[] = [];
        for (let i = 0; i < k; i++) {
            virtualResults.push({
                name: subResult.name,
                type: subResult.matchedRule.type,
                countsAsType: subResult.matchedRule.countsAs?.type ?? null,
            });
        }

        // Check if K groups of this type match a composed rule
        const groupResult = evaluateForceByGroups(virtualResults, rules);
        if (groupResult.matchedRule &&
            (groupResult.dist < best.dist ||
             (groupResult.dist === best.dist &&
              (groupResult.matchedRule.nominalPts) > (best.matchedRule?.nominalPts ?? 0)))) {
            best = groupResult;
        }

        // Prefer fewer, larger sub-groups: stop on first perfect match
        if (best.dist === 0) break;
    }

    return best;
}

// ─── Org Resolution ────────────────────────────────────────────────────────────

interface OrgConfig {
    rules: ForceTypeRule[];
    getPointRange: (comp: ForceComposition) => PointRange;
    minDistance: number;
    distanceFactor: number;
    groupMinDistance: number;
    groupDistanceFactor: number;
}

function toOrgConfig(org: OrgDefinition): OrgConfig {
    return {
        rules: org.ALL,
        getPointRange: org.getPointRange,
        minDistance: org.MIN_DISTANCE,
        distanceFactor: org.DISTANCE_FACTOR,
        groupMinDistance: org.GROUP_MIN_DISTANCE,
        groupDistanceFactor: org.GROUP_DISTANCE_FACTOR,
    };
}

/**
 * Resolve the org rules and point-range function for the given tech base / faction.
 */
function resolveOrg(techBase: string, factionName: string): OrgConfig {
    const org = ORG_REGISTRY.find(e => e.match(techBase, factionName))?.org ?? DEFAULT_ORG;
    return toOrgConfig(org);
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate a single group of units and return the structural result
 * (name + matched ForceType). This is the data each UnitGroup can cache
 * in a computed signal so the force-level evaluator doesn't redo it.
 */
export function getGroupSizeResult(units: ForceUnit[], techBase: string, factionName: string): GroupSizeResult {
    if (units.length === 0) return { name: 'Force', type: null, countsAsType: null };
    const { rules, getPointRange, minDistance, distanceFactor } = resolveOrg(techBase, factionName);
    const comp = getForceComposition(units);
    let result = evaluateForceDetailed(comp, rules, getPointRange, minDistance, distanceFactor);

    // Virtual split fallback: if flat evaluation didn't find a match,
    // try splitting points into equal sub-groups to find a composed formation.
    // E.g. 11 Clan pts → 2 × 5.5 → 2 Stars → Binary.
    if (!result.matchedRule) {
        const range = getPointRange(comp);
        const midPts = (range.min + range.max) / 2;
        if (midPts > 0) {
            const splitResult = trySplitEvaluation(midPts, rules, comp);
            if (splitResult.matchedRule) {
                result = splitResult;
            }
        }
    }

    return {
        name: result.name,
        type: result.matchedRule?.type ?? null,
        countsAsType: result.matchedRule?.countsAs?.type ?? null,
    };
}

export function getForceSizeName(units: ForceUnit[], techBase: string, factionName: string, groupResults?: GroupSizeResult[]): string {
    if (units.length === 0) return 'Force';

    const { rules, getPointRange, minDistance, distanceFactor, groupMinDistance, groupDistanceFactor } = resolveOrg(techBase, factionName);
    const comp = getForceComposition(units);
    const flatResult = evaluateForceDetailed(comp, rules, getPointRange, minDistance, distanceFactor);

    // When pre-computed group results are provided with >1 group, also try group-based evaluation
    if (groupResults && groupResults.length > 1) {
        let groupResult = evaluateForceByGroups(groupResults, rules, groupMinDistance, groupDistanceFactor);

        if (groupResult.dist === 0) {
            // If we have a perfect group-based match, prefer it over the flat result even if the flat result was also a perfect custom match.
            return groupResult.name;
        }

        // Try hierarchical split: bundle groups into intermediate formations
        // E.g. 4 Novas → 2 × (2 Novas = SN Binary) → Under-Strength Cluster
        if (groupResults.length >= 4) {
            const splitResult = trySplitGroupEvaluation(groupResults, rules, groupMinDistance, groupDistanceFactor);
            if (splitResult.dist < groupResult.dist ||
                (splitResult.dist === groupResult.dist &&
                 (splitResult.matchedRule?.nominalPts ?? 0) > (groupResult.matchedRule?.nominalPts ?? 0))) {
                groupResult = splitResult;
            }
        }

        // Prefer group-based on tie, unless the flat result was a strict match
        // (strict rules like Supernova Trinary are very specific and should not
        // be overridden by a generic aliased group match at equal distance)
        if (groupResult.dist < flatResult.dist ||
            (groupResult.dist === flatResult.dist && !flatResult.matchedRule?.strict)) {
            return groupResult.name;
        }
    }

    return flatResult.name;
}
