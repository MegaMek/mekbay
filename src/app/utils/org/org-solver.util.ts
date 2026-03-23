import type { Era } from '../../models/eras.model';
import type { Faction } from '../../models/factions.model';
import type { ASUnitTypeCode, Unit } from '../../models/units.model';
import {
    compileGroupFacts,
    compileGroupFactsList,
    compileUnitFactsList,
    DEFAULT_ORG_RULE_REGISTRY,
    getCIMoveClass,
    getNormalizedOrgUnitType,
} from './org-facts.util';
import { resolveOrgDefinitionSpec } from './org-registry.util';
import {
    getDynamicTierForModifier,
    getRepeatCountForTierDelta,
} from './org-tier.util';
import {
    EMPTY_RESULT,
    type GroupFacts,
    type GroupSizeResult,
    type GroupUnitAllocation,
    type OrgBucketValue,
    type OrgCIFormationEntry,
    type OrgCIFormationRule,
    type OrgChildTypeCountKey,
    type OrgChildRoleSpec,
    type OrgComposedCountRule,
    type OrgComposedPatternRule,
    type OrgDefinitionSpec,
    type OrgGroupBucketName,
    type OrgGroupProvenance,
    type OrgLeafCountRule,
    type OrgLeafPatternRule,
    type OrgPatternBucketMatcher,
    type OrgPatternBucketPrefixMatcher,
    type OrgPatternReferenceName,
    type OrgPatternScoreTerm,
    type OrgPatternSpec,
    type OrgRuleDefinition,
    type OrgRuleRegistry,
    type OrgTypeModifier,
    type OrgUnitBucketName,
    type UnitClassKey,
    type UnitFactTag,
    type UnitFacts,
    type UnitNumericScalarName,
} from './org-types';

export { EMPTY_RESULT } from './org-types';

const SOLVER_TIME_BUDGET_MS = 750;
const MAX_PATTERN_ENUMERATION_VISITS = 50_000;
const MAX_COMPOSITION_SEARCH_VISITS = 50_000;
const MAX_PATTERN_GREEDY_ITERATIONS = 2_000;
const MAX_COMPOSED_GROUPS_PER_CONFIG = 2_000;
const MAX_PROMOTION_LOOP_ITERATIONS = 64;
const MAX_EXACT_LEAF_PARTITION_UNITS = 32;
const CROSSGRADE_FOREIGN_GROUPS = false;

let nextSyntheticGroupFactId = -1;

interface MutableOrgSolveMetrics {
    factCompilationMs: number;
    inputNormalizationMs: number;
    regularLeafAllocationMs: number;
    exactLeafPartitionMs: number;
    initialRepairMs: number;
    initialAssimilationMs: number;
    wholeComposedMs: number;
    leftoverImprovementMs: number;
    regularPromotionMs: number;
    subRegularFallbackMs: number;
    finalMaterializationMs: number;
    totalSolveMs: number;
    exactLeafPartitionCandidateStates: number;
    exactLeafPartitionSkipped: boolean;
    regularPromotionSearches: number;
    regularPromotionResultCacheHits: number;
    regularPromotionResultCacheMisses: number;
    regularPromotionMemoHits: number;
    regularPromotionMemoMisses: number;
    regularPromotionSuccessorCacheHits: number;
    regularPromotionSuccessorCacheMisses: number;
    regularPromotionSuccessorStates: number;
    composedPlanMetrics: Map<string, MutableComposedPlanMetric>;
    timedOut: boolean;
}

let activeOrgSolveMetrics: MutableOrgSolveMetrics | null = null;
let lastOrgSolveMetrics: OrgSolveMetrics | null = null;

type ModifierBand = 'sub-regular' | 'regular' | 'super-regular';
type RuleExecutionStage = 'regular' | 'sub-regular' | 'all';

interface SolverGuard {
    readonly deadline: number;
    patternVisits: number;
    compositionVisits: number;
    timedOut: boolean;
}

interface ModifierStep {
    readonly modifierKey: string;
    readonly count: number;
    readonly tier: number;
    readonly relativeBand: ModifierBand;
    readonly distanceFromRegular: number;
}

type ComposedPlannerKind = 'single-role-fast-path' | 'exact-counted' | 'pattern-counted';

interface MutableComposedPlanMetric {
    ruleType: string;
    ruleKind: 'composed-count' | 'composed-pattern';
    compositionIndex: number;
    planner: ComposedPlannerKind;
    calls: number;
    totalMs: number;
    totalCandidates: number;
}

export interface ComposedPlanMetric {
    readonly ruleType: string;
    readonly ruleKind: 'composed-count' | 'composed-pattern';
    readonly compositionIndex: number;
    readonly planner: ComposedPlannerKind;
    readonly calls: number;
    readonly totalMs: number;
    readonly totalCandidates: number;
}

function createMutableOrgSolveMetrics(): MutableOrgSolveMetrics {
    return {
        factCompilationMs: 0,
        inputNormalizationMs: 0,
        regularLeafAllocationMs: 0,
        exactLeafPartitionMs: 0,
        initialRepairMs: 0,
        initialAssimilationMs: 0,
        wholeComposedMs: 0,
        leftoverImprovementMs: 0,
        regularPromotionMs: 0,
        subRegularFallbackMs: 0,
        finalMaterializationMs: 0,
        totalSolveMs: 0,
        exactLeafPartitionCandidateStates: 0,
        exactLeafPartitionSkipped: false,
        regularPromotionSearches: 0,
        regularPromotionResultCacheHits: 0,
        regularPromotionResultCacheMisses: 0,
        regularPromotionMemoHits: 0,
        regularPromotionMemoMisses: 0,
        regularPromotionSuccessorCacheHits: 0,
        regularPromotionSuccessorCacheMisses: 0,
        regularPromotionSuccessorStates: 0,
        composedPlanMetrics: new Map<string, MutableComposedPlanMetric>(),
        timedOut: false,
    };
}

function snapshotOrgSolveMetrics(metrics: MutableOrgSolveMetrics | null): OrgSolveMetrics | null {
    if (!metrics) {
        return null;
    }

    return {
        factCompilationMs: metrics.factCompilationMs,
        inputNormalizationMs: metrics.inputNormalizationMs,
        regularLeafAllocationMs: metrics.regularLeafAllocationMs,
        exactLeafPartitionMs: metrics.exactLeafPartitionMs,
        initialRepairMs: metrics.initialRepairMs,
        initialAssimilationMs: metrics.initialAssimilationMs,
        wholeComposedMs: metrics.wholeComposedMs,
        leftoverImprovementMs: metrics.leftoverImprovementMs,
        regularPromotionMs: metrics.regularPromotionMs,
        subRegularFallbackMs: metrics.subRegularFallbackMs,
        finalMaterializationMs: metrics.finalMaterializationMs,
        totalSolveMs: metrics.totalSolveMs,
        exactLeafPartitionCandidateStates: metrics.exactLeafPartitionCandidateStates,
        exactLeafPartitionSkipped: metrics.exactLeafPartitionSkipped,
        regularPromotionSearches: metrics.regularPromotionSearches,
        regularPromotionResultCacheHits: metrics.regularPromotionResultCacheHits,
        regularPromotionResultCacheMisses: metrics.regularPromotionResultCacheMisses,
        regularPromotionMemoHits: metrics.regularPromotionMemoHits,
        regularPromotionMemoMisses: metrics.regularPromotionMemoMisses,
        regularPromotionSuccessorCacheHits: metrics.regularPromotionSuccessorCacheHits,
        regularPromotionSuccessorCacheMisses: metrics.regularPromotionSuccessorCacheMisses,
        regularPromotionSuccessorStates: metrics.regularPromotionSuccessorStates,
        composedPlanMetrics: [...metrics.composedPlanMetrics.values()]
            .map((metric) => ({
                ruleType: metric.ruleType,
                ruleKind: metric.ruleKind,
                compositionIndex: metric.compositionIndex,
                planner: metric.planner,
                calls: metric.calls,
                totalMs: metric.totalMs,
                totalCandidates: metric.totalCandidates,
            }))
            .sort((left, right) => right.totalMs - left.totalMs || right.calls - left.calls || left.ruleType.localeCompare(right.ruleType)),
        timedOut: metrics.timedOut,
    };
}

export function getLastOrgSolveMetrics(): OrgSolveMetrics | null {
    return lastOrgSolveMetrics;
}

interface RuleModifierDescriptor {
    readonly stepsAscending: readonly ModifierStep[];
    readonly stepsDescending: readonly ModifierStep[];
    readonly regularStep: ModifierStep;
    readonly subRegularStepsDescending: readonly ModifierStep[];
    readonly superRegularStepsDescending: readonly ModifierStep[];
}

interface CompiledRuleStageMetadata {
    readonly descriptor: RuleModifierDescriptor;
    readonly allowedModifierKeysByStage: Readonly<Record<RuleExecutionStage, ReadonlySet<string> | null>>;
    readonly participatesInRegularStage: boolean;
    readonly participatesInSubRegularStage: boolean;
    readonly blocksSubRegularPromotionChildren: boolean;
    readonly canEmitExactSuperRegularWholeLeaf: boolean;
}

interface LeafCountEmission {
    readonly modifierKey: string;
    readonly perGroupCount: number;
    readonly copies: number;
    readonly tier: number;
}

interface LeafPatternEmission extends LeafCountEmission {
    readonly patternIndex: number;
    readonly score: number;
    readonly allocations: readonly ReadonlyMap<string, number>[];
}

interface ComposedCountEmission extends LeafCountEmission {
    readonly compositionIndex: number;
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

export interface ComposedCountEvaluationResult {
    readonly acceptedGroups: readonly GroupFacts[];
    readonly emitted: readonly ComposedCountEmission[];
    readonly leftoverCount: number;
}

export interface MaterializedLeafUnitResult {
    readonly groups: readonly GroupSizeResult[];
    readonly leftoverUnitFacts: readonly UnitFacts[];
}

export interface MaterializedComposedGroupResult {
    readonly groups: readonly GroupSizeResult[];
    readonly leftoverGroupFacts: readonly GroupFacts[];
}

export interface OrgSolveMetrics {
    readonly factCompilationMs: number;
    readonly inputNormalizationMs: number;
    readonly regularLeafAllocationMs: number;
    readonly exactLeafPartitionMs: number;
    readonly initialRepairMs: number;
    readonly initialAssimilationMs: number;
    readonly wholeComposedMs: number;
    readonly leftoverImprovementMs: number;
    readonly regularPromotionMs: number;
    readonly subRegularFallbackMs: number;
    readonly finalMaterializationMs: number;
    readonly totalSolveMs: number;
    readonly exactLeafPartitionCandidateStates: number;
    readonly exactLeafPartitionSkipped: boolean;
    readonly regularPromotionSearches: number;
    readonly regularPromotionResultCacheHits: number;
    readonly regularPromotionResultCacheMisses: number;
    readonly regularPromotionMemoHits: number;
    readonly regularPromotionMemoMisses: number;
    readonly regularPromotionSuccessorCacheHits: number;
    readonly regularPromotionSuccessorCacheMisses: number;
    readonly regularPromotionSuccessorStates: number;
    readonly composedPlanMetrics: readonly ComposedPlanMetric[];
    readonly timedOut: boolean;
}

export interface OrgDefinitionEvaluationResult {
    readonly unitFacts: readonly UnitFacts[];
    readonly groupFacts: readonly GroupFacts[];
    readonly ruleEvaluations: ReadonlyMap<OrgRuleDefinition, unknown>;
}

interface PatternCandidate {
    readonly allocation: ReadonlyMap<string, number>;
    readonly score: number;
}

interface ConcretePatternCandidate extends PatternCandidate {
    readonly units: readonly UnitFacts[];
}

interface PatternSelection {
    readonly patternIndex: number;
    readonly pattern: OrgPatternSpec;
    readonly candidate: ConcretePatternCandidate;
}

interface CompositionConfig {
    readonly index: number;
    readonly ruleType: string;
    readonly ruleKind: 'composed-count';
    readonly childRoles: readonly OrgChildRoleSpec[];
    readonly modifierDescriptor: RuleModifierDescriptor;
    readonly childMatchBucketBy?: OrgGroupBucketName;
}

interface PatternCompositionConfig {
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

interface AbstractCompositionPlanResult {
    readonly candidates: readonly AbstractCompositionCandidate[];
    readonly groupsByEntryId: ReadonlyMap<string, readonly GroupFacts[]>;
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

interface PlannedGroupRecord {
    readonly recordId: number;
    readonly facts: GroupFacts;
    readonly producedPlan?: AbstractProducedGroupPlan;
    readonly atomicPlan?: AbstractAtomicGroupPlan;
    materializedGroup?: GroupSizeResult;
    materialize: () => GroupSizeResult;
}

interface AbstractProducedGroupPlan {
    readonly rule: OrgComposedCountRule | OrgComposedPatternRule;
    readonly modifierStep: ModifierStep;
    readonly childRecords: readonly PlannedGroupRecord[];
}

interface AbstractAtomicGroupPlan {
    readonly kind: 'leaf' | 'ci-parent' | 'ci-fragment';
    readonly materializeAtomicGroup: () => GroupSizeResult;
}

interface ResolveContext {
    readonly definition: OrgDefinitionSpec;
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

interface CIFragmentToken {
    readonly moveClass: NonNullable<ReturnType<typeof getCIMoveClass>>;
    readonly allocations: readonly GroupUnitAllocation[];
}

const ABSTRACT_UNIT_BUCKET_NAMES: readonly OrgUnitBucketName[] = [
    'classKey',
    'ciMoveClass',
    'ciMoveClassTroopers',
    'flightType',
    'infantryTroopers',
    'transport',
];

const resolveContextTemplateByDefinition = new WeakMap<OrgDefinitionSpec, ResolveContextTemplate>();
const compiledRuleStageMetadataByRule = new WeakMap<OrgRuleDefinition, CompiledRuleStageMetadata>();
const compiledGroupFactsByGroup = new WeakMap<GroupSizeResult, GroupFacts>();

function getCompiledGroupFacts(group: GroupSizeResult): GroupFacts {
    const cached = compiledGroupFactsByGroup.get(group);
    if (cached) {
        return cached;
    }

    const facts = compileGroupFacts(group);
    compiledGroupFactsByGroup.set(group, facts);
    return facts;
}

function getCompiledGroupFactsList(groups: readonly GroupSizeResult[]): GroupFacts[] {
    return groups.map((group) => getCompiledGroupFacts(group));
}

function createSolverGuard(): SolverGuard {
    return {
        deadline: Date.now() + SOLVER_TIME_BUDGET_MS,
        patternVisits: 0,
        compositionVisits: 0,
        timedOut: false,
    };
}

function getSolveTimestampMs(): number {
    return globalThis.performance?.now() ?? Date.now();
}

function addMetricDuration(metrics: MutableOrgSolveMetrics | null, key: keyof Pick<
    MutableOrgSolveMetrics,
    'factCompilationMs'
    | 'inputNormalizationMs'
    | 'regularLeafAllocationMs'
    | 'exactLeafPartitionMs'
    | 'initialRepairMs'
    | 'initialAssimilationMs'
    | 'wholeComposedMs'
    | 'leftoverImprovementMs'
    | 'regularPromotionMs'
    | 'subRegularFallbackMs'
    | 'finalMaterializationMs'
    | 'totalSolveMs'
>, startedAtMs: number): void {
    if (!metrics) {
        return;
    }

    metrics[key] += Math.max(0, getSolveTimestampMs() - startedAtMs);
}

function recordComposedPlanMetric(
    config: Pick<CompositionConfig | PatternCompositionConfig, 'ruleType' | 'ruleKind' | 'index'>,
    planner: ComposedPlannerKind,
    startedAtMs: number,
    candidateCount: number,
): void {
    const metrics = activeOrgSolveMetrics;
    if (!metrics) {
        return;
    }

    const key = `${config.ruleKind}::${config.ruleType}::${config.index}::${planner}`;
    const existing = metrics.composedPlanMetrics.get(key);
    const elapsedMs = Math.max(0, getSolveTimestampMs() - startedAtMs);

    if (existing) {
        existing.calls += 1;
        existing.totalMs += elapsedMs;
        existing.totalCandidates += candidateCount;
        return;
    }

    metrics.composedPlanMetrics.set(key, {
        ruleType: config.ruleType,
        ruleKind: config.ruleKind,
        compositionIndex: config.index,
        planner,
        calls: 1,
        totalMs: elapsedMs,
        totalCandidates: candidateCount,
    });
}

function allocateSyntheticGroupFactId(): number {
    const groupFactId = nextSyntheticGroupFactId;
    nextSyntheticGroupFactId -= 1;
    return groupFactId;
}

function shouldAbortSearch(guard: SolverGuard): boolean {
    if (guard.timedOut) {
        return true;
    }
    if (Date.now() > guard.deadline) {
        guard.timedOut = true;
        return true;
    }
    return false;
}

function getRulePriority(rule: Pick<OrgRuleDefinition, 'priority'>): number {
    return rule.priority ?? 0;
}

function getModifierCount(value: number | OrgTypeModifier): number {
    return typeof value === 'number' ? value : value.count;
}

function getModifierTier(
    baseTier: number,
    regularCount: number,
    modifierKey: string,
    modifierValue: number | OrgTypeModifier,
    dynamicTier?: number,
): number {
    if (typeof modifierValue !== 'number' && modifierValue.tier !== undefined) {
        return modifierValue.tier;
    }

    return getDynamicTierForModifier(baseTier, regularCount, getModifierCount(modifierValue), dynamicTier ?? 0);
}

function getRuleModifierDescriptor(rule: Pick<OrgRuleDefinition, 'modifiers' | 'tier' | 'dynamicTier'>): RuleModifierDescriptor {
    const modifierEntries = Object.entries(rule.modifiers);
    const regularModifierValue = rule.modifiers[''] ?? modifierEntries[0]?.[1] ?? 1;
    const regularCount = getModifierCount(regularModifierValue);
    const stepsAscending = modifierEntries
        .map(([modifierKey, modifierValue]) => ({
            modifierKey,
            count: getModifierCount(modifierValue),
            tier: getModifierTier(rule.tier, regularCount, modifierKey, modifierValue, rule.dynamicTier),
            relativeBand: (getModifierCount(modifierValue) < regularCount
                ? 'sub-regular'
                : getModifierCount(modifierValue) > regularCount
                    ? 'super-regular'
                    : 'regular') as ModifierBand,
            distanceFromRegular: Math.abs(getModifierCount(modifierValue) - regularCount),
        }))
        .sort((left, right) => left.count - right.count);
    const regularStep = stepsAscending.find((step) => step.relativeBand === 'regular') ?? stepsAscending[0];

    return {
        stepsAscending,
        stepsDescending: [...stepsAscending].sort((left, right) => right.count - left.count),
        regularStep,
        subRegularStepsDescending: stepsAscending
            .filter((step) => step.relativeBand === 'sub-regular')
            .sort((left, right) => right.count - left.count),
        superRegularStepsDescending: stepsAscending
            .filter((step) => step.relativeBand === 'super-regular')
            .sort((left, right) => right.count - left.count),
    };
}

function compileRuleStageMetadata(rule: OrgRuleDefinition): CompiledRuleStageMetadata {
    const cached = compiledRuleStageMetadataByRule.get(rule);
    if (cached) {
        return cached;
    }

    const descriptor = getRuleModifierDescriptor(rule);
    const regularModifierKeys = new Set([descriptor.regularStep.modifierKey]);
    const subRegularModifierKeys = new Set(descriptor.subRegularStepsDescending.map((step) => step.modifierKey));
    const allModifierKeys = new Set(descriptor.stepsDescending.map((step) => step.modifierKey));
    const isLeafPatternRule = rule.kind === 'leaf-pattern';
    const isLeafCountRule = rule.kind === 'leaf-count';
    const participatesInRegularStage = isLeafPatternRule || !isLeafCountRule || (rule.priority ?? 0) >= 0;
    const participatesInSubRegularStage = !isLeafPatternRule && subRegularModifierKeys.size > 0;
    const blocksSubRegularPromotionChildren = rule.kind === 'ci-formation' || rule.kind === 'composed-count'
        ? !!rule.requireRegularForPromotion
        : false;
    const canEmitExactSuperRegularWholeLeaf = (rule.kind === 'leaf-count' || rule.kind === 'leaf-pattern')
        && descriptor.superRegularStepsDescending.length > 0;

    const metadata = {
        descriptor,
        allowedModifierKeysByStage: {
            regular: participatesInRegularStage ? regularModifierKeys : new Set<string>(),
            'sub-regular': participatesInSubRegularStage ? subRegularModifierKeys : new Set<string>(),
            all: allModifierKeys,
        },
        participatesInRegularStage,
        participatesInSubRegularStage,
        blocksSubRegularPromotionChildren,
        canEmitExactSuperRegularWholeLeaf,
    };

    compiledRuleStageMetadataByRule.set(rule, metadata);
    return metadata;
}

function getRuleStageMetadata(
    context: ResolveContext,
    rule: OrgRuleDefinition,
): CompiledRuleStageMetadata {
    return context.ruleStageMetadata.get(rule) ?? compileRuleStageMetadata(rule);
}

function getAllowedModifierKeysForStage(
    metadata: CompiledRuleStageMetadata,
    stage: RuleExecutionStage,
): ReadonlySet<string> | undefined {
    return stage === 'all' ? undefined : metadata.allowedModifierKeysByStage[stage] ?? undefined;
}

function getModifierStepForRuleStage(
    metadata: CompiledRuleStageMetadata,
    stage: RuleExecutionStage,
): readonly ModifierStep[] {
    if (stage === 'regular') {
        return metadata.participatesInRegularStage ? [metadata.descriptor.regularStep] : [];
    }
    if (stage === 'sub-regular') {
        return metadata.participatesInSubRegularStage ? metadata.descriptor.subRegularStepsDescending : [];
    }
    return metadata.descriptor.stepsDescending;
}

function isSubRegularModifierKey(
    metadata: CompiledRuleStageMetadata,
    modifierKey: string,
): boolean {
    return metadata.allowedModifierKeysByStage['sub-regular']?.has(modifierKey) ?? false;
}

function getRuleRegistry(definition?: OrgDefinitionSpec, registry?: OrgRuleRegistry): OrgRuleRegistry {
    return registry ?? definition?.registry ?? DEFAULT_ORG_RULE_REGISTRY;
}

function getSelectorNames(selector: OrgLeafCountRule['unitSelector'] | OrgLeafPatternRule['unitSelector']): readonly string[] {
    return (Array.isArray(selector) ? selector : [selector]) as readonly string[];
}

function matchesUnitSelectors(
    unitFacts: UnitFacts,
    selector: OrgLeafCountRule['unitSelector'] | OrgLeafPatternRule['unitSelector'],
    registry: OrgRuleRegistry,
): boolean {
    return getSelectorNames(selector).some((selectorName) => {
        const selectorFn = registry.unitSelectors[selectorName as keyof typeof registry.unitSelectors];
        return selectorFn ? selectorFn(unitFacts) : false;
    });
}

function getUnitBucketValue(
    bucketBy: OrgUnitBucketName | undefined,
    facts: UnitFacts,
    registry: OrgRuleRegistry,
): string {
    if (!bucketBy) {
        return '__all__';
    }
    const bucketFn = registry.unitBuckets[bucketBy];
    return bucketFn ? `${bucketFn(facts) as string | number | boolean}` : '__all__';
}

function getGroupBucketValue(
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

function groupUnitsByBucket(
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

function makeGroupName(type: string | null, modifierKey: string): string {
    return `${modifierKey}${type ?? 'Force'}`;
}

function createLeafGroup(
    rule: OrgLeafCountRule | OrgLeafPatternRule,
    modifierStep: ModifierStep,
    units: readonly UnitFacts[],
): GroupSizeResult {
    return {
        name: makeGroupName(rule.type, modifierStep.modifierKey),
        type: rule.type,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        units: units.map((facts) => facts.unit),
        tag: rule.tag,
        priority: rule.priority,
    };
}

function createComposedGroup(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    modifierStep: ModifierStep,
    children: readonly GroupSizeResult[],
): GroupSizeResult {
    return {
        name: makeGroupName(rule.type, modifierStep.modifierKey),
        type: rule.type,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        children: [...children],
        tag: rule.tag,
        priority: rule.priority,
    };
}

function createAtomicGroupTemplate(
    type: string,
    modifierKey: string,
    countsAsType: GroupSizeResult['countsAsType'],
    tier: number,
    tag: GroupSizeResult['tag'],
    priority: GroupSizeResult['priority'],
): GroupSizeResult {
    return {
        name: makeGroupName(type, modifierKey),
        type: type as GroupSizeResult['type'],
        modifierKey,
        countsAsType,
        tier,
        provenance: 'produced-group',
        tag,
        priority,
    };
}

function createAtomicFragmentTemplate(
    type: string,
    count: number,
    tier: number,
    tag: GroupSizeResult['tag'],
    priority: GroupSizeResult['priority'],
): GroupSizeResult {
    return {
        name: makeCountedGroupName(type, count),
        type: type as GroupSizeResult['type'],
        modifierKey: '',
        countsAsType: null,
        tier,
        count,
        provenance: 'produced-group',
        tag,
        priority,
    };
}

function buildAbstractGroupFactsFromUnits(
    groupTemplate: GroupSizeResult,
    units: readonly UnitFacts[],
    unitAllocations?: readonly GroupUnitAllocation[],
): GroupFacts {
    const unitTypeCounts = new Map<ASUnitTypeCode, number>();
    const unitClassCounts = new Map<UnitClassKey, number>();
    const unitTagCounts = new Map<UnitFactTag, number>();
    const unitScalarSums = new Map<UnitNumericScalarName, number>();
    const descendantUnitBucketCounts = new Map<OrgUnitBucketName, Map<OrgBucketValue, number>>();

    for (const bucketName of ABSTRACT_UNIT_BUCKET_NAMES) {
        descendantUnitBucketCounts.set(bucketName, new Map<OrgBucketValue, number>());
    }

    const allocationByUnit = new Map(units.map((facts) => [facts.unit, unitAllocations?.find((allocation) => allocation.unit === facts.unit)?.troopers ?? facts.scalars.troopers]));

    for (const facts of units) {
        const troopers = allocationByUnit.get(facts.unit) ?? facts.scalars.troopers;
        const unitType = getNormalizedOrgUnitType(facts.unit);
        unitTypeCounts.set(unitType, (unitTypeCounts.get(unitType) ?? 0) + 1);
        unitClassCounts.set(facts.classKey, (unitClassCounts.get(facts.classKey) ?? 0) + 1);
        for (const tag of facts.tags) {
            unitTagCounts.set(tag, (unitTagCounts.get(tag) ?? 0) + 1);
        }
        for (const [key, value] of Object.entries(facts.scalars)) {
            if (typeof value === 'number') {
                const numericValue = key === 'troopers' ? troopers : value;
                unitScalarSums.set(key as UnitNumericScalarName, (unitScalarSums.get(key as UnitNumericScalarName) ?? 0) + numericValue);
            }
        }
        for (const bucketName of ABSTRACT_UNIT_BUCKET_NAMES) {
            const bucketCounts = descendantUnitBucketCounts.get(bucketName)!;
            const bucketValue = getUnitBucketValue(bucketName, facts, DEFAULT_ORG_RULE_REGISTRY) as OrgBucketValue;
            bucketCounts.set(bucketValue, (bucketCounts.get(bucketValue) ?? 0) + 1);
        }
    }

    return {
        groupFactId: allocateSyntheticGroupFactId(),
        group: groupTemplate,
        type: groupTemplate.type,
        countsAsType: groupTemplate.countsAsType,
        modifierKey: groupTemplate.modifierKey,
        tier: groupTemplate.tier,
        provenance: 'produced-group',
        tag: groupTemplate.tag,
        priority: groupTemplate.priority,
        directChildCount: 0,
        childTypeCounts: new Map(),
        unitTypeCounts,
        unitClassCounts,
        unitTagCounts,
        unitScalarSums,
        descendantUnitBucketCounts,
    };
}

function createAbstractAtomicGroupRecord(
    facts: GroupFacts,
    materializeAtomicGroup: () => GroupSizeResult,
    kind: AbstractAtomicGroupPlan['kind'],
): PlannedGroupRecord {
    const record: PlannedGroupRecord = {
        recordId: facts.groupFactId,
        facts,
        atomicPlan: {
            kind,
            materializeAtomicGroup,
        },
        materialize: () => {
            if (!record.materializedGroup) {
                record.materializedGroup = record.atomicPlan!.materializeAtomicGroup();
            }
            return record.materializedGroup;
        },
    };

    return record;
}

function createAbstractLeafGroupRecord(
    rule: OrgLeafCountRule | OrgLeafPatternRule,
    modifierStep: ModifierStep,
    units: readonly UnitFacts[],
): PlannedGroupRecord {
    const template = createAtomicGroupTemplate(
        rule.type,
        modifierStep.modifierKey,
        rule.countsAs ?? null,
        modifierStep.tier,
        rule.tag,
        rule.priority,
    );
    const facts = buildAbstractGroupFactsFromUnits(template, units);

    return createAbstractAtomicGroupRecord(
        facts,
        () => createLeafGroup(rule, modifierStep, units),
        'leaf',
    );
}

function createAbstractCIParentRecord(
    rule: OrgCIFormationRule,
    modifierStep: ModifierStep,
    tokens: readonly CIFragmentToken[],
    unitFactsByUnit: ReadonlyMap<Unit, UnitFacts>,
): PlannedGroupRecord {
    const allocations = aggregateTokenAllocations(tokens);
    const units = allocations
        .map((allocation) => unitFactsByUnit.get(allocation.unit))
        .filter((facts): facts is UnitFacts => !!facts);
    const template = createAtomicGroupTemplate(
        rule.type,
        modifierStep.modifierKey,
        rule.countsAs ?? null,
        modifierStep.tier,
        rule.tag,
        rule.priority,
    );
    const facts = buildAbstractGroupFactsFromUnits(template, units, allocations);

    return createAbstractAtomicGroupRecord(
        facts,
        () => createCIParentGroup(rule, modifierStep, tokens),
        'ci-parent',
    );
}

function createAbstractCIFragmentRecord(
    rule: OrgCIFormationRule,
    count: number,
    tokens: readonly CIFragmentToken[],
    unitFactsByUnit: ReadonlyMap<Unit, UnitFacts>,
): PlannedGroupRecord {
    const allocations = aggregateTokenAllocations(tokens);
    const units = allocations
        .map((allocation) => unitFactsByUnit.get(allocation.unit))
        .filter((facts): facts is UnitFacts => !!facts);
    const template = createAtomicFragmentTemplate(
        rule.fragmentType,
        count,
        rule.fragmentTier,
        rule.tag,
        rule.priority,
    );
    const facts = buildAbstractGroupFactsFromUnits(template, units, allocations);

    return createAbstractAtomicGroupRecord(
        facts,
        () => createCIFragmentGroup(rule, count, tokens),
        'ci-fragment',
    );
}

function getPreferredUnitTypeKey(facts: UnitFacts): string {
    return getNormalizedOrgUnitType(facts.unit);
}

function getPreferredGroupTypeKey(facts: GroupFacts): string {
    const unitTypes = Array.from(facts.unitTypeCounts.entries())
        .filter(([, count]) => count > 0)
        .map(([unitType]) => unitType);

    return unitTypes.length === 1 ? unitTypes[0] : '__mixed__';
}

function groupUnitsByPreferredType(units: readonly UnitFacts[]): Map<string, UnitFacts[]> {
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

function buildPatternCompositionConfig(rule: OrgComposedPatternRule): PatternCompositionConfig {
    return {
        index: 0,
        ruleType: rule.type,
        ruleKind: 'composed-pattern',
        childRoles: rule.childRoles,
        modifierDescriptor: getRuleModifierDescriptor(rule),
        childMatchBucketBy: rule.childMatchBucketBy,
    };
}

function matchesComposedPatternSelection(
    rule: OrgComposedPatternRule,
    selectedGroups: readonly GroupFacts[],
    registry: OrgRuleRegistry,
): boolean {
    const bucketCounts = getComposedPatternBucketCounts(selectedGroups, rule.bucketBy);
    const availableBucketValues = [...bucketCounts.keys()];
    const totalCount = [...bucketCounts.values()].reduce((sum, count) => sum + count, 0);

    return rule.patterns.some((pattern) => (
        pattern.copySize === totalCount
        && passesPatternBounds(pattern, bucketCounts, availableBucketValues)
    ));
}

function makeCountedGroupName(type: string, count: number): string {
    return count <= 1 ? type : `${count}x ${type}`;
}

function aggregateTokenAllocations(tokens: readonly CIFragmentToken[]): GroupUnitAllocation[] {
    const allocationByUnit = new Map<Unit, number>();

    for (const token of tokens) {
        for (const allocation of token.allocations) {
            allocationByUnit.set(allocation.unit, (allocationByUnit.get(allocation.unit) ?? 0) + allocation.troopers);
        }
    }

    return Array.from(allocationByUnit.entries()).map(([unit, troopers]) => ({ unit, troopers }));
}

function getUnitsFromAllocations(allocations: readonly GroupUnitAllocation[]): Unit[] {
    return allocations.map((allocation) => allocation.unit);
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

function createCIParentGroup(
    rule: OrgCIFormationRule,
    modifierStep: ModifierStep,
    tokens: readonly CIFragmentToken[],
): GroupSizeResult {
    const unitAllocations = aggregateTokenAllocations(tokens);
    return {
        name: makeGroupName(rule.type, modifierStep.modifierKey),
        type: rule.type,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        units: getUnitsFromAllocations(unitAllocations),
        unitAllocations,
        tag: rule.tag,
        priority: rule.priority,
    };
}

function createCIFragmentGroup(
    rule: OrgCIFormationRule,
    count: number,
    tokens: readonly CIFragmentToken[],
): GroupSizeResult {
    const unitAllocations = aggregateTokenAllocations(tokens);
    return {
        name: makeCountedGroupName(rule.fragmentType, count),
        type: rule.fragmentType,
        modifierKey: '',
        countsAsType: null,
        tier: rule.fragmentTier,
        provenance: 'produced-group',
        count,
        units: getUnitsFromAllocations(unitAllocations),
        unitAllocations,
        tag: rule.tag,
        priority: rule.priority,
    };
}

function partitionAllocationsToFragments(
    moveClass: NonNullable<ReturnType<typeof getCIMoveClass>>,
    allocations: readonly GroupUnitAllocation[],
    troopersPerFragment: number,
): { tokens: CIFragmentToken[]; leftoverAllocations: GroupUnitAllocation[] } {
    const working = allocations
        .filter((allocation) => allocation.troopers > 0)
        .map((allocation) => ({ ...allocation }));
    const tokens: CIFragmentToken[] = [];
    let allocationIndex = 0;

    while (allocationIndex < working.length) {
        const remainingTroopersAvailable = working
            .slice(allocationIndex)
            .reduce((sum, allocation) => sum + allocation.troopers, 0);
        if (remainingTroopersAvailable < troopersPerFragment) {
            break;
        }

        let remainingTroopers = troopersPerFragment;
        const fragmentAllocations: GroupUnitAllocation[] = [];
        let cursor = allocationIndex;

        while (cursor < working.length && remainingTroopers > 0) {
            const allocation = working[cursor];
            if (allocation.troopers <= 0) {
                cursor += 1;
                continue;
            }

            const consumedTroopers = Math.min(allocation.troopers, remainingTroopers);
            fragmentAllocations.push({ unit: allocation.unit, troopers: consumedTroopers });
            allocation.troopers -= consumedTroopers;
            remainingTroopers -= consumedTroopers;

            if (allocation.troopers <= 0) {
                cursor += 1;
            }
        }

        if (remainingTroopers > 0) {
            break;
        }

        while (allocationIndex < working.length && working[allocationIndex].troopers <= 0) {
            allocationIndex += 1;
        }

        tokens.push({
            moveClass,
            allocations: fragmentAllocations,
        });
    }

    return {
        tokens,
        leftoverAllocations: working
            .filter((allocation) => allocation.troopers > 0)
            .map((allocation) => ({ unit: allocation.unit, troopers: allocation.troopers })),
    };
}

function getMoveClassFromAllocations(allocations: readonly GroupUnitAllocation[]): NonNullable<ReturnType<typeof getCIMoveClass>> | null {
    const moveClasses = new Set(
        allocations
            .map((allocation) => getCIMoveClass(allocation.unit))
            .filter((moveClass): moveClass is NonNullable<ReturnType<typeof getCIMoveClass>> => moveClass !== null),
    );

    return moveClasses.size === 1 ? [...moveClasses][0] : null;
}

function sliceAllocationsToTokens(
    allocations: readonly GroupUnitAllocation[],
    moveClass: NonNullable<ReturnType<typeof getCIMoveClass>>,
    troopersPerFragment: number,
): CIFragmentToken[] | null {
    const partitioned = partitionAllocationsToFragments(moveClass, allocations, troopersPerFragment);
    if (partitioned.leftoverAllocations.length > 0) {
        return null;
    }

    return partitioned.tokens;
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
    const allocations = group.unitAllocations
        ?? group.units?.map((unit) => ({ unit, troopers: unit.internal || 0 }))
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

    if (group.type === rule.fragmentType) {
        const tokens = sliceAllocationsToTokens(allocations, moveClass, entry.troopers);
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

    const tokens = sliceAllocationsToTokens(allocations, moveClass, entry.troopers);
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
    unitFactsByUnit: ReadonlyMap<Unit, UnitFacts>,
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

    const allocationsByMoveClass = new Map<NonNullable<ReturnType<typeof getCIMoveClass>>, GroupUnitAllocation[]>();
    for (const facts of eligibleUnits) {
        const moveClass = getCIMoveClass(facts.unit);
        if (!moveClass || !entryByMoveClass.has(moveClass)) {
            leftoverCount += 1;
            continue;
        }

        const existing = allocationsByMoveClass.get(moveClass);
        const allocation = { unit: facts.unit, troopers: facts.scalars.troopers };
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
        const partitioned = partitionAllocationsToFragments(moveClass, allocations, entry.troopers);
        const tokens = partitioned.tokens;
        if (partitioned.leftoverAllocations.length > 0) {
            leftoverCount += partitioned.leftoverAllocations.length;
        }
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
    const allocationsByMoveClass = new Map<NonNullable<ReturnType<typeof getCIMoveClass>>, GroupUnitAllocation[]>();

    for (const facts of eligibleUnits) {
        const moveClass = getCIMoveClass(facts.unit);
        if (!moveClass || !entryByMoveClass.has(moveClass)) {
            leftoverUnitFacts.push(facts);
            continue;
        }

        const existing = allocationsByMoveClass.get(moveClass);
        const allocation = { unit: facts.unit, troopers: facts.scalars.troopers };
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
        const partitioned = partitionAllocationsToFragments(moveClass, allocations, entry.troopers);
        const tokens = partitioned.tokens;
        leftoverUnitAllocations.push(...partitioned.leftoverAllocations);
        groups.push(...materializeCIFormationTokens(rule, tokens, entry));
    }

    return {
        groups,
        leftoverUnitFacts: [...ineligibleUnits, ...leftoverUnitFacts],
        leftoverUnitAllocations,
    };
}

function materializeCIFormationRuleRecords(
    rule: OrgCIFormationRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
    context?: ResolveContext,
): { records: PlannedGroupRecord[]; leftoverUnitFacts: UnitFacts[]; leftoverUnitAllocations: GroupUnitAllocation[] } {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    const entryByMoveClass = new Map(rule.entries.map((entry) => [entry.moveClass, entry]));
    const unitFactsByUnit = new Map(eligibleUnits.map((facts) => [facts.unit, facts]));
    const leftoverUnitFacts: UnitFacts[] = [];
    const leftoverUnitAllocations: GroupUnitAllocation[] = [];
    const allocationsByMoveClass = new Map<NonNullable<ReturnType<typeof getCIMoveClass>>, GroupUnitAllocation[]>();

    for (const facts of eligibleUnits) {
        const moveClass = getCIMoveClass(facts.unit);
        if (!moveClass || !entryByMoveClass.has(moveClass)) {
            leftoverUnitFacts.push(facts);
            continue;
        }

        const existing = allocationsByMoveClass.get(moveClass);
        const allocation = { unit: facts.unit, troopers: facts.scalars.troopers };
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
        const partitioned = partitionAllocationsToFragments(moveClass, allocations, entry.troopers);
        leftoverUnitAllocations.push(...partitioned.leftoverAllocations);
        records.push(...materializeCIFormationTokenRecords(rule, partitioned.tokens, entry, unitFactsByUnit));
    }

    return {
        records,
        leftoverUnitFacts: [...ineligibleUnits, ...leftoverUnitFacts],
        leftoverUnitAllocations,
    };
}

function normalizeCIFormationGroups(
    pool: readonly GroupSizeResult[],
    context: ResolveContext,
): GroupSizeResult[] {
    let nextPool = [...pool];

    for (const rule of context.ciFormationRules) {
        const entryByMoveClass = new Map(rule.entries.map((entry) => [entry.moveClass, entry]));
        const groupFacts = getCompiledGroupFactsList(nextPool);
        const candidates = groupFacts.filter((facts) => {
            if (facts.type !== rule.fragmentType && facts.type !== rule.type) {
                return false;
            }
            const ciCount = facts.unitTypeCounts.get('CI') ?? 0;
            return ciCount > 0 && facts.unitTypeCounts.size === 1;
        });
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

function resolvePatternBucketValues(
    matcher: OrgPatternBucketMatcher,
    availableBucketValues: readonly string[],
): readonly string[] {
    if (isPatternBucketListMatcher(matcher)) {
        return matcher.map(String);
    }

    return availableBucketValues.filter((bucketValue) => bucketValue.startsWith(matcher.prefix));
}

function isPatternBucketListMatcher(
    matcher: OrgPatternBucketMatcher,
): matcher is readonly OrgBucketValue[] {
    return Array.isArray(matcher);
}

function isPatternBucketPrefixMatcher(
    matcher: OrgPatternBucketMatcher,
): matcher is OrgPatternBucketPrefixMatcher {
    return !isPatternBucketListMatcher(matcher);
}

function getPatternRefTotal(
    ref: OrgPatternReferenceName,
    allocation: ReadonlyMap<string, number>,
    pattern: OrgPatternSpec,
    availableBucketValues: readonly string[],
): number {
    const values = pattern.bucketGroups?.[ref]
        ? resolvePatternBucketValues(pattern.bucketGroups[ref], availableBucketValues)
        : [String(ref)];

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
    const values = pattern.bucketGroups?.[ref]
        ? resolvePatternBucketValues(pattern.bucketGroups[ref], availableBucketValues)
        : [String(ref)];

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

function passesPatternBounds(
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

function enumeratePatternCandidates(
    bucketCounts: ReadonlyMap<string, number>,
    pattern: OrgPatternSpec,
    guard: SolverGuard,
): PatternCandidate[] {
    const bucketEntries = Array.from(bucketCounts.entries()).filter(([, count]) => count > 0);
    const availableBucketValues = bucketEntries.map(([bucketValue]) => bucketValue);
    const candidates: PatternCandidate[] = [];
    const working = new Map<string, number>();

    function visit(bucketIndex: number, remaining: number): void {
        guard.patternVisits += 1;
        if (guard.patternVisits > MAX_PATTERN_ENUMERATION_VISITS || shouldAbortSearch(guard)) {
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
        groups.push(createLeafGroup(rule, getPatternModifierStep(descriptor, selection.pattern.copySize), selection.candidate.units));
        selection.candidate.units.forEach((unit) => selectedFactIds.add(unit.factId));
    }

    const leftoverUnitFacts = [
        ...ineligibleUnits,
        ...eligibleUnits.filter((facts) => !selectedFactIds.has(facts.factId)),
    ];

    return { groups, leftoverUnitFacts };
}

function materializeLeafPatternWithCandidateRecords(
    rule: OrgLeafPatternRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry,
): { records: PlannedGroupRecord[]; leftoverUnitFacts: UnitFacts[] } {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const ineligibleUnits = unitFacts.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
    const unitsByBucket = groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry);
    const descriptor = getRuleModifierDescriptor(rule);
    const selectedFactIds = new Set<number>();
    const records: PlannedGroupRecord[] = [];
    const guard = createSolverGuard();

    const selections = materializeLeafPatternsShared(rule.patterns, unitsByBucket, guard);
    for (const selection of selections) {
        records.push(createAbstractLeafGroupRecord(rule, getPatternModifierStep(descriptor, selection.pattern.copySize), selection.candidate.units));
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
    }

    return {
        groups,
        leftoverUnitFacts: [
            ...ineligibleUnits,
            ...eligibleUnits.filter((facts) => !usedFactIds.has(facts.factId)),
        ],
    };
}

function materializeLeafCountRuleRecords(
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
    }

    return {
        records,
        leftoverUnitFacts: [
            ...ineligibleUnits,
            ...eligibleUnits.filter((facts) => !usedFactIds.has(facts.factId)),
        ],
    };
}

function compareExactLeafCountStepPartitions(
    left: readonly ModifierStep[],
    right: readonly ModifierStep[],
): number {
    const leftPreferenceBuckets = getModifierPreferenceBuckets(left);
    const rightPreferenceBuckets = getModifierPreferenceBuckets(right);
    const sharedLength = Math.min(leftPreferenceBuckets.length, rightPreferenceBuckets.length);

    for (let index = 0; index < sharedLength; index += 1) {
        const bucketComparison = compareModifierPreferenceBucketKeys(leftPreferenceBuckets[index].key, rightPreferenceBuckets[index].key);
        if (bucketComparison !== 0) {
            return bucketComparison;
        }

        const comparison = leftPreferenceBuckets[index].count - rightPreferenceBuckets[index].count;
        if (comparison !== 0) {
            return comparison;
        }
    }

    if (leftPreferenceBuckets.length !== rightPreferenceBuckets.length) {
        return leftPreferenceBuckets.length - rightPreferenceBuckets.length;
    }

    if (left.length !== right.length) {
        return right.length - left.length;
    }

    return 0;
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
    return partitions.sort((left, right) => compareExactLeafCountStepPartitions(right, left));
}

function enumerateExactLeafCountRuleRecordSets(
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

function groupMatchesRole(group: GroupFacts, role: OrgChildRoleSpec): boolean {
    const groupType = group.type;
    const countsAsType = group.countsAsType;
    const matchesType = (groupType !== null && role.matches.includes(groupType))
        || (countsAsType !== null && role.matches.includes(countsAsType));
    if (!matchesType) {
        return false;
    }

    if (role.onlyUnitTypes && role.onlyUnitTypes.length > 0) {
        for (const [unitType, count] of group.unitTypeCounts.entries()) {
            if (count > 0 && !role.onlyUnitTypes.includes(unitType)) {
                return false;
            }
        }
    }

    if (role.requiredUnitTagsAny && role.requiredUnitTagsAny.length > 0) {
        const hasAny = role.requiredUnitTagsAny.some((tag) => (group.unitTagCounts.get(tag) ?? 0) > 0);
        if (!hasAny) {
            return false;
        }
    }

    if (role.requiredUnitTagsAll && role.requiredUnitTagsAll.length > 0) {
        const hasAll = role.requiredUnitTagsAll.every((tag) => (group.unitTagCounts.get(tag) ?? 0) > 0);
        if (!hasAll) {
            return false;
        }
    }

    if (role.requiredTagsAny && role.requiredTagsAny.length > 0) {
        if (!group.tag || !role.requiredTagsAny.includes(group.tag)) {
            return false;
        }
    }

    if (role.requiredTagsAll && role.requiredTagsAll.length > 0) {
        if (!group.tag || !role.requiredTagsAll.every((tag) => tag === group.tag)) {
            return false;
        }
    }

    return true;
}

function buildCompositionConfigs(rule: OrgComposedCountRule): CompositionConfig[] {
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

function canAssignGroupsToRoles(
    selectedGroups: readonly GroupFacts[],
    childRoles: readonly OrgChildRoleSpec[],
    guard: SolverGuard,
): boolean {
    const roleCounts = new Array(childRoles.length).fill(0);

    function visit(groupIndex: number): boolean {
        guard.compositionVisits += 1;
        if (guard.compositionVisits > MAX_COMPOSITION_SEARCH_VISITS || shouldAbortSearch(guard)) {
            return false;
        }
        if (groupIndex >= selectedGroups.length) {
            return childRoles.every((role, roleIndex) => roleCounts[roleIndex] >= (role.min ?? 0));
        }

        const group = selectedGroups[groupIndex];
        const matchingRoleIndexes = childRoles
            .map((role, roleIndex) => ({ role, roleIndex }))
            .filter(({ role }) => groupMatchesRole(group, role))
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

function getGroupFactsSignatureKey(group: GroupFacts): string {
    return [
        group.type ?? 'null',
        group.countsAsType ?? 'null',
        group.modifierKey,
        String(group.tier),
        group.provenance,
        group.tag ?? '',
        String(group.priority ?? 0),
        String(group.directChildCount),
        serializeReadonlyMap(group.childTypeCounts),
        serializeReadonlyMap(group.unitTypeCounts),
        serializeReadonlyMap(group.unitClassCounts),
        serializeReadonlyMap(group.unitTagCounts),
        serializeReadonlyMap(group.unitScalarSums),
        serializeNestedReadonlyMap(group.descendantUnitBucketCounts),
    ].join('||');
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
                    .filter(({ role }) => groupMatchesRole(representativeGroup, role))
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
        guard.compositionVisits += 1;
        if (guard.compositionVisits > MAX_COMPOSITION_SEARCH_VISITS || shouldAbortSearch(guard)) {
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
        guard.compositionVisits += 1;
        if (guard.compositionVisits > MAX_COMPOSITION_SEARCH_VISITS || shouldAbortSearch(guard)) {
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
    const leftPreferenceBuckets = getModifierPreferenceBuckets(left.map((candidate) => candidate.modifierStep));
    const rightPreferenceBuckets = getModifierPreferenceBuckets(right.map((candidate) => candidate.modifierStep));
    const sharedLength = Math.min(leftPreferenceBuckets.length, rightPreferenceBuckets.length);

    for (let index = 0; index < sharedLength; index += 1) {
        const bucketComparison = compareModifierPreferenceBucketKeys(leftPreferenceBuckets[index].key, rightPreferenceBuckets[index].key);
        if (bucketComparison !== 0) {
            return bucketComparison;
        }

        const comparison = leftPreferenceBuckets[index].count - rightPreferenceBuckets[index].count;
        if (comparison !== 0) {
            return comparison;
        }
    }

    if (leftPreferenceBuckets.length !== rightPreferenceBuckets.length) {
        return leftPreferenceBuckets.length - rightPreferenceBuckets.length;
    }

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

function compareModifierStepPreference(left: ModifierStep, right: ModifierStep): number {
    const leftBandScore = left.relativeBand === 'regular' ? 3 : left.relativeBand === 'super-regular' ? 2 : 1;
    const rightBandScore = right.relativeBand === 'regular' ? 3 : right.relativeBand === 'super-regular' ? 2 : 1;
    if (leftBandScore !== rightBandScore) {
        return leftBandScore - rightBandScore;
    }

    if (left.distanceFromRegular !== right.distanceFromRegular) {
        return right.distanceFromRegular - left.distanceFromRegular;
    }

    if (left.count !== right.count) {
        return left.count - right.count;
    }

    return left.tier - right.tier;
}

function getModifierPreferenceBuckets(steps: readonly ModifierStep[]): Array<{ readonly key: string; readonly count: number }> {
    const counts = new Map<string, number>();

    for (const step of steps) {
        const bandScore = step.relativeBand === 'regular' ? 3 : step.relativeBand === 'super-regular' ? 2 : 1;
        const key = `${bandScore}:${step.distanceFromRegular}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((left, right) => {
            return -compareModifierPreferenceBucketKeys(left.key, right.key);
        });
}

function compareModifierPreferenceBucketKeys(leftKey: string, rightKey: string): number {
    const [leftBand, leftDistance] = leftKey.split(':').map(Number);
    const [rightBand, rightDistance] = rightKey.split(':').map(Number);

    if (leftBand !== rightBand) {
        return leftBand - rightBand;
    }

    if (leftDistance !== rightDistance) {
        return rightDistance - leftDistance;
    }

    return 0;
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
        guard.compositionVisits += 1;
        if (guard.compositionVisits > MAX_COMPOSITION_SEARCH_VISITS || shouldAbortSearch(guard)) {
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
        guard.compositionVisits += 1;
        if (guard.compositionVisits > MAX_COMPOSITION_SEARCH_VISITS || shouldAbortSearch(guard)) {
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
    allowedModifierKeys?: ReadonlySet<string>,
): readonly AbstractCompositionCandidate[] {
    const startedAtMs = getSolveTimestampMs();
    const [role] = config.childRoles;
    if (!role) {
        recordComposedPlanMetric(config, 'single-role-fast-path', startedAtMs, 0);
        return [];
    }

    const steps = config.modifierDescriptor.stepsDescending.filter((step) => !allowedModifierKeys || allowedModifierKeys.has(step.modifierKey));
    let availableCounts = entries.map((entry) => entry.availableCount);
    const candidates: AbstractCompositionCandidate[] = [];

    for (const step of steps) {
        if (!canSatisfySingleRoleCount(role, step.count)) {
            continue;
        }

        while (sumSignatureCounts(availableCounts) >= step.count && candidates.length < MAX_COMPOSED_GROUPS_PER_CONFIG) {
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
    }

    recordComposedPlanMetric(config, 'single-role-fast-path', startedAtMs, candidates.length);
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
        recordComposedPlanMetric(config, 'exact-counted', startedAtMs, 0);
        return [];
    }

    if (isSimpleSingleRoleConfig(config)) {
        return planSimpleSingleRoleCompositionsFromEntries(entries, config, allowedModifierKeys);
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
    recordComposedPlanMetric(config, 'exact-counted', startedAtMs, result.length);
    return result;
}

function planCountedCompositions(
    groups: readonly GroupFacts[],
    config: CompositionConfig,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
): readonly AbstractCompositionCandidate[] {
    return planCountedCompositionsFromEntries(
        buildCountedCompositionInventory(groups, config.childRoles).entries,
        config,
        guard,
        allowedModifierKeys,
    );
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

function resolvePlannedCompositionCandidates(
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

function findAbstractCompositionSelection(
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
    const shouldPreferHomogeneousLeafChildren = shouldPreferHomogeneousChildren(config.childRoles)
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
                        registry,
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
        }

        entries.push(...bucketEntries);
        inventory.groupsByEntryId.forEach((value, key) => groupsByEntryId.set(key, value));
        candidates.push(...abstractPlan);
        return getAbstractPlanLeftoverGroups(bucketEntries, abstractPlan, inventory.groupsByEntryId);
    };

    for (const bucketGroups of remainingByBucket.values()) {
        planBucketGroupSet(bucketGroups);
    }

    recordComposedPlanMetric(config, 'pattern-counted', startedAtMs, candidates.length);
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

function planComposedPatternRuleInternal(
    rule: OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
    context?: ResolveContext,
): AbstractCompositionPlanResult {
    const cacheKey = context ? getNegativeComposedPlanCacheKey(rule, groupFacts, allowedModifierKeys) : null;
    if (context && cacheKey && context.negativeComposedPlanKeys.has(cacheKey)) {
        return {
            candidates: [],
            groupsByEntryId: new Map<string, readonly GroupFacts[]>(),
        };
    }

    const config = buildPatternCompositionConfig(rule);
    const planned = planPatternComposedConfig(rule, groupFacts, config, registry, guard, allowedModifierKeys);
    if (context && cacheKey && planned.candidates.length === 0 && !guard.timedOut) {
        context.negativeComposedPlanKeys.add(cacheKey);
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

function planComposedCountRuleInternal(
    rule: OrgComposedCountRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
    context?: ResolveContext,
): AbstractCompositionPlanResult {
    const cacheKey = context ? getNegativeComposedPlanCacheKey(rule, groupFacts, allowedModifierKeys) : null;
    if (context && cacheKey && context.negativeComposedPlanKeys.has(cacheKey)) {
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

    if (context && cacheKey && (best?.candidates.length ?? 0) === 0 && !guard.timedOut) {
        context.negativeComposedPlanKeys.add(cacheKey);
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
        configs.some((config) => config.childRoles.some((role) => groupMatchesRole(group, role))),
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
        rule.childRoles.some((role) => groupMatchesRole(group, role)),
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

export function evaluateOrgDefinition(
    definition: OrgDefinitionSpec,
    units: readonly Unit[],
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
    units: readonly Unit[],
    groups: readonly GroupSizeResult[] = [],
    era?: Era | null,
): OrgDefinitionEvaluationResult {
    return evaluateOrgDefinition(resolveOrgDefinitionSpec(faction, era), units, groups);
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
    definition: OrgDefinitionSpec,
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
    definition: OrgDefinitionSpec,
): number {
    const childTiers = rule.childRoles
        .flatMap((role) => role.matches)
        .map((type) => getRuleTierByTypeFromDefinition(definition, type))
        .filter((tier): tier is number => tier !== null);

    return childTiers.length > 0 ? Math.min(...childTiers) : rule.tier;
}

function getResolveContext(definition: OrgDefinitionSpec): ResolveContext {
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
        if (targetSteps.length === 0) {
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

function getRuleByType(context: ResolveContext, type: GroupSizeResult['type']): OrgComposedCountRule | undefined {
    if (!type) {
        return undefined;
    }
    return context.composedCountRuleByType.get(type);
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
    if (leftScore.highestTier !== rightScore.highestTier) {
        return rightScore.highestTier - leftScore.highestTier;
    }
    if (leftScore.subRegularGroupCount !== rightScore.subRegularGroupCount) {
        return leftScore.subRegularGroupCount - rightScore.subRegularGroupCount;
    }
    if (leftScore.totalRegularityDistance !== rightScore.totalRegularityDistance) {
        return leftScore.totalRegularityDistance - rightScore.totalRegularityDistance;
    }
    if (leftScore.leftoverCount !== rightScore.leftoverCount) {
        return leftScore.leftoverCount - rightScore.leftoverCount;
    }
    if (leftScore.topLevelGroupCount !== rightScore.topLevelGroupCount) {
        return leftScore.topLevelGroupCount - rightScore.topLevelGroupCount;
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

function getRuleTierByType(context: ResolveContext, type: GroupSizeResult['type']): number | null {
    return type ? (context.ruleTierByType.get(type) ?? null) : null;
}

function getMinimumChildTierForRule(rule: OrgComposedCountRule | OrgComposedPatternRule, context: ResolveContext): number {
    return context.minimumChildTierByRule.get(rule) ?? getMinimumChildTierForComposedRule(rule, context.definition);
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

function planComposedRuleInternal(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
    context?: ResolveContext,
): AbstractCompositionPlanResult {
    return rule.kind === 'composed-count'
        ? planComposedCountRuleInternal(rule, groupFacts, registry, guard, allowedModifierKeys, context)
        : planComposedPatternRuleInternal(rule, groupFacts, registry, guard, allowedModifierKeys, context);
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

function getCurrentStructuralCount(
    group: GroupSizeResult,
    descriptor: RuleModifierDescriptor,
): number {
    const step = descriptor.stepsAscending.find((candidate) => candidate.modifierKey === group.modifierKey);
    const impliedCount = step?.count ?? descriptor.regularStep.count;
    const explicitCount = group.children?.length ?? 0;
    return Math.max(impliedCount, explicitCount);
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
        && rule.childRoles.some((role) => groupMatchesRole(facts, role)),
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
            if (rule.kind === 'composed-pattern' && !matchesComposedPatternSelection(rule, state.groupFacts, registry)) {
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
                    name: makeGroupName(rule.type, modifierStep.modifierKey),
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
            context,
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

function compareGroupPoolStates(
    left: CanonicalGroupPoolState,
    right: CanonicalGroupPoolState,
    context: ResolveContext,
): number {
    const leftScore = scoreCanonicalGroupPoolState(left, context);
    const rightScore = scoreCanonicalGroupPoolState(right, context);

    return compareFinalStateScores(leftScore, rightScore);
}

function getApplicableComposedRulesForFacts(
    groupFacts: readonly GroupFacts[],
    context: ResolveContext,
): readonly (OrgComposedCountRule | OrgComposedPatternRule)[] {
    if (groupFacts.length === 0) {
        return [];
    }

    const factsByTier = new Map<number, GroupFacts[]>();
    for (const facts of groupFacts) {
        const existing = factsByTier.get(facts.tier);
        if (existing) {
            existing.push(facts);
        } else {
            factsByTier.set(facts.tier, [facts]);
        }
    }

    return getOrderedComposedRules(context).filter((rule) => {
        const tierFacts = factsByTier.get(getMinimumChildTierForRule(rule, context));
        if (!tierFacts || tierFacts.length === 0) {
            return false;
        }

        if (!tierFacts.some((facts) => rule.childRoles.some((role) => groupMatchesRole(facts, role)))) {
            return false;
        }

        const requiredCount = getRuleStageMetadata(context, rule).descriptor.regularStep.count;
        let matchingCount = 0;
        for (const facts of groupFacts) {
            if (rule.childRoles.some((role) => groupMatchesRole(facts, role))) {
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
    const candidateChildTiers = applicableRules.map((rule) => getMinimumChildTierForRule(rule, context));
    const targetChildTier = candidateChildTiers.length > 0 ? Math.min(...candidateChildTiers) : null;

    if (targetChildTier === null) {
        return initialState;
    }

    for (const rule of applicableRules) {
        if (getMinimumChildTierForRule(rule, context) !== targetChildTier) {
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
    const metrics = activeOrgSolveMetrics;
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

function collectAllGroupUnits(group: GroupSizeResult): Unit[] {
    const result: Unit[] = [];

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

    if (activeOrgSolveMetrics) {
        activeOrgSolveMetrics.timedOut = guard.timedOut;
    }
    addMetricDuration(metrics, 'totalSolveMs', solveStartedAtMs);
    lastOrgSolveMetrics = snapshotOrgSolveMetrics(activeOrgSolveMetrics);
    activeOrgSolveMetrics = null;

    return materialized;
}

function createSyntheticGroupForRule(
    rule: OrgLeafCountRule | OrgLeafPatternRule | OrgComposedCountRule,
    modifierStep: ModifierStep,
): GroupSizeResult {
    return {
        name: makeGroupName(rule.type, modifierStep.modifierKey),
        type: rule.type,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        tag: rule.tag,
        priority: rule.priority,
    };
}

function createConcretePlannedGroupRecord(group: GroupSizeResult): PlannedGroupRecord {
    const facts = getCompiledGroupFacts(group);

    return {
        recordId: facts.groupFactId,
        facts,
        materializedGroup: group,
        materialize: () => group,
    };
}

function createAbstractProducedGroupTemplate(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    modifierStep: ModifierStep,
): GroupSizeResult {
    return {
        name: makeGroupName(rule.type, modifierStep.modifierKey),
        type: rule.type,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        tag: rule.tag,
        priority: rule.priority,
    };
}

function copyReadonlyCountMap<Key extends string>(source: ReadonlyMap<Key, number>): Map<Key, number> {
    return new Map(source.entries());
}

function sumReadonlyCountMaps<Key extends string>(
    children: readonly GroupFacts[],
    select: (child: GroupFacts) => ReadonlyMap<Key, number>,
): Map<Key, number> {
    const result = new Map<Key, number>();

    for (const child of children) {
        for (const [key, count] of select(child).entries()) {
            result.set(key, (result.get(key) ?? 0) + count);
        }
    }

    return result;
}

function sumReadonlyNestedCountMaps<Key extends string>(
    children: readonly GroupFacts[],
    select: (child: GroupFacts) => ReadonlyMap<Key, ReadonlyMap<OrgBucketValue, number>>,
): Map<Key, Map<OrgBucketValue, number>> {
    const result = new Map<Key, Map<OrgBucketValue, number>>();

    for (const child of children) {
        for (const [bucketName, bucketCounts] of select(child).entries()) {
            let mergedCounts = result.get(bucketName);
            if (!mergedCounts) {
                mergedCounts = new Map<OrgBucketValue, number>();
                result.set(bucketName, mergedCounts);
            }

            for (const [bucketValue, count] of bucketCounts.entries()) {
                mergedCounts.set(bucketValue, (mergedCounts.get(bucketValue) ?? 0) + count);
            }
        }
    }

    return result;
}

function createAbstractComposedGroupRecord(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    modifierStep: ModifierStep,
    childRecords: readonly PlannedGroupRecord[],
): PlannedGroupRecord {
    const groupFactId = allocateSyntheticGroupFactId();
    const materializedGroupTemplate = createAbstractProducedGroupTemplate(rule, modifierStep);
    const childFacts = childRecords.map((record) => record.facts);
    const childTypeCounts = new Map<OrgChildTypeCountKey, number>();

    for (const child of childFacts) {
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
    }

    const facts: GroupFacts = {
        groupFactId,
        group: materializedGroupTemplate,
        type: rule.type,
        countsAsType: rule.countsAs ?? null,
        modifierKey: modifierStep.modifierKey,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        tag: rule.tag,
        directChildCount: childRecords.length,
        childTypeCounts,
        unitTypeCounts: sumReadonlyCountMaps(childFacts, (child) => child.unitTypeCounts),
        unitClassCounts: sumReadonlyCountMaps(childFacts, (child) => child.unitClassCounts),
        unitTagCounts: sumReadonlyCountMaps(childFacts, (child) => child.unitTagCounts),
        unitScalarSums: sumReadonlyCountMaps(childFacts, (child) => child.unitScalarSums),
        descendantUnitBucketCounts: sumReadonlyNestedCountMaps(childFacts, (child) => child.descendantUnitBucketCounts),
    };
    const record: PlannedGroupRecord = {
        recordId: groupFactId,
        facts,
        producedPlan: {
            rule,
            modifierStep,
            childRecords,
        },
        materialize: () => {
            if (!record.materializedGroup) {
                materializedGroupTemplate.children = record.producedPlan?.childRecords.map((child) => child.materialize()) ?? [];
                record.materializedGroup = materializedGroupTemplate;
            }
            return record.materializedGroup;
        },
    };

    return record;
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
    definition: OrgDefinitionSpec,
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
    definition: OrgDefinitionSpec,
    units: readonly Unit[],
    groups: readonly GroupSizeResult[],
): GroupSizeResult[] {
    activeOrgSolveMetrics = createMutableOrgSolveMetrics();
    lastOrgSolveMetrics = null;
    const solveStartedAtMs = getSolveTimestampMs();
    const metrics = activeOrgSolveMetrics;

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
    const normalizedInputGroups = normalizeCIFormationGroups(groups, context);
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
    units: readonly Unit[],
    faction: Faction,
    era: Era | null = null,
    _hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
    const definition = resolveOrgDefinitionSpec(faction, era);
    return resolveWithDefinition(definition, units, []);
}

export function resolveFromGroups(
    groupResults: readonly GroupSizeResult[],
    faction: Faction,
    era: Era | null = null,
    _hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
    const definition = resolveOrgDefinitionSpec(faction, era);
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
