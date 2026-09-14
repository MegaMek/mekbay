// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Leaf and infantry rules: plan and materialize groups directly from units. */

import {
    DEFAULT_ORG_RULE_REGISTRY,
    getCIMoveClass,
    getCISquadCount,
    getNormalizedOrgUnitType,
    getUnitBucketValue,
} from './org-facts.util';
import {
    type CIFragmentToken,
    type CISquadAllocation,
    createAbstractCIFragmentRecord,
    createAbstractCIParentRecord,
    createAbstractLeafFragmentRecord,
    createAbstractLeafGroupRecord,
    createCIFragmentGroup,
    createCIParentGroup,
    createLeafFragmentGroup,
    createLeafGroup,
    getAllocationSquadCount,
    getCompiledGroupFactsList,
    type PlannedGroupRecord,
} from './org-group-records.util';
import { enumeratePatternCandidates, getPatternRefBucketValues, type PatternCandidate } from './org-patterns.util';
import {
    compareModifierPreferences,
    getRuleModifierDescriptor,
    type LeafCountEmission,
    type ModifierStep,
    type RuleModifierDescriptor,
} from './org-rule-metadata.util';
import { createSolverGuard, forkSolverGuard, shouldAbortSearch, stopOrgSearch, type SolverGuard } from './org-solve-session';
import type {
    GroupFacts,
    GroupSizeResult,
    GroupUnitAllocation,
    OrgCIFormationEntry,
    OrgCIFormationRule,
    OrgLeafCountRule,
    OrgLeafPatternRule,
    OrgPatternSpec,
    OrgRuleRegistry,
    OrgUnit,
    OrgUnitBucketName,
    UnitFacts,
} from './org-types';

const MAX_PATTERN_GREEDY_ITERATIONS = 2_000;

interface LeafPatternEmission extends LeafCountEmission {
    readonly patternIndex: number;
    readonly score: number;
    readonly allocations: readonly ReadonlyMap<string, number>[];
}

export interface CIFormationEvaluationResult {
    readonly eligibleUnits: readonly UnitFacts[];
    readonly emitted: readonly LeafCountEmission[];
    readonly leftoverCount: number;
}

export interface LeafCountEvaluationResult {
    readonly eligibleUnits: readonly UnitFacts[];
    readonly emitted: readonly LeafCountEmission[];
    readonly leftoverCount: number;
}

export interface LeafPatternEvaluationResult {
    readonly eligibleUnits: readonly UnitFacts[];
    readonly emitted: readonly LeafPatternEmission[];
    readonly leftoverCount: number;
}

export interface MaterializedLeafUnitResult {
    readonly groups: readonly GroupSizeResult[];
    readonly leftoverUnitFacts: readonly UnitFacts[];
}

interface ConcretePatternCandidate extends PatternCandidate {
    readonly units: readonly UnitFacts[];
}

interface PatternSelection {
    readonly patternIndex: number;
    readonly pattern: OrgPatternSpec;
    readonly candidate: ConcretePatternCandidate;
}

function getSelectorNames(selector: OrgLeafCountRule['unitSelector'] | OrgLeafPatternRule['unitSelector']): readonly string[] {
    return (Array.isArray(selector) ? selector : [selector]) as readonly string[];
}

export function matchesUnitSelectors(
    unitFacts: UnitFacts,
    selector: OrgLeafCountRule['unitSelector'] | OrgLeafPatternRule['unitSelector'],
    registry: OrgRuleRegistry,
): boolean {
    return getSelectorNames(selector).some((selectorName) => {
        const selectorFn = registry.unitSelectors[selectorName as keyof typeof registry.unitSelectors];
        return selectorFn ? selectorFn(unitFacts) : false;
    });
}

export function groupUnitsByBucket(
    units: readonly UnitFacts[],
    bucketBy: OrgUnitBucketName | undefined,
    registry: OrgRuleRegistry,
): Map<string, UnitFacts[]> {
    const buckets = new Map<string, UnitFacts[]>();
    for (const facts of units) {
        const key = getUnitBucketValue(bucketBy, facts, registry);
        const existing = buckets.get(key);
        if (existing) {
            existing.push(facts);
        } else {
            buckets.set(key, [facts]);
        }
    }
    return buckets;
}

function getPreferredUnitTypeKey(facts: UnitFacts): string {
    return getNormalizedOrgUnitType(facts.unit);
}

export function groupUnitsByPreferredType(units: readonly UnitFacts[]): Map<string, UnitFacts[]> {
    const buckets = new Map<string, UnitFacts[]>();

    for (const facts of units) {
        const key = getPreferredUnitTypeKey(facts);
        const existing = buckets.get(key);
        if (existing) {
            existing.push(facts);
        } else {
            buckets.set(key, [facts]);
        }
    }

    return buckets;
}

function createCISquadAllocation(facts: UnitFacts): CISquadAllocation {
    return { unit: facts.unit, squads: facts.squads };
}

function getCIEntryDescriptor(
    rule: OrgCIFormationRule,
    entry: OrgCIFormationEntry,
): RuleModifierDescriptor {
    return getRuleModifierDescriptor({
        modifiers: entry.counts,
        tier: rule.tier,
        dynamicTier: rule.dynamicTier,
    });
}

function createCIFragmentTokensFromSquadAllocations(
    moveClass: NonNullable<ReturnType<typeof getCIMoveClass>>,
    allocations: readonly CISquadAllocation[],
): CIFragmentToken[] {
    const tokens: CIFragmentToken[] = [];

    for (const allocation of allocations) {
        let remainingSquads = getAllocationSquadCount(allocation);
        while (remainingSquads > 0) {
            tokens.push({
                moveClass,
                allocations: [{ unit: allocation.unit, squads: 1 }],
            });
            remainingSquads -= 1;
        }
    }

    return tokens;
}

function getMoveClassFromAllocations(allocations: readonly (CISquadAllocation | GroupUnitAllocation)[]): NonNullable<ReturnType<typeof getCIMoveClass>> | null {
    const moveClasses = new Set(
        allocations
            .map((allocation) => getCIMoveClass(allocation.unit))
            .filter((moveClass): moveClass is NonNullable<ReturnType<typeof getCIMoveClass>> => moveClass !== null),
    );

    return moveClasses.size === 1 ? [...moveClasses][0] : null;
}

function sliceAllocationsToTokens(
    allocations: readonly CISquadAllocation[],
    moveClass: NonNullable<ReturnType<typeof getCIMoveClass>>,
): CIFragmentToken[] | null {
    return createCIFragmentTokensFromSquadAllocations(moveClass, allocations);
}

function getModifierStepForGroup(
    rule: OrgCIFormationRule,
    entry: OrgCIFormationEntry,
    group: GroupSizeResult,
): ModifierStep | null {
    return getCIEntryDescriptor(rule, entry).stepsAscending.find((step) => step.modifierKey === group.modifierKey) ?? null;
}

function getCIFragmentTokensFromGroup(
    rule: OrgCIFormationRule,
    group: GroupSizeResult,
    entryByMoveClass: ReadonlyMap<NonNullable<ReturnType<typeof getCIMoveClass>>, OrgCIFormationEntry>,
): CIFragmentToken[] | null {
    const allocations: CISquadAllocation[] = group.unitAllocations
        ?.map((allocation) => ({ unit: allocation.unit, squads: getAllocationSquadCount(allocation) }))
        ?? group.units?.map((unit) => ({ unit, squads: getCISquadCount(unit) }))
        ?? [];
    if (allocations.length === 0) {
        return null;
    }

    const moveClass = getMoveClassFromAllocations(allocations);
    if (!moveClass) {
        return null;
    }

    const entry = entryByMoveClass.get(moveClass);
    if (!entry) {
        return null;
    }

    if (group.isFragment || group.type === rule.fragmentType) {
        const tokens = sliceAllocationsToTokens(allocations, moveClass);
        if (!tokens) {
            return null;
        }
        const expectedCount = group.count ?? tokens.length;
        return tokens.length === expectedCount ? tokens : null;
    }

    if (group.type !== rule.type) {
        return null;
    }

    const step = getModifierStepForGroup(rule, entry, group);
    if (!step) {
        return null;
    }

    const tokens = sliceAllocationsToTokens(allocations, moveClass);
    if (!tokens) {
        return null;
    }

    return tokens.length === step.count ? tokens : null;
}

function materializeCIFormationTokens(
    rule: OrgCIFormationRule,
    tokens: readonly CIFragmentToken[],
    entry: OrgCIFormationEntry,
): GroupSizeResult[] {
    const descriptor = getCIEntryDescriptor(rule, entry);
    const groups: GroupSizeResult[] = [];
    let remaining = [...tokens];

    for (const step of descriptor.stepsDescending) {
        if (step.count === 1 && rule.type === rule.fragmentType) {
            continue;
        }
        while (remaining.length >= step.count) {
            const selected = remaining.slice(0, step.count);
            remaining = remaining.slice(step.count);
            groups.push(createCIParentGroup(rule, step, selected));
        }
    }

    if (remaining.length > 0) {
        groups.push(createCIFragmentGroup(rule, remaining.length, remaining));
    }

    return groups;
}

function materializeCIFormationTokenRecords(
    rule: OrgCIFormationRule,
    tokens: readonly CIFragmentToken[],
    entry: OrgCIFormationEntry,
    unitFactsByUnit: ReadonlyMap<OrgUnit, UnitFacts>,
): PlannedGroupRecord[] {
    const descriptor = getCIEntryDescriptor(rule, entry);
    const groups: PlannedGroupRecord[] = [];
    let remaining = [...tokens];

    for (const step of descriptor.stepsDescending) {
        if (step.count === 1 && rule.type === rule.fragmentType) {
            continue;
        }
        while (remaining.length >= step.count) {
            const selected = remaining.slice(0, step.count);
            remaining = remaining.slice(step.count);
            groups.push(createAbstractCIParentRecord(rule, step, selected, unitFactsByUnit));
        }
    }

    if (remaining.length > 0) {
        groups.push(createAbstractCIFragmentRecord(rule, remaining.length, remaining, unitFactsByUnit));
    }

    return groups;
}

export function evaluateCIFormationRule(
    rule: OrgCIFormationRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): CIFormationEvaluationResult {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const emitted: LeafCountEmission[] = [];
    const entryByMoveClass = new Map(rule.entries.map((entry) => [entry.moveClass, entry]));
    let leftoverCount = 0;

    const allocationsByMoveClass = new Map<NonNullable<ReturnType<typeof getCIMoveClass>>, CISquadAllocation[]>();
    for (const facts of eligibleUnits) {
        const moveClass = getCIMoveClass(facts.unit);
        const allocation = createCISquadAllocation(facts);
        if (!moveClass || !entryByMoveClass.has(moveClass) || allocation.squads <= 0) {
            leftoverCount += 1;
            continue;
        }

        const existing = allocationsByMoveClass.get(moveClass);
        if (existing) {
            existing.push(allocation);
        } else {
            allocationsByMoveClass.set(moveClass, [allocation]);
        }
    }

    for (const [moveClass, allocations] of allocationsByMoveClass.entries()) {
        const entry = entryByMoveClass.get(moveClass);
        if (!entry) {
            continue;
        }
        const tokens = createCIFragmentTokensFromSquadAllocations(moveClass, allocations);
        const descriptor = getCIEntryDescriptor(rule, entry);
        let remaining = tokens.length;
        for (const step of descriptor.stepsDescending) {
            const copies = Math.floor(remaining / step.count);
            if (copies <= 0) {
                continue;
            }
            emitted.push({
                modifierKey: step.modifierKey,
                perGroupCount: step.count,
                copies,
                tier: step.tier,
            });
            remaining -= copies * step.count;
        }
        if (remaining > 0) {
            emitted.push({
                modifierKey: '',
                perGroupCount: 1,
                copies: remaining,
                tier: rule.fragmentTier,
            });
        }
    }

    return {
        eligibleUnits,
        emitted,
        leftoverCount,
    };
}

export function materializeCIFormationRule(
    rule: OrgCIFormationRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): { groups: GroupSizeResult[]; leftoverUnitFacts: UnitFacts[]; leftoverUnitAllocations: GroupUnitAllocation[] } {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    const entryByMoveClass = new Map(rule.entries.map((entry) => [entry.moveClass, entry]));
    const leftoverUnitFacts: UnitFacts[] = [];
    const leftoverUnitAllocations: GroupUnitAllocation[] = [];
    const allocationsByMoveClass = new Map<NonNullable<ReturnType<typeof getCIMoveClass>>, CISquadAllocation[]>();

    for (const facts of eligibleUnits) {
        const moveClass = getCIMoveClass(facts.unit);
        const allocation = createCISquadAllocation(facts);
        if (!moveClass || !entryByMoveClass.has(moveClass) || allocation.squads <= 0) {
            leftoverUnitFacts.push(facts);
            continue;
        }

        const existing = allocationsByMoveClass.get(moveClass);
        if (existing) {
            existing.push(allocation);
        } else {
            allocationsByMoveClass.set(moveClass, [allocation]);
        }
    }

    const groups: GroupSizeResult[] = [];
    for (const [moveClass, allocations] of allocationsByMoveClass.entries()) {
        const entry = entryByMoveClass.get(moveClass);
        if (!entry) {
            continue;
        }
        const tokens = createCIFragmentTokensFromSquadAllocations(moveClass, allocations);
        groups.push(...materializeCIFormationTokens(rule, tokens, entry));
    }

    return {
        groups,
        leftoverUnitFacts: [...ineligibleUnits, ...leftoverUnitFacts],
        leftoverUnitAllocations,
    };
}

export function materializeCIFormationRuleRecords(
    rule: OrgCIFormationRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): { records: PlannedGroupRecord[]; leftoverUnitFacts: UnitFacts[]; leftoverUnitAllocations: GroupUnitAllocation[] } {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    const entryByMoveClass = new Map(rule.entries.map((entry) => [entry.moveClass, entry]));
    const unitFactsByUnit = new Map(eligibleUnits.map((facts) => [facts.unit, facts]));
    const leftoverUnitFacts: UnitFacts[] = [];
    const leftoverUnitAllocations: GroupUnitAllocation[] = [];
    const allocationsByMoveClass = new Map<NonNullable<ReturnType<typeof getCIMoveClass>>, CISquadAllocation[]>();

    for (const facts of eligibleUnits) {
        const moveClass = getCIMoveClass(facts.unit);
        const allocation = createCISquadAllocation(facts);
        if (!moveClass || !entryByMoveClass.has(moveClass) || allocation.squads <= 0) {
            leftoverUnitFacts.push(facts);
            continue;
        }

        const existing = allocationsByMoveClass.get(moveClass);
        if (existing) {
            existing.push(allocation);
        } else {
            allocationsByMoveClass.set(moveClass, [allocation]);
        }
    }

    const records: PlannedGroupRecord[] = [];
    for (const [moveClass, allocations] of allocationsByMoveClass.entries()) {
        const entry = entryByMoveClass.get(moveClass);
        if (!entry) {
            continue;
        }
        const tokens = createCIFragmentTokensFromSquadAllocations(moveClass, allocations);
        records.push(...materializeCIFormationTokenRecords(rule, tokens, entry, unitFactsByUnit));
    }

    return {
        records,
        leftoverUnitFacts: [...ineligibleUnits, ...leftoverUnitFacts],
        leftoverUnitAllocations,
    };
}

function isCIFragmentCandidateForRule(
    facts: GroupFacts,
    rule: OrgCIFormationRule,
): boolean {
    if (facts.isFragment) {
        return facts.type === rule.fragmentType;
    }

    if (facts.type !== rule.fragmentType && facts.type !== rule.type) {
        return false;
    }

    const ciCount = facts.unitTypeCounts.get('CI') ?? 0;
    return ciCount > 0 && facts.unitTypeCounts.size === 1;
}

export function normalizeCIFormationGroups(
    pool: readonly GroupSizeResult[],
    rules: readonly OrgCIFormationRule[],
): GroupSizeResult[] {
    let nextPool = [...pool];

    for (const rule of rules) {
        const entryByMoveClass = new Map(rule.entries.map((entry) => [entry.moveClass, entry]));
        const groupFacts = getCompiledGroupFactsList(nextPool);
        const candidates = groupFacts.filter((facts) => isCIFragmentCandidateForRule(facts, rule));
        if (candidates.length === 0) {
            continue;
        }

        const replacementGroups: GroupSizeResult[] = [];
        const consumedGroupFactIds = new Set<number>();
        const tokensByMoveClass = new Map<NonNullable<ReturnType<typeof getCIMoveClass>>, CIFragmentToken[]>();

        for (const facts of candidates) {
            const tokens = getCIFragmentTokensFromGroup(rule, facts.group, entryByMoveClass);
            if (!tokens) {
                continue;
            }
            consumedGroupFactIds.add(facts.groupFactId);
            for (const token of tokens) {
                const existing = tokensByMoveClass.get(token.moveClass);
                if (existing) {
                    existing.push(token);
                } else {
                    tokensByMoveClass.set(token.moveClass, [token]);
                }
            }
        }

        if (consumedGroupFactIds.size === 0) {
            continue;
        }

        for (const [moveClass, tokens] of tokensByMoveClass.entries()) {
            const entry = entryByMoveClass.get(moveClass);
            if (!entry) {
                continue;
            }
            replacementGroups.push(...materializeCIFormationTokens(rule, tokens, entry));
        }

        nextPool = [
            ...groupFacts
                .filter((facts) => !consumedGroupFactIds.has(facts.groupFactId))
                .map((facts) => facts.group),
            ...replacementGroups,
        ];
    }

    return nextPool;
}

function consumeUnitsBySteps(
    units: readonly UnitFacts[],
    modifierStepsDescending: readonly ModifierStep[],
): { emitted: LeafCountEmission[]; usedUnits: UnitFacts[] } {
    const emitted: LeafCountEmission[] = [];
    const usedUnits: UnitFacts[] = [];
    let remaining = [...units];

    for (const step of modifierStepsDescending) {
        const copies = Math.floor(remaining.length / step.count);
        if (copies <= 0) {
            continue;
        }
        emitted.push({
            modifierKey: step.modifierKey,
            perGroupCount: step.count,
            copies,
            tier: step.tier,
        });
        const takeCount = copies * step.count;
        usedUnits.push(...remaining.slice(0, takeCount));
        remaining = remaining.slice(takeCount);
    }

    return { emitted, usedUnits };
}

export function evaluateLeafCountRule(
    rule: OrgLeafCountRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): LeafCountEvaluationResult {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const descriptor = getRuleModifierDescriptor(rule);
    const emitted: LeafCountEmission[] = [];
    let leftoverCount = 0;

    for (const bucketUnits of groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry).values()) {
        const bucketResult = consumeUnitsBySteps(bucketUnits, descriptor.stepsDescending);
        emitted.push(...bucketResult.emitted);
        leftoverCount += bucketUnits.length - bucketResult.usedUnits.length;
    }

    return {
        eligibleUnits,
        emitted,
        leftoverCount,
    };
}

function getPatternModifierStep(
    descriptor: RuleModifierDescriptor,
    copySize: number,
): ModifierStep {
    return descriptor.stepsAscending.find((step) => step.count === copySize) ?? descriptor.regularStep;
}

function cloneWorkingUnits(
    source: ReadonlyMap<string, UnitFacts[]>,
): Map<string, UnitFacts[]> {
    const clone = new Map<string, UnitFacts[]>();
    for (const [bucketValue, units] of source.entries()) {
        clone.set(bucketValue, [...units]);
    }
    return clone;
}

function buildWorkingBucketUnits(
    unitsByBucket: ReadonlyMap<string, readonly UnitFacts[]>,
): Map<string, UnitFacts[]> {
    const working = new Map<string, UnitFacts[]>();
    for (const [bucketValue, units] of unitsByBucket.entries()) {
        working.set(bucketValue, [...units]);
    }
    return working;
}

function getLeafPatternFormationMatchingIgnoredUnits(
    rule: OrgLeafPatternRule,
    pattern: OrgPatternSpec,
    units: readonly UnitFacts[],
    registry: OrgRuleRegistry,
): OrgUnit[] {
    const ignoredPatternRefs = rule.formationMatching?.ignoredPatternRefs;
    if (!ignoredPatternRefs || ignoredPatternRefs.length === 0 || units.length === 0) {
        return [];
    }

    const bucketValueByUnit = new Map(
        units.map((facts) => [facts.unit, String(getUnitBucketValue(rule.bucketBy, facts, registry))]),
    );
    const availableBucketValues = Array.from(new Set(bucketValueByUnit.values()));
    const ignoredBucketValues = new Set<string>();

    for (const ref of ignoredPatternRefs) {
        for (const bucketValue of getPatternRefBucketValues(ref, pattern, availableBucketValues)) {
            ignoredBucketValues.add(String(bucketValue));
        }
    }

    if (ignoredBucketValues.size === 0) {
        return [];
    }

    return units
        .filter((facts) => ignoredBucketValues.has(bucketValueByUnit.get(facts.unit) ?? ''))
        .map((facts) => facts.unit);
}

function materializeSinglePatternCandidate(
    pattern: OrgPatternSpec,
    workingUnits: ReadonlyMap<string, UnitFacts[]>,
    guard: SolverGuard,
): ConcretePatternCandidate | null {
    const bucketCounts = new Map<string, number>();
    for (const [bucketValue, units] of workingUnits.entries()) {
        if (units.length > 0) {
            bucketCounts.set(bucketValue, units.length);
        }
    }

    const next = enumeratePatternCandidates(bucketCounts, pattern, guard)[0];
    if (!next) {
        return null;
    }

    const candidateUnits = cloneWorkingUnits(workingUnits);
    const selectedUnits: UnitFacts[] = [];
    for (const [bucketValue, count] of next.allocation.entries()) {
        const units = candidateUnits.get(bucketValue) ?? [];
        if (units.length < count) {
            return null;
        }
        selectedUnits.push(...units.splice(0, count));
    }

    if (selectedUnits.length === 0) {
        return null;
    }

    return {
        allocation: next.allocation,
        score: next.score,
        units: selectedUnits,
    };
}

function comparePatternSelections(left: PatternSelection, right: PatternSelection): number {
    if (left.candidate.score !== right.candidate.score) {
        return left.candidate.score - right.candidate.score;
    }
    if (left.pattern.copySize !== right.pattern.copySize) {
        return right.pattern.copySize - left.pattern.copySize;
    }
    return left.patternIndex - right.patternIndex;
}

function consumePatternCandidate(
    workingUnits: Map<string, UnitFacts[]>,
    candidate: ConcretePatternCandidate,
): void {
    const selectedIds = new Set(candidate.units.map((unit) => unit.factId));
    for (const [bucketValue, units] of workingUnits.entries()) {
        const remaining = units.filter((unit) => !selectedIds.has(unit.factId));
        workingUnits.set(bucketValue, remaining);
    }
}

function materializeLeafPatternsShared(
    patterns: readonly OrgPatternSpec[],
    unitsByBucket: ReadonlyMap<string, readonly UnitFacts[]>,
    guard: SolverGuard,
): PatternSelection[] {
    const workingUnits = buildWorkingBucketUnits(unitsByBucket);
    const selections: PatternSelection[] = [];
    let iterations = 0;

    while (iterations < MAX_PATTERN_GREEDY_ITERATIONS && !shouldAbortSearch(guard)) {
        iterations += 1;
        const candidates: PatternSelection[] = [];

        patterns.forEach((pattern, patternIndex) => {
            if (shouldAbortSearch(guard)) {
                return;
            }
            const candidate = materializeSinglePatternCandidate(pattern, workingUnits, guard);
            if (!candidate) {
                return;
            }
            candidates.push({ patternIndex, pattern, candidate });
        });

        if (candidates.length === 0) {
            break;
        }

        const chosenSelection = [...candidates].sort(comparePatternSelections)[0];
        consumePatternCandidate(workingUnits, chosenSelection.candidate);
        selections.push(chosenSelection);
    }

    if (iterations >= MAX_PATTERN_GREEDY_ITERATIONS) stopOrgSearch(guard, 'iteration-limit');
    return selections;
}

export function evaluateLeafPatternRule(
    rule: OrgLeafPatternRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): LeafPatternEvaluationResult {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const unitsByBucket = groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry);
    const emitted: LeafPatternEmission[] = [];
    const usedFactIds = new Set<number>();
    const descriptor = getRuleModifierDescriptor(rule);
    const guard = createSolverGuard();

    const selections = materializeLeafPatternsShared(rule.patterns, unitsByBucket, guard);
    const groupedSelections = new Map<number, ConcretePatternCandidate[]>();
    for (const selection of selections) {
        const existing = groupedSelections.get(selection.patternIndex);
        if (existing) {
            existing.push(selection.candidate);
        } else {
            groupedSelections.set(selection.patternIndex, [selection.candidate]);
        }
        selection.candidate.units.forEach((unit) => usedFactIds.add(unit.factId));
    }

    Array.from(groupedSelections.entries())
        .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
        .forEach(([patternIndex, concrete]) => {
            const pattern = rule.patterns[patternIndex];
            const step = getPatternModifierStep(descriptor, pattern.copySize);
            const copies = concrete.length;
            emitted.push({
                modifierKey: step.modifierKey,
                perGroupCount: pattern.copySize,
                copies,
                tier: step.tier,
                patternIndex,
                score: concrete.reduce((sum, candidate) => sum + candidate.score, 0) / copies,
                allocations: concrete.map((candidate) => candidate.allocation),
            });
        });

    return {
        eligibleUnits,
        emitted,
        leftoverCount: eligibleUnits.filter((facts) => !usedFactIds.has(facts.factId)).length,
    };
}

function materializeLeafPatternWithCandidates(
    rule: OrgLeafPatternRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry,
): { groups: GroupSizeResult[]; leftoverUnitFacts: UnitFacts[] } {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    const unitsByBucket = groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry);
    const descriptor = getRuleModifierDescriptor(rule);
    const selectedFactIds = new Set<number>();
    const groups: GroupSizeResult[] = [];
    const guard = createSolverGuard();

    const selections = materializeLeafPatternsShared(rule.patterns, unitsByBucket, guard);
    for (const selection of selections) {
        const ignoredUnits = getLeafPatternFormationMatchingIgnoredUnits(
            rule,
            selection.pattern,
            selection.candidate.units,
            registry,
        );
        groups.push(createLeafGroup(
            rule,
            getPatternModifierStep(descriptor, selection.pattern.copySize),
            selection.candidate.units,
            ignoredUnits,
        ));
        selection.candidate.units.forEach((unit) => selectedFactIds.add(unit.factId));
    }

    const leftoverUnitFacts = [
        ...ineligibleUnits,
        ...eligibleUnits.filter((facts) => !selectedFactIds.has(facts.factId)),
    ];

    return { groups, leftoverUnitFacts };
}

export function materializeLeafPatternWithCandidateRecords(
    rule: OrgLeafPatternRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry,
    parentGuard: SolverGuard,
): { records: PlannedGroupRecord[]; leftoverUnitFacts: UnitFacts[] } {
    const guard = forkSolverGuard(parentGuard);
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    const unitsByBucket = groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry);
    const descriptor = getRuleModifierDescriptor(rule);
    const selectedFactIds = new Set<number>();
    const records: PlannedGroupRecord[] = [];

    const selections = materializeLeafPatternsShared(rule.patterns, unitsByBucket, guard);
    for (const selection of selections) {
        const ignoredUnits = getLeafPatternFormationMatchingIgnoredUnits(
            rule,
            selection.pattern,
            selection.candidate.units,
            registry,
        );
        records.push(createAbstractLeafGroupRecord(
            rule,
            getPatternModifierStep(descriptor, selection.pattern.copySize),
            selection.candidate.units,
            ignoredUnits,
        ));
        selection.candidate.units.forEach((unit) => selectedFactIds.add(unit.factId));
    }

    const leftoverUnitFacts = [
        ...ineligibleUnits,
        ...eligibleUnits.filter((facts) => !selectedFactIds.has(facts.factId)),
    ];

    return { records, leftoverUnitFacts };
}

export function materializeLeafPatternRule(
    rule: OrgLeafPatternRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): MaterializedLeafUnitResult {
    return materializeLeafPatternWithCandidates(rule, unitFacts, registry);
}

export function materializeLeafCountRule(
    rule: OrgLeafCountRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): MaterializedLeafUnitResult {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    const descriptor = getRuleModifierDescriptor(rule);
    const groups: GroupSizeResult[] = [];
    const usedFactIds = new Set<number>();

    for (const bucketUnits of groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry).values()) {
        const preferredLeftovers: UnitFacts[] = [];

        for (const preferredUnits of groupUnitsByPreferredType(bucketUnits).values()) {
            let remaining = [...preferredUnits];
            for (const step of descriptor.stepsDescending) {
                while (remaining.length >= step.count) {
                    const selected = remaining.slice(0, step.count);
                    remaining = remaining.slice(step.count);
                    selected.forEach((facts) => usedFactIds.add(facts.factId));
                    groups.push(createLeafGroup(rule, step, selected));
                }
            }
            preferredLeftovers.push(...remaining);
        }

        let mixedRemaining = preferredLeftovers;
        for (const step of descriptor.stepsDescending) {
            while (mixedRemaining.length >= step.count) {
                const selected = mixedRemaining.slice(0, step.count);
                mixedRemaining = mixedRemaining.slice(step.count);
                selected.forEach((facts) => usedFactIds.add(facts.factId));
                groups.push(createLeafGroup(rule, step, selected));
            }
        }

        if (rule.fragmentType && mixedRemaining.length > 0) {
            mixedRemaining.forEach((facts) => usedFactIds.add(facts.factId));
            groups.push(createLeafFragmentGroup(rule, mixedRemaining.length, mixedRemaining));
        }
    }

    return {
        groups,
        leftoverUnitFacts: [
            ...ineligibleUnits,
            ...eligibleUnits.filter((facts) => !usedFactIds.has(facts.factId)),
        ],
    };
}

export function materializeLeafCountRuleRecords(
    rule: OrgLeafCountRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): { records: PlannedGroupRecord[]; leftoverUnitFacts: UnitFacts[] } {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    const descriptor = getRuleModifierDescriptor(rule);
    const records: PlannedGroupRecord[] = [];
    const usedFactIds = new Set<number>();

    for (const bucketUnits of groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry).values()) {
        const preferredLeftovers: UnitFacts[] = [];

        for (const preferredUnits of groupUnitsByPreferredType(bucketUnits).values()) {
            let remaining = [...preferredUnits];
            for (const step of descriptor.stepsDescending) {
                while (remaining.length >= step.count) {
                    const selected = remaining.slice(0, step.count);
                    remaining = remaining.slice(step.count);
                    selected.forEach((facts) => usedFactIds.add(facts.factId));
                    records.push(createAbstractLeafGroupRecord(rule, step, selected));
                }
            }
            preferredLeftovers.push(...remaining);
        }

        let mixedRemaining = preferredLeftovers;
        for (const step of descriptor.stepsDescending) {
            while (mixedRemaining.length >= step.count) {
                const selected = mixedRemaining.slice(0, step.count);
                mixedRemaining = mixedRemaining.slice(step.count);
                selected.forEach((facts) => usedFactIds.add(facts.factId));
                records.push(createAbstractLeafGroupRecord(rule, step, selected));
            }
        }

        if (rule.fragmentType && mixedRemaining.length > 0) {
            mixedRemaining.forEach((facts) => usedFactIds.add(facts.factId));
            records.push(createAbstractLeafFragmentRecord(rule, mixedRemaining.length, mixedRemaining));
        }
    }

    return {
        records,
        leftoverUnitFacts: [
            ...ineligibleUnits,
            ...eligibleUnits.filter((facts) => !usedFactIds.has(facts.factId)),
        ],
    };
}

function enumerateExactLeafCountStepPartitions(
    totalCount: number,
    stepsDescending: readonly ModifierStep[],
    maxPartitions: number = 256,
): readonly (readonly ModifierStep[])[] {
    const partitions: ModifierStep[][] = [];
    const partitionKeys = new Set<string>();

    function visit(stepIndex: number, remaining: number, selected: ModifierStep[]): void {
        if (partitions.length >= maxPartitions) {
            return;
        }
        if (remaining === 0) {
            const partition = [...selected];
            const partitionKey = partition.map((step) => `${step.modifierKey}:${step.count}`).join('|');
            if (!partitionKeys.has(partitionKey)) {
                partitionKeys.add(partitionKey);
                partitions.push(partition);
            }
            return;
        }
        if (stepIndex >= stepsDescending.length) {
            return;
        }

        const step = stepsDescending[stepIndex];
        const maxCopies = Math.floor(remaining / step.count);
        for (let copies = maxCopies; copies >= 0; copies -= 1) {
            for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
                selected.push(step);
            }
            visit(stepIndex + 1, remaining - (copies * step.count), selected);
            selected.length -= copies;
        }
    }

    visit(0, totalCount, []);
    return partitions.sort((left, right) => compareModifierPreferences(right, left));
}

export function enumerateExactLeafCountRuleRecordSets(
    rule: OrgLeafCountRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): readonly (readonly PlannedGroupRecord[])[] {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    if (ineligibleUnits.length > 0) {
        return [];
    }

    const descriptor = getRuleModifierDescriptor(rule);
    const combinedRecordSet: PlannedGroupRecord[] = [];

    for (const bucketUnits of groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry).values()) {
        const orderedUnits = [...groupUnitsByPreferredType(bucketUnits).values()].flat();
        if (orderedUnits.length === 0) {
            continue;
        }

        const stepPartitions = enumerateExactLeafCountStepPartitions(orderedUnits.length, descriptor.stepsDescending);
        if (stepPartitions.length === 0) {
            return [];
        }

        const bestPartition = stepPartitions[0];
        let unitOffset = 0;
        for (const step of bestPartition) {
            const selected = orderedUnits.slice(unitOffset, unitOffset + step.count);
            unitOffset += step.count;
            combinedRecordSet.push(createAbstractLeafGroupRecord(rule, step, selected));
        }
    }

    return combinedRecordSet.length > 0 ? [combinedRecordSet] : [];
}
