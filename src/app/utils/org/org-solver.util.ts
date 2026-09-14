// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Organization solve orchestration: allocation, repair, promotion, and final selection. */

import type { Era } from '../../models/eras.model';
import type { Faction } from '../../models/factions.model';
import {
    type AbstractCompositionPlanResult,
    buildCompositionConfigs,
    buildPatternCompositionConfig,
    canAssignGroupsToRoles,
    evaluateComposedCountRule,
    evaluateComposedPatternRule,
    findAbstractCompositionSelection,
    getGroupBucketValue,
    getGroupFactsSignatureKey,
    matchesComposedPatternSelection,
    planComposedCountRuleInternal,
    planComposedPatternRuleInternal,
    resolvePlannedCompositionCandidates,
} from './org-composition.util';
import { compileUnitFactsList } from './org-facts.util';
import {
    copyReadonlyCountMap,
    createAbstractComposedGroupRecord,
    createAbstractLeafFragmentRecord,
    createAbstractLeafGroupRecord,
    createAbstractProducedGroupTemplate,
    createConcretePlannedGroupRecord,
    getCompiledGroupFacts,
    getCompiledGroupFactsList,
    getRuleDisplayName,
    makeGroupName,
    type PlannedGroupRecord,
} from './org-group-records.util';
import {
    enumerateExactLeafCountRuleRecordSets,
    evaluateCIFormationRule,
    evaluateLeafCountRule,
    evaluateLeafPatternRule,
    groupUnitsByBucket,
    groupUnitsByPreferredType,
    matchesUnitSelectors,
    materializeCIFormationRuleRecords,
    materializeLeafCountRuleRecords,
    materializeLeafPatternWithCandidateRecords,
    normalizeCIFormationGroups,
} from './org-leaf-rules.util';
import { resolveOrgDefinition } from './org-registry.util';
import { groupMatchesChildRole } from './org-role-match.util';
import {
    type CompiledRuleStageMetadata,
    compileRuleStageMetadata,
    getAllowedModifierKeysForStage,
    getModifierStepForRuleStage,
    getRulePriority,
    getRuleRegistry,
    isSubRegularModifierKey,
    type ModifierBand,
    type ModifierStep,
    type RuleExecutionStage,
    type RuleModifierDescriptor,
} from './org-rule-metadata.util';
import {
    addMetricDuration,
    createMutableOrgSolveMetrics,
    createSolverGuard,
    getSolveTimestampMs,
    type MutableOrgSolveMetrics,
    orgSolveMetrics,
    shouldAbortSearch,
    snapshotOrgSolveMetrics,
    type SolverGuard,
} from './org-solve-session';
import { getRepeatCountForTierDelta } from './org-tier.util';
import {
    EMPTY_RESULT,
    type GroupFacts,
    type GroupSizeResult,
    type GroupUnitAllocation,
    type OrgBucketValue,
    type OrgChildTypeCountKey,
    type OrgCIFormationRule,
    type OrgComposedCountRule,
    type OrgComposedPatternRule,
    type OrgDefinition,
    type OrgGroupBucketName,
    type OrgGroupProvenance,
    type OrgLeafCountRule,
    type OrgLeafPatternRule,
    type OrgRuleDefinition,
    type OrgRuleRegistry,
    type OrgUnit,
    type UnitFacts,
} from './org-types';

const MAX_PROMOTION_LOOP_ITERATIONS = 64;

const MAX_EXACT_LEAF_PARTITION_UNITS = 32;

const CROSSGRADE_FOREIGN_GROUPS = false;

export interface OrgDefinitionEvaluationResult {
    readonly unitFacts: readonly UnitFacts[];
    readonly groupFacts: readonly GroupFacts[];
    readonly ruleEvaluations: ReadonlyMap<OrgRuleDefinition, unknown>;
}

interface CanonicalGroupPoolSignatureEntry {
    readonly key: string;
    readonly count: number;
}

interface CanonicalGroupPoolSignature {
    readonly entries: readonly CanonicalGroupPoolSignatureEntry[];
    readonly counts: ReadonlyMap<string, number>;
    readonly key: string;
}

interface CanonicalGroupPoolState {
    readonly groups: readonly PlannedGroupRecord[];
    readonly groupFacts: readonly GroupFacts[];
    readonly recordByGroupFactId: ReadonlyMap<number, PlannedGroupRecord>;
    readonly signature: CanonicalGroupPoolSignature;
}

interface ResolveContext {
    readonly definition: OrgDefinition;
    readonly ciFormationRules: readonly OrgCIFormationRule[];
    readonly leafCountRules: readonly OrgLeafCountRule[];
    readonly leafPatternRules: readonly OrgLeafPatternRule[];
    readonly composedCountRules: readonly OrgComposedCountRule[];
    readonly composedPatternRules: readonly OrgComposedPatternRule[];
    readonly knownGroupTypes: ReadonlySet<string>;
    readonly ruleTierByType: ReadonlyMap<string, number>;
    readonly composedCountRuleByType: ReadonlyMap<string, OrgComposedCountRule>;
    readonly anyRuleByType: ReadonlyMap<string, OrgLeafCountRule | OrgLeafPatternRule | OrgCIFormationRule | OrgComposedCountRule | OrgComposedPatternRule>;
    readonly orderedComposedRules: readonly (OrgComposedCountRule | OrgComposedPatternRule)[];
    readonly minimumChildTierByRule: ReadonlyMap<OrgComposedCountRule | OrgComposedPatternRule, number>;
    readonly ruleStageMetadata: ReadonlyMap<OrgRuleDefinition, CompiledRuleStageMetadata>;
    readonly exactRegularPromotionResultBySignature: Map<string, CanonicalGroupPoolState>;
    readonly negativeComposedPlanKeys: Set<string>;
}

type ResolveContextTemplate = Omit<ResolveContext, 'exactRegularPromotionResultBySignature' | 'negativeComposedPlanKeys'>;

interface FinalStateScore {
    readonly isWhole: boolean;
    readonly highestTier: number;
    readonly totalPriority: number;
    readonly topLevelGroupCount: number;
    readonly highestTierGroupCount: number;
    readonly totalRegularityDistance: number;
    readonly subRegularGroupCount: number;
    readonly leftoverCount: number;
}

interface DescendantRegularityScore {
    readonly totalRegularityDistance: number;
    readonly subRegularGroupCount: number;
    readonly groupCount: number;
}

interface CanonicalPromotionFuture {
    readonly finalScore: FinalStateScore;
    readonly nextSignatureKey?: string;
}

interface ResolvedState {
    readonly canonicalState: CanonicalGroupPoolState;
    readonly leftoverUnits: readonly UnitFacts[];
    readonly leftoverUnitAllocations: readonly GroupUnitAllocation[];
}

const resolveContextTemplateByDefinition = new WeakMap<OrgDefinition, ResolveContextTemplate>();

function getRuleStageMetadata(
    context: ResolveContext,
    rule: OrgRuleDefinition,
): CompiledRuleStageMetadata {
    return context.ruleStageMetadata.get(rule) ?? compileRuleStageMetadata(rule);
}

export function evaluateOrgDefinition(
    definition: OrgDefinition,
    units: readonly OrgUnit[],
    groups: readonly GroupSizeResult[] = [],
): OrgDefinitionEvaluationResult {
    const unitFacts = compileUnitFactsList(units);
    const groupFacts = getCompiledGroupFactsList(groups);
    const registry = getRuleRegistry(definition);
    const ruleEvaluations = new Map<OrgRuleDefinition, unknown>();

    for (const rule of definition.rules) {
        switch (rule.kind) {
            case 'leaf-count':
                ruleEvaluations.set(rule, evaluateLeafCountRule(rule, unitFacts, registry));
                break;
            case 'leaf-pattern':
                ruleEvaluations.set(rule, evaluateLeafPatternRule(rule, unitFacts, registry));
                break;
            case 'ci-formation':
                ruleEvaluations.set(rule, evaluateCIFormationRule(rule, unitFacts, registry));
                break;
            case 'composed-count':
                ruleEvaluations.set(rule, evaluateComposedCountRule(rule, groupFacts, registry));
                break;
            case 'composed-pattern':
                ruleEvaluations.set(rule, evaluateComposedPatternRule(rule, groupFacts, registry));
                break;
        }
    }

    return {
        unitFacts,
        groupFacts,
        ruleEvaluations,
    };
}

export function evaluateFactionOrgDefinition(
    faction: Faction,
    units: readonly OrgUnit[],
    groups: readonly GroupSizeResult[] = [],
    era?: Era | null,
): OrgDefinitionEvaluationResult {
    return evaluateOrgDefinition(resolveOrgDefinition(faction, era), units, groups);
}

function compareGroupScore(left: GroupSizeResult, right: GroupSizeResult): number {
    if (left.tier !== right.tier) {
        return right.tier - left.tier;
    }
    return (right.priority ?? 0) - (left.priority ?? 0);
}

function compareGroupFactsScore(
    left: Pick<GroupFacts, 'tier' | 'priority'>,
    right: Pick<GroupFacts, 'tier' | 'priority'>,
): number {
    if (left.tier !== right.tier) {
        return right.tier - left.tier;
    }
    return (right.priority ?? 0) - (left.priority ?? 0);
}

function getGroupRegularityScore(
    group: Pick<GroupFacts, 'type' | 'modifierKey'>,
    context: ResolveContext,
): { readonly distanceFromRegular: number; readonly isSubRegular: boolean } {
    const rule = getAnyRuleByType(context, group.type);
    if (!rule) {
        return {
            distanceFromRegular: group.modifierKey === '' ? 0 : 1,
            isSubRegular: group.modifierKey !== '',
        };
    }

    const metadata = getRuleStageMetadata(context, rule);
    const step = metadata.descriptor.stepsAscending.find((candidate) => candidate.modifierKey === group.modifierKey);
    if (!step) {
        return {
            distanceFromRegular: group.modifierKey === '' ? 0 : 1,
            isSubRegular: group.modifierKey !== '',
        };
    }

    return {
        distanceFromRegular: step.distanceFromRegular,
        isSubRegular: step.relativeBand === 'sub-regular',
    };
}

function getOrderedComposedRules(
    context: ResolveContext,
): readonly (OrgComposedCountRule | OrgComposedPatternRule)[] {
    return context.orderedComposedRules;
}

function compareOrderedComposedRules(
    left: OrgComposedCountRule | OrgComposedPatternRule,
    right: OrgComposedCountRule | OrgComposedPatternRule,
    minimumChildTierByRule: ReadonlyMap<OrgComposedCountRule | OrgComposedPatternRule, number>,
): number {
    const leftChildTier = minimumChildTierByRule.get(left) ?? left.tier;
    const rightChildTier = minimumChildTierByRule.get(right) ?? right.tier;

    if (leftChildTier !== rightChildTier) {
        return leftChildTier - rightChildTier;
    }
    if (left.tier !== right.tier) {
        return right.tier - left.tier;
    }
    return getRulePriority(right) - getRulePriority(left);
}

function getRuleTierByTypeFromDefinition(
    definition: OrgDefinition,
    type: GroupSizeResult['type'],
): number | null {
    if (!type) {
        return null;
    }

    const rule = definition.rules.find((candidate) => candidate.type === type);
    return rule?.tier ?? null;
}

function getMinimumChildTierForComposedRule(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    definition: OrgDefinition,
): number {
    const childTiers = rule.childRoles
        .flatMap((role) => role.matches)
        .map((type) => getRuleTierByTypeFromDefinition(definition, type))
        .filter((tier): tier is number => tier !== null);

    return childTiers.length > 0 ? Math.min(...childTiers) : rule.tier;
}

function getResolveContext(definition: OrgDefinition): ResolveContext {
    let template = resolveContextTemplateByDefinition.get(definition);
    if (!template) {
        const knownGroupTypes = new Set<string>();
        const ruleTierByType = new Map<string, number>();
        const composedCountRuleByType = new Map<string, OrgComposedCountRule>();
        const anyRuleByType = new Map<string, OrgLeafCountRule | OrgLeafPatternRule | OrgCIFormationRule | OrgComposedCountRule | OrgComposedPatternRule>();

        for (const rule of definition.rules) {
            knownGroupTypes.add(rule.type);
            ruleTierByType.set(rule.type, rule.tier);
            if (!anyRuleByType.has(rule.type)) {
                anyRuleByType.set(rule.type, rule);
            }
            if (rule.kind === 'ci-formation' && !anyRuleByType.has(rule.fragmentType)) {
                anyRuleByType.set(rule.fragmentType, rule);
            }
            if (rule.kind === 'composed-count' && !composedCountRuleByType.has(rule.type)) {
                composedCountRuleByType.set(rule.type, rule);
            }
        }

        const ruleStageMetadata = new Map<OrgRuleDefinition, CompiledRuleStageMetadata>(
            definition.rules.map((rule) => [rule, compileRuleStageMetadata(rule)]),
        );
        const composedRules = definition.rules.filter((rule): rule is OrgComposedCountRule | OrgComposedPatternRule =>
            rule.kind === 'composed-count' || rule.kind === 'composed-pattern',
        );
        const minimumChildTierByRule = new Map<OrgComposedCountRule | OrgComposedPatternRule, number>(
            composedRules.map((rule) => [rule, getMinimumChildTierForComposedRule(rule, definition)]),
        );
        const orderedComposedRules = [...composedRules].sort((left, right) => compareOrderedComposedRules(left, right, minimumChildTierByRule));
        const composedCountRules = orderedComposedRules.filter((rule): rule is OrgComposedCountRule => rule.kind === 'composed-count');
        const composedPatternRules = orderedComposedRules.filter((rule): rule is OrgComposedPatternRule => rule.kind === 'composed-pattern');

        template = {
            definition,
            ciFormationRules: definition.rules.filter((rule): rule is OrgCIFormationRule => rule.kind === 'ci-formation')
                .sort((left, right) => right.tier - left.tier || getRulePriority(right) - getRulePriority(left)),
            leafCountRules: definition.rules.filter((rule): rule is OrgLeafCountRule => rule.kind === 'leaf-count')
                .sort((left, right) => right.tier - left.tier || getRulePriority(right) - getRulePriority(left)),
            leafPatternRules: definition.rules.filter((rule): rule is OrgLeafPatternRule => rule.kind === 'leaf-pattern')
                .sort((left, right) => right.tier - left.tier || getRulePriority(right) - getRulePriority(left)),
            composedCountRules,
            composedPatternRules,
            knownGroupTypes,
            ruleTierByType,
            composedCountRuleByType,
            anyRuleByType,
            orderedComposedRules,
            minimumChildTierByRule,
            ruleStageMetadata,
        };
        resolveContextTemplateByDefinition.set(definition, template);
    }

    return {
        ...template,
        exactRegularPromotionResultBySignature: new Map<string, CanonicalGroupPoolState>(),
        negativeComposedPlanKeys: new Set<string>(),
    };
}

function resolveWholeLeafCandidateRecord(
    unitFacts: readonly UnitFacts[],
    context: ResolveContext,
): PlannedGroupRecord | null {
    const registry = context.definition.registry;
    let best: PlannedGroupRecord | null = null;

    for (const rule of context.ciFormationRules) {
        const materialized = materializeCIFormationRuleRecords(rule, unitFacts, registry);
        if (materialized.records.length === 1 && materialized.leftoverUnitFacts.length === 0 && materialized.leftoverUnitAllocations.length === 0) {
            const candidate = materialized.records[0];
            if (!best || compareGroupFactsScore(candidate.facts, best.facts) < 0) {
                best = candidate;
            }
        }
    }

    const allLeafRules: Array<OrgLeafCountRule | OrgLeafPatternRule> = [
        ...context.leafPatternRules,
        ...context.leafCountRules,
    ];

    for (const rule of allLeafRules) {
        if (rule.kind === 'leaf-count') {
            const materialized = materializeLeafCountRuleRecords(rule, unitFacts, registry);
            if (materialized.records.length === 1 && materialized.leftoverUnitFacts.length === 0) {
                const candidate = materialized.records[0];
                if (!best || compareGroupFactsScore(candidate.facts, best.facts) < 0) {
                    best = candidate;
                }
            }
            continue;
        }

        const materialized = materializeLeafPatternWithCandidateRecords(rule, unitFacts, registry);
        if (materialized.records.length === 1 && materialized.leftoverUnitFacts.length === 0) {
            const candidate = materialized.records[0];
            if (!best || compareGroupFactsScore(candidate.facts, best.facts) < 0) {
                best = candidate;
            }
        }
    }

    return best;
}

function resolveExactLeafPartitionCandidateStates(
    unitFacts: readonly UnitFacts[],
    context: ResolveContext,
): ResolvedState[] {
    const registry = context.definition.registry;
    const candidates: ResolvedState[] = [];
    const seenPartitionStateKeys = new Set<string>();
    const allLeafRules: Array<OrgLeafCountRule | OrgLeafPatternRule> = [
        ...context.leafPatternRules,
        ...context.leafCountRules,
    ];

    function pushExactPartitionCandidates(partitionState: CanonicalGroupPoolState): void {
        if (seenPartitionStateKeys.has(partitionState.signature.key)) {
            return;
        }
        seenPartitionStateKeys.add(partitionState.signature.key);
        candidates.push({ canonicalState: partitionState, leftoverUnits: [], leftoverUnitAllocations: [] });

        const repairedPartitionState = repairSubRegularGroupsForPromotionState(partitionState, context);
        const assimilatedPartitionState = preAssimilateUnderRegularGroupState(repairedPartitionState, context, createSolverGuard());
        const promotedPartitionState = searchBestRegularPromotionPoolStateFromState(assimilatedPartitionState, context, createSolverGuard());
        const improvedPartitionState = runLeftoverImprovementLoopState(promotedPartitionState, context, createSolverGuard());

        candidates.push({ canonicalState: promotedPartitionState, leftoverUnits: [], leftoverUnitAllocations: [] });
        if (improvedPartitionState.signature.key !== promotedPartitionState.signature.key) {
            candidates.push({ canonicalState: improvedPartitionState, leftoverUnits: [], leftoverUnitAllocations: [] });
        }

        const wholeComposedState = resolveWholeComposedCandidateState(improvedPartitionState, context, createSolverGuard());
        if (wholeComposedState) {
            candidates.push({ canonicalState: wholeComposedState, leftoverUnits: [], leftoverUnitAllocations: [] });
        }
    }

    for (const rule of allLeafRules) {
        if (rule.kind === 'leaf-pattern') {
            const materialized = materializeLeafPatternWithCandidateRecords(rule, unitFacts, registry);
            if (materialized.records.length === 0 || materialized.leftoverUnitFacts.length > 0) {
                continue;
            }

            const partitionState = createCanonicalGroupPoolStateFromRecords(materialized.records);
            pushExactPartitionCandidates(partitionState);
            continue;
        }

        const exactRecordSets = enumerateExactLeafCountRuleRecordSets(rule, unitFacts, registry);
        for (const recordSet of exactRecordSets) {
            if (recordSet.length === 0) {
                continue;
            }

            const partitionState = createCanonicalGroupPoolStateFromRecords(recordSet);
            pushExactPartitionCandidates(partitionState);
        }
    }

    return candidates;
}

function materializeLeafRulesByStageRecords(
    unitFacts: readonly UnitFacts[],
    context: ResolveContext,
    stage: RuleExecutionStage,
): { records: PlannedGroupRecord[]; leftover: UnitFacts[]; leftoverUnitAllocations: GroupUnitAllocation[] } {
    const registry = context.definition.registry;
    let remaining = [...unitFacts];
    const records: PlannedGroupRecord[] = [];
    const leftoverUnitAllocations: GroupUnitAllocation[] = [];

    if (stage !== 'sub-regular') {
        for (const rule of context.ciFormationRules) {
            const materialized = materializeCIFormationRuleRecords(rule, remaining, registry);
            records.push(...materialized.records);
            remaining = [...materialized.leftoverUnitFacts];
            leftoverUnitAllocations.push(...materialized.leftoverUnitAllocations);
        }
    }

    const leafRules: Array<OrgLeafCountRule | OrgLeafPatternRule> = [
        ...context.leafPatternRules,
        ...context.leafCountRules,
    ];

    for (const rule of leafRules) {
        const metadata = getRuleStageMetadata(context, rule);

        if (rule.kind === 'leaf-pattern') {
            if (!metadata.participatesInRegularStage || stage === 'sub-regular') {
                continue;
            }
            const materialized = materializeLeafPatternWithCandidateRecords(rule, remaining, registry);
            records.push(...materialized.records);
            remaining = [...materialized.leftoverUnitFacts];
            continue;
        }

        const targetSteps = getModifierStepForRuleStage(metadata, stage);
        if (targetSteps.length === 0 && !rule.fragmentType) {
            continue;
        }

        const eligibleUnits = remaining.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
        const ineligibleUnits = remaining.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
        const usedIds = new Set<number>();

        for (const bucketUnits of groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry).values()) {
            const preferredLeftovers: UnitFacts[] = [];

            for (const preferredUnits of groupUnitsByPreferredType(bucketUnits).values()) {
                let working = [...preferredUnits];
                for (const step of targetSteps) {
                    while (working.length >= step.count) {
                        const selected = working.slice(0, step.count);
                        working = working.slice(step.count);
                        selected.forEach((facts) => usedIds.add(facts.factId));
                        records.push(createAbstractLeafGroupRecord(rule, step, selected));
                    }
                }
                preferredLeftovers.push(...working);
            }

            let mixedWorking = preferredLeftovers;
            for (const step of targetSteps) {
                while (mixedWorking.length >= step.count) {
                    const selected = mixedWorking.slice(0, step.count);
                    mixedWorking = mixedWorking.slice(step.count);
                    selected.forEach((facts) => usedIds.add(facts.factId));
                    records.push(createAbstractLeafGroupRecord(rule, step, selected));
                }
            }

            if (rule.fragmentType && mixedWorking.length > 0) {
                mixedWorking.forEach((facts) => usedIds.add(facts.factId));
                records.push(createAbstractLeafFragmentRecord(rule, mixedWorking.length, mixedWorking));
            }
        }

        remaining = [
            ...ineligibleUnits,
            ...eligibleUnits.filter((facts) => !usedIds.has(facts.factId)),
        ];
    }

    return { records, leftover: remaining, leftoverUnitAllocations };
}

function materializeComposedRulesByStageState(
    initialState: CanonicalGroupPoolState,
    context: ResolveContext,
    stage: RuleExecutionStage,
    guard: SolverGuard,
): CanonicalGroupPoolState {
    const blockedFacts = initialState.groupFacts.filter((facts) => isBlockedSubRegularPromotionChildFacts(facts, context));
    let state = createCanonicalGroupPoolStateFromRecords(
        initialState.groups.filter((group) => !isBlockedSubRegularPromotionChildFacts(group.facts, context)),
    );

    for (const rule of getOrderedComposedRules(context)) {
        const allowedModifierKeys = getAllowedModifierKeysForStage(getRuleStageMetadata(context, rule), stage);
        const abstractCandidates = planComposedRuleInternal(
            rule,
            state.groupFacts,
            context.definition.registry,
            guard,
            allowedModifierKeys,
            context,
        );

        if (abstractCandidates.candidates.length === 0) {
            continue;
        }

        const plannedCandidates = resolvePlannedCompositionCandidates(
            abstractCandidates.candidates,
            abstractCandidates.groupsByEntryId,
            state.recordByGroupFactId,
        );
        const usedChildren = new Set(plannedCandidates.flatMap((candidate) => candidate.groups.map((group) => group.recordId)));
        const producedGroups = plannedCandidates.map((candidate) => createAbstractComposedGroupRecord(
            rule,
            candidate.modifierStep,
            candidate.groups,
        ));
        state = createSuccessorCanonicalGroupPoolState(state, producedGroups, usedChildren);
    }

    if (blockedFacts.length === 0) {
        return state;
    }

    const blockedRecords = blockedFacts
        .map((facts) => initialState.recordByGroupFactId.get(facts.groupFactId))
        .filter((record): record is PlannedGroupRecord => !!record);

    return createCanonicalGroupPoolStateFromRecords([
        ...blockedRecords,
        ...state.groups,
    ]);
}

function isBlockedSubRegularPromotionChildFacts(
    facts: Pick<GroupFacts, 'type' | 'modifierKey'>,
    context: ResolveContext,
): boolean {
    if (!facts.type) {
        return false;
    }

    const rule = context.composedCountRules.find((candidate) =>
        candidate.type === facts.type && candidate.requireRegularForPromotion,
    ) ?? context.ciFormationRules.find((candidate) =>
        candidate.type === facts.type && candidate.requireRegularForPromotion,
    );
    if (!rule) {
        return false;
    }

    return isSubRegularModifierKey(getRuleStageMetadata(context, rule), facts.modifierKey);
}

function attachLeftoverUnits(
    groups: GroupSizeResult[],
    leftoverUnits: readonly UnitFacts[],
    leftoverUnitAllocations: readonly GroupUnitAllocation[],
): GroupSizeResult[] {
    if (leftoverUnits.length === 0 && leftoverUnitAllocations.length === 0) {
        return groups;
    }
    const attachedLeftoverUnits = Array.from(new Set([
        ...leftoverUnits.map((facts) => facts.unit),
        ...leftoverUnitAllocations.map((allocation) => allocation.unit),
    ]));
    if (groups.length === 0) {
        return [{
            ...EMPTY_RESULT,
            leftoverUnits: attachedLeftoverUnits,
            leftoverUnitAllocations: [...leftoverUnitAllocations],
        }];
    }
    const sorted = [...groups].sort(compareGroupScore);
    const [top, ...rest] = sorted;
    return [{
        ...top,
        leftoverUnits: attachedLeftoverUnits,
        leftoverUnitAllocations: [...leftoverUnitAllocations],
    }, ...rest];
}

function getAnyRuleByType(
    context: ResolveContext,
    type: GroupSizeResult['type'],
): OrgLeafCountRule | OrgLeafPatternRule | OrgCIFormationRule | OrgComposedCountRule | OrgComposedPatternRule | undefined {
    if (!type) {
        return undefined;
    }

    return context.anyRuleByType.get(type);
}

function getModifierBandForGroupFacts(group: GroupFacts, context: ResolveContext): ModifierBand {
    const rule = getAnyRuleByType(context, group.type);
    if (!rule) {
        return group.modifierKey === '' ? 'regular' : 'sub-regular';
    }
    const metadata = getRuleStageMetadata(context, rule);
    return metadata.descriptor.stepsAscending.find((step) => step.modifierKey === group.modifierKey)?.relativeBand ?? 'regular';
}

function scoreResolvedState(state: ResolvedState, context: ResolveContext): FinalStateScore {
    const baseScore = scoreCanonicalGroupPoolState(state.canonicalState, context);
    const leftoverCount = state.leftoverUnits.length + state.leftoverUnitAllocations.length;

    return {
        ...baseScore,
        isWhole: baseScore.isWhole && leftoverCount === 0,
        leftoverCount,
    };
}

function scoreCanonicalGroupPoolState(state: CanonicalGroupPoolState, context: ResolveContext): FinalStateScore {
    const topLevelGroupCount = state.groupFacts.length;
    const highestTier = topLevelGroupCount > 0 ? Math.max(...state.groupFacts.map((group) => group.tier)) : 0;
    const highestTierGroupCount = state.groupFacts.filter((group) => group.tier === highestTier).length;
    const totalPriority = state.groupFacts.reduce((sum, group) => sum + (group.priority ?? 0), 0);
    const regularity = state.groupFacts.reduce((summary, group) => {
        const groupScore = getGroupRegularityScore(group, context);
        return {
            totalRegularityDistance: summary.totalRegularityDistance + groupScore.distanceFromRegular,
            subRegularGroupCount: summary.subRegularGroupCount + (groupScore.isSubRegular ? 1 : 0),
        };
    }, {
        totalRegularityDistance: 0,
        subRegularGroupCount: 0,
    });
    const isWhole = topLevelGroupCount === 1
        && getModifierBandForGroupFacts(state.groupFacts[0], context) !== 'sub-regular';

    return {
        isWhole,
        highestTier,
        totalPriority,
        topLevelGroupCount,
        highestTierGroupCount,
        totalRegularityDistance: regularity.totalRegularityDistance,
        subRegularGroupCount: regularity.subRegularGroupCount,
        leftoverCount: 0,
    };
}

function compareResolvedState(left: ResolvedState, right: ResolvedState, context: ResolveContext): number {
    const leftScore = scoreResolvedState(left, context);
    const rightScore = scoreResolvedState(right, context);

    const scoreComparison = compareFinalStateScores(leftScore, rightScore);
    if (scoreComparison !== 0) {
        return scoreComparison;
    }

    const leftDescendantScore = scoreResolvedStateDescendantRegularity(left, context);
    const rightDescendantScore = scoreResolvedStateDescendantRegularity(right, context);
    if (leftDescendantScore.subRegularGroupCount !== rightDescendantScore.subRegularGroupCount) {
        return leftDescendantScore.subRegularGroupCount - rightDescendantScore.subRegularGroupCount;
    }
    if (leftDescendantScore.totalRegularityDistance !== rightDescendantScore.totalRegularityDistance) {
        return leftDescendantScore.totalRegularityDistance - rightDescendantScore.totalRegularityDistance;
    }
    if (leftDescendantScore.groupCount !== rightDescendantScore.groupCount) {
        return rightDescendantScore.groupCount - leftDescendantScore.groupCount;
    }

    return 0;
}

function scoreResolvedStateDescendantRegularity(
    state: ResolvedState,
    context: ResolveContext,
): DescendantRegularityScore {
    const summary = {
        totalRegularityDistance: 0,
        subRegularGroupCount: 0,
        groupCount: 0,
    };

    const visit = (group: GroupSizeResult | undefined): void => {
        if (!group) {
            return;
        }

        for (const child of group.children ?? []) {
            const childFacts = getCompiledGroupFacts(child);
            const childScore = getGroupRegularityScore(childFacts, context);
            summary.totalRegularityDistance += childScore.distanceFromRegular;
            summary.subRegularGroupCount += childScore.isSubRegular ? 1 : 0;
            summary.groupCount += 1;
            visit(child);
        }
    };

    for (const group of materializeCanonicalGroupPoolState(state.canonicalState)) {
        visit(group);
    }

    return summary;
}

function compareFinalStateScores(leftScore: FinalStateScore, rightScore: FinalStateScore): number {

    if (leftScore.isWhole !== rightScore.isWhole) {
        return leftScore.isWhole ? -1 : 1;
    }
    if (leftScore.leftoverCount !== rightScore.leftoverCount) {
        return leftScore.leftoverCount - rightScore.leftoverCount;
    }
    if (leftScore.topLevelGroupCount !== rightScore.topLevelGroupCount) {
        return leftScore.topLevelGroupCount - rightScore.topLevelGroupCount;
    }
    if (leftScore.subRegularGroupCount !== rightScore.subRegularGroupCount) {
        return leftScore.subRegularGroupCount - rightScore.subRegularGroupCount;
    }
    if (leftScore.totalRegularityDistance !== rightScore.totalRegularityDistance) {
        return leftScore.totalRegularityDistance - rightScore.totalRegularityDistance;
    }
    if (leftScore.highestTier !== rightScore.highestTier) {
        return rightScore.highestTier - leftScore.highestTier;
    }
    if (leftScore.highestTierGroupCount !== rightScore.highestTierGroupCount) {
        return rightScore.highestTierGroupCount - leftScore.highestTierGroupCount;
    }
    if (leftScore.isWhole && rightScore.isWhole && leftScore.totalPriority !== rightScore.totalPriority) {
        return rightScore.totalPriority - leftScore.totalPriority;
    }

    return 0;
}

function materializeResolvedState(state: ResolvedState): GroupSizeResult[] {
    return attachLeftoverUnits(
        normalizeTopLevelGroups(materializeCanonicalGroupPoolState(state.canonicalState)),
        state.leftoverUnits,
        state.leftoverUnitAllocations,
    );
}

function pickBestResolvedState(
    states: readonly ResolvedState[],
    context: ResolveContext,
): ResolvedState {
    let best = states[0];

    if (!best) {
        return {
            canonicalState: createCanonicalGroupPoolStateFromRecords([]),
            leftoverUnits: [],
            leftoverUnitAllocations: [],
        };
    }

    for (const candidate of states.slice(1)) {
        if (compareResolvedState(candidate, best, context) < 0) {
            best = candidate;
        }
    }

    return best;
}

function getMinimumChildTierForRule(rule: OrgComposedCountRule | OrgComposedPatternRule, context: ResolveContext): number {
    return context.minimumChildTierByRule.get(rule) ?? getMinimumChildTierForComposedRule(rule, context.definition);
}

function getMinimumPresentChildTierForRule(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
): number | null {
    const matchingTiers = groupFacts
        .filter((facts) => rule.childRoles.some((role) => groupMatchesChildRole(facts, role)))
        .map((facts) => facts.tier);

    return matchingTiers.length > 0 ? Math.min(...matchingTiers) : null;
}

function planComposedRuleInternal(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
    context?: ResolveContext,
): AbstractCompositionPlanResult {
    return rule.kind === 'composed-count'
        ? planComposedCountRuleInternal(rule, groupFacts, registry, guard, allowedModifierKeys, context?.negativeComposedPlanKeys)
        : planComposedPatternRuleInternal(rule, groupFacts, registry, guard, allowedModifierKeys, context?.negativeComposedPlanKeys);
}

function buildPlannedPromotionResult(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    plan: AbstractCompositionPlanResult,
    recordByGroupFactId: ReadonlyMap<number, PlannedGroupRecord>,
): { readonly usedChildren: ReadonlySet<number>; readonly producedGroups: readonly PlannedGroupRecord[] } | null {
    if (plan.candidates.length === 0) {
        return null;
    }

    const plannedCandidates = resolvePlannedCompositionCandidates(plan.candidates, plan.groupsByEntryId, recordByGroupFactId);
    const usedChildren = new Set(plannedCandidates.flatMap((candidate) => candidate.groups.map((group) => group.recordId)));
    const producedGroups = plannedCandidates.map((candidate) => createAbstractComposedGroupRecord(
        rule,
        candidate.modifierStep,
        candidate.groups,
    ));

    return { usedChildren, producedGroups };
}

function getCurrentStructuralCountFacts(
    facts: Pick<GroupFacts, 'modifierKey' | 'directChildCount'>,
    descriptor: RuleModifierDescriptor,
): number {
    const step = descriptor.stepsAscending.find((candidate) => candidate.modifierKey === facts.modifierKey);
    const impliedCount = step?.count ?? descriptor.regularStep.count;
    return Math.max(impliedCount, facts.directChildCount);
}

function getEligibleChildFacts(
    parent: Pick<GroupFacts, 'tier'>,
    rule: OrgComposedCountRule,
    candidateFacts: readonly GroupFacts[],
    context: ResolveContext,
): GroupFacts[] {
    return candidateFacts.filter((facts) =>
        !isBlockedSubRegularPromotionChildFacts(facts, context)
        && facts.tier < parent.tier
        && rule.childRoles.some((role) => groupMatchesChildRole(facts, role)),
    );
}

function isSingleBucketMatch(
    groups: readonly GroupFacts[],
    bucketBy: OrgGroupBucketName | undefined,
    registry: OrgRuleRegistry,
): boolean {
    if (!bucketBy || groups.length <= 1) {
        return true;
    }

    const bucketValues = new Set(groups.map((group) => getGroupBucketValue(bucketBy, group, registry)));
    return bucketValues.size === 1;
}

function resolveWholeComposedCandidateRecord(
    state: CanonicalGroupPoolState,
    context: ResolveContext,
    guard: SolverGuard,
): PlannedGroupRecord | null {
    if (state.groups.length === 0) {
        return null;
    }

    if (state.groupFacts.some((facts) => isBlockedSubRegularPromotionChildFacts(facts, context))) {
        return null;
    }

    const registry = context.definition.registry;
    let best: PlannedGroupRecord | null = null;

    for (const rule of getOrderedComposedRules(context)) {
        const configs = rule.kind === 'composed-count'
            ? buildCompositionConfigs(rule)
            : [buildPatternCompositionConfig(rule)];
        for (const config of configs) {
            if (shouldAbortSearch(guard)) {
                return best;
            }
            if (!isSingleBucketMatch(state.groupFacts, config.childMatchBucketBy, registry)) {
                continue;
            }
            if (!canAssignGroupsToRoles(state.groupFacts, config.childRoles, guard)) {
                continue;
            }
            if (rule.kind === 'composed-pattern' && !matchesComposedPatternSelection(rule, state.groupFacts)) {
                continue;
            }

            for (const step of config.modifierDescriptor.stepsDescending) {
                if (step.count !== state.groups.length || step.relativeBand === 'sub-regular') {
                    continue;
                }
                const candidate = createAbstractComposedGroupRecord(rule, step, state.groups);
                if (!best || compareGroupFactsScore(candidate.facts, best.facts) < 0) {
                    best = candidate;
                }
            }
        }
    }

    return best;
}

function resolveWholeComposedCandidateState(
    state: CanonicalGroupPoolState,
    context: ResolveContext,
    guard: SolverGuard,
): CanonicalGroupPoolState | null {
    const record = resolveWholeComposedCandidateRecord(state, context, guard);
    return record ? createCanonicalGroupPoolStateFromRecords([record]) : null;
}

function canRepairSubRegularGroupForPromotionFacts(
    facts: Pick<GroupFacts, 'provenance' | 'type' | 'modifierKey' | 'directChildCount'>,
    context: ResolveContext,
    rule: OrgComposedCountRule,
): boolean {
    if (!rule.requireRegularForPromotion
        || facts.provenance !== 'input-group'
        || facts.type !== rule.type
        || facts.directChildCount <= 0) {
        return false;
    }

    return isSubRegularModifierKey(getRuleStageMetadata(context, rule), facts.modifierKey);
}

function copyReadonlyNestedCountMap<Key extends string>(
    source: ReadonlyMap<Key, ReadonlyMap<OrgBucketValue, number>>,
): Map<Key, Map<OrgBucketValue, number>> {
    const result = new Map<Key, Map<OrgBucketValue, number>>();

    for (const [key, nested] of source.entries()) {
        result.set(key, new Map(nested.entries()));
    }

    return result;
}

function incrementMutableCountMap<Key extends string>(
    target: Map<Key, number>,
    source: ReadonlyMap<Key, number>,
): void {
    for (const [key, count] of source.entries()) {
        target.set(key, (target.get(key) ?? 0) + count);
    }
}

function incrementMutableNestedCountMap<Key extends string>(
    target: Map<Key, Map<OrgBucketValue, number>>,
    source: ReadonlyMap<Key, ReadonlyMap<OrgBucketValue, number>>,
): void {
    for (const [bucketName, nested] of source.entries()) {
        let merged = target.get(bucketName);
        if (!merged) {
            merged = new Map<OrgBucketValue, number>();
            target.set(bucketName, merged);
        }

        for (const [bucketValue, count] of nested.entries()) {
            merged.set(bucketValue, (merged.get(bucketValue) ?? 0) + count);
        }
    }
}

function createUpdatedParentRecord(
    parentRecord: PlannedGroupRecord,
    rule: OrgComposedCountRule,
    modifierStep: ModifierStep,
    addedChildren: readonly PlannedGroupRecord[],
): PlannedGroupRecord {
    const baseFacts = parentRecord.facts;
    const childTypeCounts = copyReadonlyCountMap(baseFacts.childTypeCounts);
    const unitTypeCounts = copyReadonlyCountMap(baseFacts.unitTypeCounts);
    const unitClassCounts = copyReadonlyCountMap(baseFacts.unitClassCounts);
    const unitTagCounts = copyReadonlyCountMap(baseFacts.unitTagCounts);
    const unitScalarSums = copyReadonlyCountMap(baseFacts.unitScalarSums);
    const descendantUnitBucketCounts = copyReadonlyNestedCountMap(baseFacts.descendantUnitBucketCounts);

    for (const childRecord of addedChildren) {
        const child = childRecord.facts;
        const childTypeKey = child.type ?? 'null';
        childTypeCounts.set(childTypeKey, (childTypeCounts.get(childTypeKey) ?? 0) + 1);
        if (child.countsAsType) {
            const countsAsKey = `countsAs:${child.countsAsType}` as OrgChildTypeCountKey;
            childTypeCounts.set(countsAsKey, (childTypeCounts.get(countsAsKey) ?? 0) + 1);
        }
        if (child.tag) {
            const tagKey = `tag:${child.tag}` as OrgChildTypeCountKey;
            childTypeCounts.set(tagKey, (childTypeCounts.get(tagKey) ?? 0) + 1);
        }

        incrementMutableCountMap(unitTypeCounts, child.unitTypeCounts);
        incrementMutableCountMap(unitClassCounts, child.unitClassCounts);
        incrementMutableCountMap(unitTagCounts, child.unitTagCounts);
        incrementMutableCountMap(unitScalarSums, child.unitScalarSums);
        incrementMutableNestedCountMap(descendantUnitBucketCounts, child.descendantUnitBucketCounts);
    }

    const facts: GroupFacts = {
        ...baseFacts,
        group: createAbstractProducedGroupTemplate(rule, modifierStep),
        modifierKey: modifierStep.modifierKey,
        tier: modifierStep.tier,
        directChildCount: baseFacts.directChildCount + addedChildren.length,
        childTypeCounts,
        unitTypeCounts,
        unitClassCounts,
        unitTagCounts,
        unitScalarSums,
        descendantUnitBucketCounts,
    };

    const updatedRecord: PlannedGroupRecord = {
        recordId: parentRecord.recordId,
        facts,
        materialize: () => {
            if (!updatedRecord.materializedGroup) {
                const baseGroup = parentRecord.materialize();
                updatedRecord.materializedGroup = {
                    ...baseGroup,
                    name: makeGroupName(getRuleDisplayName(rule), modifierStep.modifierKey),
                    displayName: rule.displayName,
                    modifierKey: modifierStep.modifierKey,
                    tier: modifierStep.tier,
                    children: [
                        ...(baseGroup.children ?? []),
                        ...addedChildren.map((child) => child.materialize()),
                    ],
                };
            }

            return updatedRecord.materializedGroup;
        },
    };

    return updatedRecord;
}

function repairSubRegularGroupsForPromotionState(
    initialState: CanonicalGroupPoolState,
    context: ResolveContext,
): CanonicalGroupPoolState {
    let state = initialState;

    for (const rule of context.composedCountRules) {
        if (!rule.requireRegularForPromotion) {
            continue;
        }

        const candidates = state.groupFacts.filter((facts) => canRepairSubRegularGroupForPromotionFacts(facts, context, rule));
        if (candidates.length === 0) {
            continue;
        }

        const flattenedChildren = candidates.flatMap((facts) => facts.group.children ?? []);
        const childState = createCanonicalGroupPoolStateFromRecords(
            flattenedChildren.map((group) => createConcretePlannedGroupRecord(group)),
        );
        const abstractCandidates = planComposedCountRuleInternal(
            rule,
            childState.groupFacts,
            context.definition.registry,
            createSolverGuard(),
            undefined,
            context.negativeComposedPlanKeys,
        );
        if (abstractCandidates.candidates.length === 0) {
            continue;
        }

        const plannedCandidates = resolvePlannedCompositionCandidates(
            abstractCandidates.candidates,
            abstractCandidates.groupsByEntryId,
            childState.recordByGroupFactId,
        );
        const repackagedRecords = plannedCandidates.map((candidate) => createAbstractComposedGroupRecord(
            rule,
            candidate.modifierStep,
            candidate.groups,
        ));

        const candidateFactIds = new Set(candidates.map((facts) => facts.groupFactId));
        state = createCanonicalGroupPoolStateFromRecords([
            ...state.groups.filter((group) => !candidateFactIds.has(group.facts.groupFactId)),
            ...repackagedRecords,
        ]);
    }

    return state;
}

function getCanonicalGroupPoolSignatureEntries(signatureCounts: ReadonlyMap<string, number>): CanonicalGroupPoolSignatureEntry[] {
    return [...signatureCounts.entries()]
        .filter(([, count]) => count > 0)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => ({ key, count }));
}

function createCanonicalGroupPoolSignature(
    signatureCounts: ReadonlyMap<string, number>,
): CanonicalGroupPoolSignature {
    const entries = getCanonicalGroupPoolSignatureEntries(signatureCounts);

    return {
        entries,
        counts: new Map(entries.map((entry) => [entry.key, entry.count])),
        key: entries.map((entry) => `${entry.key}::${entry.count}`).join('###'),
    };
}

function createCanonicalGroupPoolStateFromRecords(
    groups: readonly PlannedGroupRecord[],
    signatureCounts?: ReadonlyMap<string, number>,
): CanonicalGroupPoolState {
    const groupFacts = groups.map((group) => group.facts);
    const counts = new Map<string, number>();

    if (signatureCounts) {
        for (const [key, count] of signatureCounts.entries()) {
            if (count > 0) {
                counts.set(key, count);
            }
        }
    } else {
        for (const facts of groupFacts) {
            const key = getGroupFactsSignatureKey(facts);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }

    return {
        groups,
        groupFacts,
        recordByGroupFactId: new Map(groups.map((group) => [group.facts.groupFactId, group])),
        signature: createCanonicalGroupPoolSignature(counts),
    };
}

function materializeCanonicalGroupPoolState(state: CanonicalGroupPoolState): GroupSizeResult[] {
    return state.groups.map((group) => group.materialize());
}

function decrementSignatureCount(
    counts: Map<string, number>,
    key: string,
): void {
    const nextValue = (counts.get(key) ?? 0) - 1;
    if (nextValue > 0) {
        counts.set(key, nextValue);
        return;
    }

    counts.delete(key);
}

function incrementSignatureCount(
    counts: Map<string, number>,
    key: string,
): void {
    counts.set(key, (counts.get(key) ?? 0) + 1);
}

function createSuccessorCanonicalGroupPoolState(
    state: CanonicalGroupPoolState,
    producedGroups: readonly PlannedGroupRecord[],
    usedChildren: ReadonlySet<number>,
): CanonicalGroupPoolState {
    const remainingGroups = state.groups.filter((group) => !usedChildren.has(group.recordId));
    const producedFacts = producedGroups.map((group) => group.facts);
    const nextCounts = new Map(state.signature.counts);

    for (const facts of state.groupFacts) {
        if (usedChildren.has(facts.groupFactId)) {
            decrementSignatureCount(nextCounts, getGroupFactsSignatureKey(facts));
        }
    }

    for (const facts of producedFacts) {
        incrementSignatureCount(nextCounts, getGroupFactsSignatureKey(facts));
    }

    return createCanonicalGroupPoolStateFromRecords(
        [...remainingGroups, ...producedGroups],
        nextCounts,
    );
}

function getApplicableComposedRulesForFacts(
    groupFacts: readonly GroupFacts[],
    context: ResolveContext,
): readonly (OrgComposedCountRule | OrgComposedPatternRule)[] {
    if (groupFacts.length === 0) {
        return [];
    }

    return getOrderedComposedRules(context).filter((rule) => {
        if (getMinimumPresentChildTierForRule(rule, groupFacts) === null) {
            return false;
        }

        const requiredCount = getRuleStageMetadata(context, rule).descriptor.regularStep.count;
        let matchingCount = 0;
        for (const facts of groupFacts) {
            if (rule.childRoles.some((role) => groupMatchesChildRole(facts, role))) {
                matchingCount += 1;
                if (matchingCount >= requiredCount) {
                    return true;
                }
            }
        }

        return false;
    });
}

function retainDominantCanonicalGroupPoolStates(
    states: readonly CanonicalGroupPoolState[],
    context: ResolveContext,
): CanonicalGroupPoolState[] {
    if (states.length <= 1) {
        return [...states];
    }

    const bestByKey = new Map<string, CanonicalGroupPoolState>();
    const scoreByKey = new Map<string, FinalStateScore>();

    for (const state of states) {
        const key = state.signature.key;
        const existing = bestByKey.get(key);
        if (!existing) {
            bestByKey.set(key, state);
            scoreByKey.set(key, scoreCanonicalGroupPoolState(state, context));
            continue;
        }

        const candidateScore = scoreCanonicalGroupPoolState(state, context);
        const existingScore = scoreByKey.get(key) ?? scoreCanonicalGroupPoolState(existing, context);
        if (compareFinalStateScores(candidateScore, existingScore) < 0) {
            bestByKey.set(state.signature.key, state);
            scoreByKey.set(key, candidateScore);
        }
    }

    return [...bestByKey.values()];
}

function getRegularPromotionSuccessors(
    state: CanonicalGroupPoolState,
    context: ResolveContext,
    guard: SolverGuard,
): CanonicalGroupPoolState[] {
    const promotableFacts = state.groupFacts.filter((facts) => !isBlockedSubRegularPromotionChildFacts(facts, context));
    const applicableRules = getApplicableComposedRulesForFacts(promotableFacts, context);
    const successors: CanonicalGroupPoolState[] = [];

    for (const rule of applicableRules) {
        if (shouldAbortSearch(guard)) {
            break;
        }

        const allowedModifierKeys = getAllowedModifierKeysForStage(getRuleStageMetadata(context, rule), 'regular');
        const plannedResult = buildPlannedPromotionResult(
            rule,
            planComposedRuleInternal(rule, promotableFacts, context.definition.registry, guard, allowedModifierKeys, context),
            state.recordByGroupFactId,
        );
        if (!plannedResult) {
            continue;
        }

        successors.push(createSuccessorCanonicalGroupPoolState(state, plannedResult.producedGroups, plannedResult.usedChildren));
    }

    return retainDominantCanonicalGroupPoolStates(successors, context);
}

function runSingleTierRegularPromotionStepState(
    initialState: CanonicalGroupPoolState,
    context: ResolveContext,
    guard: SolverGuard,
): CanonicalGroupPoolState {
    let poolState = initialState;
    let remainingFacts = poolState.groupFacts.filter((facts) => !isBlockedSubRegularPromotionChildFacts(facts, context));
    const applicableRules = getApplicableComposedRulesForFacts(remainingFacts, context);
    const candidateChildTiers = applicableRules
        .map((rule) => getMinimumPresentChildTierForRule(rule, remainingFacts))
        .filter((tier): tier is number => tier !== null);
    const targetChildTier = candidateChildTiers.length > 0 ? Math.min(...candidateChildTiers) : null;

    if (targetChildTier === null) {
        return initialState;
    }

    for (const rule of applicableRules) {
        if (getMinimumPresentChildTierForRule(rule, remainingFacts) !== targetChildTier) {
            continue;
        }

        const allowedModifierKeys = getAllowedModifierKeysForStage(getRuleStageMetadata(context, rule), 'regular');
        const plannedResult = buildPlannedPromotionResult(
            rule,
            planComposedRuleInternal(rule, remainingFacts, context.definition.registry, guard, allowedModifierKeys, context),
            poolState.recordByGroupFactId,
        );
        if (!plannedResult) {
            continue;
        }

        poolState = createSuccessorCanonicalGroupPoolState(poolState, plannedResult.producedGroups, plannedResult.usedChildren);
        remainingFacts = remainingFacts.filter((facts) => !plannedResult.usedChildren.has(facts.groupFactId));
    }

    return poolState;
}

function searchBestRegularPromotionPoolStateFromState(
    initialState: CanonicalGroupPoolState,
    context: ResolveContext,
    guard: SolverGuard,
): CanonicalGroupPoolState {
    const metrics = orgSolveMetrics.active;
    const cachedResult = context.exactRegularPromotionResultBySignature.get(initialState.signature.key);
    if (cachedResult) {
        if (metrics) {
            metrics.regularPromotionResultCacheHits += 1;
        }
        return cachedResult;
    }

    if (metrics) {
        metrics.regularPromotionResultCacheMisses += 1;
        metrics.regularPromotionSearches += 1;
    }

    function finalize(result: CanonicalGroupPoolState): CanonicalGroupPoolState {
        if (!guard.timedOut) {
            context.exactRegularPromotionResultBySignature.set(initialState.signature.key, result);
        }
        return result;
    }

    const memo = new Map<string, CanonicalPromotionFuture>();
    const successorsBySignature = new Map<string, readonly CanonicalGroupPoolState[]>();
    const stateBySignature = new Map<string, CanonicalGroupPoolState>([[initialState.signature.key, initialState]]);

    function getCachedSuccessors(state: CanonicalGroupPoolState): readonly CanonicalGroupPoolState[] {
        const cached = successorsBySignature.get(state.signature.key);
        if (cached) {
            if (metrics) {
                metrics.regularPromotionSuccessorCacheHits += 1;
            }
            return cached;
        }

        if (metrics) {
            metrics.regularPromotionSuccessorCacheMisses += 1;
        }
        const successors = getRegularPromotionSuccessors(state, context, guard);
        if (metrics) {
            metrics.regularPromotionSuccessorStates += successors.length;
        }
        successors.forEach((successor) => stateBySignature.set(successor.signature.key, successor));
        successorsBySignature.set(state.signature.key, successors);
        return successors;
    }

    function visit(state: CanonicalGroupPoolState): CanonicalPromotionFuture {
        const cached = memo.get(state.signature.key);
        if (cached) {
            if (metrics) {
                metrics.regularPromotionMemoHits += 1;
            }
            return cached;
        }

        if (metrics) {
            metrics.regularPromotionMemoMisses += 1;
        }

        let bestFuture: CanonicalPromotionFuture = {
            finalScore: scoreCanonicalGroupPoolState(state, context),
        };

        for (const successor of getCachedSuccessors(state)) {
            if (shouldAbortSearch(guard)) {
                break;
            }

            const candidate = visit(successor);
            if (compareFinalStateScores(candidate.finalScore, bestFuture.finalScore) < 0) {
                bestFuture = {
                    finalScore: candidate.finalScore,
                    nextSignatureKey: successor.signature.key,
                };
            }
        }

        memo.set(state.signature.key, bestFuture);
        return bestFuture;
    }

    const resolvedResultBySignature = new Map<string, CanonicalGroupPoolState>();

    function resolveExactResultForState(state: CanonicalGroupPoolState): CanonicalGroupPoolState {
        const cached = resolvedResultBySignature.get(state.signature.key);
        if (cached) {
            return cached;
        }

        const future = memo.get(state.signature.key);
        if (!future?.nextSignatureKey) {
            resolvedResultBySignature.set(state.signature.key, state);
            return state;
        }

        const nextState = stateBySignature.get(future.nextSignatureKey)
            ?? getCachedSuccessors(state).find((candidate) => candidate.signature.key === future.nextSignatureKey);
        if (!nextState) {
            resolvedResultBySignature.set(state.signature.key, state);
            return state;
        }

        const result = resolveExactResultForState(nextState);
        resolvedResultBySignature.set(state.signature.key, result);
        return result;
    }

    visit(initialState);

    if (!guard.timedOut) {
        for (const state of stateBySignature.values()) {
            context.exactRegularPromotionResultBySignature.set(state.signature.key, resolveExactResultForState(state));
        }
    }

    let currentState = initialState;
    let safety = 0;

    while (safety < MAX_PROMOTION_LOOP_ITERATIONS * 4) {
        safety += 1;
        const future = memo.get(currentState.signature.key);
        if (!future?.nextSignatureKey) {
            return finalize(currentState);
        }

        const nextState = getCachedSuccessors(currentState)
            .find((candidate) => candidate.signature.key === future.nextSignatureKey);
        if (!nextState) {
            return finalize(currentState);
        }

        currentState = nextState;
    }

    return finalize(currentState);
}

function runLeftoverImprovementLoopState(
    initialState: CanonicalGroupPoolState,
    context: ResolveContext,
    guard: SolverGuard,
): CanonicalGroupPoolState {
    let state = initialState;
    let previousSignature = '';
    let iteration = 0;

    while (iteration < MAX_PROMOTION_LOOP_ITERATIONS && !shouldAbortSearch(guard)) {
        iteration += 1;
        const signature = state.signature.key;
        if (signature === previousSignature) {
            break;
        }
        previousSignature = signature;

        const stepped = runSingleTierRegularPromotionStepState(state, context, guard);
        const assimilated = assimilateLeftoversIntoParentState(stepped, context, guard);
        const cachedExactResult = context.exactRegularPromotionResultBySignature.get(assimilated.signature.key);
        const isAlreadyPromotionOptimal = cachedExactResult?.signature.key === assimilated.signature.key;
        const promoted = isAlreadyPromotionOptimal
            ? assimilated
            : searchBestRegularPromotionPoolStateFromState(assimilated, context, guard);
        const subRegularized = materializeComposedRulesByStageState(promoted, context, 'sub-regular', guard);

        if (subRegularized.signature.key === promoted.signature.key) {
            state = promoted;
            if (state.signature.key === signature) {
                break;
            }
            continue;
        }

        state = searchBestRegularPromotionPoolStateFromState(subRegularized, context, guard);
    }

    return state;
}

function preAssimilateUnderRegularGroupState(
    initialState: CanonicalGroupPoolState,
    context: ResolveContext,
    guard: SolverGuard,
): CanonicalGroupPoolState {
    let state = initialState;
    const ruleByType = new Map(context.composedCountRules.map((rule) => [rule.type, rule]));
    const underRegularGroups = state.groupFacts
        .filter((facts) => {
            const rule = facts.type ? ruleByType.get(facts.type) : undefined;
            if (!rule) {
                return false;
            }
            return facts.modifierKey !== '' && isSubRegularModifierKey(getRuleStageMetadata(context, rule), facts.modifierKey);
        })
        .sort((left, right) => {
            const leftRule = left.type ? ruleByType.get(left.type) : undefined;
            const rightRule = right.type ? ruleByType.get(right.type) : undefined;
            const leftChildTier = leftRule ? getMinimumChildTierForRule(leftRule, context) : left.tier;
            const rightChildTier = rightRule ? getMinimumChildTierForRule(rightRule, context) : right.tier;

            if (leftChildTier !== rightChildTier) {
                return leftChildTier - rightChildTier;
            }
            return left.tier - right.tier;
        });

    for (const currentGroupFacts of underRegularGroups) {
        const rule = currentGroupFacts.type ? ruleByType.get(currentGroupFacts.type) : undefined;
        if (!rule) {
            continue;
        }
        const nextCurrentGroupFacts = state.groupFacts.find((facts) => facts.groupFactId === currentGroupFacts.groupFactId);
        if (!nextCurrentGroupFacts) {
            continue;
        }
        const currentRecord = state.recordByGroupFactId.get(nextCurrentGroupFacts.groupFactId);
        if (!currentRecord) {
            continue;
        }
        const descriptor = getRuleStageMetadata(context, rule).descriptor;
        const currentStep = descriptor.stepsAscending.find((step) => step.modifierKey === nextCurrentGroupFacts.modifierKey);
        if (!currentStep) {
            continue;
        }
        const currentCount = getCurrentStructuralCountFacts(nextCurrentGroupFacts, descriptor);
        const needed = descriptor.regularStep.count - currentCount;
        if (needed <= 0) {
            continue;
        }

        const remainingFacts = state.groupFacts.filter((facts) => facts.groupFactId !== nextCurrentGroupFacts.groupFactId);
        const roleMatches = getEligibleChildFacts(currentRecord.facts, rule, remainingFacts, context);
        const addition = findAbstractCompositionSelection(roleMatches, rule.childRoles, needed, guard);
        if (!addition) {
            continue;
        }

        const additionFactIds = new Set(addition.map((facts) => facts.groupFactId));
        const addedChildren = addition
            .map((facts) => state.recordByGroupFactId.get(facts.groupFactId))
            .filter((record): record is PlannedGroupRecord => !!record);
        const updatedRecord = createUpdatedParentRecord(currentRecord, rule, descriptor.regularStep, addedChildren);
        state = createCanonicalGroupPoolStateFromRecords([
            ...state.groups.filter((group) => group.recordId !== currentRecord.recordId && !additionFactIds.has(group.facts.groupFactId)),
            updatedRecord,
        ]);
    }

    return state;
}

function assimilateLeftoversIntoParentState(
    initialState: CanonicalGroupPoolState,
    context: ResolveContext,
    guard: SolverGuard,
): CanonicalGroupPoolState {
    let state = initialState;
    const ruleByType = new Map(context.composedCountRules.map((rule) => [rule.type, rule]));
    const sortedParents = state.groupFacts
        .filter((facts) => facts.type !== null && ruleByType.has(facts.type))
        .sort((left, right) => {
            const leftRule = left.type ? ruleByType.get(left.type) : undefined;
            const rightRule = right.type ? ruleByType.get(right.type) : undefined;
            const leftChildTier = leftRule ? getMinimumChildTierForRule(leftRule, context) : left.tier;
            const rightChildTier = rightRule ? getMinimumChildTierForRule(rightRule, context) : right.tier;

            if (leftChildTier !== rightChildTier) {
                return leftChildTier - rightChildTier;
            }
            return left.tier - right.tier;
        });

    for (const currentParentFacts of sortedParents) {
        const rule = currentParentFacts.type ? ruleByType.get(currentParentFacts.type) : undefined;
        if (!rule) {
            continue;
        }
        const nextCurrentParentFacts = state.groupFacts.find((facts) => facts.groupFactId === currentParentFacts.groupFactId);
        if (!nextCurrentParentFacts) {
            continue;
        }
        const currentRecord = state.recordByGroupFactId.get(nextCurrentParentFacts.groupFactId);
        if (!currentRecord) {
            continue;
        }
        const descriptor = getRuleStageMetadata(context, rule).descriptor;
        const currentStep = descriptor.stepsAscending.find((step) => step.modifierKey === nextCurrentParentFacts.modifierKey) ?? descriptor.regularStep;
        const nextSteps = descriptor.stepsAscending.filter((step) => step.count > currentStep.count);
        if (nextSteps.length === 0) {
            continue;
        }

        const availableFacts = state.groupFacts.filter((facts) => facts.groupFactId !== nextCurrentParentFacts.groupFactId);
        const matchingFacts = getEligibleChildFacts(currentRecord.facts, rule, availableFacts, context);

        let upgradedRecord = currentRecord;
        const usedGroupFactIds = new Set<number>();
        let currentCount = getCurrentStructuralCountFacts(nextCurrentParentFacts, descriptor);
        for (const targetStep of nextSteps) {
            const needed = targetStep.count - currentCount;
            if (needed <= 0) {
                upgradedRecord = createUpdatedParentRecord(upgradedRecord, rule, targetStep, []);
                currentCount = Math.max(currentCount, targetStep.count);
                continue;
            }
            const selection = findAbstractCompositionSelection(
                matchingFacts.filter((facts) => !usedGroupFactIds.has(facts.groupFactId)),
                rule.childRoles,
                needed,
                guard,
            );
            if (!selection) {
                break;
            }
            selection.forEach((facts) => usedGroupFactIds.add(facts.groupFactId));
            const additionRecords = selection
                .map((facts) => state.recordByGroupFactId.get(facts.groupFactId))
                .filter((record): record is PlannedGroupRecord => !!record);
            currentCount += additionRecords.length;
            upgradedRecord = createUpdatedParentRecord(upgradedRecord, rule, targetStep, additionRecords);
            break;
        }

        if (usedGroupFactIds.size > 0 || upgradedRecord !== currentRecord) {
            state = createCanonicalGroupPoolStateFromRecords([
                ...state.groups.filter((group) => group.recordId !== currentRecord.recordId && !usedGroupFactIds.has(group.facts.groupFactId)),
                upgradedRecord,
            ]);
        }
    }

    return state;
}

function normalizeTopLevelGroups(groups: readonly GroupSizeResult[]): GroupSizeResult[] {
    return [...groups].sort(compareGroupScore);
}

function collectAllGroupUnits(group: GroupSizeResult): OrgUnit[] {
    const result: OrgUnit[] = [];

    if (group.units) {
        result.push(...group.units);
    }
    if (group.leftoverUnits) {
        result.push(...group.leftoverUnits);
    }
    if (group.children) {
        for (const child of group.children) {
            result.push(...collectAllGroupUnits(child));
        }
    }

    return result;
}

function isNativeGroupForContext(group: GroupSizeResult, context: ResolveContext): boolean {
    return (group.type !== null && context.knownGroupTypes.has(group.type))
        || (group.countsAsType !== null && context.knownGroupTypes.has(group.countsAsType));
}

function isStableSingleGroupResolveResult(group: GroupSizeResult, context: ResolveContext): boolean {
    return group.type !== null
        && group.type !== 'Force'
        && isNativeGroupForContext(group, context)
        && !group.leftoverUnits
        && !group.leftoverUnitAllocations;
}

function isStableNativeRegularGroupInput(group: GroupSizeResult, context: ResolveContext): boolean {
    return isStableSingleGroupResolveResult(group, context)
        && group.provenance === 'input-group'
        && group.modifierKey === '';
}

function isTransparentForeignTypedGroup(group: GroupSizeResult, context: ResolveContext): boolean {
    return !CROSSGRADE_FOREIGN_GROUPS
        && group.type !== null
        && group.type !== 'Force'
        && !isNativeGroupForContext(group, context);
}

function finalizeResolvedCandidates(
    candidateStates: readonly ResolvedState[],
    regularPoolState: CanonicalGroupPoolState,
    context: ResolveContext,
    metrics: MutableOrgSolveMetrics,
    solveStartedAtMs: number,
    guard: SolverGuard,
): GroupSizeResult[] {
    let phaseStartedAtMs = getSolveTimestampMs();
    const wholeComposedState = resolveWholeComposedCandidateState(regularPoolState, context, createSolverGuard());
    addMetricDuration(metrics, 'wholeComposedMs', phaseStartedAtMs);

    const allResolvedStates = [...candidateStates];
    const primaryState = allResolvedStates[0];
    if (wholeComposedState && primaryState && primaryState.leftoverUnits.length === 0 && primaryState.leftoverUnitAllocations.length === 0) {
        allResolvedStates.push({ canonicalState: wholeComposedState, leftoverUnits: [], leftoverUnitAllocations: [] });
    }

    const bestState = pickBestResolvedState(allResolvedStates, context);

    phaseStartedAtMs = getSolveTimestampMs();
    const materialized = materializeResolvedState(bestState);
    addMetricDuration(metrics, 'finalMaterializationMs', phaseStartedAtMs);

    if (orgSolveMetrics.active) {
        orgSolveMetrics.active.timedOut = guard.timedOut;
    }
    addMetricDuration(metrics, 'totalSolveMs', solveStartedAtMs);
    orgSolveMetrics.last = snapshotOrgSolveMetrics(orgSolveMetrics.active);
    orgSolveMetrics.active = null;

    return materialized;
}

function createSyntheticGroupForRule(
    rule: OrgLeafCountRule | OrgLeafPatternRule | OrgComposedCountRule,
    modifierStep: ModifierStep,
): GroupSizeResult {
    return {
        name: makeGroupName(getRuleDisplayName(rule), modifierStep.modifierKey),
        type: rule.type,
        displayName: rule.displayName,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        tag: rule.tag,
        priority: rule.priority,
    };
}

function markGroupsWithProvenance(
    groups: readonly GroupSizeResult[],
    provenance: OrgGroupProvenance,
): GroupSizeResult[] {
    return groups.map((group) => ({
        ...group,
        provenance,
    }));
}

function getCrossgradeCandidates(
    context: ResolveContext,
): Array<{ rule: OrgLeafCountRule | OrgLeafPatternRule | OrgComposedCountRule; step: ModifierStep }> {
    const candidateRules = context.composedCountRules.length > 0
        ? context.composedCountRules
        : context.definition.rules.filter((rule): rule is OrgLeafCountRule | OrgLeafPatternRule | OrgComposedCountRule =>
            rule.kind === 'leaf-count' || rule.kind === 'leaf-pattern' || rule.kind === 'composed-count',
        );

    return candidateRules.flatMap((rule) =>
        getRuleStageMetadata(context, rule).descriptor.stepsAscending.map((step) => ({ rule, step })),
    );
}

function crossgradeTierOnlyForeignGroup(
    group: GroupSizeResult,
    context: ResolveContext,
): GroupSizeResult[] {
    const candidates = getCrossgradeCandidates(context);
    if (candidates.length === 0) {
        return [group];
    }

    const highestTier = Math.max(...candidates.map((candidate) => candidate.step.tier));
    if (group.tier - highestTier > 0.0001) {
        const highestCandidates = candidates.filter((candidate) => Math.abs(candidate.step.tier - highestTier) < 0.0001);
        const chosen = highestCandidates
            .map((candidate) => createSyntheticGroupForRule(candidate.rule, candidate.step))
            .sort(compareGroupScore)[0];

        if (!chosen) {
            return [group];
        }

        const repeatCount = getRepeatCountForTierDelta(group.tier, chosen.tier);
        return Array.from({ length: repeatCount }, () => ({ ...chosen }));
    }

    const chosen = candidates
        .sort((left, right) => {
            const leftDistance = Math.abs(left.step.tier - group.tier);
            const rightDistance = Math.abs(right.step.tier - group.tier);

            if (leftDistance !== rightDistance) {
                return leftDistance - rightDistance;
            }

            if (left.rule.tier !== right.rule.tier) {
                return right.rule.tier - left.rule.tier;
            }

            return compareGroupScore(
                createSyntheticGroupForRule(left.rule, left.step),
                createSyntheticGroupForRule(right.rule, right.step),
            );
        })[0];

    return chosen ? [createSyntheticGroupForRule(chosen.rule, chosen.step)] : [group];
}

function applyForeignDisplayName(
    groups: readonly GroupSizeResult[],
    foreignDisplayName?: string,
): GroupSizeResult[] {
    if (!foreignDisplayName) {
        return [...groups];
    }

    return groups.map((group) => ({
        ...group,
        foreignDisplayName,
    }));
}

function preprocessGroupsForDefinition(
    definition: OrgDefinition,
    groupResults: readonly GroupSizeResult[],
): GroupSizeResult[] {
    const context = getResolveContext(definition);
    const normalized: GroupSizeResult[] = [];

    for (const group of groupResults) {
        if (isNativeGroupForContext(group, context)) {
            normalized.push(group);
            continue;
        }

        const foreignDisplayName = group.foreignDisplayName ?? group.name;

        // Concrete foreign org groups should crossgrade as completed parents.
        // Generic wrappers like Force, or type-less foreign buckets, still need
        // descendant-unit re-evaluation under the target definition.
        if (group.type && group.type !== 'Force') {
            if (CROSSGRADE_FOREIGN_GROUPS) {
                normalized.push(...applyForeignDisplayName(crossgradeTierOnlyForeignGroup(group, context), foreignDisplayName));
            } else {
                normalized.push(group);
            }
            continue;
        }

        const descendantUnits = collectAllGroupUnits(group);
        const reevaluatedGroups = resolveWithDefinition(definition, descendantUnits, []);
        if (reevaluatedGroups.length === 0) {
            normalized.push(...applyForeignDisplayName([EMPTY_RESULT], foreignDisplayName));
            continue;
        }

        normalized.push(...applyForeignDisplayName(reevaluatedGroups, foreignDisplayName));
    }

    return normalized;
}

function resolveWithDefinition(
    definition: OrgDefinition,
    units: readonly OrgUnit[],
    groups: readonly GroupSizeResult[],
): GroupSizeResult[] {
    orgSolveMetrics.active = createMutableOrgSolveMetrics();
    orgSolveMetrics.last = null;
    const solveStartedAtMs = getSolveTimestampMs();
    const metrics = orgSolveMetrics.active;

    const context = getResolveContext(definition);
    const guard = createSolverGuard();

    let phaseStartedAtMs = getSolveTimestampMs();
    const compiledUnits = compileUnitFactsList(units);
    addMetricDuration(metrics, 'factCompilationMs', phaseStartedAtMs);

    const wholeLeafRecord = groups.length === 0 ? resolveWholeLeafCandidateRecord(compiledUnits, context) : null;
    const shouldEvaluateExactLeafPartitions = groups.length === 0 && compiledUnits.length <= MAX_EXACT_LEAF_PARTITION_UNITS;
    if (metrics && groups.length === 0 && !shouldEvaluateExactLeafPartitions) {
        metrics.exactLeafPartitionSkipped = true;
    }

    phaseStartedAtMs = getSolveTimestampMs();
    const exactLeafPartitionStates = shouldEvaluateExactLeafPartitions
        ? resolveExactLeafPartitionCandidateStates(compiledUnits, context)
        : [];
    addMetricDuration(metrics, 'exactLeafPartitionMs', phaseStartedAtMs);
    if (metrics) {
        metrics.exactLeafPartitionCandidateStates += exactLeafPartitionStates.length;
    }

    phaseStartedAtMs = getSolveTimestampMs();
    const normalizedInputGroups = normalizeCIFormationGroups(groups, context.ciFormationRules);
    addMetricDuration(metrics, 'inputNormalizationMs', phaseStartedAtMs);

    phaseStartedAtMs = getSolveTimestampMs();
    const regularLeafResult = materializeLeafRulesByStageRecords(compiledUnits, context, 'regular');
    addMetricDuration(metrics, 'regularLeafAllocationMs', phaseStartedAtMs);

    const leftoverUnits = [...regularLeafResult.leftover];
    const leftoverUnitAllocations = [...regularLeafResult.leftoverUnitAllocations];

    let initialPoolState = createCanonicalGroupPoolStateFromRecords([
        ...normalizedInputGroups.map((group) => createConcretePlannedGroupRecord(group)),
        ...regularLeafResult.records,
    ]);
    const canSkipInitialGroupRepair = compiledUnits.length === 0
        && normalizedInputGroups.length > 0
        && normalizedInputGroups.every((group) => isStableNativeRegularGroupInput(group, context));

    if (!canSkipInitialGroupRepair) {
        phaseStartedAtMs = getSolveTimestampMs();
        initialPoolState = repairSubRegularGroupsForPromotionState(initialPoolState, context);
        addMetricDuration(metrics, 'initialRepairMs', phaseStartedAtMs);

        phaseStartedAtMs = getSolveTimestampMs();
        initialPoolState = preAssimilateUnderRegularGroupState(initialPoolState, context, guard);
        addMetricDuration(metrics, 'initialAssimilationMs', phaseStartedAtMs);
    }

    phaseStartedAtMs = getSolveTimestampMs();
    const wholeComposedFromInitialState = resolveWholeComposedCandidateState(initialPoolState, context, createSolverGuard());
    addMetricDuration(metrics, 'wholeComposedMs', phaseStartedAtMs);

    phaseStartedAtMs = getSolveTimestampMs();
    const initialImprovedPoolState = runLeftoverImprovementLoopState(initialPoolState, context, createSolverGuard());
    addMetricDuration(metrics, 'leftoverImprovementMs', phaseStartedAtMs);

    phaseStartedAtMs = getSolveTimestampMs();
    const regularPoolState = searchBestRegularPromotionPoolStateFromState(initialPoolState, context, createSolverGuard());
    addMetricDuration(metrics, 'regularPromotionMs', phaseStartedAtMs);

    phaseStartedAtMs = getSolveTimestampMs();
    const improvedRegularPoolState = runLeftoverImprovementLoopState(regularPoolState, context, createSolverGuard());
    addMetricDuration(metrics, 'leftoverImprovementMs', phaseStartedAtMs);

    const candidateStates: ResolvedState[] = [
        { canonicalState: regularPoolState, leftoverUnits, leftoverUnitAllocations },
        { canonicalState: improvedRegularPoolState, leftoverUnits, leftoverUnitAllocations },
        { canonicalState: initialImprovedPoolState, leftoverUnits, leftoverUnitAllocations },
    ];

    if (wholeComposedFromInitialState && leftoverUnits.length === 0 && leftoverUnitAllocations.length === 0) {
        candidateStates.push({ canonicalState: wholeComposedFromInitialState, leftoverUnits: [], leftoverUnitAllocations: [] });
    }

    if (leftoverUnits.length > 0) {
        phaseStartedAtMs = getSolveTimestampMs();
        const subRegularLeafResult = materializeLeafRulesByStageRecords(leftoverUnits, context, 'sub-regular');
        const fallbackInitialState = createCanonicalGroupPoolStateFromRecords([
            ...regularPoolState.groups,
            ...subRegularLeafResult.records,
        ]);
        const fallbackRegularPoolState = searchBestRegularPromotionPoolStateFromState(fallbackInitialState, context, guard);
        const fallbackImprovedPoolState = runLeftoverImprovementLoopState(fallbackRegularPoolState, context, guard);
        addMetricDuration(metrics, 'subRegularFallbackMs', phaseStartedAtMs);

        candidateStates.push({
            canonicalState: fallbackImprovedPoolState,
            leftoverUnits: subRegularLeafResult.leftover,
            leftoverUnitAllocations: [...leftoverUnitAllocations, ...subRegularLeafResult.leftoverUnitAllocations],
        });
    }

    if (wholeLeafRecord) {
        candidateStates.push({ canonicalState: createCanonicalGroupPoolStateFromRecords([wholeLeafRecord]), leftoverUnits: [], leftoverUnitAllocations: [] });
    }

    candidateStates.push(...exactLeafPartitionStates);

    return finalizeResolvedCandidates(candidateStates, regularPoolState, context, metrics, solveStartedAtMs, guard);
}

export function resolveFromUnits(
    units: readonly OrgUnit[],
    faction: Faction,
    era: Era | null = null,
    _hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
    const definition = resolveOrgDefinition(faction, era);
    return resolveWithDefinition(definition, units, []);
}

export function resolveFromGroups(
    groupResults: readonly GroupSizeResult[],
    faction: Faction,
    era: Era | null = null,
    _hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
    const definition = resolveOrgDefinition(faction, era);
    const context = getResolveContext(definition);
    if (groupResults.length === 1 && isStableSingleGroupResolveResult(groupResults[0], context)) {
        return [groupResults[0]];
    }

    const markedGroups = markGroupsWithProvenance(groupResults, 'input-group');
    if (!CROSSGRADE_FOREIGN_GROUPS) {
        const passthroughGroups = markedGroups.filter((group) => isTransparentForeignTypedGroup(group, context));
        const groupsNeedingResolution = markedGroups.filter((group) => !isTransparentForeignTypedGroup(group, context));

        if (groupsNeedingResolution.length === 0) {
            return passthroughGroups;
        }

        const resolvedGroups = resolveWithDefinition(
            definition,
            [],
            preprocessGroupsForDefinition(definition, groupsNeedingResolution),
        );

        if (passthroughGroups.length === 0) {
            return resolvedGroups;
        }

        return [...resolvedGroups, ...passthroughGroups].sort(compareGroupScore);
    }

    return resolveWithDefinition(definition, [], preprocessGroupsForDefinition(definition, markedGroups));
}
