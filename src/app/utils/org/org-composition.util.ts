// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Composition rules: plan and materialize parent groups from child groups. */

import { DEFAULT_ORG_RULE_REGISTRY } from './org-facts.util';
import { createComposedGroup, type PlannedGroupRecord } from './org-group-records.util';
import { passesPatternBounds } from './org-patterns.util';
import { groupMatchesChildRole } from './org-role-match.util';
import {
    compareModifierPreferences,
    getRuleModifierDescriptor,
    type LeafCountEmission,
    type ModifierStep,
    type RuleModifierDescriptor,
} from './org-rule-metadata.util';
import {
    createSolverGuard,
    getSolveTimestampMs,
    recordComposedPlanMetric,
    shouldAbortSearch,
    stopOrgSearch,
    visitOrgSearch,
    type SolverGuard,
} from './org-solve-session';
import type {
    GroupFacts,
    GroupSizeResult,
    OrgChildRoleSpec,
    OrgComposedCountRule,
    OrgComposedPatternRule,
    OrgGroupBucketName,
    OrgRuleRegistry,
    OrgUnitBucketName,
} from './org-types';

const MAX_COMPOSED_GROUPS_PER_CONFIG = 2_000;

interface ComposedCountEmission extends LeafCountEmission {
    readonly compositionIndex: number;
}

export interface ComposedCountEvaluationResult {
    readonly acceptedGroups: readonly GroupFacts[];
    readonly emitted: readonly ComposedCountEmission[];
    readonly leftoverCount: number;
}

export interface MaterializedComposedGroupResult {
    readonly groups: readonly GroupSizeResult[];
    readonly leftoverGroupFacts: readonly GroupFacts[];
}

export interface CompositionConfig {
    readonly index: number;
    readonly ruleType: string;
    readonly ruleKind: 'composed-count';
    readonly childRoles: readonly OrgChildRoleSpec[];
    readonly modifierDescriptor: RuleModifierDescriptor;
    readonly childMatchBucketBy?: OrgGroupBucketName;
}

export interface PatternCompositionConfig {
    readonly index: number;
    readonly ruleType: string;
    readonly ruleKind: 'composed-pattern';
    readonly childRoles: readonly OrgChildRoleSpec[];
    readonly modifierDescriptor: RuleModifierDescriptor;
    readonly childMatchBucketBy?: OrgGroupBucketName;
}

interface ConcreteCompositionCandidate {
    readonly groups: readonly GroupFacts[];
    readonly compositionIndex: number;
    readonly modifierStep: ModifierStep;
}

interface PlannedCompositionCandidate {
    readonly groups: readonly PlannedGroupRecord[];
    readonly compositionIndex: number;
    readonly modifierStep: ModifierStep;
}

interface CountedCompositionEntry {
    readonly id: string;
    readonly key: string;
    readonly representativeGroup: GroupFacts;
    readonly availableCount: number;
    readonly matchingRoleIndexes: readonly number[];
}

interface CountedCompositionInventory {
    readonly entries: readonly CountedCompositionEntry[];
    readonly groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]>;
}

interface AbstractCompositionCandidate {
    readonly entries: readonly CountedCompositionEntry[];
    readonly signatureCounts: readonly number[];
    readonly compositionIndex: number;
    readonly modifierStep: ModifierStep;
}

export interface AbstractCompositionPlanResult {
    readonly candidates: readonly AbstractCompositionCandidate[];
    readonly groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]>;
}

export function getGroupBucketValue(
    bucketBy: OrgGroupBucketName | undefined,
    facts: GroupFacts,
    registry: OrgRuleRegistry,
): string {
    if (!bucketBy) {
        return '__all__';
    }
    const bucketFn = registry.groupBuckets[bucketBy];
    if (!bucketFn) {
        return '__all__';
    }
    const bucketValue: unknown = bucketFn(facts);
    return `${bucketValue}`;
}

function getPreferredGroupTypeKey(facts: GroupFacts): string {
    const unitTypes = Array.from(facts.unitTypeCounts.entries())
        .filter(([, count]) => count > 0)
        .map(([unitType]) => unitType);

    return unitTypes.length === 1 ? unitTypes[0] : '__mixed__';
}

function groupFactsByPreferredType(groups: readonly GroupFacts[]): Map<string, GroupFacts[]> {
    const buckets = new Map<string, GroupFacts[]>();

    for (const facts of groups) {
        const key = getPreferredGroupTypeKey(facts);
        const existing = buckets.get(key);
        if (existing) {
            existing.push(facts);
        } else {
            buckets.set(key, [facts]);
        }
    }

    return buckets;
}

function shouldPreferHomogeneousChildren(childRoles: readonly OrgChildRoleSpec[]): boolean {
    return childRoles.length === 1;
}

function areOnlySubRegularModifierKeysAllowed(
    config: Pick<CompositionConfig, 'modifierDescriptor'>,
    allowedModifierKeys?: ReadonlySet<string>,
): boolean {
    if (!allowedModifierKeys || allowedModifierKeys.size === 0) {
        return false;
    }

    const subRegularModifierKeys = new Set(
        config.modifierDescriptor.subRegularStepsDescending.map((step) => step.modifierKey),
    );

    return [...allowedModifierKeys].every((modifierKey) => subRegularModifierKeys.has(modifierKey));
}

function getComposedPatternBucketCounts(
    groups: readonly GroupFacts[],
    bucketBy: OrgUnitBucketName,
): Map<string, number> {
    const bucketCounts = new Map<string, number>();

    for (const group of groups) {
        const descendantCounts = group.descendantUnitBucketCounts.get(bucketBy);
        if (!descendantCounts) {
            continue;
        }
        for (const [bucketValue, count] of descendantCounts.entries()) {
            bucketCounts.set(`${bucketValue}`, (bucketCounts.get(`${bucketValue}`) ?? 0) + count);
        }
    }

    return bucketCounts;
}

export function buildPatternCompositionConfig(rule: OrgComposedPatternRule): PatternCompositionConfig {
    return {
        index: 0,
        ruleType: rule.type,
        ruleKind: 'composed-pattern',
        childRoles: rule.childRoles,
        modifierDescriptor: getRuleModifierDescriptor(rule),
        childMatchBucketBy: rule.childMatchBucketBy,
    };
}

export function matchesComposedPatternSelection(
    rule: OrgComposedPatternRule,
    selectedGroups: readonly GroupFacts[],
): boolean {
    const bucketCounts = getComposedPatternBucketCounts(selectedGroups, rule.bucketBy);
    const availableBucketValues = [...bucketCounts.keys()];
    const totalCount = [...bucketCounts.values()].reduce((sum, count) => sum + count, 0);

    return rule.patterns.some((pattern) => (
        pattern.copySize === totalCount
        && passesPatternBounds(pattern, bucketCounts, availableBucketValues)
    ));
}

export function buildCompositionConfigs(rule: OrgComposedCountRule): CompositionConfig[] {
    const configs: CompositionConfig[] = [
        {
            index: 0,
            ruleType: rule.type,
            ruleKind: 'composed-count',
            childRoles: rule.childRoles,
            modifierDescriptor: getRuleModifierDescriptor(rule),
            childMatchBucketBy: rule.childMatchBucketBy,
        },
    ];

    rule.alternativeCompositions?.forEach((alternative, alternativeIndex) => {
        configs.push({
            index: alternativeIndex + 1,
            ruleType: rule.type,
            ruleKind: 'composed-count',
            childRoles: alternative.childRoles,
            modifierDescriptor: getRuleModifierDescriptor({
                modifiers: alternative.modifiers,
                tier: rule.tier,
                dynamicTier: rule.dynamicTier,
            }),
            childMatchBucketBy: alternative.childMatchBucketBy,
        });
    });

    return configs;
}

export function canAssignGroupsToRoles(
    selectedGroups: readonly GroupFacts[],
    childRoles: readonly OrgChildRoleSpec[],
    guard: SolverGuard,
): boolean {
    const roleCounts = new Array(childRoles.length).fill(0);

    function visit(groupIndex: number): boolean {
        if (!visitOrgSearch(guard, 'composition')) {
            return false;
        }
        if (groupIndex >= selectedGroups.length) {
            return childRoles.every((role, roleIndex) => roleCounts[roleIndex] >= (role.min ?? 0));
        }

        const group = selectedGroups[groupIndex];
        const matchingRoleIndexes = childRoles
            .map((role, roleIndex) => ({ role, roleIndex }))
            .filter(({ role }) => groupMatchesChildRole(group, role))
            .map(({ roleIndex }) => roleIndex);

        if (matchingRoleIndexes.length === 0) {
            return false;
        }

        for (const roleIndex of matchingRoleIndexes) {
            const role = childRoles[roleIndex];
            const max = role.max ?? Number.POSITIVE_INFINITY;
            if (roleCounts[roleIndex] >= max) {
                continue;
            }
            roleCounts[roleIndex] += 1;
            if (visit(groupIndex + 1)) {
                return true;
            }
            roleCounts[roleIndex] -= 1;
        }

        return false;
    }

    return visit(0);
}

function serializeReadonlyMap(map: ReadonlyMap<string, number>): string {
    return [...map.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}:${value}`)
        .join('|');
}

function serializeNestedReadonlyMap(
    map: ReadonlyMap<string, ReadonlyMap<string, number>>,
): string {
    return [...map.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=>${serializeReadonlyMap(value)}`)
        .join('||');
}

// Facts are immutable snapshots. Updated plans create new facts, even when they
// retain a groupFactId, so key by snapshot identity rather than the logical ID.
const signatureByGroupFacts = new WeakMap<GroupFacts, string>();

export function getGroupFactsSignatureKey(group: GroupFacts): string {
    const cached = signatureByGroupFacts.get(group);
    if (cached !== undefined) return cached;

    const signature = [
        group.type ?? 'null',
        group.countsAsType ?? 'null',
        group.modifierKey,
        String(group.tier),
        group.isFragment ? 'fragment' : 'non-fragment',
        group.provenance,
        group.tag ?? '',
        String(group.priority ?? 0),
        String(group.directChildCount),
        serializeReadonlyMap(group.childTypeCounts),
        serializeReadonlyMap(group.unitTypeCounts),
        serializeReadonlyMap(group.unitClassCounts),
        serializeReadonlyMap(group.unitTagCounts),
        serializeNestedReadonlyMap(group.descendantUnitBucketCounts),
    ].join('||');
    signatureByGroupFacts.set(group, signature);
    return signature;
}

function buildCountedCompositionInventory(
    groups: readonly GroupFacts[],
    childRoles: readonly OrgChildRoleSpec[],
): CountedCompositionInventory {
    const byKey = new Map<string, GroupFacts[]>();

    for (const group of groups) {
        const key = getGroupFactsSignatureKey(group);
        const existing = byKey.get(key);
        if (existing) {
            existing.push(group);
        } else {
            byKey.set(key, [group]);
        }
    }

    const groupsByEntryId = new Map<string, readonly GroupFacts[]>();
    const entries = [...byKey.entries()]
        .map(([key, bucketGroups]) => {
            const representativeGroup = bucketGroups[0];
            const id = `${key}@@${representativeGroup.groupFactId}`;
            groupsByEntryId.set(id, bucketGroups);

            return {
                id,
                key,
                representativeGroup,
                availableCount: bucketGroups.length,
                matchingRoleIndexes: childRoles
                    .map((role, roleIndex) => ({ role, roleIndex }))
                    .filter(({ role }) => groupMatchesChildRole(representativeGroup, role))
                    .map(({ roleIndex }) => roleIndex),
            };
        })
        .filter((entry) => entry.matchingRoleIndexes.length > 0)
        .sort((left, right) => {
            const leftGroup = left.representativeGroup;
            const rightGroup = right.representativeGroup;

            if (leftGroup.tier !== rightGroup.tier) {
                return leftGroup.tier - rightGroup.tier;
            }

            return left.key.localeCompare(right.key);
        });

    return {
        entries,
        groupsByEntryId,
    };
}

function canAssignSignatureCountsToRoles(
    entries: readonly CountedCompositionEntry[],
    selectedCounts: readonly number[],
    childRoles: readonly OrgChildRoleSpec[],
    guard: SolverGuard,
): boolean {
    const roleCounts = new Array(childRoles.length).fill(0);

    function distributeCountAcrossRoles(
        matchingRoleIndexes: readonly number[],
        matchIndex: number,
        remainingCount: number,
        next: () => boolean,
    ): boolean {
        if (matchIndex >= matchingRoleIndexes.length) {
            return remainingCount === 0 && next();
        }

        const roleIndex = matchingRoleIndexes[matchIndex];
        const role = childRoles[roleIndex];
        const max = role.max ?? Number.POSITIVE_INFINITY;
        const available = Math.max(0, max - roleCounts[roleIndex]);
        const maxAssignable = Math.min(remainingCount, available);

        for (let assigned = maxAssignable; assigned >= 0; assigned -= 1) {
            roleCounts[roleIndex] += assigned;
            if (distributeCountAcrossRoles(matchingRoleIndexes, matchIndex + 1, remainingCount - assigned, next)) {
                return true;
            }
            roleCounts[roleIndex] -= assigned;
        }

        return false;
    }

    function visit(entryIndex: number): boolean {
        if (!visitOrgSearch(guard, 'composition')) {
            return false;
        }

        if (entryIndex >= entries.length) {
            return childRoles.every((role, roleIndex) => roleCounts[roleIndex] >= (role.min ?? 0));
        }

        const selectedCount = selectedCounts[entryIndex] ?? 0;
        if (selectedCount === 0) {
            return visit(entryIndex + 1);
        }

        return distributeCountAcrossRoles(entries[entryIndex].matchingRoleIndexes, 0, selectedCount, () => visit(entryIndex + 1));
    }

    return visit(0);
}

function enumerateAbstractSelections(
    entries: readonly CountedCompositionEntry[],
    availableCounts: readonly number[],
    childRoles: readonly OrgChildRoleSpec[],
    targetCount: number,
    guard: SolverGuard,
): readonly number[][] {
    const selections: number[][] = [];
    const selectedCounts = new Array(entries.length).fill(0);
    const roleAssignmentCache = new Map<string, boolean>();

    function hasValidRoleAssignment(): boolean {
        const key = selectedCounts.join(',');
        const cached = roleAssignmentCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const result = canAssignSignatureCountsToRoles(entries, selectedCounts, childRoles, guard);
        roleAssignmentCache.set(key, result);
        return result;
    }

    function visit(entryIndex: number, remainingCount: number): void {
        if (!visitOrgSearch(guard, 'composition')) {
            return;
        }

        if (remainingCount === 0) {
            if (hasValidRoleAssignment()) {
                selections.push([...selectedCounts]);
            }
            return;
        }

        if (entryIndex >= entries.length) {
            return;
        }

        const remainingAvailable = availableCounts.slice(entryIndex).reduce((sum, count) => sum + count, 0);
        if (remainingAvailable < remainingCount) {
            return;
        }

        const maxTake = Math.min(availableCounts[entryIndex] ?? 0, remainingCount);
        for (let take = maxTake; take >= 0; take -= 1) {
            selectedCounts[entryIndex] = take;
            visit(entryIndex + 1, remainingCount - take);
            selectedCounts[entryIndex] = 0;
        }
    }

    visit(0, targetCount);
    return selections;
}

function compareAbstractCompositionPlans(
    left: readonly AbstractCompositionCandidate[],
    right: readonly AbstractCompositionCandidate[],
): number {
    const preferenceComparison = compareModifierPreferences(
        left.map(candidate => candidate.modifierStep),
        right.map(candidate => candidate.modifierStep),
    );
    if (preferenceComparison !== 0) return preferenceComparison;

    const leftUsed = left.reduce((sum, candidate) => (
        sum + candidate.signatureCounts.reduce((countSum, count) => countSum + count, 0)
    ), 0);
    const rightUsed = right.reduce((sum, candidate) => (
        sum + candidate.signatureCounts.reduce((countSum, count) => countSum + count, 0)
    ), 0);
    if (leftUsed !== rightUsed) {
        return leftUsed - rightUsed;
    }

    return 0;
}

function isBetterAbstractCompositionPlan(
    left: readonly AbstractCompositionCandidate[],
    right: readonly AbstractCompositionCandidate[],
): boolean {
    return compareAbstractCompositionPlans(left, right) > 0;
}

function sumSignatureCounts(counts: readonly number[]): number {
    return counts.reduce((sum, count) => sum + count, 0);
}

function serializeSignatureCounts(counts: readonly number[]): string {
    return counts.join(',');
}

function enumerateAbstractSelectionsViaRoleInventory(
    entries: readonly CountedCompositionEntry[],
    availableCounts: readonly number[],
    childRoles: readonly OrgChildRoleSpec[],
    targetCount: number,
    guard: SolverGuard,
    selectionPredicate?: (selected: readonly GroupFacts[]) => boolean,
    groupsByEntryId?: ReadonlyMap<string, readonly GroupFacts[]>,
): readonly number[][] {
    if (entries.length === 0 || targetCount <= 0) {
        return [];
    }

    const selections: number[][] = [];
    const selectionKeys = new Set<string>();
    const selectedCounts = new Array(entries.length).fill(0);
    const roleCounts = new Array(childRoles.length).fill(0);
    const suffixAvailableCounts = new Array(entries.length + 1).fill(0);
    const suffixRoleCapacities = Array.from({ length: entries.length + 1 }, () => new Array(childRoles.length).fill(0));

    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
        suffixAvailableCounts[entryIndex] = suffixAvailableCounts[entryIndex + 1] + (availableCounts[entryIndex] ?? 0);
        for (let roleIndex = 0; roleIndex < childRoles.length; roleIndex += 1) {
            suffixRoleCapacities[entryIndex][roleIndex] = suffixRoleCapacities[entryIndex + 1][roleIndex];
        }
        for (const roleIndex of entries[entryIndex].matchingRoleIndexes) {
            suffixRoleCapacities[entryIndex][roleIndex] += availableCounts[entryIndex] ?? 0;
        }
    }

    function canStillSatisfyRoleMinimums(startEntryIndex: number): boolean {
        return childRoles.every((role, roleIndex) => {
            const min = role.min ?? 0;
            return roleCounts[roleIndex] >= min
                || roleCounts[roleIndex] + suffixRoleCapacities[startEntryIndex][roleIndex] >= min;
        });
    }

    function hasSatisfiedRoleMinimums(): boolean {
        return childRoles.every((role, roleIndex) => roleCounts[roleIndex] >= (role.min ?? 0));
    }

    function pushSelection(): void {
        if (!hasSatisfiedRoleMinimums()) {
            return;
        }

        const selection = [...selectedCounts];
        const selectionKey = serializeSignatureCounts(selection);
        if (selectionKeys.has(selectionKey)) {
            return;
        }

        if (selectionPredicate && groupsByEntryId && !selectionPredicate(getPreviewGroupsForAbstractSelection(entries, selection, groupsByEntryId))) {
            return;
        }

        selectionKeys.add(selectionKey);
        selections.push(selection);
    }

    function distributeAcrossMatchingRoles(
        matchingRoleIndexes: readonly number[],
        matchIndex: number,
        remainingCount: number,
        next: () => void,
    ): void {
        if (!visitOrgSearch(guard, 'composition')) {
            return;
        }

        if (matchIndex >= matchingRoleIndexes.length) {
            if (remainingCount === 0) {
                next();
            }
            return;
        }

        const roleIndex = matchingRoleIndexes[matchIndex];
        const role = childRoles[roleIndex];
        const max = role.max ?? Number.POSITIVE_INFINITY;
        const maxAssignable = Math.min(remainingCount, Math.max(0, max - roleCounts[roleIndex]));

        for (let assigned = maxAssignable; assigned >= 0; assigned -= 1) {
            roleCounts[roleIndex] += assigned;
            distributeAcrossMatchingRoles(matchingRoleIndexes, matchIndex + 1, remainingCount - assigned, next);
            roleCounts[roleIndex] -= assigned;
        }
    }

    function visit(entryIndex: number, remainingCount: number): void {
        if (!visitOrgSearch(guard, 'composition')) {
            return;
        }

        if (remainingCount === 0) {
            pushSelection();
            return;
        }

        if (entryIndex >= entries.length || suffixAvailableCounts[entryIndex] < remainingCount) {
            return;
        }

        if (!canStillSatisfyRoleMinimums(entryIndex)) {
            return;
        }

        const entry = entries[entryIndex];
        const maxTake = Math.min(availableCounts[entryIndex] ?? 0, remainingCount);
        for (let take = maxTake; take >= 0; take -= 1) {
            selectedCounts[entryIndex] = take;

            if (take === 0) {
                visit(entryIndex + 1, remainingCount);
                selectedCounts[entryIndex] = 0;
                continue;
            }

            if (entry.matchingRoleIndexes.length === 0) {
                selectedCounts[entryIndex] = 0;
                continue;
            }

            distributeAcrossMatchingRoles(entry.matchingRoleIndexes, 0, take, () => {
                if (canStillSatisfyRoleMinimums(entryIndex + 1)) {
                    visit(entryIndex + 1, remainingCount - take);
                }
            });
            selectedCounts[entryIndex] = 0;
        }
    }

    visit(0, targetCount);
    return selections;
}

function isSimpleSingleRoleConfig(config: CompositionConfig): boolean {
    return config.childRoles.length === 1;
}

function canSatisfySingleRoleCount(role: OrgChildRoleSpec, targetCount: number): boolean {
    const min = role.min ?? 0;
    const max = role.max ?? Number.POSITIVE_INFINITY;
    return targetCount >= min && targetCount <= max;
}

function takeGreedySignatureCounts(
    availableCounts: readonly number[],
    targetCount: number,
): number[] | null {
    if (sumSignatureCounts(availableCounts) < targetCount) {
        return null;
    }

    const selection = new Array(availableCounts.length).fill(0);
    let remaining = targetCount;

    for (let entryIndex = 0; entryIndex < availableCounts.length && remaining > 0; entryIndex += 1) {
        const take = Math.min(availableCounts[entryIndex] ?? 0, remaining);
        selection[entryIndex] = take;
        remaining -= take;
    }

    return remaining === 0 ? selection : null;
}

function planSimpleSingleRoleCompositionsFromEntries(
    entries: readonly CountedCompositionEntry[],
    config: CompositionConfig,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
): readonly AbstractCompositionCandidate[] {
    const startedAtMs = getSolveTimestampMs();
    const [role] = config.childRoles;
    if (!role) {
        recordComposedPlanMetric(guard, config, 'single-role-fast-path', startedAtMs, 0);
        return [];
    }

    const steps = config.modifierDescriptor.stepsDescending.filter((step) => !allowedModifierKeys || allowedModifierKeys.has(step.modifierKey));
    let availableCounts = entries.map((entry) => entry.availableCount);
    const candidates: AbstractCompositionCandidate[] = [];

    for (const step of steps) {
        if (!canSatisfySingleRoleCount(role, step.count)) {
            continue;
        }

        while (sumSignatureCounts(availableCounts) >= step.count && candidates.length < MAX_COMPOSED_GROUPS_PER_CONFIG && !shouldAbortSearch(guard)) {
            const selection = takeGreedySignatureCounts(availableCounts, step.count);
            if (!selection) {
                break;
            }

            candidates.push({
                entries,
                signatureCounts: selection,
                compositionIndex: config.index,
                modifierStep: step,
            });
            availableCounts = availableCounts.map((count, index) => count - (selection[index] ?? 0));
        }
        if (candidates.length >= MAX_COMPOSED_GROUPS_PER_CONFIG && sumSignatureCounts(availableCounts) >= step.count) {
            stopOrgSearch(guard, 'iteration-limit');
        }
    }

    recordComposedPlanMetric(guard, config, 'single-role-fast-path', startedAtMs, candidates.length);
    return candidates;
}

function planCountedCompositionsFromEntries(
    entries: readonly CountedCompositionEntry[],
    config: CompositionConfig,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
): readonly AbstractCompositionCandidate[] {
    const startedAtMs = getSolveTimestampMs();
    if (entries.length === 0) {
        recordComposedPlanMetric(guard, config, 'exact-counted', startedAtMs, 0);
        return [];
    }

    if (isSimpleSingleRoleConfig(config)) {
        return planSimpleSingleRoleCompositionsFromEntries(entries, config, guard, allowedModifierKeys);
    }

    const initialCounts = entries.map((entry) => entry.availableCount);
    const steps = config.modifierDescriptor.stepsDescending.filter((step) => !allowedModifierKeys || allowedModifierKeys.has(step.modifierKey));
    const transitionMemo = new Map<string, readonly number[][]>();
    const planMemo = new Map<string, readonly AbstractCompositionCandidate[]>();

    function getTransitions(availableCounts: readonly number[], step: ModifierStep): readonly number[][] {
        const transitionKey = `${step.modifierKey}::${serializeSignatureCounts(availableCounts)}`;
        const cached = transitionMemo.get(transitionKey);
        if (cached) {
            return cached;
        }

        const transitions = enumerateAbstractSelectionsViaRoleInventory(
            entries,
            availableCounts,
            config.childRoles,
            step.count,
            guard,
        );
        transitionMemo.set(transitionKey, transitions);
        return transitions;
    }

    function visit(availableCounts: readonly number[]): readonly AbstractCompositionCandidate[] {
        const stateKey = serializeSignatureCounts(availableCounts);
        const cached = planMemo.get(stateKey);
        if (cached) {
            return cached;
        }

        const totalAvailable = sumSignatureCounts(availableCounts);

        for (const step of steps) {
            if (shouldAbortSearch(guard) || totalAvailable < step.count) {
                continue;
            }

            let bestForStep: readonly AbstractCompositionCandidate[] = [];

            for (const selection of getTransitions(availableCounts, step)) {
                const nextCounts = availableCounts.map((count, index) => count - (selection[index] ?? 0));
                const candidate: readonly AbstractCompositionCandidate[] = [
                    {
                        entries,
                        signatureCounts: selection,
                        compositionIndex: config.index,
                        modifierStep: step,
                    },
                    ...visit(nextCounts),
                ];

                if (candidate.length > MAX_COMPOSED_GROUPS_PER_CONFIG) {
                    stopOrgSearch(guard, 'iteration-limit');
                    continue;
                }

                if (bestForStep.length === 0 || isBetterAbstractCompositionPlan(candidate, bestForStep)) {
                    bestForStep = candidate;
                }
            }

            if (bestForStep.length > 0) {
                planMemo.set(stateKey, bestForStep);
                return bestForStep;
            }
        }

        planMemo.set(stateKey, []);
        return [];
    }

    const result = visit(initialCounts);
    recordComposedPlanMetric(guard, config, 'exact-counted', startedAtMs, result.length);
    return result;
}

function materializeAbstractCompositionPlan(
    candidates: readonly AbstractCompositionCandidate[],
    groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]>,
): ConcreteCompositionCandidate[] {
    const availableGroups = new Map<string, GroupFacts[]>();

    return candidates.map((candidate) => {
        const selectedGroups: GroupFacts[] = [];

        candidate.signatureCounts.forEach((count, entryIndex) => {
            const entry = candidate.entries[entryIndex];
            if (!entry) {
                return;
            }

            let remaining = availableGroups.get(entry.id);
            if (!remaining) {
                remaining = [...(groupsByEntryId.get(entry.id) ?? [])];
                availableGroups.set(entry.id, remaining);
            }

            for (let taken = 0; taken < count; taken += 1) {
                const group = remaining.shift();
                if (group) {
                    selectedGroups.push(group);
                }
            }
        });

        return {
            groups: selectedGroups,
            compositionIndex: candidate.compositionIndex,
            modifierStep: candidate.modifierStep,
        };
    });
}

export function resolvePlannedCompositionCandidates(
    candidates: readonly AbstractCompositionCandidate[],
    groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]>,
    recordByGroupFactId: ReadonlyMap<number, PlannedGroupRecord>,
): PlannedCompositionCandidate[] {
    const availableGroups = new Map<string, PlannedGroupRecord[]>();

    return candidates.map((candidate) => {
        const selectedGroups: PlannedGroupRecord[] = [];

        candidate.signatureCounts.forEach((count, entryIndex) => {
            const entry = candidate.entries[entryIndex];
            if (!entry) {
                return;
            }

            let remaining = availableGroups.get(entry.id);
            if (!remaining) {
                remaining = (groupsByEntryId.get(entry.id) ?? [])
                    .map((group) => recordByGroupFactId.get(group.groupFactId))
                    .filter((group): group is PlannedGroupRecord => !!group);
                availableGroups.set(entry.id, remaining);
            }

            for (let taken = 0; taken < count; taken += 1) {
                const group = remaining.shift();
                if (group) {
                    selectedGroups.push(group);
                }
            }
        });

        return {
            groups: selectedGroups,
            compositionIndex: candidate.compositionIndex,
            modifierStep: candidate.modifierStep,
        };
    });
}

function getPreviewGroupsForAbstractSelection(
    entries: readonly CountedCompositionEntry[],
    signatureCounts: readonly number[],
    groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]>,
): GroupFacts[] {
    const groups: GroupFacts[] = [];

    signatureCounts.forEach((count, entryIndex) => {
        const entry = entries[entryIndex];
        if (!entry || count <= 0) {
            return;
        }

        groups.push(...(groupsByEntryId.get(entry.id) ?? []).slice(0, count));
    });

    return groups;
}

function getAbstractPlanLeftoverGroups(
    entries: readonly CountedCompositionEntry[],
    candidates: readonly AbstractCompositionCandidate[],
    groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]>,
): GroupFacts[] {
    const consumedCounts = new Map<string, number>();

    for (const candidate of candidates) {
        candidate.signatureCounts.forEach((count, entryIndex) => {
            const entry = candidate.entries[entryIndex];
            if (!entry || count <= 0) {
                return;
            }
            consumedCounts.set(entry.id, (consumedCounts.get(entry.id) ?? 0) + count);
        });
    }

    return entries.flatMap((entry) => (groupsByEntryId.get(entry.id) ?? []).slice(consumedCounts.get(entry.id) ?? 0));
}

export function findAbstractCompositionSelection(
    groups: readonly GroupFacts[],
    childRoles: readonly OrgChildRoleSpec[],
    targetCount: number,
    guard: SolverGuard,
    selectionPredicate?: (selected: readonly GroupFacts[]) => boolean,
): GroupFacts[] | null {
    const inventory = buildCountedCompositionInventory(groups, childRoles);
    const entries = inventory.entries;
    if (entries.length === 0) {
        return null;
    }

    const availableCounts = entries.map((entry) => entry.availableCount);
    const selection = enumerateAbstractSelectionsViaRoleInventory(
        entries,
        availableCounts,
        childRoles,
        targetCount,
        guard,
        selectionPredicate,
        inventory.groupsByEntryId,
    )[0];

    return selection ? getPreviewGroupsForAbstractSelection(entries, selection, inventory.groupsByEntryId) : null;
}

function planComposedConfig(
    groups: readonly GroupFacts[],
    config: CompositionConfig,
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
): { readonly entries: readonly CountedCompositionEntry[]; readonly candidates: readonly AbstractCompositionCandidate[]; readonly groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]> } {
    const remainingByBucket = new Map<string, GroupFacts[]>();

    for (const group of groups) {
        const bucketKey = getGroupBucketValue(config.childMatchBucketBy, group, registry);
        const existing = remainingByBucket.get(bucketKey);
        if (existing) {
            existing.push(group);
        } else {
            remainingByBucket.set(bucketKey, [group]);
        }
    }

    const entries: CountedCompositionEntry[] = [];
    const candidates: AbstractCompositionCandidate[] = [];
    const groupsByEntryId = new Map<string, readonly GroupFacts[]>();
    const shouldPreferHomogeneousLeafChildren = !areOnlySubRegularModifierKeysAllowed(config, allowedModifierKeys)
        && shouldPreferHomogeneousChildren(config.childRoles)
        && groups.every((group) => !group.group.children || group.group.children.length === 0);

    const materializeBucketGroupSet = (bucketGroups: readonly GroupFacts[]): GroupFacts[] => {
        const inventory = buildCountedCompositionInventory(bucketGroups, config.childRoles);
        const abstractPlan = planCountedCompositionsFromEntries(inventory.entries, config, guard, allowedModifierKeys);
        entries.push(...inventory.entries);
        inventory.groupsByEntryId.forEach((value, key) => groupsByEntryId.set(key, value));
        candidates.push(...abstractPlan);
        return getAbstractPlanLeftoverGroups(inventory.entries, abstractPlan, inventory.groupsByEntryId);
    };

    for (const bucketGroups of remainingByBucket.values()) {
        if (!shouldPreferHomogeneousLeafChildren) {
            materializeBucketGroupSet(bucketGroups);
            continue;
        }

        const preferredLeftovers: GroupFacts[] = [];
        for (const preferredGroups of groupFactsByPreferredType(bucketGroups).values()) {
            preferredLeftovers.push(...materializeBucketGroupSet(preferredGroups));
        }

        materializeBucketGroupSet(preferredLeftovers);
    }

    return { entries, candidates, groupsByEntryId };
}

function planPatternComposedConfig(
    rule: OrgComposedPatternRule,
    groups: readonly GroupFacts[],
    config: PatternCompositionConfig,
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
): { readonly entries: readonly CountedCompositionEntry[]; readonly candidates: readonly AbstractCompositionCandidate[]; readonly groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]> } {
    const startedAtMs = getSolveTimestampMs();
    const remainingByBucket = new Map<string, GroupFacts[]>();

    for (const group of groups) {
        const bucketKey = getGroupBucketValue(config.childMatchBucketBy, group, registry);
        const existing = remainingByBucket.get(bucketKey);
        if (existing) {
            existing.push(group);
        } else {
            remainingByBucket.set(bucketKey, [group]);
        }
    }

    const entries: CountedCompositionEntry[] = [];
    const candidates: AbstractCompositionCandidate[] = [];
    const groupsByEntryId = new Map<string, readonly GroupFacts[]>();

    const planBucketGroupSet = (bucketGroups: readonly GroupFacts[]): GroupFacts[] => {
        const inventory = buildCountedCompositionInventory(bucketGroups, config.childRoles);
        const bucketEntries = inventory.entries;
        const abstractPlan: AbstractCompositionCandidate[] = [];
        let availableCounts = bucketEntries.map((entry) => entry.availableCount);

        for (const step of config.modifierDescriptor.stepsDescending) {
            if (allowedModifierKeys && !allowedModifierKeys.has(step.modifierKey)) {
                continue;
            }

            let producedGroups = 0;
            while (!shouldAbortSearch(guard)
                && producedGroups < MAX_COMPOSED_GROUPS_PER_CONFIG
                && availableCounts.reduce((sum, count) => sum + count, 0) >= step.count) {
                const selection = enumerateAbstractSelections(bucketEntries, availableCounts, config.childRoles, step.count, guard)
                    .find((candidateSelection) => matchesComposedPatternSelection(
                        rule,
                        getPreviewGroupsForAbstractSelection(bucketEntries, candidateSelection, inventory.groupsByEntryId),
                    ));
                if (!selection) {
                    break;
                }

                abstractPlan.push({
                    entries: bucketEntries,
                    signatureCounts: selection,
                    compositionIndex: 0,
                    modifierStep: step,
                });
                availableCounts = availableCounts.map((count, index) => count - (selection[index] ?? 0));
                producedGroups += 1;
            }
            if (producedGroups >= MAX_COMPOSED_GROUPS_PER_CONFIG && sumSignatureCounts(availableCounts) >= step.count) {
                stopOrgSearch(guard, 'iteration-limit');
            }
        }

        entries.push(...bucketEntries);
        inventory.groupsByEntryId.forEach((value, key) => groupsByEntryId.set(key, value));
        candidates.push(...abstractPlan);
        return getAbstractPlanLeftoverGroups(bucketEntries, abstractPlan, inventory.groupsByEntryId);
    };

    for (const bucketGroups of remainingByBucket.values()) {
        planBucketGroupSet(bucketGroups);
    }

    recordComposedPlanMetric(guard, config, 'pattern-counted', startedAtMs, candidates.length);
    return { entries, candidates, groupsByEntryId };
}

function materializeComposedPatternRuleInternal(
    rule: OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry,
    allowedModifierKeys?: ReadonlySet<string>,
): MaterializedComposedGroupResult {
    const config = buildPatternCompositionConfig(rule);
    const guard = createSolverGuard();
    const planned = planPatternComposedConfig(rule, groupFacts, config, registry, guard, allowedModifierKeys);
    const concreteCandidates = materializeAbstractCompositionPlan(planned.candidates, planned.groupsByEntryId);

    const groups = concreteCandidates.map((candidate) =>
        createComposedGroup(rule, candidate.modifierStep, candidate.groups.map((group) => group.group)),
    );
    const usedGroupFactIds = new Set(concreteCandidates.flatMap((candidate) => candidate.groups.map((group) => group.groupFactId)));

    return {
        groups,
        leftoverGroupFacts: groupFacts.filter((group) => !usedGroupFactIds.has(group.groupFactId)),
    };
}

export function planComposedPatternRuleInternal(
    rule: OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
    negativeComposedPlanKeys?: Set<string>,
): AbstractCompositionPlanResult {
    const cacheKey = negativeComposedPlanKeys ? getNegativeComposedPlanCacheKey(rule, groupFacts, allowedModifierKeys) : null;
    if (negativeComposedPlanKeys && cacheKey && negativeComposedPlanKeys.has(cacheKey)) {
        return {
            candidates: [],
            groupsByEntryId: new Map<string, readonly GroupFacts[]>(),
        };
    }

    const config = buildPatternCompositionConfig(rule);
    const planned = planPatternComposedConfig(rule, groupFacts, config, registry, guard, allowedModifierKeys);
    if (negativeComposedPlanKeys && cacheKey && planned.candidates.length === 0 && !guard.session.stopReason) {
        negativeComposedPlanKeys.add(cacheKey);
    }

    return {
        candidates: planned.candidates,
        groupsByEntryId: planned.groupsByEntryId,
    };
}

function materializeComposedCountRuleInternal(
    rule: OrgComposedCountRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry,
    allowedModifierKeys?: ReadonlySet<string>,
): MaterializedComposedGroupResult {
    const configs = buildCompositionConfigs(rule);
    const guard = createSolverGuard();
    const evaluations = configs.map((config) => ({
        config,
        ...planComposedConfig(groupFacts, config, registry, guard, allowedModifierKeys),
    }));
    const best = evaluations.sort((left, right) => {
        return compareAbstractCompositionPlans(right.candidates, left.candidates);
    })[0];

    if (!best) {
        return { groups: [], leftoverGroupFacts: [...groupFacts] };
    }

    const concreteCandidates = materializeAbstractCompositionPlan(best.candidates, best.groupsByEntryId);

    const groups = concreteCandidates.map((candidate) =>
        createComposedGroup(rule, candidate.modifierStep, candidate.groups.map((group) => group.group)),
    );
    const usedGroupFactIds = new Set(concreteCandidates.flatMap((candidate) => candidate.groups.map((group) => group.groupFactId)));

    return {
        groups,
        leftoverGroupFacts: groupFacts.filter((group) => !usedGroupFactIds.has(group.groupFactId)),
    };
}

export function planComposedCountRuleInternal(
    rule: OrgComposedCountRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
    negativeComposedPlanKeys?: Set<string>,
): AbstractCompositionPlanResult {
    const cacheKey = negativeComposedPlanKeys ? getNegativeComposedPlanCacheKey(rule, groupFacts, allowedModifierKeys) : null;
    if (negativeComposedPlanKeys && cacheKey && negativeComposedPlanKeys.has(cacheKey)) {
        return {
            candidates: [],
            groupsByEntryId: new Map<string, readonly GroupFacts[]>(),
        };
    }

    const configs = buildCompositionConfigs(rule);
    const evaluations = configs.map((config) => ({
        config,
        ...planComposedConfig(groupFacts, config, registry, guard, allowedModifierKeys),
    }));
    const best = evaluations.sort((left, right) => {
        return compareAbstractCompositionPlans(right.candidates, left.candidates);
    })[0];

    if (negativeComposedPlanKeys && cacheKey && (best?.candidates.length ?? 0) === 0 && !guard.session.stopReason) {
        negativeComposedPlanKeys.add(cacheKey);
    }

    return {
        candidates: best?.candidates ?? [],
        groupsByEntryId: best?.groupsByEntryId ?? new Map<string, readonly GroupFacts[]>(),
    };
}

export function evaluateComposedCountRule(
    rule: OrgComposedCountRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): ComposedCountEvaluationResult {
    const configs = buildCompositionConfigs(rule);
    const guard = createSolverGuard();
    const acceptedGroups = groupFacts.filter((group) =>
        configs.some((config) => config.childRoles.some((role) => groupMatchesChildRole(group, role))),
    );

    const evaluations = configs.map((config) => ({
        config,
        ...planComposedConfig(groupFacts, config, registry, guard),
    }));
    const best = evaluations.sort((left, right) => {
        return compareAbstractCompositionPlans(right.candidates, left.candidates);
    })[0];

    const emitted: ComposedCountEmission[] = best
        ? best.candidates.map((candidate) => ({
            modifierKey: candidate.modifierStep.modifierKey,
            perGroupCount: candidate.modifierStep.count,
            copies: 1,
            tier: candidate.modifierStep.tier,
            compositionIndex: candidate.compositionIndex,
        }))
        : [];
    const usedGroups = best
        ? best.candidates.reduce((sum, candidate) => (
            sum + candidate.signatureCounts.reduce((countSum, count) => countSum + count, 0)
        ), 0)
        : 0;

    return {
        acceptedGroups,
        emitted,
        leftoverCount: acceptedGroups.length - usedGroups,
    };
}

export function materializeComposedCountRule(
    rule: OrgComposedCountRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): MaterializedComposedGroupResult {
    return materializeComposedCountRuleInternal(rule, groupFacts, registry);
}

export function evaluateComposedPatternRule(
    rule: OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): ComposedCountEvaluationResult {
    const acceptedGroups = groupFacts.filter((group) =>
        rule.childRoles.some((role) => groupMatchesChildRole(group, role)),
    );
    const config = buildPatternCompositionConfig(rule);
    const guard = createSolverGuard();
    const planned = planPatternComposedConfig(rule, groupFacts, config, registry, guard);
    const emitted: ComposedCountEmission[] = planned.candidates.map((candidate) => ({
        modifierKey: candidate.modifierStep.modifierKey,
        perGroupCount: candidate.modifierStep.count,
        copies: 1,
        tier: candidate.modifierStep.tier,
        compositionIndex: candidate.compositionIndex,
    }));
    const usedGroups = planned.candidates.reduce((sum, candidate) => (
        sum + candidate.signatureCounts.reduce((countSum, count) => countSum + count, 0)
    ), 0);

    return {
        acceptedGroups,
        emitted,
        leftoverCount: acceptedGroups.length - usedGroups,
    };
}

export function materializeComposedPatternRule(
    rule: OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): MaterializedComposedGroupResult {
    return materializeComposedPatternRuleInternal(rule, groupFacts, registry);
}

function serializeAllowedModifierKeys(allowedModifierKeys?: ReadonlySet<string>): string {
    if (!allowedModifierKeys || allowedModifierKeys.size === 0) {
        return '*';
    }

    return [...allowedModifierKeys].sort((left, right) => left.localeCompare(right)).join('|');
}

function createGroupFactsInventorySignature(groupFacts: readonly GroupFacts[]): string {
    const counts = new Map<string, number>();

    for (const facts of groupFacts) {
        const signatureKey = getGroupFactsSignatureKey(facts);
        counts.set(signatureKey, (counts.get(signatureKey) ?? 0) + 1);
    }

    return [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => `${key}::${count}`)
        .join('##');
}

function getNegativeComposedPlanCacheKey(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
    allowedModifierKeys?: ReadonlySet<string>,
): string {
    return [
        rule.kind,
        rule.type,
        serializeAllowedModifierKeys(allowedModifierKeys),
        createGroupFactsInventorySignature(groupFacts),
    ].join('@@');
}
