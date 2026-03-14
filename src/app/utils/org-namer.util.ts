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

import { resolveFromGroups, resolveFromUnits, EMPTY_RESULT } from './org-solver.util';
import { DEFAULT_ORG, ORG_REGISTRY } from './org-definitions.util';
import type { AggregatedGroupSizeResult, GroupSizeResult } from './org-types';
import type { OrgDefinition, OrgTypeComposed, OrgTypeRule } from './org-types';
import { type Force, UnitGroup } from '../models/force.model';
import { LoadForceEntry, type LoadForceGroup } from '../models/load-force-entry.model';
import type { Unit } from '../models/units.model';
import { getUnitsAverageTechBase, TechBase } from '../models/tech.model';
import {
    getAggregatedTier,
    getDynamicTierForModifier,
    getEquivalentGroupCountAtTier,
    getTierForRepeatedGroup,
} from './org-tier.util';
import { FactionAffinity } from '../models/factions.model';

/*
 * Author: Drake
 *
 * Utility class to deteremine organization names.
 */

export function getOrgFromGroup(group: UnitGroup): GroupSizeResult[];
export function getOrgFromGroup(group: LoadForceGroup, factionName: string, factionAffinity: FactionAffinity): GroupSizeResult[];
export function getOrgFromGroup(group: UnitGroup | LoadForceGroup, factionName?: string, factionAffinity?: FactionAffinity): GroupSizeResult[] {
    if (group instanceof UnitGroup) {
        const force = group.force;
        const fn = force.faction()?.name ?? 'Mercenary';
        const fa = force.faction()?.group ?? 'Mercenary';
        const allUnits = group.units().map(u => u.getUnit()).filter((u): u is Unit => u !== undefined);
        return resolveFromUnits(allUnits, fn, fa);
    }
    const units = group.units
        .filter((u): u is typeof u & { unit: Unit } => u.unit !== undefined)
        .map(u => u.unit);
    return resolveFromUnits(units, factionName!, factionAffinity!);
}

export function getOrgFromForce(force: Force): GroupSizeResult[];
export function getOrgFromForce(entry: LoadForceEntry, factionName: string, factionAffinity: FactionAffinity): GroupSizeResult[];
export function getOrgFromForce(forceOrEntry: Force | LoadForceEntry, factionName?: string, factionAffinity?: FactionAffinity): GroupSizeResult[] {
    if (forceOrEntry instanceof LoadForceEntry) {
        const fn = factionName || 'Mercenary';
        const fa = factionAffinity || 'Mercenary';
        const groupResults = forceOrEntry.groups
            .filter(g => g.units.some(u => u.unit !== undefined))
            .flatMap(g => getOrgFromGroup(g, fn, fa));
        return resolveFromGroups(fn, fa, groupResults);
    }
    const fn = forceOrEntry.faction()?.name ?? 'Mercenary';
    const fa = forceOrEntry.faction()?.group ?? 'Mercenary';
    const groupResults = forceOrEntry.groups()
        .filter(g => g.units().length > 0)
        .flatMap(g => g.sizeResult().groups ?? []);
    return resolveFromGroups(fn, fa, groupResults);
}

/**
 * Evaluate the org size result for a collection of LoadForceEntry instances.
 * If childGroupResults are provided, they are used as pre-computed sub-group
 * results (hierarchical mode). Otherwise, each entry is evaluated individually
 * and their results are used as sub-groups (flat mode).
 */
export function getOrgFromForceCollection(
    entries: LoadForceEntry[],
    factionName: string,
    factionAffinity: FactionAffinity,
    childGroupResults?: GroupSizeResult[],
): GroupSizeResult[] {
    if (entries.length === 0) return [EMPTY_RESULT];
    const groupResults = childGroupResults
        ?? entries.flatMap(e => getOrgFromForce(e, factionName, factionAffinity));
    return resolveFromGroups(factionName, factionAffinity, groupResults);
}

/**
 * Display-only aggregation helper.
 *
 * Raw org-namer APIs intentionally return the unwrapped top-level groups so callers
 * can reason about exact subgroup structure. For UI display, we then run the same
 * groups back through hierarchical aggregation and finally fold duplicate names into
 * `Nx Name` strings. The original groups are preserved on the returned wrapper so
 * callers can re-submit them for further structural evaluation without losing data.
 */
export function getAggregatedGroupsResult(
    groups: GroupSizeResult[],
    factionName: string,
    factionAffinity: FactionAffinity,
): AggregatedGroupSizeResult {
    const org = resolveOrg(factionName, factionAffinity);
    if (groups.length === 0) {
        return {
            name: EMPTY_RESULT.name,
            tier: EMPTY_RESULT.tier,
            groups,
        };
    }

    if (groups.length === 1) {
        return {
            name: groups[0].name,
            tier: groups[0].tier,
            groups,
        };
    }

    const displayGroups = getDisplayGroups(groups, factionName, factionAffinity);
    return aggregateGroupsResult(displayGroups, groups, org);
}

function getDisplayGroups(
    groups: GroupSizeResult[],
    factionName: string,
    factionAffinity: FactionAffinity
): GroupSizeResult[] {
    if (groups.length <= 1) return groups;

    const promotedGroups = promoteDisplayGroups(groups, resolveOrg(factionName, factionAffinity));
    return resolveFromGroups(factionName, factionAffinity, promotedGroups, true);
}

function resolveOrg(factionName: string, factionAffinity: FactionAffinity): OrgDefinition {
    return ORG_REGISTRY.find(entry => entry.match(factionName, factionAffinity))?.org ?? DEFAULT_ORG;
}

function isComposedRule(rule: OrgTypeRule): rule is OrgTypeComposed {
    return rule.kind === 'composed';
}

function getModifierCount(modifier: number | { count: number }): number {
    return typeof modifier === 'number' ? modifier : modifier.count;
}

function getSortedModifiers(rule: OrgTypeRule): [string, number][] {
    return Object.entries(rule.modifiers)
        .map(([prefix, modifier]) => [prefix, getModifierCount(modifier)] as [string, number])
        .sort((a, b) => a[1] - b[1]);
}

function getRegularCount(rule: OrgTypeRule): number {
    const regularModifier = rule.modifiers[''] ?? Object.values(rule.modifiers)[0];
    return regularModifier ? getModifierCount(regularModifier) : 0;
}

function resolveTier(rule: OrgTypeRule, prefix: string): number {
    const modifier = rule.modifiers[prefix];
    if (modifier != null && typeof modifier === 'object' && 'tier' in modifier && modifier.tier != null) {
        return modifier.tier;
    }
    if (rule.dynamicTier && rule.dynamicTier > 0) {
        const regularCount = getRegularCount(rule);
        const modifierCount = modifier != null ? getModifierCount(modifier) : regularCount;
        if (regularCount > 0 && modifierCount !== regularCount) {
            return getDynamicTierForModifier(rule.tier, regularCount, modifierCount, rule.dynamicTier);
        }
    }
    return rule.tier;
}

function buildRuleName(rule: OrgTypeRule, prefix: string): string {
    return prefix ? `${prefix}${rule.type}` : rule.type;
}

function findGroupRuleState(
    group: GroupSizeResult,
    rules: ReadonlyArray<OrgTypeRule>,
): { rule: OrgTypeRule; prefix: string; count: number } | null {
    if (!group.type) return null;

    for (const rule of rules) {
        if (rule.type !== group.type) continue;

        if (group.modifierKey !== undefined) {
            const modifier = rule.modifiers[group.modifierKey];
            if (modifier != null) {
                return { rule, prefix: group.modifierKey, count: getModifierCount(modifier) };
            }
        }
    }

    return null;
}

function promoteDisplayGroups(
    groups: GroupSizeResult[],
    org: OrgDefinition,
): GroupSizeResult[] {
    const promoted = [...groups].sort((a, b) => b.tier - a.tier);

    let changed = true;
    while (changed) {
        changed = false;

        for (let index = 0; index < promoted.length; index++) {
            const state = findGroupRuleState(promoted[index], org.rules);
            if (!state || !isComposedRule(state.rule)) continue;

            const nextModifiers = getSortedModifiers(state.rule)
                .filter(([, count]) => count > state.count)
                .sort((a, b) => a[1] - b[1]);
            if (nextModifiers.length === 0) continue;

            const acceptedTypes = new Set(state.rule.composedOfAny);
            const candidateIndices = promoted
                .map((group, candidateIndex) => ({ group, candidateIndex }))
                .filter(({ candidateIndex, group }) =>
                    candidateIndex !== index &&
                    ((group.type && acceptedTypes.has(group.type)) ||
                        (group.countsAsType && acceptedTypes.has(group.countsAsType))),
                )
                .map(({ candidateIndex }) => candidateIndex);

            if (candidateIndices.length === 0) continue;

            const reachableModifier = nextModifiers
                .filter(([, count]) => count <= state.count + candidateIndices.length)
                .at(-1);
            if (!reachableModifier) continue;

            const [nextPrefix, nextCount] = reachableModifier;
            const consumeCount = nextCount - state.count;
            const consumedIndices = candidateIndices.slice(0, consumeCount).sort((a, b) => b - a);
            const consumedGroups = consumedIndices.map(candidateIndex => promoted[candidateIndex]);

            promoted[index] = {
                ...promoted[index],
                name: buildRuleName(state.rule, nextPrefix),
                modifierKey: nextPrefix,
                tier: resolveTier(state.rule, nextPrefix),
                children: [
                    ...(promoted[index].children ?? []),
                    ...consumedGroups,
                ],
            };

            for (const consumedIndex of consumedIndices) {
                promoted.splice(consumedIndex, 1);
            }

            promoted.sort((a, b) => b.tier - a.tier);
            changed = true;
            break;
        }
    }

    return promoted;
}

/**
 * Aggregates multiple GroupSizeResults into a single display result.
 *
 * Tier aggregation treats each +1 tier step as being worth 3x formations of the
 * previous tier. For a highest-tier group at `baseTier`, each other group
 * contributes `3^(groupTier - baseTier)` equivalent base groups. The final tier
 * is then `baseTier + log_3(totalEquivalentBaseGroups)`.
 *
 * Examples:
 * - 3x tier-5 groups => tier 6
 * - 9x tier-5 groups => tier 7
 * - mixed tiers combine additively in this base-3 space.
 */
export function aggregateGroupsResult(
    groups: GroupSizeResult[],
    originalGroups: GroupSizeResult[] = groups,
    org?: OrgDefinition,
): AggregatedGroupSizeResult {
    if (groups.length === 0) {
        return {
            name: EMPTY_RESULT.name,
            tier: EMPTY_RESULT.tier,
            groups: originalGroups,
        };
    }
    if (groups.length === 1) {
        return {
            name: groups[0].name,
            tier: groups[0].tier,
            groups: originalGroups,
        };
    }
    // Sort by tier descending so the highest-tier group appears first
    const sorted = [...groups].sort((a, b) => b.tier - a.tier);

    // Tier: each +1 tier is worth 3x groups of the previous tier.
    const tierSum = getAggregatedTier(sorted.map(group => group.tier));
    const name = org
        ? buildAggregatedDisplayName(sorted, tierSum, org)
        : buildAggregatedNameParts(sorted).join(' + ');

    return {
        name,
        tier: tierSum,
        groups: originalGroups,
    };
}


// ===== Utility =====

/** Resolve tech base from a flat array of LoadForceUnit-like objects. */
function resolveTechBase(units: { unit: Unit | undefined }[], factionName: string): TechBase {
    if (factionName.includes('ComStar') || factionName.includes('Word of Blake')) return 'Inner Sphere'; // not important
    const realUnits = units.filter((u): u is { unit: Unit } => u.unit !== undefined).map(u => u.unit);
    return getUnitsAverageTechBase(realUnits);
}

/** Resolve tech base from a set of LoadForceEntry instances. */
function resolveTechBaseFromEntries(entries: LoadForceEntry[], factionName: string): TechBase {
    return resolveTechBase(entries.flatMap(e => e.groups.flatMap(g => g.units)), factionName);
}

function buildAggregatedNameParts(groups: GroupSizeResult[]): string[] {
    const buckets = new Map<string, GroupSizeResult[]>();
    for (const group of groups) {
        const key = `${group.type ?? 'null'}:${group.name}:${group.tag ?? ''}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(group);
    }

    const parts: string[] = [];
    for (const bucket of buckets.values()) {
        const [first] = bucket;
        if (!first) continue;
        parts.push(bucket.length > 1 ? `${bucket.length}x ${first.name}` : first.name);
    }

    return parts;
}

function buildAggregatedDisplayName(
    groups: GroupSizeResult[],
    aggregatedTier: number,
    org: OrgDefinition,
): string {
    const anchorState = findGroupRuleState(groups[0], org.rules);
    if (!anchorState) return buildAggregatedNameParts(groups).join(' + ');

    return findClosestAggregatedRuleLabel(anchorState.rule, aggregatedTier);
}

function findClosestAggregatedRuleLabel(rule: OrgTypeRule, aggregatedTier: number): string {
    const modifiers = getSortedModifiers(rule);
    if (modifiers.length === 0) return rule.type;

    let bestName = buildRuleName(rule, modifiers[0][0]);
    let bestTier = resolveTier(rule, modifiers[0][0]);
    let bestDistance = Math.abs(aggregatedTier - bestTier);

    const consider = (name: string, tier: number): void => {
        const distance = Math.abs(aggregatedTier - tier);
        if (
            distance < bestDistance ||
            (distance === bestDistance && tier < bestTier)
        ) {
            bestName = name;
            bestTier = tier;
            bestDistance = distance;
        }
    };

    for (const [prefix] of modifiers) {
        consider(buildRuleName(rule, prefix), resolveTier(rule, prefix));
    }

    const regularIndex = modifiers.findIndex(([prefix]) => prefix === '');
    if (regularIndex === -1) {
        return bestName;
    }

    const multiplierCycle = modifiers.slice(regularIndex);
    const tierSlack = 2;
    const maxMultiplier = Math.max(
        2,
        Math.ceil(getEquivalentGroupCountAtTier(aggregatedTier, bestTier)) + 2,
    );

    for (let multiplier = 2; multiplier <= maxMultiplier; multiplier++) {
        for (const [prefix] of multiplierCycle) {
            const tier = getTierForRepeatedGroup(resolveTier(rule, prefix), multiplier);
            if (tier > aggregatedTier + tierSlack && multiplier > maxMultiplier - 1) {
                continue;
            }
            consider(`${multiplier}x ${buildRuleName(rule, prefix)}`, tier);
        }
    }

    return bestName;
}