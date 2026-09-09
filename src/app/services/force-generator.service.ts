// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { formatUnitName } from '../utils/unit-display-name.util';
import { Injectable, OnDestroy, inject } from '@angular/core';

import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import { createForcePreviewEntryData, type ForcePreviewEntry, type ForcePreviewGroup } from '../models/force-preview.model';
import type { MegaMekWeightedAvailabilityRecord } from '../models/megamek/availability.model';
import type {
    MegaMekRulesetEchelonToken,
    MegaMekRulesetForceNode,
    MegaMekRulesetOptionNode,
    MegaMekRulesetRecord,
    MegaMekRulesetSubforceNode,
} from '../models/megamek/rulesets.model';
import type { LoadForceEntry } from '../models/load-force-entry.model';
import { MAX_UNITS as FORCE_MAX_UNITS } from '../models/force.model';
import { MULFACTION_EXTINCT, MULFACTION_MERCENARY, MULFACTION_NONE } from '../models/mulfactions.model';
import type { ForceGeneratorOptions } from '../models/options.model';
import { getUnitsAverageTechBase } from '../models/tech.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { resolveOrgDefinition } from '../utils/org/org-registry.util';
import { resolveFromGroups, resolveFromUnits } from '../utils/org/org-solver.util';
import { LanceTypeIdentifierUtil, type FormationGroupLike } from '../utils/lance-type-identifier.util';
import { FormationRequirementEngine } from '../utils/formation-requirement-engine.util';
import type { FormationCandidatePredicateFilter, FormationConstraint, FormationEvaluation, FormationSearchDecision } from '../utils/formation-requirement.model';
import { getFormationBlueprint } from '../utils/formation-blueprints';
import type { FormationTypeDefinition } from '../utils/formation-type.model';
import { compileFormationUnitFacts, type FormationUnitLike } from '../utils/formation-unit-facts.util';
import { evaluateFormationPredicate } from '../utils/formation-predicates.util';
import { collectGroupUnits } from '../utils/org/org-facts.util';
import type { GroupSizeResult, OrgDefinition, OrgRuleDefinition, OrgType, OrgUnit } from '../utils/org/org-types';
import { getEffectivePilotingSkill } from '../utils/cbt-common.util';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL, type CrewMemberDetails } from '../models/crew-member.model';
import { getPositiveDropdownNamesFromFilter, resolveDropdownNamesFromFilter } from '../utils/filter-name-resolution.util';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { bondNumberRange } from '../utils/bounded-integer-input.util';
import { normalizeMultiStateSelection } from '../utils/unit-search-shared.util';
import { getUnitVariantGroupKey } from '../utils/unit-variant.util';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';
import { TagsService } from './tags.service';
import { uuidv7 } from '../utils/uuid.util';

import {
    findMatchingForceNode,
    matchesRulesetWhen,
    normalizeRulesetToken,
    resolvePreferredForceNode,
    type ForceNodeSelection,
    type RulesetMatchContext,
} from './force-generator/ruleset-matching';
import {
    addRulesetValues,
    applyForceNodeToProfile,
    createRulesetTemplate,
    getRulesetMatchReasons,
    getRulesetMatchScore,
    mergeRulesetNodeIntoProfile,
    type RulesetProfile,
} from './force-generator/ruleset-preferences';
import { pickWeightedRandomEntry } from './force-generator/weighted-selection';
import {
    createLowestCostCandidateForSkillSettings,
    createSkillAdjustedCandidateOptions,
    createSkillAdjustedCandidateOptionsForSettings,
    getBudgetMetric,
    getForceGenerationCBTSkillPairs,
    hasVariableForceGenerationSkillSettings,
    type SkillRange as ForceGenerationSkillRange,
    type SkillSettings as ForceGenerationSkillSettings,
} from './force-generator/skill-options';
import { getBudgetRangeDistance, getBudgetTarget, isBudgetWithinRange, optimizeSkillBudget } from './force-generator/skill-budget';
import { getScopedAvailabilityWeights, includeMulAvailabilityFallback, type AvailabilityWeights } from './force-generator/availability-weights';

const LOG_ATTEMPTS = false;
const FORCE_GENERATION_OPTIMIZE_SELECTED_SKILLS_FOR_BUDGET = true;
const IGNORED_RARITY_FORCE_GENERATOR_WEIGHTS = { requisition: 1, salvage: 0 } as const;
const FORCE_GENERATION_PRODUCTION_SOURCE_ROLL_WEIGHT = 5;
const FORCE_GENERATION_SALVAGE_SOURCE_ROLL_WEIGHT = 1;
const IMPLICIT_MULTI_FACTION_EXCLUDED_IDS = new Set<number>([MULFACTION_EXTINCT]);
const DEFAULT_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS = 300;
const MIN_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS = 300;
const MAX_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS = 30_000;
export const FORCE_GENERATION_MIN_PILOT_SKILL = 0;
export const FORCE_GENERATION_MAX_PILOT_SKILL = 8;
export const DEFAULT_FORCE_GENERATION_MAX_CBT_SKILL_DELTA = 1;
const PREVIEW_GROUP_SPLIT_MIN_TIER = 1;
const PREVIEW_GROUP_TIER_EPSILON = 0.0001;
const PREVIEW_GROUP_SEARCH_MAX_UNITS = 12;
const PREVIEW_GROUP_SEARCH_MAX_VISITS = 100_000;

const DEFAULT_PREVIEW_FORCE_FACTION: Faction = {
    id: MULFACTION_MERCENARY,
    name: 'Mercenary',
    group: 'Mercenary',
    img: '',
    eras: {},
};

interface ForceGenerationCandidateUnit {
    unit: UnitSummary;
    requisitionWeight: number;
    salvageWeight: number;
    availabilityWeightsIgnored: boolean;
    cost: number;
    alias?: string;
    commander?: boolean;
    skill?: number;
    gunnery?: number;
    piloting?: number;
    crew?: CrewMemberDetails[];
    lockKey?: string;
    variantGroupKey?: string;
    locked: boolean;
    megaMekUnitType: string;
    megaMekWeightClass?: string;
    role?: string;
    motive?: string;
    taggedQuantityCapKey?: string;
    taggedQuantityCap?: number;
}

interface ForceGenerationTaggedQuantityCaps {
    capByKey: ReadonlyMap<string, number>;
    keyByUnitUuid: ReadonlyMap<string, string>;
}

type ForceGenerationAvailabilitySource = 'requisition' | 'salvage';

interface ForceGenerationAvailabilityPair {
    eraId: number;
    factionId: number;
}

interface ForceGenerationCandidateUnitTypeSummary {
    unitType: string;
    candidateCount: number;
    totalAvailabilityWeight: number;
}

interface ForceGenerationAvailabilityWeightCache {
    signature: string;
    useMegaMekAvailability: boolean;
    scopeState: ForceGenerationAvailabilityScopeState;
    weightsByUnitUuid: Map<string, { requisition: number; salvage: number }>;
}

interface ForceGenerationPreparedCandidateCache {
    signature: string;
    candidates: readonly ForceGenerationCandidateUnit[];
}

interface ForceGenerationBaseCandidateUnit {
    unit: UnitSummary;
    cost: number;
    skill?: number;
    gunnery?: number;
    piloting?: number;
    megaMekUnitType: string;
    megaMekWeightClass?: string;
    role?: string;
    motive?: string;
}

interface ForceGenerationBaseCandidateCache {
    signature: string;
    candidates: readonly ForceGenerationBaseCandidateUnit[];
}

interface ForceGenerationSelectionPreparationCache {
    signature: string;
    preparation: ForceGenerationSelectionPreparation;
}

interface ForceGenerationAvailabilityScopeState {
    pairs: readonly ForceGenerationAvailabilityPair[];
    eraIds: readonly number[];
    factionIds: readonly number[];
    eraIdTexts: readonly string[];
    factionIdTextSet: ReadonlySet<string>;
}

interface ForceGenerationTopLevelEchelonOption {
    echelon: string;
    preferredUnitCount: number;
    weight: number;
}

interface ForceGenerationTopLevelUnitTypeChoice {
    summary: ForceGenerationCandidateUnitTypeSummary;
    echelons: ForceGenerationTopLevelEchelonOption[];
}

interface ForceGenerationTopLevelForceNodeChoice {
    summary: ForceGenerationCandidateUnitTypeSummary;
    matchContext: RulesetMatchContext;
}

interface ForceGenerationSuccessfulAttemptRankSnapshot {
    structureScore: number;
    midpointDistance: number;
    unitCount: number;
}

interface ForceGenerationSuccessfulAttemptLog {
    attemptNumber: number;
    selectedEchelon?: string;
    totalCost: number;
    unitCount: number;
    structureScore: number;
    structureSummary: string | null;
    midpointDistance: number;
    perfectMatch: boolean;
    becameBest: boolean;
    decisionReason: string;
    units: {
        label: string;
        cost: number;
    }[];
}

interface ResolvedRulesetContext {
    primary: MegaMekRulesetRecord | null;
    chain: MegaMekRulesetRecord[];
}

interface ForceGenerationSelectionStep {
    unit: UnitSummary;
    locked: boolean;
    rolledSource: ForceGenerationAvailabilitySource;
    source: ForceGenerationAvailabilitySource;
    usedFallbackSource: boolean;
    requisitionWeight: number;
    salvageWeight: number;
    cost: number;
    skill?: number;
    gunnery?: number;
    piloting?: number;
    rulesetReasons: string[];
}

interface ForceGenerationSelectionAttempt {
    selectedCandidates: ForceGenerationCandidateUnit[];
    selectionSteps: ForceGenerationSelectionStep[];
    rulesetProfile: RulesetProfile | null;
    structureEvaluation?: ForceGenerationStructureEvaluation;
    targetFormationGroups?: ForceGenerationTargetFormationCandidateGroup[];
    candidatePoolStarved?: boolean;
}

interface ForceGenerationTargetFormationContext {
    definition: FormationTypeDefinition;
    minUnitCount: number;
    maxUnitCount: number;
}

interface ForceGenerationTargetFormationInstanceContext {
    definition: FormationTypeDefinition;
    preferredUnitCount: number;
}

interface ForceGenerationTargetFormationSetContext {
    selections: ForceGenerationTargetFormationSelection[];
    instances: ForceGenerationTargetFormationInstanceContext[];
}

interface ForceGenerationTargetFormationCandidateGroup {
    formationId: string;
    unitIndexes: number[];
}

interface ForceGenerationTargetFormationSetAttemptEvaluation {
    rank: ForceGenerationTargetAttemptRank;
    allTargetsSatisfied: boolean;
    budgetValid: boolean;
    unitCountValid: boolean;
    message: string;
}

interface ForceGenerationSelectionPreparation {
    rulesetProfile: RulesetProfile | null;
    selectableCandidates: readonly ForceGenerationCandidateUnit[];
    lowestCostCandidates: readonly ForceGenerationCandidateUnit[];
    highestCostCandidates: readonly ForceGenerationCandidateUnit[];
    rulesetScoreByCandidate: Map<ForceGenerationCandidateUnit, number>;
    rulesetReasonsByCandidate: Map<ForceGenerationCandidateUnit, string[]>;
}

interface ForceGenerationAttemptBudget {
    minAttempts: number;
    maxAttempts: number;
    targetDurationMs: number;
}

interface ForceGenerationInterruptSignal {
    terminated: boolean;
}

interface ForceGenerationSearchDeadline {
    expiresAtMs: number;
    interruptSignal?: ForceGenerationInterruptSignal;
}

interface ForceGenerationSkillBudgetPlanningCosts {
    minCostByCandidate: ReadonlyMap<ForceGenerationCandidateUnit, number>;
    maxCostByCandidate: ReadonlyMap<ForceGenerationCandidateUnit, number>;
}

interface ForceGenerationBudgetFeasibilityOptions {
    unitCount: number;
    budgetRange?: ForceGenerationBudgetRange;
    lockedCandidates: readonly ForceGenerationCandidateUnit[];
    preventDuplicateChassis: boolean;
    skillBudgetPlanningCosts?: ForceGenerationSkillBudgetPlanningCosts;
}

interface ForceGenerationUnitTypeGroup {
    summary: ForceGenerationCandidateUnitTypeSummary;
    candidates: readonly ForceGenerationCandidateUnit[];
}

interface ForceGenerationTopLevelChoiceContext {
    unitTypeGroups: readonly ForceGenerationUnitTypeGroup[];
    baseMatchContext: RulesetMatchContext;
    minUnitCount: number;
    maxUnitCount: number;
    orgDefinition: OrgDefinition | null;
    budgetRange?: ForceGenerationBudgetRange;
    lockedCandidates: readonly ForceGenerationCandidateUnit[];
    preventDuplicateChassis: boolean;
    skillBudgetPlanningCosts?: ForceGenerationSkillBudgetPlanningCosts;
}

interface ForceGenerationTargetFormationBudgetReachabilityContext {
    lowestCostCandidatePool: readonly ForceGenerationCandidateUnit[];
}

type ForceGenerationSkillOptionResolver = (
    candidate: ForceGenerationCandidateUnit,
    index: number,
) => readonly ForceGenerationCandidateUnit[];

interface ForceGenerationTargetAttemptRank {
    satisfiedTargetCount: number;
    requestedTargetCount: number;
    formationDeficitScore: number;
    budgetDistance: number;
    unitCountDistance: number;
}

interface ForceGenerationTargetSearchAttemptResult {
    attempt: ForceGenerationSelectionAttempt;
    rank: ForceGenerationTargetAttemptRank;
    complete: boolean;
    message: string | null;
}

interface ForceGenerationTargetSearchResult {
    bestAttempt: ForceGenerationSelectionAttempt | null;
    bestResult: ForceGenerationTargetSearchAttemptResult | null;
    completeAttempt: ForceGenerationSelectionAttempt | null;
    attemptsTried: number;
}

interface ForceGenerationStructureEvaluation {
    score: number;
    perfectMatch: boolean;
    summary: string;
}

export interface ForceGenerationPreview {
    gameSystem: GameSystem;
    name?: string;
    units: GeneratedForceUnit[];
    totalCost: number;
    error: string | null;
    faction: Faction | null;
    era: Era | null;
    explanationLines: string[];
    targetFormationId?: string;
    targetFormations?: ForceGenerationTargetFormationSelection[];
    targetFormationGroups?: ForceGenerationTargetFormationPreviewGroup[];
}

export interface ForceGenerationPreviewTask {
    isAsync: boolean;
    result: Promise<ForceGenerationPreview>;
    terminate(): void;
}

export interface ForceGenerationTargetFormationSelection {
    formationId: string;
    count: number;
}

export interface ForceGenerationTargetFormationPreviewGroup {
    formationId: string;
    unitIndexes: number[];
    validatedGameSystem?: GameSystem;
}

export interface ForceGenerationRequest {
    context: ForceGenerationContext;
    eligibleUnits?: readonly UnitSummary[];
    searchSettings?: readonly string[];
    gameSystem: GameSystem;
    budgetRange: ForceGenerationBudgetRange;
    minUnitCount: number;
    maxUnitCount: number;
    gunnery: number;
    piloting: number;
    skillRanges?: ForceGenerationSkillRanges;
    lockedUnits?: readonly GeneratedForceUnit[];
    ignoreRarityWeight?: boolean;
    preventDuplicateChassis?: boolean;
    useTaggedQuantities?: boolean;
    useUnitTagsAsChassisTags?: boolean;
    targetFormationId?: string;
    targetFormations?: readonly ForceGenerationTargetFormationSelection[];
}

export interface ForceGenerationSkillRanges {
    gunnery: ForceGenerationSkillRange;
    piloting?: ForceGenerationSkillRange;
    maxDelta?: number;
}

export interface ForceGenerationBudgetRange {
    min: number;
    max: number;
}

export interface ForceGenerationContextOptions {
    crossEraAvailabilityInMultiEraSelection?: boolean;
    randomFaction?: boolean;
    mergeSelectedFactionAvailability?: boolean;
    gameSystem?: GameSystem;
    targetFormationId?: string;
    targetFormations?: readonly ForceGenerationTargetFormationSelection[];
}

export interface ForceGenerationContext {
    forceFaction: Faction | null;
    forceEra: Era | null;
    availabilityFactionIds: readonly number[];
    availabilityEraIds: readonly number[];
    useAvailabilityFactionScope?: boolean;
    useAvailabilityEraScope?: boolean;
    availablePairCount: number;
    ruleset: MegaMekRulesetRecord | null;
    explicitFactionSelection?: boolean;
    targetFormationFactionInferred?: boolean;
}

export interface GeneratedForceUnit {
    unit: UnitSummary;
    cost: number;
    skill?: number;
    gunnery?: number;
    piloting?: number;
    crew?: CrewMemberDetails[];
    alias?: string;
    commander?: boolean;
    lockKey?: string;
    variantGroupKey?: string;
}

export function normalizeGeneratedCBTCrew(
    unit: UnitSummary,
    crew: readonly CrewMemberDetails[] | undefined,
    gunnery: number,
    piloting: number,
    alias?: string,
): CrewMemberDetails[] | undefined {
    const isLandAirMek = unit.subtype === 'Land-Air BattleMek';
    if (!crew?.length && !isLandAirMek) {
        return undefined;
    }

    const effectivePiloting = getEffectivePilotingSkill(unit, piloting);
    return Array.from({ length: Math.max(1, unit.crewSize || 1) }, (_, id) => {
        const existing = crew?.find((member) => member.id === id);
        const memberGunnery = existing?.gunnery ?? gunnery ?? DEFAULT_GUNNERY_SKILL;
        const memberPiloting = getEffectivePilotingSkill(
            unit,
            existing?.piloting ?? effectivePiloting ?? DEFAULT_PILOTING_SKILL,
        );
        return {
            id,
            name: existing?.name ?? (id === 0 ? alias ?? '' : ''),
            gunnery: memberGunnery,
            piloting: memberPiloting,
            ...(isLandAirMek ? {
                asfGunnery: existing?.asfGunnery ?? memberGunnery,
                asfPiloting: existing?.asfPiloting ?? memberPiloting,
            } : {}),
        };
    });
}

export function getGeneratedCBTCrewSkill(
    crew: readonly CrewMemberDetails[] | undefined,
    skillType: 'gunnery' | 'piloting',
    fallback: number,
): number {
    if (!crew?.length) return fallback;
    const asfSkill = skillType === 'gunnery' ? 'asfGunnery' : 'asfPiloting';
    return Math.min(...crew.flatMap((member) => [member[skillType], member[asfSkill]]
        .filter((skill): skill is number => skill !== undefined)));
}

export interface ForceGeneratorBudgetDefaults {
    classic: ForceGenerationBudgetRange;
    alphaStrike: ForceGenerationBudgetRange;
}

export interface ForceGeneratorUnitCountDefaults {
    min: number;
    max: number;
}

export interface ForceGeneratorSkillDefaults {
    gunnery: ForceGenerationSkillRange;
    piloting: ForceGenerationSkillRange;
    maxDelta: number;
}

interface PreviewGroupPlanContext {
    faction: Faction;
    era: Era | null;
    gameSystem: GameSystem;
    factionName: string;
    formationMatchCache: Map<string, ReturnType<typeof LanceTypeIdentifierUtil.getBestMatchForGroup> | null>;
}

interface PlannedPreviewGroup {
    previewGroup: ForcePreviewGroup;
    firstUnitIndex: number;
}

interface PreviewGroupPlan {
    groups: PlannedPreviewGroup[];
    score: number;
    formationCount: number;
}

interface PreviewGroupTemplate {
    group: GroupSizeResult;
    unitCount: number;
    signature: string;
}

interface PreviewGroupSearchState {
    visits: number;
    aborted: boolean;
}

const COMMON_ECHELON_UNIT_COUNTS = new Map<string, number>([
    ['ELEMENT', 1],
    ['POINT', 1],
    ['LEVEL_I', 1],
    ['SQUAD', 1],
    ['PLATOON', 1],
    ['FLIGHT', 2],
    ['LANCE', 4],
    ['STAR', 5],
    ['LEVEL_II', 6],
    ['SQUADRON', 6],
    ['BINARY', 10],
    ['COMPANY', 12],
    ['TRINARY', 15],
]);

const ECHELON_TO_ORG_TYPE = new Map<string, OrgType>([
    ['ELEMENT', 'Element'],
    ['POINT', 'Point'],
    ['LEVEL_I', 'Level I'],
    ['SQUAD', 'Squad'],
    ['PLATOON', 'Platoon'],
    ['FLIGHT', 'Flight'],
    ['LANCE', 'Lance'],
    ['STAR', 'Star'],
    ['LEVEL_II', 'Level II'],
    ['SQUADRON', 'Squadron'],
    ['WING', 'Wing'],
    ['BINARY', 'Binary'],
    ['COMPANY', 'Company'],
    ['TRINARY', 'Trinary'],
    ['BATTALION', 'Battalion'],
    ['CLUSTER', 'Cluster'],
    ['REGIMENT', 'Regiment'],
    ['BRIGADE', 'Brigade'],
    ['GALAXY', 'Galaxy'],
    ['LEVEL_III', 'Level III'],
    ['LEVEL_IV', 'Level IV'],
    ['LEVEL_V', 'Level V'],
    ['LEVEL_VI', 'Level VI'],
]);

function resolvePreviewGroupSignature(group: GroupSizeResult): string {
    return `${group.type ?? 'null'}|${group.modifierKey}|${group.countsAsType ?? 'null'}`;
}

function isPreviewGroupTierOneOrHigher(group: GroupSizeResult): boolean {
    return group.tier + PREVIEW_GROUP_TIER_EPSILON >= PREVIEW_GROUP_SPLIT_MIN_TIER;
}

function shouldSplitPreviewGroup(group: GroupSizeResult): boolean {
    const children = group.children ?? [];
    return children.length > 0 && children.every((child) => isPreviewGroupTierOneOrHigher(child));
}

function matchesPreviewGroupTemplate(candidate: GroupSizeResult, template: GroupSizeResult): boolean {
    return candidate.type === template.type
        && candidate.modifierKey === template.modifierKey
        && candidate.countsAsType === template.countsAsType;
}

function getPreviewTemplateSearchKey(template: PreviewGroupTemplate): string {
    return `${template.signature}|${template.unitCount}`;
}

function compareIndexSelections(left: readonly number[], right: readonly number[]): number {
    const count = Math.min(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
        if (left[index] !== right[index]) {
            return left[index] - right[index];
        }
    }

    return left.length - right.length;
}

function getGeneratedUnitsForSelection(
    generatedUnits: readonly GeneratedForceUnit[],
    selectedIndices: readonly number[],
): readonly GeneratedForceUnit[] {
    return selectedIndices.map((index) => generatedUnits[index]);
}

function removeSelectedIndices(
    remainingIndices: readonly number[],
    selectedIndices: readonly number[],
): number[] {
    const nextRemainingIndices: number[] = [];
    let selectedCursor = 0;

    for (const remainingIndex of remainingIndices) {
        while (selectedCursor < selectedIndices.length && selectedIndices[selectedCursor] < remainingIndex) {
            selectedCursor += 1;
        }

        if (selectedIndices[selectedCursor] !== remainingIndex) {
            nextRemainingIndices.push(remainingIndex);
        }
    }

    return nextRemainingIndices;
}

function createGeneratedUnitQueues(generatedUnits: readonly GeneratedForceUnit[]): Map<OrgUnit, GeneratedForceUnit[]> {
    const queueByUnit = new Map<OrgUnit, GeneratedForceUnit[]>();

    for (const generatedUnit of generatedUnits) {
        const queue = queueByUnit.get(generatedUnit.unit);
        if (queue) {
            queue.push(generatedUnit);
            continue;
        }

        queueByUnit.set(generatedUnit.unit, [generatedUnit]);
    }

    return queueByUnit;
}

function takeGeneratedUnitsForUnitList(
    units: readonly OrgUnit[],
    queueByUnit: Map<OrgUnit, GeneratedForceUnit[]>,
): GeneratedForceUnit[] | null {
    const result: GeneratedForceUnit[] = [];

    for (const unit of units) {
        const queue = queueByUnit.get(unit);
        const generatedUnit = queue?.shift();
        if (!generatedUnit) {
            return null;
        }

        result.push(generatedUnit);
    }

    return result;
}

function countQueuedGeneratedUnits(queueByUnit: ReadonlyMap<OrgUnit, readonly GeneratedForceUnit[]>): number {
    let count = 0;
    for (const queue of queueByUnit.values()) {
        count += queue.length;
    }

    return count;
}

function combinePreviewGroupPlans(plans: readonly PreviewGroupPlan[]): PreviewGroupPlan {
    return {
        groups: [...plans.flatMap((plan) => plan.groups)].sort((left, right) => left.firstUnitIndex - right.firstUnitIndex),
        score: plans.reduce((sum, plan) => sum + plan.score, 0),
        formationCount: plans.reduce((sum, plan) => sum + plan.formationCount, 0),
    };
}

function getPreviewGroupRegularityScore(group: GroupSizeResult): number {
    if (!group.type || group.tier < PREVIEW_GROUP_SPLIT_MIN_TIER) {
        return 0;
    }

    if (group.modifierKey === '') {
        return 2;
    }

    if (group.modifierKey === 'Half ' || group.modifierKey === 'Short ' || group.modifierKey === 'Under-Strength ') {
        return -1;
    }

    return 0;
}

function isBetterPreviewGroupPlan(candidate: PreviewGroupPlan, incumbent: PreviewGroupPlan | null): boolean {
    if (!incumbent) {
        return true;
    }

    if (candidate.score !== incumbent.score) {
        return candidate.score > incumbent.score;
    }

    if (candidate.formationCount !== incumbent.formationCount) {
        return candidate.formationCount > incumbent.formationCount;
    }

    return false;
}

function createGeneratedPreviewGroup(
    generatedUnits: readonly GeneratedForceUnit[],
    gameSystem: GameSystem,
    formationId?: string,
): ForcePreviewGroup {
    const requiresCommander = generatedUnits.length >= 4;
    let commanderIndex = generatedUnits.findIndex((unit) => unit.commander);
    if (requiresCommander && commanderIndex < 0) {
        commanderIndex = generatedUnits.reduce((bestIndex, unit, index) => {
            const best = generatedUnits[bestIndex];
            if (!best) return index;
            if (gameSystem === GameSystem.AS) {
                return (unit.skill ?? Number.POSITIVE_INFINITY) < (best.skill ?? Number.POSITIVE_INFINITY)
                    ? index
                    : bestIndex;
            }
            const unitTotal = (unit.gunnery ?? Number.POSITIVE_INFINITY) + (unit.piloting ?? Number.POSITIVE_INFINITY);
            const bestTotal = (best.gunnery ?? Number.POSITIVE_INFINITY) + (best.piloting ?? Number.POSITIVE_INFINITY);
            if (unitTotal !== bestTotal) return unitTotal < bestTotal ? index : bestIndex;
            if (unit.gunnery !== best.gunnery) {
                return (unit.gunnery ?? Number.POSITIVE_INFINITY) < (best.gunnery ?? Number.POSITIVE_INFINITY)
                    ? index
                    : bestIndex;
            }
            return bestIndex;
        }, 0);
    }
    return {
        formationId,
        units: generatedUnits.map((generatedUnit, index) => ({
            unit: generatedUnit.unit,
            destroyed: false,
            gunnery: gameSystem === GameSystem.CBT ? generatedUnit.gunnery : undefined,
            piloting: gameSystem === GameSystem.CBT ? generatedUnit.piloting : undefined,
            skill: gameSystem === GameSystem.AS ? generatedUnit.skill : undefined,
            alias: generatedUnit.alias,
            crew: gameSystem === GameSystem.CBT
                ? generatedUnit.crew?.map((member) => ({ ...member }))
                : undefined,
            commander: requiresCommander ? index === commanderIndex : generatedUnit.commander,
            lockKey: generatedUnit.lockKey,
        })),
    };
}

function getGeneratedUnitFirstIndex(
    generatedUnits: readonly GeneratedForceUnit[],
    unitIndexByGeneratedUnit: ReadonlyMap<GeneratedForceUnit, number>,
): number {
    let firstIndex = Number.MAX_SAFE_INTEGER;

    for (const generatedUnit of generatedUnits) {
        firstIndex = Math.min(firstIndex, unitIndexByGeneratedUnit.get(generatedUnit) ?? Number.MAX_SAFE_INTEGER);
    }

    return firstIndex;
}

function createPreviewFormationUnit(
    generatedUnit: GeneratedForceUnit,
    forceContext: {
        faction: () => Faction | null;
        era: () => Era | null;
        techBase: () => string;
        gameSystem: GameSystem;
    },
): FormationUnitLike {
    return {
        force: forceContext,
        getFormationSummary: () => generatedUnit.unit,
        pilotSkill: () => generatedUnit.skill ?? generatedUnit.gunnery ?? 4,
        gunnerySkill: () => generatedUnit.gunnery ?? generatedUnit.skill ?? 4,
    };
}

function hasGroupDependentPreviewFormationFiltering(resolvedGroup: GroupSizeResult): boolean {
    return !!resolvedGroup.type && (
        (resolvedGroup.children?.length ?? 0) > 0
        || (resolvedGroup.formationMatchingIgnoredUnits?.length ?? 0) > 0
    );
}

function getBestPreviewFormationMatch(
    generatedUnits: readonly GeneratedForceUnit[],
    resolvedGroup: GroupSizeResult,
    context: PreviewGroupPlanContext,
): ReturnType<typeof LanceTypeIdentifierUtil.getBestMatchForGroup> {
    const units = generatedUnits.map((generatedUnit) => generatedUnit.unit);
    const techBase = getUnitsAverageTechBase(units);
    const forceContext = {
        faction: () => context.faction,
        era: () => context.era,
        techBase: () => techBase,
        gameSystem: context.gameSystem,
    };
    const formationUnits = generatedUnits.map((generatedUnit) => createPreviewFormationUnit(generatedUnit, forceContext));
    if (!hasGroupDependentPreviewFormationFiltering(resolvedGroup)) {
        return LanceTypeIdentifierUtil.getBestMatch(
            formationUnits,
            techBase,
            context.factionName,
            context.gameSystem,
        );
    }

    const group: FormationGroupLike = {
        force: forceContext,
        units: () => formationUnits,
        organizationalResult: () => ({
            name: resolvedGroup.name,
            tier: resolvedGroup.tier,
            groups: [resolvedGroup],
        }),
        formationHistory: new Set<string>(),
    };

    return LanceTypeIdentifierUtil.getBestMatchForGroup(group);
}

function createPreviewLeafGroupPlan(
    resolvedGroup: GroupSizeResult,
    generatedUnits: readonly GeneratedForceUnit[],
    context: PreviewGroupPlanContext,
    unitIndexByGeneratedUnit: ReadonlyMap<GeneratedForceUnit, number>,
): PreviewGroupPlan {
    const orderedGeneratedUnits = [...generatedUnits].sort((left, right) => (
        (unitIndexByGeneratedUnit.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (unitIndexByGeneratedUnit.get(right) ?? Number.MAX_SAFE_INTEGER)
    ));
    const orderedUnitIndexes = orderedGeneratedUnits
        .map((generatedUnit) => unitIndexByGeneratedUnit.get(generatedUnit) ?? Number.MAX_SAFE_INTEGER)
        .join(',');
    const formationMatchCacheKey = hasGroupDependentPreviewFormationFiltering(resolvedGroup)
        ? `${resolvePreviewGroupSignature(resolvedGroup)}:${orderedUnitIndexes}`
        : `units:${orderedUnitIndexes}`;
    let bestMatch = context.formationMatchCache.get(formationMatchCacheKey);
    if (bestMatch === undefined) {
        bestMatch = getBestPreviewFormationMatch(orderedGeneratedUnits, resolvedGroup, context) ?? null;
        context.formationMatchCache.set(formationMatchCacheKey, bestMatch);
    }

    const formationId = bestMatch?.definition.id;

    return {
        groups: [{
            previewGroup: createGeneratedPreviewGroup(orderedGeneratedUnits, context.gameSystem, formationId),
            firstUnitIndex: getGeneratedUnitFirstIndex(orderedGeneratedUnits, unitIndexByGeneratedUnit),
        }],
        score: (bestMatch
            ? LanceTypeIdentifierUtil.getFormationPriorityWeight(bestMatch.definition, context.factionName)
            : 0) + getPreviewGroupRegularityScore(resolvedGroup),
        formationCount: formationId ? 1 : 0,
    };
}

function materializePreviewTemplateLeafGroup(
    template: GroupSizeResult,
    generatedUnits: readonly GeneratedForceUnit[],
): GroupSizeResult {
    return {
        name: template.name,
        type: template.type,
        modifierKey: template.modifierKey,
        countsAsType: template.countsAsType,
        tier: template.tier,
        units: generatedUnits.map((generatedUnit) => generatedUnit.unit),
        tag: template.tag,
        priority: template.priority,
    };
}

function buildPreviewGroupPlanFromChildren(
    group: GroupSizeResult,
    generatedUnits: readonly GeneratedForceUnit[],
    context: PreviewGroupPlanContext,
    unitIndexByGeneratedUnit: ReadonlyMap<GeneratedForceUnit, number>,
): PreviewGroupPlan | null {
    const children = group.children ?? [];
    if (children.length === 0) {
        return null;
    }

    const queueByUnit = createGeneratedUnitQueues(generatedUnits);
    const childPlans: PreviewGroupPlan[] = [];

    for (const child of children) {
        const childGeneratedUnits = takeGeneratedUnitsForUnitList(collectGroupUnits(child), queueByUnit);
        if (!childGeneratedUnits) {
            return null;
        }

        childPlans.push(buildPreviewGroupPlanFromResolvedGroup(child, childGeneratedUnits, context, unitIndexByGeneratedUnit));
    }

    if (countQueuedGeneratedUnits(queueByUnit) > 0) {
        return null;
    }

    return combinePreviewGroupPlans(childPlans);
}

function forEachIndexCombination(
    indices: readonly number[],
    size: number,
    callback: (selected: readonly number[]) => boolean,
): boolean {
    const selected: number[] = [];

    const visit = (start: number, remaining: number): boolean => {
        if (remaining === 0) {
            return callback(selected);
        }

        for (let index = start; index <= indices.length - remaining; index += 1) {
            selected.push(indices[index]);
            if (visit(index + 1, remaining - 1)) {
                return true;
            }
            selected.pop();
        }

        return false;
    };

    return visit(0, size);
}

function searchOptimizedPreviewGroupPlan(
    templates: readonly PreviewGroupTemplate[],
    generatedUnits: readonly GeneratedForceUnit[],
    context: PreviewGroupPlanContext,
    unitIndexByGeneratedUnit: ReadonlyMap<GeneratedForceUnit, number>,
    evaluationCache: Map<string, PreviewGroupPlan | null>,
    generatedUnitsBySelectionCache: Map<string, readonly GeneratedForceUnit[]>,
    resolvedGroupsBySelectionCache: Map<string, readonly GroupSizeResult[]>,
    searchState: PreviewGroupSearchState,
    templateIndex: number,
    remainingIndices: readonly number[],
    previousEquivalentTemplateSelection: readonly number[] | null,
): PreviewGroupPlan | null {
    if (templateIndex >= templates.length) {
        return remainingIndices.length === 0
            ? { groups: [], score: 0, formationCount: 0 }
            : null;
    }

    const template = templates[templateIndex];
    if (remainingIndices.length < template.unitCount) {
        return null;
    }

    let bestPlan: PreviewGroupPlan | null = null;
    const candidateSelections = templateIndex === templates.length - 1
        ? [remainingIndices]
        : null;
    const templateSearchKey = getPreviewTemplateSearchKey(template);

    const evaluateSelection = (selectedIndices: readonly number[]): boolean => {
        if (previousEquivalentTemplateSelection
            && compareIndexSelections(selectedIndices, previousEquivalentTemplateSelection) <= 0) {
            return false;
        }

        if (searchState.visits >= PREVIEW_GROUP_SEARCH_MAX_VISITS) {
            searchState.aborted = true;
            return true;
        }

        searchState.visits += 1;

        const selectionCacheKey = selectedIndices.join(',');
        const cacheKey = `${template.signature}:${selectionCacheKey}`;
        let childPlan = evaluationCache.get(cacheKey);
        if (childPlan === undefined) {
            let childGeneratedUnits = generatedUnitsBySelectionCache.get(selectionCacheKey);
            if (!childGeneratedUnits) {
                childGeneratedUnits = getGeneratedUnitsForSelection(generatedUnits, selectedIndices);
                generatedUnitsBySelectionCache.set(selectionCacheKey, childGeneratedUnits);
            }

            let resolvedChildGroup: GroupSizeResult | null = null;
            if (!shouldSplitPreviewGroup(template.group) && childGeneratedUnits.length === template.unitCount) {
                resolvedChildGroup = materializePreviewTemplateLeafGroup(template.group, childGeneratedUnits);
            } else {
                let resolvedChildGroups = resolvedGroupsBySelectionCache.get(selectionCacheKey);
                if (!resolvedChildGroups) {
                    resolvedChildGroups = resolveFromUnits(
                        childGeneratedUnits.map((generatedUnit) => generatedUnit.unit),
                        context.faction,
                        context.era,
                    );
                    resolvedGroupsBySelectionCache.set(selectionCacheKey, resolvedChildGroups);
                }

                resolvedChildGroup = resolvedChildGroups.length === 1 && matchesPreviewGroupTemplate(resolvedChildGroups[0], template.group)
                    ? resolvedChildGroups[0]
                    : null;
            }

            if (!resolvedChildGroup) {
                childPlan = null;
            } else {
                childPlan = buildPreviewGroupPlanFromResolvedGroup(
                    resolvedChildGroup,
                    childGeneratedUnits,
                    context,
                    unitIndexByGeneratedUnit,
                );
            }

            evaluationCache.set(cacheKey, childPlan);
        }

        if (!childPlan) {
            return false;
        }

        const nextRemainingIndices = removeSelectedIndices(remainingIndices, selectedIndices);
        const nextTemplateSearchKey = templates[templateIndex + 1]
            ? getPreviewTemplateSearchKey(templates[templateIndex + 1])
            : null;
        const tailPlan = searchOptimizedPreviewGroupPlan(
            templates,
            generatedUnits,
            context,
            unitIndexByGeneratedUnit,
            evaluationCache,
            generatedUnitsBySelectionCache,
            resolvedGroupsBySelectionCache,
            searchState,
            templateIndex + 1,
            nextRemainingIndices,
            nextTemplateSearchKey === templateSearchKey ? selectedIndices : null,
        );
        if (!tailPlan) {
            return searchState.aborted;
        }

        const combinedPlan = combinePreviewGroupPlans([childPlan, tailPlan]);
        if (isBetterPreviewGroupPlan(combinedPlan, bestPlan)) {
            bestPlan = combinedPlan;
        }

        return searchState.aborted;
    };

    if (candidateSelections) {
        evaluateSelection(candidateSelections[0]);
        return searchState.aborted ? null : bestPlan;
    }

    forEachIndexCombination(remainingIndices, template.unitCount, evaluateSelection);
    return searchState.aborted ? null : bestPlan;
}

function tryBuildOptimizedPreviewPlanForGroups(
    groups: readonly GroupSizeResult[],
    generatedUnits: readonly GeneratedForceUnit[],
    context: PreviewGroupPlanContext,
    unitIndexByGeneratedUnit: ReadonlyMap<GeneratedForceUnit, number>,
): PreviewGroupPlan | null {
    if (groups.length <= 1 || generatedUnits.length > PREVIEW_GROUP_SEARCH_MAX_UNITS) {
        return null;
    }

    const templates = groups
        .map((group) => ({
            group,
            unitCount: collectGroupUnits(group).length,
            signature: resolvePreviewGroupSignature(group),
        }))
        .filter((template) => template.unitCount > 0);
    if (templates.length !== groups.length) {
        return null;
    }

    const evaluationCache = new Map<string, PreviewGroupPlan | null>();
    const generatedUnitsBySelectionCache = new Map<string, readonly GeneratedForceUnit[]>();
    const resolvedGroupsBySelectionCache = new Map<string, readonly GroupSizeResult[]>();
    const searchState: PreviewGroupSearchState = { visits: 0, aborted: false };

    return searchOptimizedPreviewGroupPlan(
        templates,
        generatedUnits,
        context,
        unitIndexByGeneratedUnit,
        evaluationCache,
        generatedUnitsBySelectionCache,
        resolvedGroupsBySelectionCache,
        searchState,
        0,
        generatedUnits.map((_, index) => index),
        null,
    );
}

function tryBuildOptimizedPreviewGroupPlan(
    group: GroupSizeResult,
    generatedUnits: readonly GeneratedForceUnit[],
    context: PreviewGroupPlanContext,
    unitIndexByGeneratedUnit: ReadonlyMap<GeneratedForceUnit, number>,
): PreviewGroupPlan | null {
    return tryBuildOptimizedPreviewPlanForGroups(
        group.children ?? [],
        generatedUnits,
        context,
        unitIndexByGeneratedUnit,
    );
}

function buildPreviewGroupPlanFromResolvedGroup(
    group: GroupSizeResult,
    generatedUnits: readonly GeneratedForceUnit[],
    context: PreviewGroupPlanContext,
    unitIndexByGeneratedUnit: ReadonlyMap<GeneratedForceUnit, number>,
): PreviewGroupPlan {
    if (!shouldSplitPreviewGroup(group)) {
        return createPreviewLeafGroupPlan(group, generatedUnits, context, unitIndexByGeneratedUnit);
    }

    const optimizedPlan = tryBuildOptimizedPreviewGroupPlan(group, generatedUnits, context, unitIndexByGeneratedUnit);
    if (optimizedPlan) {
        return optimizedPlan;
    }

    const childPlan = buildPreviewGroupPlanFromChildren(group, generatedUnits, context, unitIndexByGeneratedUnit);
    if (childPlan) {
        return childPlan;
    }

    return createPreviewLeafGroupPlan(group, generatedUnits, context, unitIndexByGeneratedUnit);
}

function buildPreviewGroups(
    generatedUnits: readonly GeneratedForceUnit[],
    context: PreviewGroupPlanContext,
): ForcePreviewGroup[] {
    const resolvedUnitGroups = resolveFromUnits(
        generatedUnits.map((generatedUnit) => generatedUnit.unit),
        context.faction,
        context.era,
    );
    const resolvedGroups = resolvedUnitGroups.length > 1
        ? resolveFromGroups(resolvedUnitGroups, context.faction, context.era)
        : resolvedUnitGroups;
    const unitIndexByGeneratedUnit = new Map(generatedUnits.map((generatedUnit, index) => [generatedUnit, index]));
    const optimizedTopLevelPlan = tryBuildOptimizedPreviewPlanForGroups(
        resolvedGroups,
        generatedUnits,
        context,
        unitIndexByGeneratedUnit,
    );
    if (optimizedTopLevelPlan) {
        return optimizedTopLevelPlan.groups.map((plannedGroup) => plannedGroup.previewGroup);
    }

    const queueByUnit = createGeneratedUnitQueues(generatedUnits);
    const plannedGroups: PreviewGroupPlan[] = [];

    for (const resolvedGroup of resolvedGroups) {
        const groupGeneratedUnits = takeGeneratedUnitsForUnitList(collectGroupUnits(resolvedGroup), queueByUnit);
        if (!groupGeneratedUnits) {
            return [createGeneratedPreviewGroup(generatedUnits, context.gameSystem)];
        }

        plannedGroups.push(buildPreviewGroupPlanFromResolvedGroup(
            resolvedGroup,
            groupGeneratedUnits,
            context,
            unitIndexByGeneratedUnit,
        ));
    }

    if (countQueuedGeneratedUnits(queueByUnit) > 0) {
        return [createGeneratedPreviewGroup(generatedUnits, context.gameSystem)];
    }

    return combinePreviewGroupPlans(plannedGroups).groups.map((plannedGroup) => plannedGroup.previewGroup);
}

function normalizeInitialBudgetRange(min: number, max: number): ForceGenerationBudgetRange {
    const normalizedMin = Math.max(0, min);
    const normalizedMax = Math.max(0, max);

    return {
        min: normalizedMax > 0 ? Math.min(normalizedMin, normalizedMax) : normalizedMin,
        max: normalizedMax,
    };
}

function normalizeInitialUnitCountRange(min: number, max: number): ForceGeneratorUnitCountDefaults {
    const normalizedMin = Math.min(FORCE_MAX_UNITS, Math.max(1, Math.floor(min)));
    const normalizedMax = Math.max(normalizedMin, Math.floor(max));

    return {
        min: normalizedMin,
        max: Math.min(FORCE_MAX_UNITS, normalizedMax),
    };
}

function normalizeBudgetBound(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeUnitCountBound(value: number): number {
    return Number.isFinite(value) ? Math.min(FORCE_MAX_UNITS, Math.max(1, Math.floor(value))) : 1;
}

function normalizeForceGenerationSkillValue(value: number | undefined, fallback: number): number {
    const resolvedValue = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(
        FORCE_GENERATION_MAX_PILOT_SKILL,
        Math.max(FORCE_GENERATION_MIN_PILOT_SKILL, Math.floor(resolvedValue)),
    );
}

function normalizeForceGenerationSkillRange(
    range: ForceGenerationSkillRange | undefined,
    fallback: number,
): ForceGenerationSkillRange {
    const fallbackSkill = normalizeForceGenerationSkillValue(fallback, fallback);
    const firstValue = normalizeForceGenerationSkillValue(range?.min, fallbackSkill);
    const secondValue = normalizeForceGenerationSkillValue(range?.max, fallbackSkill);

    return {
        min: Math.min(firstValue, secondValue),
        max: Math.max(firstValue, secondValue),
    };
}

function normalizeForceGenerationMaxSkillDelta(value: number | undefined): number {
    const resolvedValue = typeof value === 'number' && Number.isFinite(value)
        ? value
        : DEFAULT_FORCE_GENERATION_MAX_CBT_SKILL_DELTA;
    return Math.min(
        FORCE_GENERATION_MAX_PILOT_SKILL,
        Math.max(
            0,
            Math.floor(resolvedValue),
        ),
    );
}

function resolveForceGenerationSkillSettings(
    options: Pick<ForceGenerationRequest, 'gunnery' | 'piloting' | 'skillRanges'>,
): ForceGenerationSkillSettings {
    return {
        gunnery: normalizeForceGenerationSkillRange(options.skillRanges?.gunnery, options.gunnery),
        piloting: normalizeForceGenerationSkillRange(options.skillRanges?.piloting, options.piloting),
        maxDelta: normalizeForceGenerationMaxSkillDelta(options.skillRanges?.maxDelta),
    };
}

function pickRandomIntegerInRange(range: ForceGenerationSkillRange): number {
    if (range.min === range.max) {
        return range.min;
    }

    return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
}

function hasValidForceGenerationSkillSettings(
    gameSystem: GameSystem,
    settings: ForceGenerationSkillSettings,
): boolean {
    return gameSystem !== GameSystem.CBT || getForceGenerationCBTSkillPairs(settings).length > 0;
}

function formatForceGenerationSkillRange(range: ForceGenerationSkillRange): string {
    return range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`;
}

function formatForceGenerationSkillSettingsNote(
    gameSystem: GameSystem,
    skillSettings: ForceGenerationSkillSettings,
): string {
    if (gameSystem === GameSystem.AS) {
        return `Skill target: Pilot Skill ${formatForceGenerationSkillRange(skillSettings.gunnery)}.`;
    }

    return `Skill target: Gunnery ${formatForceGenerationSkillRange(skillSettings.gunnery)}, Piloting ${formatForceGenerationSkillRange(skillSettings.piloting)}, max delta ${skillSettings.maxDelta}.`;
}

function buildForceGenerationSkillSettingsSignature(
    options: Pick<ForceGenerationRequest, 'gunnery' | 'piloting' | 'skillRanges'>,
): string {
    const skillSettings = resolveForceGenerationSkillSettings(options);
    return [
        `g:${skillSettings.gunnery.min}-${skillSettings.gunnery.max}`,
        `p:${skillSettings.piloting.min}-${skillSettings.piloting.max}`,
        `d:${skillSettings.maxDelta}`,
    ].join(',');
}

function clonePreviewGroups(groups: readonly ForcePreviewGroup[]): ForcePreviewGroup[] {
    return groups.map((group) => ({
        name: group.name,
        formationId: group.formationId,
        units: group.units.map((unit) => ({
            ...unit,
            crew: unit.crew?.map((member) => ({ ...member })),
        })),
    }));
}

function resolveBudgetRangeWithEditedMin(
    range: ForceGenerationBudgetRange,
    editedMin: number,
): ForceGenerationBudgetRange {
    const nextMin = normalizeBudgetBound(editedMin);
    const currentMax = normalizeBudgetBound(range.max);
    const bondedRange = bondNumberRange({
        min: nextMin,
        max: currentMax > 0 ? currentMax : null,
    }, 'min');

    return { min: bondedRange.min, max: bondedRange.max ?? 0 };
}

function resolveBudgetRangeWithEditedMax(
    range: ForceGenerationBudgetRange,
    editedMax: number,
): ForceGenerationBudgetRange {
    const currentMin = normalizeBudgetBound(range.min);
    const nextMax = normalizeBudgetBound(editedMax);

    const bondedRange = bondNumberRange({
        min: currentMin,
        max: nextMax > 0 ? nextMax : null,
    }, 'max');

    return { min: bondedRange.min, max: bondedRange.max ?? 0 };
}

function resolveUnitCountRangeWithEditedMin(
    range: ForceGeneratorUnitCountDefaults,
    editedMin: number,
): ForceGeneratorUnitCountDefaults {
    const nextMin = normalizeUnitCountBound(editedMin);
    const currentMax = normalizeUnitCountBound(range.max);

    return bondNumberRange({
        min: nextMin,
        max: currentMax,
    }, 'min');
}

function resolveUnitCountRangeWithEditedMax(
    range: ForceGeneratorUnitCountDefaults,
    editedMax: number,
): ForceGeneratorUnitCountDefaults {
    const currentMin = normalizeUnitCountBound(range.min);
    const nextMax = normalizeUnitCountBound(editedMax);

    return bondNumberRange({
        min: currentMin,
        max: nextMax,
    }, 'max');
}

function setHasAny<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
    const [smaller, larger] = left.size <= right.size
        ? [left, right]
        : [right, left];

    for (const value of smaller) {
        if (larger.has(value)) {
            return true;
        }
    }

    return false;
}

function getMinimumMetricTotal(
    values: readonly number[],
    count: number,
): number {
    if (count <= 0) {
        return 0;
    }

    return [...values]
        .sort((left, right) => left - right)
        .slice(0, count)
        .reduce((sum, value) => sum + value, 0);
}

function getOrderedCandidateCostTotalExcluding(
    orderedCandidates: readonly ForceGenerationCandidateUnit[],
    excludedCandidate: ForceGenerationCandidateUnit,
    count: number,
    getCost: (candidate: ForceGenerationCandidateUnit) => number = (candidate) => candidate.cost,
): number {
    if (count <= 0 || orderedCandidates.length <= 1) {
        return 0;
    }

    let total = 0;
    let includedCount = 0;
    const boundedCount = Math.min(count, orderedCandidates.length - 1);
    for (const candidate of orderedCandidates) {
        if (candidate === excludedCandidate) {
            continue;
        }

        total += getCost(candidate);
        includedCount += 1;
        if (includedCount >= boundedCount) {
            break;
        }
    }

    return total;
}

function getReusableCandidateCostTotal(
    orderedCandidates: readonly ForceGenerationCandidateUnit[],
    count: number,
    getCost: (candidate: ForceGenerationCandidateUnit) => number = (candidate) => candidate.cost,
): number {
    if (count <= 0) {
        return 0;
    }
    if (orderedCandidates.length === 0) {
        return Number.POSITIVE_INFINITY;
    }

    return getCost(orderedCandidates[0]) * count;
}

function getPreferredOrgTypeForEchelon(echelon: string | undefined): OrgType | undefined {
    return echelon ? ECHELON_TO_ORG_TYPE.get(echelon) : undefined;
}

function getCommonUnitCountForOrgType(type: OrgType): number | undefined {
    for (const [echelon, orgType] of ECHELON_TO_ORG_TYPE.entries()) {
        if (orgType === type) {
            return COMMON_ECHELON_UNIT_COUNTS.get(echelon);
        }
    }

    return undefined;
}

function getRuleRegularCount(rule: Pick<OrgRuleDefinition, 'modifiers'>): number | undefined {
    const regularValue = rule.modifiers[''] ?? Object.values(rule.modifiers)[0];
    if (regularValue === undefined) {
        return undefined;
    }

    return typeof regularValue === 'number' ? regularValue : regularValue.count;
}

function findOrgRuleByType(definition: OrgDefinition, type: OrgType): OrgRuleDefinition | undefined {
    return definition.rules.find((rule) => rule.type === type);
}

function resolveRegularUnitCountForOrgType(
    definition: OrgDefinition,
    type: OrgType,
    visited: Set<OrgType> = new Set<OrgType>(),
): number | undefined {
    const commonUnitCount = getCommonUnitCountForOrgType(type);
    if (commonUnitCount !== undefined) {
        return commonUnitCount;
    }

    if (visited.has(type)) {
        return undefined;
    }

    visited.add(type);
    const rule = findOrgRuleByType(definition, type);
    if (!rule) {
        return undefined;
    }

    const regularCount = getRuleRegularCount(rule);
    if (regularCount === undefined) {
        return undefined;
    }

    if (rule.kind === 'leaf-count' || rule.kind === 'leaf-pattern' || rule.kind === 'ci-formation') {
        return regularCount;
    }

    const childType = rule.childRoles[0]?.matches[0];
    if (!childType) {
        return regularCount;
    }

    const childUnitCount = resolveRegularUnitCountForOrgType(definition, childType, visited);
    return childUnitCount === undefined ? regularCount : regularCount * childUnitCount;
}

function getPreferredUnitCountForEchelon(
    echelon: string | undefined,
    definition: OrgDefinition | null,
): number | undefined {
    if (!echelon) {
        return undefined;
    }

    const commonUnitCount = COMMON_ECHELON_UNIT_COUNTS.get(echelon);
    if (commonUnitCount !== undefined) {
        return commonUnitCount;
    }

    const preferredOrgType = getPreferredOrgTypeForEchelon(echelon);
    if (preferredOrgType && definition) {
        return resolveRegularUnitCountForOrgType(definition, preferredOrgType);
    }

    return undefined;
}

function compareResolvedOrgGroups(left: GroupSizeResult, right: GroupSizeResult): number {
    if (left.tier !== right.tier) {
        return right.tier - left.tier;
    }

    return (right.priority ?? 0) - (left.priority ?? 0);
}

function getResolvedOrgGroupLabel(group: GroupSizeResult): string {
    return group.type ? `${group.modifierKey}${group.type}` : group.name;
}

function normalizeRole(value: string | undefined): string | undefined {
    return value?.trim().toLowerCase() || undefined;
}

function normalizeSelectionKey(value: string | undefined): string {
    return value?.trim().toLowerCase() || '';
}

function buildDuplicateChassisKey(unit: UnitSummary): string {
    const chassisKey = normalizeSelectionKey(unit.chassis);
    if (chassisKey.length === 0) {
        return '';
    }

    return normalizeSelectionKey(getUnitVariantGroupKey(unit));
}

function buildTaggedQuantityUnitKey(unit: UnitSummary): string {
    return `unit:${unit.uuid}`;
}

function buildTaggedQuantityChassisKey(unit: UnitSummary): string {
    const chassisKey = normalizeSelectionKey(TagsService.getChassisTagKey(unit));
    return chassisKey.length > 0 ? `chassis:${chassisKey}` : buildTaggedQuantityUnitKey(unit);
}

function buildAvailabilityPairKey(eraId: number, factionId: number): string {
    return `${eraId}:${factionId}`;
}

function serializeForceGenerationCacheIds(ids: readonly number[]): string {
    return [...new Set(ids)].sort((left, right) => left - right).join(',');
}

function buildForceGenerationUnitListSignature(units: readonly Pick<UnitSummary, 'uuid'>[]): string {
    return [units.length, ...units.map((unit) => unit.uuid)].join('\u001f');
}

function getEraReferenceYear(era: Era | null): number | undefined {
    if (!era) {
        return undefined;
    }

    const fromYear = era.years.from;
    const toYear = era.years.to;
    if (typeof fromYear === 'number' && typeof toYear === 'number') {
        return Math.round((fromYear + toYear) / 2);
    }

    return fromYear ?? toYear;
}

function getRulesetOptionEchelons(option: Pick<MegaMekRulesetOptionNode, 'echelon' | 'echelons'>): MegaMekRulesetEchelonToken[] {
    if (option.echelons && option.echelons.length > 0) {
        return [...option.echelons];
    }

    return option.echelon ? [option.echelon] : [];
}

function formatForceGeneratorWeight(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatForceGeneratorPercent(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatForceGeneratorFlags(
    preventDuplicateChassis: boolean,
    useTaggedQuantities: boolean,
    useUnitTagsAsChassisTags: boolean,
): string | null {
    const activeFlags = [
        preventDuplicateChassis ? 'Prevent Duplicate Chassis: on' : null,
        useTaggedQuantities ? 'Limit to tagged quantities: on' : null,
        useUnitTagsAsChassisTags ? 'Use Unit-variant tags as Chassis tags: on' : null,
    ].filter((flag): flag is string => flag !== null);

    return activeFlags.length > 0 ? `${activeFlags.join('; ')}.` : null;
}

function getForceGeneratorNow(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }

    return Date.now();
}

function formatForceGenerationSkillSummary(
    gameSystem: GameSystem,
    step: Pick<ForceGenerationSelectionStep, 'skill' | 'gunnery' | 'piloting'>,
): string | null {
    if (gameSystem === GameSystem.AS) {
        return step.skill === undefined ? null : `Skill ${step.skill}`;
    }

    return step.gunnery === undefined || step.piloting === undefined
        ? null
        : `G/P ${step.gunnery}/${step.piloting}`;
}

function toMegaMekUnitType(unit: UnitSummary): string {
    switch (unit.type) {
        case 'Mek':
            return 'Mek';
        case 'Tank':
            return 'Tank';
        case 'VTOL':
            return 'VTOL';
        case 'ProtoMek':
            return 'ProtoMek';
        case 'Naval':
            return 'Naval';
        case 'Handheld Weapon':
            return 'Handheld Weapon';
        case 'Infantry':
            return unit.subtype === 'Battle Armor' ? 'BattleArmor' : 'Infantry';
        case 'Aero':
            if (unit.subtype.includes('Conventional Fighter')) {
                return 'Conventional Fighter';
            }
            if (unit.subtype.includes('Aerospace Fighter')) {
                return 'AeroSpaceFighter';
            }
            if (unit.subtype.includes('Small Craft')) {
                return 'Small Craft';
            }
            if (unit.subtype.includes('DropShip')) {
                return 'Dropship';
            }
            if (unit.subtype.includes('JumpShip')) {
                return 'Jumpship';
            }
            if (unit.subtype.includes('WarShip')) {
                return 'Warship';
            }
            if (unit.subtype.includes('Space Station')) {
                return 'Space Station';
            }
            return 'Aero';
        default:
            return unit.type;
    }
}

function toMegaMekWeightClass(unit: UnitSummary): string | undefined {
    switch (unit.weightClass) {
        case 'Ultra Light/PA(L)/Exoskeleton':
            return 'UL';
        case 'Light':
            return 'L';
        case 'Medium':
            return 'M';
        case 'Heavy':
            return 'H';
        case 'Assault':
            return 'A';
        case 'Colossal/Super-Heavy':
            return 'SH';
        default:
            return undefined;
    }
}

function toMegaMekMotive(unit: UnitSummary): string | undefined {
    switch (unit.moveType) {
        case 'VTOL':
            return 'vtol';
        case 'Hover':
            return 'hover';
        case 'Tracked':
            return 'tracked';
        case 'Wheeled':
            return 'wheeled';
        case 'WiGE':
            return 'wige';
        case 'Naval':
            return 'naval';
        case 'Submarine':
            return 'submarine';
        case 'Motorized':
        case 'Motorized SCUBA':
            return 'motorized';
        case 'Aerodyne':
            return 'aerodyne';
        case 'Spheroid':
            return 'spheroid';
        default:
            return undefined;
    }
}

@Injectable()
export class ForceGeneratorService implements OnDestroy {
    private readonly dataService = inject(DataService);
    private readonly optionsService = inject(OptionsService);
    private readonly filtersService = inject(UnitSearchFiltersService);
    private readonly unitAvailabilitySource = inject(UnitAvailabilitySourceService);
    private availabilityWeightCache: ForceGenerationAvailabilityWeightCache | null = null;
    private baseCandidateCache: ForceGenerationBaseCandidateCache | null = null;
    private preparedCandidateCache: ForceGenerationPreparedCandidateCache | null = null;
    private selectionPreparationCache: ForceGenerationSelectionPreparationCache | null = null;
    private formationComputationAttempts = 0;
    private formationComputationElapsedMs = 0;

    public ngOnDestroy(): void {
        this.clearGenerationCaches();
    }

    public resolveInitialBudgetDefaults(
        options: Pick<ForceGeneratorOptions, 'lastBudget'>,
        unitSearchLimit: number,
        unitSearchGameSystem: GameSystem,
    ): ForceGeneratorBudgetDefaults {
        const hasUnitSearchLimit = Number.isFinite(unitSearchLimit) && unitSearchLimit > 0;

        return {
            classic: normalizeInitialBudgetRange(
                options.lastBudget.classic.min,
                unitSearchGameSystem === GameSystem.CBT && hasUnitSearchLimit
                    ? unitSearchLimit
                    : options.lastBudget.classic.max,
            ),
            alphaStrike: normalizeInitialBudgetRange(
                options.lastBudget.alphaStrike.min,
                unitSearchGameSystem === GameSystem.AS && hasUnitSearchLimit
                    ? unitSearchLimit
                    : options.lastBudget.alphaStrike.max,
            ),
        };
    }

    public resolveInitialUnitCountDefaults(
        options: Pick<ForceGeneratorOptions, 'lastUnitCount'>,
    ): ForceGeneratorUnitCountDefaults {
        return normalizeInitialUnitCountRange(
            options.lastUnitCount.min,
            options.lastUnitCount.max,
        );
    }

    public resolveInitialSkillDefaults(
        options: Pick<ForceGeneratorOptions, 'lastSkills'>,
    ): ForceGeneratorSkillDefaults {
        return {
            gunnery: normalizeForceGenerationSkillRange({
                min: options.lastSkills.gunnery.min,
                max: options.lastSkills.gunnery.max,
            }, 4),
            piloting: normalizeForceGenerationSkillRange({
                min: options.lastSkills.piloting.min,
                max: options.lastSkills.piloting.max,
            }, 5),
            maxDelta: normalizeForceGenerationMaxSkillDelta(options.lastSkills.maxDelta),
        };
    }

    public resolveBudgetRangeForEditedMin(
        range: ForceGenerationBudgetRange,
        editedMin: number,
    ): ForceGenerationBudgetRange {
        return resolveBudgetRangeWithEditedMin(range, editedMin);
    }

    public resolveBudgetRangeForEditedMax(
        range: ForceGenerationBudgetRange,
        editedMax: number,
    ): ForceGenerationBudgetRange {
        return resolveBudgetRangeWithEditedMax(range, editedMax);
    }

    public resolveUnitCountRangeForEditedMin(
        range: ForceGeneratorUnitCountDefaults,
        editedMin: number,
    ): ForceGeneratorUnitCountDefaults {
        return resolveUnitCountRangeWithEditedMin(range, editedMin);
    }

    public resolveUnitCountRangeForEditedMax(
        range: ForceGeneratorUnitCountDefaults,
        editedMax: number,
    ): ForceGeneratorUnitCountDefaults {
        return resolveUnitCountRangeWithEditedMax(range, editedMax);
    }

    public resolveGenerationContext(
        eligibleUnits: readonly UnitSummary[],
        options: ForceGenerationContextOptions = {},
    ): ForceGenerationContext {
        const selectedEras = this.resolveSelectedEras();
        const excludedEraIds = this.resolveExcludedEraIds();
        const selectedFactions = this.resolveSelectedFactions();
        const excludedFactionIds = this.resolveExcludedFactionIds();
        const crossEraAvailabilityInMultiEraSelection = options.crossEraAvailabilityInMultiEraSelection ?? false;
        const randomFaction = options.randomFaction === true;
        const mergeSelectedFactionAvailability = options.mergeSelectedFactionAvailability !== false;
        const availablePairs = this.collectPositiveAvailabilityPairs(
            eligibleUnits,
            selectedEras.map((era) => era.id),
            selectedFactions.map((faction) => faction.id),
            excludedEraIds,
            excludedFactionIds,
        );
        const targetFormationFaction = this.resolveTargetFormationContextFaction(
            options,
            selectedFactions,
            excludedFactionIds,
            availablePairs,
        );
        const forceFaction = targetFormationFaction
            ?? (selectedFactions.length > 0
                ? this.pickForceFaction(selectedFactions, availablePairs)
                : randomFaction
                    ? this.pickForceFaction(selectedFactions, availablePairs)
                    : this.dataService.getFactionById(MULFACTION_MERCENARY) ?? null);
        const useSinglePickedFactionAvailability = randomFaction
            || (selectedFactions.length > 1 && !mergeSelectedFactionAvailability);
        const forceEra = this.resolveContextEra(
            selectedEras,
            excludedEraIds,
            selectedFactions.length > 0 || targetFormationFaction || randomFaction ? forceFaction : null,
            availablePairs,
            crossEraAvailabilityInMultiEraSelection,
        );
        const availabilityEraIds = this.resolveAvailabilityEraIds(
            selectedEras,
            excludedEraIds,
            forceEra,
            crossEraAvailabilityInMultiEraSelection,
        );
        const availabilityFactionIds = targetFormationFaction
            ? [targetFormationFaction.id]
            : useSinglePickedFactionAvailability && forceFaction
                ? [forceFaction.id]
                : this.resolveAvailabilityFactionIds(
                    selectedFactions,
                    excludedFactionIds,
                    availablePairs,
                    availabilityEraIds,
                );
        const useAvailabilityFactionScope = targetFormationFaction
            ? false
            : useSinglePickedFactionAvailability
                ? false
                : this.shouldUseAvailabilityFactionScopeFromFilters(selectedFactions, availabilityFactionIds);
        const useAvailabilityEraScope = this.shouldUseAvailabilityEraScopeFromFilters(
            selectedEras,
            availabilityEraIds,
            crossEraAvailabilityInMultiEraSelection,
        );
        const rulesetContext = this.resolveRulesetContext(forceFaction, forceEra);

        return {
            forceFaction,
            forceEra,
            availabilityFactionIds,
            availabilityEraIds,
            useAvailabilityFactionScope,
            useAvailabilityEraScope,
            availablePairCount: availablePairs.length,
            ruleset: rulesetContext.primary,
            explicitFactionSelection: selectedFactions.length === 1,
            targetFormationFactionInferred: targetFormationFaction !== null,
        };
    }

    public buildPreview(options: ForceGenerationRequest): ForceGenerationPreview {
        const generator = this.buildPreviewGenerator(options);
        let step = generator.next();
        while (!step.done) {
            step = generator.next();
        }

        return step.value;
    }

    public buildPreviewAsync(options: ForceGenerationRequest): ForceGenerationPreviewTask {
        if (!this.canRunAsyncForceGeneration()) {
            const preview = this.buildPreview(options);
            return {
                isAsync: false,
                result: Promise.resolve(preview),
                terminate: () => undefined,
            };
        }

        const interruptSignal: ForceGenerationInterruptSignal = { terminated: false };
        return {
            isAsync: true,
            result: this.runPreviewGeneratorAsync(this.buildPreviewGenerator(options, interruptSignal)),
            terminate: () => {
                interruptSignal.terminated = true;
            },
        };
    }

    private canRunAsyncForceGeneration(): boolean {
        return typeof globalThis.setTimeout === 'function';
    }

    private runPreviewGeneratorAsync(
        generator: Generator<void, ForceGenerationPreview, void>,
    ): Promise<ForceGenerationPreview> {
        return new Promise((resolve, reject) => {
            const runNextStep = (): void => {
                try {
                    const step = generator.next();
                    if (step.done) {
                        resolve(step.value);
                        return;
                    }

                    this.schedulePreviewGeneratorStep(runNextStep);
                } catch (error) {
                    reject(error);
                }
            };

            this.schedulePreviewGeneratorStep(runNextStep);
        });
    }

    private schedulePreviewGeneratorStep(callback: () => void): void {
        globalThis.setTimeout(callback, 0);
    }

    private *buildPreviewGenerator(
        options: ForceGenerationRequest,
        interruptSignal?: ForceGenerationInterruptSignal,
    ): Generator<void, ForceGenerationPreview, void> {
        const previewStartedAt = getForceGeneratorNow();
        this.formationComputationAttempts = 0;
        this.formationComputationElapsedMs = 0;
        const eligibleUnits = options.eligibleUnits ?? this.filtersService.filteredUnits();
        const requestedMinUnitCount = Math.min(FORCE_MAX_UNITS, Math.max(1, Math.floor(options.minUnitCount)));
        const requestedMaxUnitCount = Math.min(FORCE_MAX_UNITS, Math.max(requestedMinUnitCount, Math.floor(options.maxUnitCount)));
        const requestedTargetFormations = this.resolveRequestedTargetFormations(options);
        const useMultiTargetFormation = requestedTargetFormations.length > 1
            || requestedTargetFormations.some((targetFormation) => targetFormation.count > 1);
        const targetFormationContext = !useMultiTargetFormation
            ? this.resolveTargetFormationContext(options, requestedMinUnitCount, requestedMaxUnitCount, requestedTargetFormations)
            : null;
        const targetFormationSetContext = useMultiTargetFormation
            ? this.resolveTargetFormationSetContext(options, requestedTargetFormations)
            : null;
        const minUnitCount = targetFormationContext?.minUnitCount ?? requestedMinUnitCount;
        const maxUnitCount = targetFormationContext?.maxUnitCount ?? requestedMaxUnitCount;
        const budgetRange = this.normalizeBudgetRange(options.budgetRange);
        const skillSettings = resolveForceGenerationSkillSettings(options);
        const hasVariableSkillSettings = hasVariableForceGenerationSkillSettings(options.gameSystem, skillSettings);
        const availabilityWeightCache = options.ignoreRarityWeight === true
            ? undefined
            : this.resolveAvailabilityWeightCache(eligibleUnits, options.context);

        if (requestedTargetFormations.length > 0 && !targetFormationContext && !targetFormationSetContext) {
            return this.buildEmptyPreview(
                options,
                eligibleUnits.length,
                0,
                budgetRange,
                requestedMinUnitCount,
                requestedMaxUnitCount,
                'The selected target formation is not available for the current ruleset.',
            );
        }
        const taggedQuantityCaps = options.useTaggedQuantities === true && options.preventDuplicateChassis !== true
            ? this.resolveTaggedQuantityCaps(eligibleUnits, maxUnitCount, options.useUnitTagsAsChassisTags === true)
            : null;
        const useTaggedQuantityCaps = (taggedQuantityCaps?.capByKey.size ?? 0) > 0;
        const allowUnlimitedDuplicateUnits = options.preventDuplicateChassis !== true && !useTaggedQuantityCaps;
        const preparedCandidateCache = this.resolvePreparedCandidateCache(
            eligibleUnits,
            options.context,
            options,
            availabilityWeightCache,
        );
        const lockedCandidates = (options.lockedUnits ?? []).map((lockedUnit) => {
            const unit = this.resolveLockedUnitVariant(lockedUnit, preparedCandidateCache.candidates);
            const resolvedLockedUnit = this.resolveLockedUnitForSelection(lockedUnit, unit, options);
            return this.createCandidateUnit(
                unit,
                options.context,
                options,
                resolvedLockedUnit,
                availabilityWeightCache,
            );
        });
        const lockedUnitUuids = new Set(lockedCandidates.map((candidate) => candidate.unit.uuid));
        const lockedTaggedQuantityCounts = useTaggedQuantityCaps && taggedQuantityCaps
            ? this.countTaggedQuantityCandidates(lockedCandidates, taggedQuantityCaps)
            : new Map<string, number>();
        const availabilityCandidates = lockedUnitUuids.size === 0 || useTaggedQuantityCaps
            ? preparedCandidateCache.candidates
            : preparedCandidateCache.candidates.filter((candidate) => !lockedUnitUuids.has(candidate.unit.uuid));
        const skillCompatibleCandidates = this.filterCandidatesForSkillSettings(
            availabilityCandidates,
            options.gameSystem,
            skillSettings,
        );
        const candidates = useTaggedQuantityCaps
            ? this.expandCandidatesForTaggedQuantities(
                skillCompatibleCandidates,
                taggedQuantityCaps!,
                lockedTaggedQuantityCounts,
                maxUnitCount,
            )
            : [...skillCompatibleCandidates];

        if (!hasValidForceGenerationSkillSettings(options.gameSystem, skillSettings)) {
            const message = `No valid Gunnery/Piloting skill pairs match the selected ranges with max delta ${skillSettings.maxDelta}.`;
            const availableCandidateCapacity = availabilityCandidates.length + lockedCandidates.length;

            if (lockedCandidates.length > 0) {
                return this.buildPreviewFromSelectionAttempt(
                    options,
                    eligibleUnits.length,
                    availableCandidateCapacity,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    this.createSelectionAttemptFromCandidates(lockedCandidates, null),
                    message,
                    undefined,
                    candidates,
                );
            }

            return this.buildEmptyPreview(
                options,
                eligibleUnits.length,
                availableCandidateCapacity,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                message,
                candidates,
            );
        }

        const availableCandidateCapacity = useTaggedQuantityCaps
            ? lockedCandidates.length + this.countTaggedQuantityCapacity(
                skillCompatibleCandidates,
                (candidate) => candidate.unit,
                taggedQuantityCaps!,
                lockedTaggedQuantityCounts,
                maxUnitCount,
            )
            : candidates.length
                + lockedCandidates.length
                + (targetFormationContext && !allowUnlimitedDuplicateUnits
                    ? this.countMatchedPairCopyCapacity(
                        targetFormationContext.definition,
                        [...lockedCandidates, ...skillCompatibleCandidates],
                        options,
                        maxUnitCount,
                    )
                    : 0);

        const hasResolvedRuleset = this.resolveRulesetContext(options.context.forceFaction, options.context.forceEra).primary !== null;
        const didFilterCandidatesForSkills = candidates.length !== availabilityCandidates.length;
        const canReuseSelectionPreparationCache = !hasVariableSkillSettings
            && !didFilterCandidatesForSkills
            && lockedCandidates.length === 0
            && !useTaggedQuantityCaps
            && !hasResolvedRuleset;
        const selectionPreparation = hasVariableSkillSettings || targetFormationContext
            ? undefined
            : (canReuseSelectionPreparationCache
                ? this.resolveSelectionPreparationCache(
                    preparedCandidateCache,
                    options.context,
                    minUnitCount,
                    maxUnitCount,
                    budgetRange,
                )
                : this.prepareSelectionPreparation(
                    candidates,
                    lockedCandidates,
                    options.context,
                    minUnitCount,
                    maxUnitCount,
                    budgetRange,
                    { preventDuplicateChassis: options.preventDuplicateChassis === true },
                ));

        if (targetFormationContext) {
            const targetSearchResult = yield* this.runTargetFormationAttemptSearch({
                mode: 'single',
                candidateCount: candidates.length,
                minUnitCount,
                maxUnitCount,
                budgetRange,
                interruptSignal,
                runAttempt: (targetSearchDeadline) => {
                    const targetAttempt = this.buildTargetedFormationSelection(
                        candidates,
                        options,
                        targetFormationContext.definition,
                        budgetRange,
                        minUnitCount,
                        maxUnitCount,
                        lockedCandidates,
                        options.preventDuplicateChassis === true,
                        skillSettings,
                        undefined,
                        targetSearchDeadline,
                    );
                    const targetEvaluationBeforeSkillOptimization = FormationRequirementEngine.evaluateDefinition(
                        targetFormationContext.definition,
                        this.createFormationUnitsForCandidates(targetAttempt.selectedCandidates, options),
                        options.gameSystem,
                    );
                    const formationValidBeforeSkillOptimization = targetEvaluationBeforeSkillOptimization?.valid === true
                        && targetAttempt.selectedCandidates.length >= minUnitCount
                        && targetAttempt.selectedCandidates.length <= maxUnitCount;
                    const optimizedTargetAttempt = formationValidBeforeSkillOptimization
                        ? this.optimizeSelectionAttemptSkillsForBudget(
                            targetAttempt,
                            options.gameSystem,
                            skillSettings,
                            budgetRange,
                            (candidate) => this.createTargetFormationSkillAdjustedCandidateOptions(
                                candidate,
                                options,
                                targetFormationContext.definition,
                                skillSettings,
                            ),
                        )
                        : targetAttempt;
                    const targetTotalCost = optimizedTargetAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
                    const targetEvaluation = FormationRequirementEngine.evaluateDefinition(
                        targetFormationContext.definition,
                        this.createFormationUnitsForCandidates(optimizedTargetAttempt.selectedCandidates, options),
                        options.gameSystem,
                    );
                    const formationValid = targetEvaluation?.valid === true
                        && optimizedTargetAttempt.selectedCandidates.length >= minUnitCount
                        && optimizedTargetAttempt.selectedCandidates.length <= maxUnitCount;
                    const targetValid = formationValid && isBudgetWithinRange(targetTotalCost, budgetRange);

                    return {
                        attempt: optimizedTargetAttempt,
                        rank: {
                            satisfiedTargetCount: formationValid ? 1 : 0,
                            requestedTargetCount: 1,
                            formationDeficitScore: this.getFormationDeficitScore(targetEvaluation),
                            budgetDistance: getBudgetRangeDistance(targetTotalCost, budgetRange),
                            unitCountDistance: this.getUnitCountRangeDistance(targetAttempt.selectedCandidates.length, minUnitCount, maxUnitCount),
                        },
                        complete: targetValid,
                        message: null,
                    };
                },
            });

            if (targetSearchResult.completeAttempt) {
                return this.buildPreviewFromSelectionAttempt(
                    options,
                    eligibleUnits.length,
                    availableCandidateCapacity,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    targetSearchResult.completeAttempt,
                    null,
                    undefined,
                    candidates,
                    targetSearchResult.attemptsTried,
                    getForceGeneratorNow() - previewStartedAt,
                );
            }

            const targetMessage = `Unable to complete ${targetFormationContext.definition.name} within the selected filters, budget, and locked units.`;

            return this.buildPreviewFromSelectionAttempt(
                options,
                eligibleUnits.length,
                availableCandidateCapacity,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                targetSearchResult.bestAttempt ?? this.createSelectionAttemptFromCandidates(lockedCandidates, null),
                targetMessage,
                targetMessage,
                candidates,
                targetSearchResult.attemptsTried,
                getForceGeneratorNow() - previewStartedAt,
            );
        }

        if (targetFormationSetContext) {
            const targetSearchResult = yield* this.runTargetFormationAttemptSearch({
                mode: 'multi',
                candidateCount: candidates.length,
                minUnitCount,
                maxUnitCount,
                budgetRange,
                interruptSignal,
                runAttempt: (targetSearchDeadline) => {
                    const targetAttempt = this.buildMultiTargetedFormationSelection(
                        candidates,
                        options,
                        targetFormationSetContext,
                        budgetRange,
                        minUnitCount,
                        maxUnitCount,
                        lockedCandidates,
                        options.preventDuplicateChassis === true,
                        skillSettings,
                        targetSearchDeadline,
                    );
                    const optimizedTargetAttempt = this.optimizeSelectionAttemptSkillsForBudget(
                        targetAttempt,
                        options.gameSystem,
                        skillSettings,
                        budgetRange,
                        this.createTargetFormationSetSkillOptionResolver(targetAttempt, options, skillSettings),
                    );
                    const targetEvaluation = this.evaluateTargetFormationSetAttempt(
                        optimizedTargetAttempt,
                        options,
                        targetFormationSetContext,
                        budgetRange,
                        minUnitCount,
                        maxUnitCount,
                    );

                    return {
                        attempt: optimizedTargetAttempt,
                        rank: targetEvaluation.rank,
                        complete: targetEvaluation.allTargetsSatisfied && targetEvaluation.budgetValid && targetEvaluation.unitCountValid,
                        message: targetEvaluation.message,
                    };
                },
            });

            if (targetSearchResult.completeAttempt) {
                return this.buildPreviewFromSelectionAttempt(
                    options,
                    eligibleUnits.length,
                    availableCandidateCapacity,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    targetSearchResult.completeAttempt,
                    null,
                    undefined,
                    candidates,
                    targetSearchResult.attemptsTried,
                    getForceGeneratorNow() - previewStartedAt,
                );
            }

            const fallbackAttempt = targetSearchResult.bestAttempt
                ?? this.createSelectionAttemptFromCandidates(lockedCandidates, selectionPreparation?.rulesetProfile ?? null);
            const fallbackResult = targetSearchResult.bestResult;
            const fallbackEvaluation = fallbackResult ? null : this.evaluateTargetFormationSetAttempt(
                fallbackAttempt,
                options,
                targetFormationSetContext,
                budgetRange,
                minUnitCount,
                maxUnitCount,
            );
            const fullyValidTargetSuccess = fallbackResult?.complete ?? (
                fallbackEvaluation !== null
                && fallbackEvaluation.allTargetsSatisfied
                && fallbackEvaluation.budgetValid
                && fallbackEvaluation.unitCountValid
            );
            const fallbackMessage = fallbackResult?.message ?? fallbackEvaluation?.message ?? '';
            const targetFormationError = fullyValidTargetSuccess
                ? null
                : fallbackMessage;
            const targetFormationResultNote = fullyValidTargetSuccess
                ? undefined
                : fallbackMessage;

            return this.buildPreviewFromSelectionAttempt(
                options,
                eligibleUnits.length,
                availableCandidateCapacity,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                fallbackAttempt,
                targetFormationError,
                targetFormationResultNote,
                candidates,
                targetSearchResult.attemptsTried,
                getForceGeneratorNow() - previewStartedAt,
            );
        }

        if (this.isFirstCompatibleResultBudgetRequest(options.budgetRange)) {
            yield;
            const firstCompatibleCandidates = this.createSkillAdjustedCandidatesForAttempt(
                candidates,
                options.gameSystem,
                skillSettings,
            );
            const firstCompatibleSelectionPreparation = hasVariableSkillSettings
                ? this.prepareSelectionPreparation(
                    firstCompatibleCandidates,
                    lockedCandidates,
                    options.context,
                    minUnitCount,
                    maxUnitCount,
                )
                : selectionPreparation;
            const selectionAttempt = this.buildCandidateSelection(
                firstCompatibleCandidates,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                false,
                lockedCandidates,
                options.preventDuplicateChassis === true,
                firstCompatibleSelectionPreparation,
            );
            if (selectionAttempt.selectedCandidates.length > 0) {
                return this.buildPreviewFromSelectionAttempt(
                    options,
                    eligibleUnits.length,
                    availableCandidateCapacity,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    selectionAttempt,
                    null,
                    'Budget 0/0 requested, so the first compatible result was returned.',
                    candidates,
                    1,
                    getForceGeneratorNow() - previewStartedAt,
                );
            }
        }

        const lockedTotalCost = lockedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        const remainingMinUnitCount = Math.max(0, minUnitCount - lockedCandidates.length);
        const remainingMaxUnitCount = Math.max(0, maxUnitCount - lockedCandidates.length);
        const effectiveFallbackCandidates = this.filterCandidatesForAvailableTopLevelEchelons(
            candidates,
            options.context,
            remainingMinUnitCount,
            remainingMaxUnitCount,
        );
        const costPlanningCandidates = hasVariableSkillSettings
            ? effectiveFallbackCandidates.map((candidate) => createLowestCostCandidateForSkillSettings(
                candidate,
                options.gameSystem,
                skillSettings,
            ))
            : effectiveFallbackCandidates;
        const candidateCosts = costPlanningCandidates.map((candidate) => candidate.cost);
        const minimumRequiredCandidateCost = allowUnlimitedDuplicateUnits && candidateCosts.length > 0
            ? Math.min(...candidateCosts) * remainingMinUnitCount
            : getMinimumMetricTotal(candidateCosts, remainingMinUnitCount);
        const noUnderMaxForcePossible = Number.isFinite(budgetRange.max)
            && (lockedTotalCost > budgetRange.max
                || lockedTotalCost + minimumRequiredCandidateCost > budgetRange.max);

        const attemptBudget = this.createAttemptBudget(candidates.length, minUnitCount, maxUnitCount);
        const searchStartedAt = getForceGeneratorNow();
        let bestAttempt: ForceGenerationSelectionAttempt = {
            selectedCandidates: [],
            selectionSteps: [],
            rulesetProfile: null,
        };
        let bestAttemptExceedsMax = true;
        let bestAttemptUnitCountDistance = Number.POSITIVE_INFINITY;
        let bestAttemptBudgetDistance = Number.POSITIVE_INFINITY;
        let bestAttemptMidpointDistance = Number.POSITIVE_INFINITY;
        let bestValidAttempt: ForceGenerationSelectionAttempt | null = null;
        let bestValidAttemptNumber: number | null = null;
        let bestValidMidpointDistance = Number.POSITIVE_INFINITY;
        let bestValidStructureScore = Number.NEGATIVE_INFINITY;
        const successfulAttempts: ForceGenerationSuccessfulAttemptLog[] = [];
        const failureSearchWindowMs = this.resolveFailureSearchWindowMs();
        const searchDeadline = this.createSearchDeadline(
            searchStartedAt,
            failureSearchWindowMs,
            interruptSignal,
        );
        let attemptDurationEstimateMs = 0;
        let attemptLimit = attemptBudget.minAttempts;
        let attemptsTried = 0;

        for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
            if (this.hasSearchDeadlineExpired(searchDeadline)) {
                break;
            }
            yield;
            if (this.hasSearchDeadlineExpired(searchDeadline)) {
                break;
            }
            const attemptStartedAt = getForceGeneratorNow();
            attemptsTried = attempt + 1;
            const attemptCandidates = this.createSkillAdjustedCandidatesForAttempt(
                candidates,
                options.gameSystem,
                skillSettings,
            );
            const attemptSkillBudgetPlanningCosts = this.createSkillBudgetPlanningCosts(
                attemptCandidates,
                options.gameSystem,
                skillSettings,
            );
            const attemptSelectionPreparation = hasVariableSkillSettings
                ? this.prepareSelectionPreparation(
                    attemptCandidates,
                    lockedCandidates,
                    options.context,
                    minUnitCount,
                    maxUnitCount,
                    budgetRange,
                    {
                        preventDuplicateChassis: options.preventDuplicateChassis === true,
                        skillBudgetPlanningCosts: attemptSkillBudgetPlanningCosts,
                    },
                )
                : selectionPreparation;
            const rawSelectionAttempt = this.buildCandidateSelection(
                attemptCandidates,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                noUnderMaxForcePossible,
                lockedCandidates,
                options.preventDuplicateChassis === true,
                attemptSelectionPreparation,
                attemptSkillBudgetPlanningCosts,
                searchDeadline,
            );
            const minimumFilledSelectionAttempt = this.fillSelectionAttemptToMinimumUnitCount(
                rawSelectionAttempt,
                attemptCandidates,
                minUnitCount,
                maxUnitCount,
                options.preventDuplicateChassis === true,
                attemptSelectionPreparation,
            );
            const selectionAttempt = this.optimizeSelectionAttemptSkillsForBudget(
                minimumFilledSelectionAttempt,
                options.gameSystem,
                skillSettings,
                budgetRange,
            );
            const totalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
            const attemptExceedsMax = Number.isFinite(budgetRange.max) && totalCost > budgetRange.max;
            const attemptUnitCountDistance = this.getUnitCountRangeDistance(selectionAttempt.selectedCandidates.length, minUnitCount, maxUnitCount);
            const attemptBudgetDistance = getBudgetRangeDistance(totalCost, budgetRange);
            const attemptMidpointDistance = Math.abs(totalCost - getBudgetTarget(budgetRange));

            if (
                bestAttempt.selectedCandidates.length === 0
                || (
                    attemptExceedsMax !== bestAttemptExceedsMax
                    && !attemptExceedsMax
                )
                || (
                    attemptExceedsMax === bestAttemptExceedsMax
                    && (
                        attemptUnitCountDistance < bestAttemptUnitCountDistance
                        || (
                            attemptUnitCountDistance === bestAttemptUnitCountDistance
                            && (
                                attemptBudgetDistance < bestAttemptBudgetDistance
                                || (
                                    attemptBudgetDistance === bestAttemptBudgetDistance
                                    && attemptMidpointDistance < bestAttemptMidpointDistance
                                )
                            )
                        )
                    )
                )
            ) {
                bestAttempt = selectionAttempt;
                bestAttemptExceedsMax = attemptExceedsMax;
                bestAttemptUnitCountDistance = attemptUnitCountDistance;
                bestAttemptBudgetDistance = attemptBudgetDistance;
                bestAttemptMidpointDistance = attemptMidpointDistance;
            }

            const isValid = selectionAttempt.selectedCandidates.length >= minUnitCount
                && selectionAttempt.selectedCandidates.length <= maxUnitCount
                && isBudgetWithinRange(totalCost, budgetRange);
            if (isValid) {
                const structureEvaluation = this.evaluateSelectionStructure(selectionAttempt, options.context);
                if (structureEvaluation) {
                    selectionAttempt.structureEvaluation = structureEvaluation;
                }

                const midpointDistance = Math.abs(totalCost - getBudgetTarget(budgetRange));
                const structureScore = structureEvaluation?.score ?? 0;
                const bestAttemptComparison = this.compareSuccessfulAttemptToBest(
                    {
                        structureScore,
                        midpointDistance,
                        unitCount: selectionAttempt.selectedCandidates.length,
                    },
                    bestValidAttempt
                        ? {
                            structureScore: bestValidStructureScore,
                            midpointDistance: bestValidMidpointDistance,
                            unitCount: bestValidAttempt.selectedCandidates.length,
                        }
                        : null,
                );
                successfulAttempts.push(this.createSuccessfulAttemptLog(
                    attempt + 1,
                    selectionAttempt,
                    totalCost,
                    midpointDistance,
                    structureEvaluation ?? null,
                    bestAttemptComparison.becomesBest,
                    bestAttemptComparison.reason,
                ));

                if (bestAttemptComparison.becomesBest) {
                    bestValidAttempt = selectionAttempt;
                    bestValidAttemptNumber = attempt + 1;
                    bestValidStructureScore = structureScore;
                    bestValidMidpointDistance = midpointDistance;
                }

                if (!structureEvaluation || structureEvaluation.perfectMatch) {
                    this.logSuccessfulAttemptDiagnostics(
                        options,
                        budgetRange,
                        minUnitCount,
                        maxUnitCount,
                        successfulAttempts,
                        attempt + 1,
                        structureEvaluation?.perfectMatch
                            ? 'Stopped early because this successful attempt was a perfect structure match.'
                            : 'Stopped early because no structure preference applied, so the first successful attempt was accepted immediately.',
                    );
                    return this.buildPreviewFromSelectionAttempt(
                        options,
                        eligibleUnits.length,
                        availableCandidateCapacity,
                        budgetRange,
                        minUnitCount,
                        maxUnitCount,
                        selectionAttempt,
                        null,
                        undefined,
                        candidates,
                        attemptsTried,
                        getForceGeneratorNow() - previewStartedAt,
                    );
                }
            }

            if (selectionAttempt.candidatePoolStarved) {
                break;
            }

            const attemptDurationMs = Math.max(0.05, getForceGeneratorNow() - attemptStartedAt);
            attemptDurationEstimateMs = this.updateAttemptDurationEstimate(attemptDurationEstimateMs, attemptDurationMs, attempt + 1);
            attemptLimit = this.resolveAttemptLimit(
                attemptBudget,
                attempt + 1,
                attemptDurationEstimateMs,
                getForceGeneratorNow() - searchStartedAt,
                bestValidAttempt !== null,
                failureSearchWindowMs,
            );
        }

        if (bestValidAttempt) {
            this.logSuccessfulAttemptDiagnostics(
                options,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                successfulAttempts,
                bestValidAttemptNumber ?? 1,
                'Search ended without a perfect structure match, so the best successful attempt was chosen by structure score, then target distance, then unit count.',
            );
            return this.buildPreviewFromSelectionAttempt(
                options,
                eligibleUnits.length,
                availableCandidateCapacity,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                bestValidAttempt,
                null,
                undefined,
                candidates,
                attemptsTried,
                getForceGeneratorNow() - previewStartedAt,
            );
        }

        if (bestAttempt.selectedCandidates.length > 0) {
            const budgetLabel = options.gameSystem === GameSystem.AS ? 'PV' : 'BV';
            return this.buildPreviewFromSelectionAttempt(
                options,
                eligibleUnits.length,
                availableCandidateCapacity,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                bestAttempt,
                null,
                noUnderMaxForcePossible && bestAttemptExceedsMax
                    ? `No attempt stayed at or below the selected ${budgetLabel} maximum, so the lowest-total force in the requested unit-count range was returned.`
                    : 'No force matched the full budget and unit-count constraints, so the nearest force toward the target was returned.',
                candidates,
                attemptsTried,
                getForceGeneratorNow() - previewStartedAt,
            );
        }

        const emptyFailureMessage = candidates.length === 0
            ? didFilterCandidatesForSkills
                ? `Only ${candidates.length} ${options.ignoreRarityWeight === true ? 'eligible' : 'availability-positive'} units can satisfy the selected skill ranges with max delta ${skillSettings.maxDelta}.`
                : options.ignoreRarityWeight === true
                    ? 'No eligible units match the current search settings.'
                    : this.getPositiveAvailabilityMessage(candidates.length, options.context)
            : 'Unable to build a force within the selected BV/PV range and unit count constraints.';

        return this.buildEmptyPreview(
            options,
            eligibleUnits.length,
            availableCandidateCapacity,
            budgetRange,
            minUnitCount,
            maxUnitCount,
            emptyFailureMessage,
            candidates,
            attemptsTried,
                getForceGeneratorNow() - previewStartedAt,
        );
    }

    public createForceEntryFromPreviewEntry(previewEntry: ForcePreviewEntry): LoadForceEntry | null {
        const hasUnits = previewEntry.groups.some((group) => group.units.some((unit) => unit.unit));
        if (!hasUnits) {
            return null;
        }

        return createForcePreviewEntryData({
            ...previewEntry,
            instanceId: `generated-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
            timestamp: new Date().toISOString(),
            groups: clonePreviewGroups(previewEntry.groups),
        });
    }

    public createForcePreviewEntry(preview: ForceGenerationPreview, name?: string): ForcePreviewEntry | null {
        if (preview.units.length === 0) return null;

        const faction = preview.faction ?? null;
        const era = preview.era ?? null;
        const resolvedName = name?.trim() || preview.name?.trim() || ForceNamerUtil.generateForceNameForFaction(faction, this.dataService.getForceNameWords());
        const previewGroupContext = {
            faction: preview.faction
                ?? this.dataService.getFactionById(MULFACTION_MERCENARY)
                ?? DEFAULT_PREVIEW_FORCE_FACTION,
            era,
            gameSystem: preview.gameSystem,
            factionName: preview.faction?.name
                ?? this.dataService.getFactionById(MULFACTION_MERCENARY)?.name
                ?? DEFAULT_PREVIEW_FORCE_FACTION.name,
            formationMatchCache: new Map<string, ReturnType<typeof LanceTypeIdentifierUtil.getBestMatchForGroup> | null>(),
        };
        const targetPreviewGroups = this.buildTargetFormationPreviewGroups(
            preview.units,
            previewGroupContext,
            preview.targetFormationGroups,
        );

        const previewGroups = targetPreviewGroups ?? (() => {
            if (preview.targetFormationId) {
                const isValidTargetFormation = this.isGeneratedPreviewValidForFormation(
                    preview.units,
                    previewGroupContext,
                    preview.targetFormationId,
                );
                if (isValidTargetFormation) {
                    return [createGeneratedPreviewGroup(preview.units, preview.gameSystem, preview.targetFormationId)];
                }
            }

            return buildPreviewGroups(preview.units, previewGroupContext);
        })();

        const previewEntry: ForcePreviewEntry = {
            persistenceVersion: 2,
            instanceId: '',
            timestamp: '',
            type: preview.gameSystem,
            owned: true,
            cloud: false,
            local: false,
            missing: false,
            name: resolvedName,
            faction,
            era,
            bv: preview.gameSystem === GameSystem.CBT ? preview.totalCost : undefined,
            pv: preview.gameSystem === GameSystem.AS ? preview.totalCost : undefined,
            reserveCount: 0,
            groups: previewGroups,
        };

        for (const group of previewGroups) {
            group.force = previewEntry;
        }

        return previewEntry;
    }

    private resolveSelectedEras(): Era[] {
        const filterState = this.filtersService.effectiveFilterState()['era'];
        if (!filterState?.interactedWith) {
            return [];
        }

        const allEraNames = this.dataService.getEras().map((era) => era.name);
        const resolvedNames = resolveDropdownNamesFromFilter(
            normalizeMultiStateSelection(filterState.value),
            allEraNames,
            filterState.wildcardPatterns,
        );

        return [...resolvedNames.or, ...resolvedNames.and]
            .map((eraName) => this.dataService.getEraByName(eraName))
            .filter((era): era is Era => era !== undefined);
    }

    private resolveExcludedEraIds(): Set<number> {
        const filterState = this.filtersService.effectiveFilterState()['era'];
        if (!filterState?.interactedWith) {
            return new Set<number>();
        }

        const allEraNames = this.dataService.getEras().map((era) => era.name);
        const resolvedNames = resolveDropdownNamesFromFilter(
            normalizeMultiStateSelection(filterState.value),
            allEraNames,
            filterState.wildcardPatterns,
        );
        const excludedEraIds = new Set<number>();
        for (const eraName of resolvedNames.not) {
            const eraId = this.dataService.getEraByName(eraName)?.id;
            if (eraId !== undefined) {
                excludedEraIds.add(eraId);
            }
        }

        return excludedEraIds;
    }

    private resolveSelectedFactions(): Faction[] {
        const filterState = this.filtersService.effectiveFilterState()['faction'];
        if (!filterState?.interactedWith) {
            return [];
        }

        const allFactionNames = this.dataService.getFactions().map((faction) => faction.name);
        const resolvedNames = resolveDropdownNamesFromFilter(
            normalizeMultiStateSelection(filterState.value),
            allFactionNames,
            filterState.wildcardPatterns,
        );

        return [...resolvedNames.or, ...resolvedNames.and]
            .map((factionName) => this.dataService.getFactionByName(factionName))
            .filter((faction): faction is Faction => faction !== undefined);
    }

    private resolveExcludedFactionIds(): Set<number> {
        const filterState = this.filtersService.effectiveFilterState()['faction'];
        if (!filterState?.interactedWith) {
            return new Set<number>();
        }

        const allFactionNames = this.dataService.getFactions().map((faction) => faction.name);
        const resolvedNames = resolveDropdownNamesFromFilter(
            normalizeMultiStateSelection(filterState.value),
            allFactionNames,
            filterState.wildcardPatterns,
        );
        const excludedFactionIds = new Set<number>();
        for (const factionName of resolvedNames.not) {
            const factionId = this.dataService.getFactionByName(factionName)?.id;
            if (factionId !== undefined) {
                excludedFactionIds.add(factionId);
            }
        }

        return excludedFactionIds;
    }

    private resolveRemainingEraIds(excludedEraIds: ReadonlySet<number>): number[] {
        return this.dataService.getEras()
            .filter((era) => !excludedEraIds.has(era.id))
            .map((era) => era.id);
    }

    private shouldExcludeFactionFromImplicitAvailabilityScope(
        factionId: number,
        explicitlySelectedFactionIds?: ReadonlySet<number>,
    ): boolean {
        return IMPLICIT_MULTI_FACTION_EXCLUDED_IDS.has(factionId)
            && !(explicitlySelectedFactionIds?.has(factionId) ?? false);
    }

    private shouldUseCrossEraAvailabilityForSelection(
        selectedEras: readonly Era[],
        crossEraAvailabilityInMultiEraSelection: boolean,
    ): boolean {
        return crossEraAvailabilityInMultiEraSelection && selectedEras.length !== 1;
    }

    private pickHighestEraFromIds(eraIds: readonly number[]): Era | null {
        const eras = eraIds
            .map((eraId) => this.dataService.getEraById(eraId))
            .filter((era): era is Era => era !== undefined);

        if (eras.length === 0) {
            return null;
        }

        return [...eras].sort((left, right) => {
            const leftYear = getEraReferenceYear(left) ?? Number.NEGATIVE_INFINITY;
            const rightYear = getEraReferenceYear(right) ?? Number.NEGATIVE_INFINITY;
            if (leftYear !== rightYear) {
                return rightYear - leftYear;
            }

            return right.id - left.id;
        })[0] ?? null;
    }

    private resolveContextEra(
        selectedEras: readonly Era[],
        excludedEraIds: ReadonlySet<number>,
        availabilityFaction: Faction | null,
        availablePairs: readonly ForceGenerationAvailabilityPair[],
        crossEraAvailabilityInMultiEraSelection: boolean,
    ): Era | null {
        if (this.shouldUseCrossEraAvailabilityForSelection(selectedEras, crossEraAvailabilityInMultiEraSelection)) {
            const eraIds = selectedEras.length > 0
                ? selectedEras.map((era) => era.id)
                : this.resolveRemainingEraIds(excludedEraIds);
            const highestEra = this.pickHighestEraFromIds(eraIds);
            if (highestEra) {
                return highestEra;
            }
        }

        return this.pickForceEra(selectedEras, availabilityFaction, availablePairs);
    }

    private resolveAvailabilityEraIds(
        selectedEras: readonly Era[],
        excludedEraIds: ReadonlySet<number>,
        forceEra: Era | null,
        crossEraAvailabilityInMultiEraSelection: boolean,
    ): readonly number[] {
        if (this.shouldUseCrossEraAvailabilityForSelection(selectedEras, crossEraAvailabilityInMultiEraSelection)) {
            return selectedEras.length > 0
                ? selectedEras.map((era) => era.id)
                : this.resolveRemainingEraIds(excludedEraIds);
        }

        return forceEra ? [forceEra.id] : [];
    }

    private resolveAvailabilityFactionIds(
        selectedFactions: readonly Faction[],
        excludedFactionIds: ReadonlySet<number>,
        availablePairs: readonly ForceGenerationAvailabilityPair[],
        availabilityEraIds: readonly number[],
    ): readonly number[] {
        if (selectedFactions.length > 0) {
            return selectedFactions.map((faction) => faction.id);
        }

        const scopedEraIds = new Set(availabilityEraIds);
        const scopedFactionIds = new Set(
            availablePairs
                .filter((pair) => scopedEraIds.size === 0 || scopedEraIds.has(pair.eraId))
                .map((pair) => pair.factionId),
        );

        if (scopedFactionIds.size === 0) {
            return [];
        }

        return this.dataService.getFactions()
            .filter((faction) => {
                return scopedFactionIds.has(faction.id)
                    && !this.shouldExcludeFactionFromImplicitAvailabilityScope(faction.id)
                    && !excludedFactionIds.has(faction.id);
            })
            .map((faction) => faction.id);
    }

    private resolveTargetFormationContextFaction(
        options: ForceGenerationContextOptions,
        selectedFactions: readonly Faction[],
        excludedFactionIds: ReadonlySet<number>,
        availablePairs: readonly ForceGenerationAvailabilityPair[],
    ): Faction | null {
        if (!options.gameSystem || selectedFactions.length === 1) {
            return null;
        }

        const definition = this.resolveFirstExclusiveTargetFormationDefinition(options, options.gameSystem);
        if (!definition) {
            return null;
        }

        const candidateFactions = this.resolveExclusiveTargetFormationFactions(
            definition,
            selectedFactions,
            excludedFactionIds,
            availablePairs,
        );

        return candidateFactions.length > 0
            ? pickWeightedRandomEntry(candidateFactions, () => 1)
            : null;
    }

    private resolveFirstExclusiveTargetFormationDefinition(
        options: Pick<ForceGenerationContextOptions, 'targetFormationId' | 'targetFormations'>,
        gameSystem: GameSystem,
    ): FormationTypeDefinition | null {
        for (const targetFormation of this.resolveRawTargetFormationSelections(options)) {
            const definition = LanceTypeIdentifierUtil.resolveDefinition(targetFormation.formationId, gameSystem);
            if (definition?.exclusiveFaction?.length) {
                return definition;
            }
        }

        return null;
    }

    private resolveRawTargetFormationSelections(
        options: Pick<ForceGenerationContextOptions, 'targetFormationId' | 'targetFormations'>,
    ): readonly ForceGenerationTargetFormationSelection[] {
        return options.targetFormations?.length
            ? options.targetFormations
            : options.targetFormationId
                ? [{ formationId: options.targetFormationId, count: 1 }]
                : [];
    }

    private resolveExclusiveTargetFormationFactions(
        definition: FormationTypeDefinition,
        selectedFactions: readonly Faction[],
        excludedFactionIds: ReadonlySet<number>,
        availablePairs: readonly ForceGenerationAvailabilityPair[],
    ): Faction[] {
        const availableFactionIds = new Set(availablePairs.map((pair) => pair.factionId));
        const candidateFactions = selectedFactions.length > 0 ? selectedFactions : this.dataService.getFactions();
        const matchingFactions = this.sortFactionsByExclusiveTargetOrder(
            candidateFactions.filter((faction) => (
                !excludedFactionIds.has(faction.id)
                    && LanceTypeIdentifierUtil.isFormationAvailableForFaction(definition, faction)
            )),
            definition,
        );
        const availableMatchingFactions = matchingFactions.filter((faction) => availableFactionIds.has(faction.id));

        return availableMatchingFactions.length > 0 ? availableMatchingFactions : matchingFactions;
    }

    private sortFactionsByExclusiveTargetOrder(
        factions: readonly Faction[],
        definition: FormationTypeDefinition,
    ): Faction[] {
        const exclusiveFactionNames = definition.exclusiveFaction ?? [];

        return [...factions].sort((left, right) => {
            const leftIndex = this.getExclusiveFactionOrderIndex(left, exclusiveFactionNames);
            const rightIndex = this.getExclusiveFactionOrderIndex(right, exclusiveFactionNames);
            if (leftIndex !== rightIndex) {
                return leftIndex - rightIndex;
            }

            return left.name.localeCompare(right.name);
        });
    }

    private getExclusiveFactionOrderIndex(faction: Faction, exclusiveFactionNames: readonly string[]): number {
        const factionName = faction.name.toLocaleLowerCase();
        const index = exclusiveFactionNames.findIndex((exclusiveFactionName) => (
            factionName.includes(exclusiveFactionName.toLocaleLowerCase())
        ));

        return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
    }

    private shouldUseAvailabilityEraScopeFromFilters(
        selectedEras: readonly Era[],
        availabilityEraIds: readonly number[],
        crossEraAvailabilityInMultiEraSelection: boolean,
    ): boolean {
        if (!this.shouldUseCrossEraAvailabilityForSelection(selectedEras, crossEraAvailabilityInMultiEraSelection)) {
            return false;
        }

        if (selectedEras.length > 1) {
            return true;
        }

        return selectedEras.length === 0 && availabilityEraIds.length > 0;
    }

    private shouldUseAvailabilityFactionScopeFromFilters(
        selectedFactions: readonly Faction[],
        availabilityFactionIds: readonly number[],
    ): boolean {
        if (selectedFactions.length > 1) {
            return true;
        }

        return selectedFactions.length === 0 && availabilityFactionIds.length > 0;
    }

    private collectPositiveAvailabilityPairs(
        eligibleUnits: readonly UnitSummary[],
        eraIds: readonly number[],
        factionIds: readonly number[],
        excludedEraIds: ReadonlySet<number> = new Set<number>(),
        excludedFactionIds: ReadonlySet<number> = new Set<number>(),
    ): ForceGenerationAvailabilityPair[] {
        const scopedEraIds = new Set(eraIds);
        const scopedFactionIds = new Set(factionIds);

        if (this.unitAvailabilitySource.useMegaMekAvailability()) {
            return this.collectPositiveMegaMekAvailabilityPairs(
                eligibleUnits,
                scopedEraIds,
                scopedFactionIds,
                excludedEraIds,
                excludedFactionIds,
            );
        }

        const eligibleUnitIds = new Set(
            eligibleUnits.map((unit) => this.unitAvailabilitySource.getUnitAvailabilityKey(unit)),
        );

        if (eligibleUnitIds.size === 0) {
            return [];
        }

        const candidateEras = (scopedEraIds.size > 0
            ? [...scopedEraIds]
                .map((eraId) => this.dataService.getEraById(eraId))
                .filter((era): era is Era => era !== undefined)
            : this.dataService.getEras())
            .filter((era) => !excludedEraIds.has(era.id));
        const candidateFactions = (scopedFactionIds.size > 0
            ? [...scopedFactionIds]
                .map((factionId) => this.dataService.getFactionById(factionId))
                .filter((faction): faction is Faction => faction !== undefined)
            : this.dataService.getFactions())
            .filter((faction) => {
                return !this.shouldExcludeFactionFromImplicitAvailabilityScope(faction.id, scopedFactionIds)
                    && !excludedFactionIds.has(faction.id);
            });

        const pairs: ForceGenerationAvailabilityPair[] = [];
        for (const era of candidateEras) {
            for (const faction of candidateFactions) {
                const availableUnitIds = this.unitAvailabilitySource.getFactionEraUnitIds(faction, era);
                if (!setHasAny(eligibleUnitIds, availableUnitIds)) {
                    continue;
                }

                pairs.push({
                    eraId: era.id,
                    factionId: faction.id,
                });
            }
        }

        return pairs;
    }

    private collectPositiveMegaMekAvailabilityPairs(
        eligibleUnits: readonly UnitSummary[],
        scopedEraIds: ReadonlySet<number>,
        scopedFactionIds: ReadonlySet<number>,
        excludedEraIds: ReadonlySet<number>,
        excludedFactionIds: ReadonlySet<number>,
    ): ForceGenerationAvailabilityPair[] {
        const pairsByKey = new Map<string, ForceGenerationAvailabilityPair>();

        for (const unit of eligibleUnits) {
            const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            if (!availabilityRecord) {
                continue;
            }

            for (const [eraIdText, eraAvailability] of Object.entries(availabilityRecord.e)) {
                const eraId = Number(eraIdText);
                if (
                    Number.isNaN(eraId)
                    || excludedEraIds.has(eraId)
                    || (scopedEraIds.size > 0 && !scopedEraIds.has(eraId))
                ) {
                    continue;
                }

                for (const [factionIdText, weights] of Object.entries(eraAvailability)) {
                    const factionId = Number(factionIdText);
                    if (
                        Number.isNaN(factionId)
                        || this.shouldExcludeFactionFromImplicitAvailabilityScope(factionId, scopedFactionIds)
                        || excludedFactionIds.has(factionId)
                        || (scopedFactionIds.size > 0 && !scopedFactionIds.has(factionId))
                    ) {
                        continue;
                    }

                    const requisitionWeight = weights[0] ?? 0;
                    const salvageWeight = weights[1] ?? 0;
                    if (requisitionWeight <= 0 && salvageWeight <= 0) {
                        continue;
                    }

                    const pairKey = buildAvailabilityPairKey(eraId, factionId);
                    if (!pairsByKey.has(pairKey)) {
                        pairsByKey.set(pairKey, { eraId, factionId });
                    }
                }
            }
        }

        return [...pairsByKey.values()];
    }

    private pickForceFaction(
        selectedFactions: readonly Faction[],
        availablePairs: readonly ForceGenerationAvailabilityPair[],
    ): Faction | null {
        const candidateFactionIds = new Set(availablePairs.map((pair) => pair.factionId));
        const candidates = selectedFactions.length > 0
            ? selectedFactions.filter((faction) => faction.id !== MULFACTION_NONE && candidateFactionIds.has(faction.id))
            : [...candidateFactionIds]
                .map((factionId) => this.dataService.getFactionById(factionId))
                .filter((faction): faction is Faction => faction !== undefined
                    && faction.id !== MULFACTION_EXTINCT
                    && faction.id !== MULFACTION_NONE);

        if (candidates.length > 0) {
            return pickWeightedRandomEntry(candidates, () => 1);
        }

        if (selectedFactions.length > 0) {
            const fallbackCandidates = selectedFactions.filter((faction) => faction.id !== MULFACTION_NONE);
            return fallbackCandidates.length > 0
                ? pickWeightedRandomEntry(fallbackCandidates, () => 1)
                : this.dataService.getFactionById(MULFACTION_MERCENARY) ?? null;
        }

        return this.dataService.getFactionById(MULFACTION_MERCENARY) ?? null;
    }

    private pickForceEra(
        selectedEras: readonly Era[],
        forceFaction: Faction | null,
        availablePairs: readonly ForceGenerationAvailabilityPair[],
    ): Era | null {
        const availableEraIds = new Set(
            availablePairs
                .filter((pair) => !forceFaction || pair.factionId === forceFaction.id)
                .map((pair) => pair.eraId),
        );

        if (selectedEras.length > 0) {
            const candidates = selectedEras.filter((era) => availableEraIds.has(era.id));
            return pickWeightedRandomEntry(candidates.length > 0 ? candidates : selectedEras, () => 1);
        }

        const candidates = [...availableEraIds]
            .map((eraId) => this.dataService.getEraById(eraId))
            .filter((era): era is Era => era !== undefined);

        return candidates.length > 0 ? pickWeightedRandomEntry(candidates, () => 1) : null;
    }

    private resolveRulesetContext(forceFaction: Faction | null, forceEra: Era | null): ResolvedRulesetContext {
        if (!forceFaction) {
            return { primary: null, chain: [] };
        }

        const rulesetCandidates = this.dataService.getMegaMekRulesetsByMulFactionId(forceFaction.id);
        if (rulesetCandidates.length === 0) {
            return { primary: null, chain: [] };
        }

        const referenceYear = getEraReferenceYear(forceEra);
        const activeCandidates = referenceYear === undefined
            ? rulesetCandidates
            : rulesetCandidates.filter((candidate) => {
                const megaMekFaction = this.dataService.getMegaMekFactionByKey(candidate.factionKey);
                if (!megaMekFaction) {
                    return true;
                }

                return megaMekFaction.yearsActive.length === 0 || megaMekFaction.yearsActive.some((yearsActive) => {
                    const startYear = yearsActive.start ?? Number.NEGATIVE_INFINITY;
                    const endYear = yearsActive.end ?? Number.POSITIVE_INFINITY;
                    return startYear <= referenceYear && endYear >= referenceYear;
                });
            });
        const primary = activeCandidates[0] ?? rulesetCandidates[0];
        return {
            primary,
            chain: this.resolveRulesetChain(primary),
        };
    }

    private resolveRulesetContextByFactionKey(factionKey: string | undefined, forceEra: Era | null): ResolvedRulesetContext {
        if (!factionKey) {
            return { primary: null, chain: [] };
        }

        const ruleset = this.dataService.getMegaMekRulesetByFactionKey(factionKey);
        if (!ruleset) {
            return { primary: null, chain: [] };
        }

        const referenceYear = getEraReferenceYear(forceEra);
        if (referenceYear !== undefined) {
            const megaMekFaction = this.dataService.getMegaMekFactionByKey(ruleset.factionKey);
            if (megaMekFaction && megaMekFaction.yearsActive.length > 0) {
                const isActive = megaMekFaction.yearsActive.some((yearsActive) => {
                    const startYear = yearsActive.start ?? Number.NEGATIVE_INFINITY;
                    const endYear = yearsActive.end ?? Number.POSITIVE_INFINITY;
                    return startYear <= referenceYear && endYear >= referenceYear;
                });
                if (!isActive) {
                    return { primary: null, chain: [] };
                }
            }
        }

        return {
            primary: ruleset,
            chain: this.resolveRulesetChain(ruleset),
        };
    }

    private resolveRulesetChain(primaryRuleset: MegaMekRulesetRecord | null): MegaMekRulesetRecord[] {
        const chain: MegaMekRulesetRecord[] = [];
        const visited = new Set<string>();
        let current = primaryRuleset;

        while (current && !visited.has(current.factionKey)) {
            visited.add(current.factionKey);
            chain.push(current);

            const parentFactionKey = current.parentFactionKey;
            current = parentFactionKey
                ? this.dataService.getMegaMekRulesetByFactionKey(parentFactionKey) ?? null
                : null;
        }

        return chain;
    }

    private createCandidateUnit(
        unit: UnitSummary,
        context: ForceGenerationContext,
        options: ForceGenerationRequest,
        lockedUnit?: GeneratedForceUnit,
        availabilityWeightCache?: ForceGenerationAvailabilityWeightCache,
    ): ForceGenerationCandidateUnit {
        const availabilityWeights = this.getCandidateAvailabilityWeights(
            unit,
            context,
            options,
            availabilityWeightCache,
        );
        const baseCandidate = this.createBaseCandidateUnit(unit, options);

        return {
            unit,
            requisitionWeight: availabilityWeights.requisition,
            salvageWeight: availabilityWeights.salvage,
            availabilityWeightsIgnored: options.ignoreRarityWeight === true,
            cost: lockedUnit?.cost ?? baseCandidate.cost,
            alias: lockedUnit?.alias,
            commander: lockedUnit?.commander,
            skill: lockedUnit?.skill ?? baseCandidate.skill,
            gunnery: lockedUnit?.gunnery ?? baseCandidate.gunnery,
            piloting: lockedUnit?.piloting ?? baseCandidate.piloting,
            crew: lockedUnit?.crew?.map((member) => ({ ...member })),
            lockKey: lockedUnit?.lockKey,
            variantGroupKey: lockedUnit?.variantGroupKey,
            locked: lockedUnit !== undefined,
            megaMekUnitType: baseCandidate.megaMekUnitType,
            megaMekWeightClass: baseCandidate.megaMekWeightClass,
            role: baseCandidate.role,
            motive: baseCandidate.motive,
        };
    }

    private resolveLockedUnitVariant(
        lockedUnit: GeneratedForceUnit,
        candidatePool: readonly ForceGenerationCandidateUnit[],
    ): UnitSummary {
        const variantGroupKey = lockedUnit.variantGroupKey;
        if (!variantGroupKey) {
            return lockedUnit.unit;
        }

        const variantCandidates = candidatePool.filter((candidate) => getUnitVariantGroupKey(candidate.unit) === variantGroupKey);
        if (variantCandidates.length === 0) {
            return lockedUnit.unit;
        }

        return pickWeightedRandomEntry(
            variantCandidates,
            (candidate) => Math.max(1, candidate.requisitionWeight + candidate.salvageWeight),
        ).unit;
    }

    private resolveLockedUnitForSelection(
        lockedUnit: GeneratedForceUnit,
        unit: UnitSummary,
        options: ForceGenerationRequest,
    ): GeneratedForceUnit {
        const skill = options.gameSystem === GameSystem.AS
            ? lockedUnit.skill ?? lockedUnit.gunnery ?? options.gunnery
            : undefined;
        const gunnery = options.gameSystem === GameSystem.CBT
            ? lockedUnit.gunnery ?? lockedUnit.skill ?? options.gunnery
            : undefined;
        const piloting = options.gameSystem === GameSystem.CBT
            ? getEffectivePilotingSkill(unit, lockedUnit.piloting ?? options.piloting)
            : undefined;
        const crew = options.gameSystem === GameSystem.CBT
            ? normalizeGeneratedCBTCrew(unit, lockedUnit.crew, gunnery!, piloting!, lockedUnit.alias)
            : undefined;
        const resolvedGunnery = gunnery === undefined
            ? undefined
            : getGeneratedCBTCrewSkill(crew, 'gunnery', gunnery);
        const resolvedPiloting = piloting === undefined
            ? undefined
            : getGeneratedCBTCrewSkill(crew, 'piloting', piloting);

        return {
            ...lockedUnit,
            crew,
            unit,
            cost: getBudgetMetric(
                unit,
                options.gameSystem,
                skill ?? resolvedGunnery ?? options.gunnery,
                resolvedPiloting ?? options.piloting,
            ),
            skill,
            gunnery: resolvedGunnery,
            piloting: resolvedPiloting,
            lockKey: lockedUnit.lockKey ?? uuidv7(),
        };
    }

    private createBaseCandidateUnit(
        unit: UnitSummary,
        options: ForceGenerationRequest,
    ): ForceGenerationBaseCandidateUnit {
        const skillSettings = resolveForceGenerationSkillSettings(options);
        const skill = options.gameSystem === GameSystem.AS
            ? skillSettings.gunnery.min
            : undefined;
        const gunnery = options.gameSystem === GameSystem.CBT
            ? skillSettings.gunnery.min
            : undefined;
        const piloting = options.gameSystem === GameSystem.CBT
            ? getEffectivePilotingSkill(unit, skillSettings.piloting.min)
            : undefined;

        return {
            unit,
            cost: getBudgetMetric(
                unit,
                options.gameSystem,
                skill ?? gunnery ?? options.gunnery,
                piloting ?? options.piloting,
            ),
            skill,
            gunnery,
            piloting,
            megaMekUnitType: toMegaMekUnitType(unit),
            megaMekWeightClass: toMegaMekWeightClass(unit),
            role: normalizeRole(unit.role),
            motive: toMegaMekMotive(unit),
        };
    }

    private countTaggedQuantityCandidates(
        candidates: readonly Pick<ForceGenerationCandidateUnit, 'unit'>[],
        taggedQuantityCaps: ForceGenerationTaggedQuantityCaps,
    ): Map<string, number> {
        const counts = new Map<string, number>();

        for (const candidate of candidates) {
            const capKey = this.resolveTaggedQuantityCapKeyForUnit(candidate.unit, taggedQuantityCaps);
            if (!capKey) {
                continue;
            }

            counts.set(capKey, (counts.get(capKey) ?? 0) + 1);
        }

        return counts;
    }

    private resolveTaggedQuantityCaps(
        eligibleUnits: readonly UnitSummary[],
        maxUnitCount: number,
        useUnitTagsAsChassisTags = false,
    ): ForceGenerationTaggedQuantityCaps {
        const selectedTagKeys = this.resolvePositiveTaggedQuantityFilterKeys(eligibleUnits);
        if (selectedTagKeys.size === 0) {
            return {
                capByKey: new Map<string, number>(),
                keyByUnitUuid: new Map<string, string>(),
            };
        }

        if (useUnitTagsAsChassisTags) {
            return this.resolveChassisSharedTaggedQuantityCaps(eligibleUnits, selectedTagKeys, maxUnitCount);
        }

        const capByKey = new Map<string, number>();
        const keyByUnitUuid = new Map<string, string>();
        for (const unit of eligibleUnits) {
            const resolvedCap = this.getTaggedQuantityCapForUnit(unit, selectedTagKeys, maxUnitCount)
                ?? {
                    key: buildTaggedQuantityUnitKey(unit),
                    cap: 1,
                };
            keyByUnitUuid.set(unit.uuid, resolvedCap.key);
            capByKey.set(resolvedCap.key, Math.max(capByKey.get(resolvedCap.key) ?? 1, resolvedCap.cap));
        }

        return {
            capByKey,
            keyByUnitUuid,
        };
    }

    private resolveChassisSharedTaggedQuantityCaps(
        eligibleUnits: readonly UnitSummary[],
        selectedTagKeys: ReadonlySet<string>,
        maxUnitCount: number,
    ): ForceGenerationTaggedQuantityCaps {
        const capByKey = new Map<string, number>();
        const keyByUnitUuid = new Map<string, string>();

        for (const unit of eligibleUnits) {
            const chassisQuantityCap = this.getTaggedQuantityCapFromEntries(unit._chassisTags, selectedTagKeys, maxUnitCount);
            const unitQuantityCap = this.getTaggedQuantityCapFromEntries(unit._nameTags, selectedTagKeys, maxUnitCount);
            const resolvedCap = Math.max(chassisQuantityCap, unitQuantityCap);
            const resolvedKey = resolvedCap > 0
                ? buildTaggedQuantityChassisKey(unit)
                : buildTaggedQuantityUnitKey(unit);

            keyByUnitUuid.set(unit.uuid, resolvedKey);
            capByKey.set(resolvedKey, Math.max(capByKey.get(resolvedKey) ?? 1, resolvedCap || 1));
        }

        return {
            capByKey,
            keyByUnitUuid,
        };
    }

    private resolvePositiveTaggedQuantityFilterKeys(eligibleUnits: readonly UnitSummary[]): Set<string> {
        const filterState = this.filtersService.effectiveFilterState()['_tags'];
        if (!filterState?.interactedWith) {
            return new Set<string>();
        }

        const positiveTagNames = getPositiveDropdownNamesFromFilter(
            normalizeMultiStateSelection(filterState.value),
            this.collectTaggedQuantityFilterNames(eligibleUnits),
            filterState.wildcardPatterns,
        );

        return new Set(
            positiveTagNames
                .map((tagName) => normalizeSelectionKey(tagName))
                .filter((tagKey) => tagKey.length > 0),
        );
    }

    private collectTaggedQuantityFilterNames(eligibleUnits: readonly UnitSummary[]): string[] {
        const tagNames = new Set<string>();

        for (const unit of eligibleUnits) {
            for (const tagEntry of unit._chassisTags ?? []) {
                if (tagEntry.tag.trim().length > 0) {
                    tagNames.add(tagEntry.tag);
                }
            }

            for (const tagEntry of unit._nameTags ?? []) {
                if (tagEntry.tag.trim().length > 0) {
                    tagNames.add(tagEntry.tag);
                }
            }
        }

        return [...tagNames];
    }

    private getTaggedQuantityCapForUnit(
        unit: UnitSummary,
        selectedTagKeys: ReadonlySet<string>,
        maxUnitCount: number,
    ): { key: string; cap: number } | null {
        const chassisQuantityCap = this.getTaggedQuantityCapFromEntries(unit._chassisTags, selectedTagKeys, maxUnitCount);

        if (chassisQuantityCap > 0) {
            return {
                key: buildTaggedQuantityChassisKey(unit),
                cap: chassisQuantityCap,
            };
        }

        const unitQuantityCap = this.getTaggedQuantityCapFromEntries(unit._nameTags, selectedTagKeys, maxUnitCount);

        if (unitQuantityCap > 0) {
            return {
                key: buildTaggedQuantityUnitKey(unit),
                cap: unitQuantityCap,
            };
        }

        return null;
    }

    private getTaggedQuantityCapFromEntries(
        tagEntries: readonly { tag: string; quantity?: number }[] | undefined,
        selectedTagKeys: ReadonlySet<string>,
        maxUnitCount: number,
    ): number {
        let quantityCap = 0;
        for (const tagEntry of tagEntries ?? []) {
            if (!selectedTagKeys.has(normalizeSelectionKey(tagEntry.tag))) {
                continue;
            }

            quantityCap = Math.max(
                quantityCap,
                this.normalizeTaggedQuantityCap(tagEntry.quantity, maxUnitCount),
            );
        }

        return quantityCap;
    }

    private normalizeTaggedQuantityCap(quantity: number | undefined, maxUnitCount: number): number {
        const parsedQuantity = typeof quantity === 'number' && Number.isFinite(quantity)
            ? Math.floor(quantity)
            : 1;
        return Math.min(maxUnitCount, Math.max(1, parsedQuantity));
    }

    private getTaggedQuantityCap(
        capKey: string,
        taggedQuantityCaps: ForceGenerationTaggedQuantityCaps,
        maxUnitCount: number,
    ): number {
        return Math.min(maxUnitCount, Math.max(1, taggedQuantityCaps.capByKey.get(capKey) ?? 1));
    }

    private resolveTaggedQuantityCapKeyForUnit(
        unit: UnitSummary,
        taggedQuantityCaps: ForceGenerationTaggedQuantityCaps,
    ): string | null {
        const mappedKey = taggedQuantityCaps.keyByUnitUuid.get(unit.uuid);
        if (mappedKey) {
            return mappedKey;
        }

        const chassisKey = buildTaggedQuantityChassisKey(unit);
        if (taggedQuantityCaps.capByKey.has(chassisKey)) {
            return chassisKey;
        }

        const unitKey = buildTaggedQuantityUnitKey(unit);
        return taggedQuantityCaps.capByKey.has(unitKey) ? unitKey : null;
    }

    private getAvailableTaggedQuantityCopies(
        capKey: string,
        taggedQuantityCaps: ForceGenerationTaggedQuantityCaps,
        lockedCountsByKey: ReadonlyMap<string, number>,
        maxUnitCount: number,
    ): number {
        const quantityCap = this.getTaggedQuantityCap(capKey, taggedQuantityCaps, maxUnitCount);
        const lockedCount = lockedCountsByKey.get(capKey) ?? 0;
        return Math.max(0, quantityCap - lockedCount);
    }

    private countTaggedQuantityCapacity<T>(
        items: readonly T[],
        getUnit: (item: T) => UnitSummary,
        taggedQuantityCaps: ForceGenerationTaggedQuantityCaps,
        lockedCountsByKey: ReadonlyMap<string, number>,
        maxUnitCount: number,
    ): number {
        const countedKeys = new Set<string>();
        let capacity = 0;

        for (const item of items) {
            const capKey = this.resolveTaggedQuantityCapKeyForUnit(getUnit(item), taggedQuantityCaps);
            if (!capKey || countedKeys.has(capKey)) {
                continue;
            }
            countedKeys.add(capKey);

            capacity += this.getAvailableTaggedQuantityCopies(
                capKey,
                taggedQuantityCaps,
                lockedCountsByKey,
                maxUnitCount,
            );
        }

        return capacity;
    }

    private expandCandidatesForTaggedQuantities(
        candidates: readonly ForceGenerationCandidateUnit[],
        taggedQuantityCaps: ForceGenerationTaggedQuantityCaps,
        lockedCountsByKey: ReadonlyMap<string, number>,
        maxUnitCount: number,
    ): ForceGenerationCandidateUnit[] {
        const expandedCandidates: ForceGenerationCandidateUnit[] = [];

        for (const candidate of candidates) {
            const capKey = this.resolveTaggedQuantityCapKeyForUnit(candidate.unit, taggedQuantityCaps);
            const availableCopies = capKey
                ? this.getAvailableTaggedQuantityCopies(
                    capKey,
                    taggedQuantityCaps,
                    lockedCountsByKey,
                    maxUnitCount,
                )
                : 1;

            for (let copyIndex = 0; copyIndex < availableCopies; copyIndex += 1) {
                const expandedCandidate = copyIndex === 0 ? candidate : { ...candidate };
                expandedCandidates.push(capKey
                    ? {
                        ...expandedCandidate,
                        taggedQuantityCapKey: capKey,
                        taggedQuantityCap: availableCopies,
                    }
                    : expandedCandidate);
            }
        }

        return expandedCandidates;
    }

    private createSkillAdjustedCandidate(
        candidate: ForceGenerationCandidateUnit,
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationCandidateUnit {
        if (candidate.locked) {
            return candidate;
        }

        if (gameSystem === GameSystem.AS) {
            const skill = pickRandomIntegerInRange(skillSettings.gunnery);
            return {
                ...candidate,
                cost: getBudgetMetric(candidate.unit, gameSystem, skill, skillSettings.piloting.min),
                skill,
                gunnery: undefined,
                piloting: undefined,
            };
        }

        const classicSkillPairs = getForceGenerationCBTSkillPairs(skillSettings, candidate.unit);
        const skillPair = classicSkillPairs[Math.floor(Math.random() * classicSkillPairs.length)]
            ?? { gunnery: skillSettings.gunnery.min, piloting: skillSettings.piloting.min };

        return {
            ...candidate,
            cost: getBudgetMetric(candidate.unit, gameSystem, skillPair.gunnery, skillPair.piloting),
            skill: undefined,
            gunnery: skillPair.gunnery,
            piloting: skillPair.piloting,
        };
    }

    private createTargetFormationCandidatesForAttempt(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        definition: FormationTypeDefinition,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationCandidateUnit[] {
        return candidates
            .map((candidate) => this.createTargetFormationSkillAdjustedCandidate(candidate, options, definition, skillSettings))
            .filter((candidate): candidate is ForceGenerationCandidateUnit => candidate !== null);
    }

    private createTargetFormationSkillAdjustedCandidate(
        candidate: ForceGenerationCandidateUnit,
        options: ForceGenerationRequest,
        definition: FormationTypeDefinition,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationCandidateUnit | null {
        const skillOptions = this.createTargetFormationSkillAdjustedCandidateOptions(
            candidate,
            options,
            definition,
            skillSettings,
        );
        if (skillOptions.length === 0) {
            return null;
        }

        return skillOptions.length === 1
            ? skillOptions[0]
            : skillOptions[Math.floor(Math.random() * skillOptions.length)];
    }

    private createTargetFormationSkillAdjustedCandidateOptions(
        candidate: ForceGenerationCandidateUnit,
        options: ForceGenerationRequest,
        definition: FormationTypeDefinition,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationCandidateUnit[] {
        const preferredOptions = this.filterTargetFormationCandidatePool(
            createSkillAdjustedCandidateOptionsForSettings(candidate, options.gameSystem, skillSettings),
            options,
            definition,
        );
        if (preferredOptions.length > 0) {
            return preferredOptions;
        }

        const fallbackOptions = this.filterTargetFormationCandidatePool(
            createSkillAdjustedCandidateOptionsForSettings(
                candidate,
                options.gameSystem,
                this.createFormationSkillFallbackSettings(skillSettings),
            ),
            options,
            definition,
        );
        if (fallbackOptions.length === 0) {
            return [];
        }

        return this.getClosestSkillOptionsToSettings(fallbackOptions, options.gameSystem, skillSettings);
    }

    private createFormationSkillFallbackSettings(
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationSkillSettings {
        return {
            gunnery: {
                min: FORCE_GENERATION_MIN_PILOT_SKILL,
                max: FORCE_GENERATION_MAX_PILOT_SKILL,
            },
            piloting: {
                min: FORCE_GENERATION_MIN_PILOT_SKILL,
                max: FORCE_GENERATION_MAX_PILOT_SKILL,
            },
            maxDelta: skillSettings.maxDelta,
        };
    }

    private getClosestSkillOptionsToSettings(
        candidates: readonly ForceGenerationCandidateUnit[],
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationCandidateUnit[] {
        let bestDistance = Number.POSITIVE_INFINITY;
        const bestCandidates: ForceGenerationCandidateUnit[] = [];

        for (const candidate of candidates) {
            const distance = this.getCandidateSkillRangeDistance(candidate, gameSystem, skillSettings);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestCandidates.length = 0;
            }
            if (distance === bestDistance) {
                bestCandidates.push(candidate);
            }
        }

        return bestCandidates;
    }

    private getCandidateSkillRangeDistance(
        candidate: ForceGenerationCandidateUnit,
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
    ): number {
        const gunnery = gameSystem === GameSystem.AS
            ? candidate.skill ?? candidate.gunnery ?? skillSettings.gunnery.min
            : candidate.gunnery ?? candidate.skill ?? skillSettings.gunnery.min;
        const gunneryDistance = this.getSkillRangeDistance(gunnery, skillSettings.gunnery);
        if (gameSystem === GameSystem.AS) {
            return gunneryDistance;
        }

        return gunneryDistance + this.getSkillRangeDistance(candidate.piloting ?? skillSettings.piloting.min, skillSettings.piloting);
    }

    private getSkillRangeDistance(value: number, range: ForceGenerationSkillRange): number {
        if (value < range.min) {
            return range.min - value;
        }
        if (value > range.max) {
            return value - range.max;
        }

        return 0;
    }

    private createSkillBudgetPlanningCosts(
        candidates: readonly ForceGenerationCandidateUnit[],
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
        skillOptionResolver?: ForceGenerationSkillOptionResolver,
    ): ForceGenerationSkillBudgetPlanningCosts | undefined {
        if (!FORCE_GENERATION_OPTIMIZE_SELECTED_SKILLS_FOR_BUDGET
            || (!hasVariableForceGenerationSkillSettings(gameSystem, skillSettings) && !skillOptionResolver)) {
            return undefined;
        }

        const minCostByCandidate = new Map<ForceGenerationCandidateUnit, number>();
        const maxCostByCandidate = new Map<ForceGenerationCandidateUnit, number>();
        for (const [index, candidate] of candidates.entries()) {
            const options = skillOptionResolver
                ? skillOptionResolver(candidate, index)
                : createSkillAdjustedCandidateOptions(candidate, gameSystem, skillSettings);
            const resolvedOptions = options.length > 0 ? options : [candidate];
            minCostByCandidate.set(candidate, Math.min(...resolvedOptions.map(option => option.cost)));
            maxCostByCandidate.set(candidate, Math.max(...resolvedOptions.map(option => option.cost)));
        }

        return { minCostByCandidate, maxCostByCandidate };
    }

    private createTargetFormationSkillBudgetPlanningCosts(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        definition: FormationTypeDefinition,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationSkillBudgetPlanningCosts | undefined {
        return this.createSkillBudgetPlanningCosts(
            candidates,
            options.gameSystem,
            skillSettings,
            (candidate) => this.createTargetFormationSkillAdjustedCandidateOptions(candidate, options, definition, skillSettings),
        );
    }

    private getSkillPlanningCost(
        candidate: ForceGenerationCandidateUnit,
        planningCosts: ForceGenerationSkillBudgetPlanningCosts | undefined,
        kind: 'min' | 'max',
    ): number {
        const costByCandidate = kind === 'min'
            ? planningCosts?.minCostByCandidate
            : planningCosts?.maxCostByCandidate;
        return costByCandidate?.get(candidate) ?? candidate.cost;
    }

    private canSkillAdjustedSelectionReachBudgetRange(
        minTotalCost: number,
        maxTotalCost: number,
        budgetRange: { min: number; max: number },
    ): boolean {
        return maxTotalCost >= budgetRange.min && minTotalCost <= budgetRange.max;
    }

    private optimizeSelectionAttemptSkillsForBudget(
        selectionAttempt: ForceGenerationSelectionAttempt,
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
        budgetRange: { min: number; max: number },
        skillOptionResolver?: ForceGenerationSkillOptionResolver,
    ): ForceGenerationSelectionAttempt {
        if (
            !FORCE_GENERATION_OPTIMIZE_SELECTED_SKILLS_FOR_BUDGET
            || (!hasVariableForceGenerationSkillSettings(gameSystem, skillSettings) && !skillOptionResolver)
            || selectionAttempt.selectedCandidates.length === 0
        ) {
            return selectionAttempt;
        }

        const originalTotalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        if (isBudgetWithinRange(originalTotalCost, budgetRange)) {
            return selectionAttempt;
        }

        const skillOptionsByCandidate = selectionAttempt.selectedCandidates.map((candidate, index) => {
            const options = skillOptionResolver
                ? skillOptionResolver(candidate, index)
                : createSkillAdjustedCandidateOptions(candidate, gameSystem, skillSettings);
            return options.length > 0 ? options : [candidate];
        });
        const selectedCandidates = optimizeSkillBudget(selectionAttempt.selectedCandidates, skillOptionsByCandidate, budgetRange);
        if (selectedCandidates === selectionAttempt.selectedCandidates) {
            return selectionAttempt;
        }

        return {
            ...selectionAttempt,
            selectedCandidates,
            selectionSteps: selectionAttempt.selectionSteps.map((step, index) => {
                const candidate = selectedCandidates[index];
                return {
                    ...step,
                    cost: candidate?.cost ?? step.cost,
                    skill: candidate?.skill,
                    gunnery: candidate?.gunnery,
                    piloting: candidate?.piloting,
                };
            }),
        };
    }

    private createSkillAdjustedCandidatesForAttempt(
        candidates: readonly ForceGenerationCandidateUnit[],
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationCandidateUnit[] {
        if (!hasVariableForceGenerationSkillSettings(gameSystem, skillSettings)) {
            return [...candidates];
        }

        return candidates.map((candidate) => this.createSkillAdjustedCandidate(
            candidate,
            gameSystem,
            skillSettings,
        ));
    }

    private filterCandidatesForSkillSettings(
        candidates: readonly ForceGenerationCandidateUnit[],
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
    ): readonly ForceGenerationCandidateUnit[] {
        if (gameSystem !== GameSystem.CBT) {
            return candidates;
        }

        return candidates.filter((candidate) => {
            return getForceGenerationCBTSkillPairs(skillSettings, candidate.unit).length > 0;
        });
    }

    private resolveAvailabilityWeightCache(
        eligibleUnits: readonly UnitSummary[],
        context: ForceGenerationContext,
    ): ForceGenerationAvailabilityWeightCache {
        const useMegaMekAvailability = this.unitAvailabilitySource.useMegaMekAvailability();
        const availabilityScopeState = this.buildAvailabilityScopeState(context);
        const signature = this.buildAvailabilityWeightCacheSignature(context, useMegaMekAvailability, availabilityScopeState);
        if (this.availabilityWeightCache?.signature === signature) {
            return this.availabilityWeightCache;
        }

        this.availabilityWeightCache = this.buildAvailabilityWeightCache(
            signature,
            useMegaMekAvailability,
            availabilityScopeState,
            eligibleUnits,
        );

        return this.availabilityWeightCache;
    }

    private buildAvailabilityWeightCache(
        signature: string,
        useMegaMekAvailability: boolean,
        scopeState: ForceGenerationAvailabilityScopeState,
        eligibleUnits: readonly UnitSummary[],
    ): ForceGenerationAvailabilityWeightCache {
        const recordsByUnitUuid = useMegaMekAvailability ? undefined : new Map<string, MegaMekWeightedAvailabilityRecord | undefined>();
        const weightsByUnitUuid = new Map<string, AvailabilityWeights>();
        for (const unit of eligibleUnits) {
            const record = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            recordsByUnitUuid?.set(unit.uuid, record);
            weightsByUnitUuid.set(unit.uuid, getScopedAvailabilityWeights(record, scopeState, useMegaMekAvailability));
        }

        if (!useMegaMekAvailability) {
            const unitsByMulId = new Map<number, UnitSummary[]>();
            for (const unit of eligibleUnits) {
                if (unit.id === null) continue;
                const matchingUnits = unitsByMulId.get(unit.id) ?? [];
                matchingUnits.push(unit);
                unitsByMulId.set(unit.id, matchingUnits);
            }
            for (const { eraId, factionId } of scopeState.pairs) {
                const faction = this.dataService.getFactionById(factionId);
                const era = this.dataService.getEraById(eraId);
                if (!faction || !era) {
                    continue;
                }
                for (const unitId of this.unitAvailabilitySource.getFactionEraUnitIds(faction, era, 'mul')) {
                    for (const unit of unitsByMulId.get(Number(unitId)) ?? []) {
                        const exactValue = recordsByUnitUuid!.get(unit.uuid)?.e[String(eraId)]?.[String(factionId)];
                        includeMulAvailabilityFallback(weightsByUnitUuid.get(unit.uuid)!, exactValue);
                    }
                }
            }
        }

        return { signature, useMegaMekAvailability, scopeState, weightsByUnitUuid };
    }

    private buildAvailabilityScopeState(context: ForceGenerationContext): ForceGenerationAvailabilityScopeState {
        const eraIds = this.getScopedAvailabilityEraIds(context);
        const factionIds = this.getScopedAvailabilityFactionIds(context);
        const pairs = eraIds.flatMap((eraId) => factionIds.map((factionId) => ({ eraId, factionId })));

        return {
            pairs,
            eraIds,
            factionIds,
            eraIdTexts: eraIds.map((eraId) => String(eraId)),
            factionIdTextSet: new Set(factionIds.map((factionId) => String(factionId))),
        };
    }

    private buildAvailabilityWeightCacheSignature(
        context: ForceGenerationContext,
        useMegaMekAvailability: boolean,
        scopeState?: ForceGenerationAvailabilityScopeState,
    ): string {
        const resolvedScopeState = scopeState ?? this.buildAvailabilityScopeState(context);
        return [
            `corpus:${this.dataService.searchCorpusVersion()}`,
            `availability:${this.dataService.megaMekAvailabilityVersion()}`,
            `source:${useMegaMekAvailability ? 'megamek' : 'mul'}`,
            `weightEras:${serializeForceGenerationCacheIds(resolvedScopeState.eraIds)}`,
            `weightFactions:${serializeForceGenerationCacheIds(resolvedScopeState.factionIds)}`,
        ].join('|');
    }

    private getCachedAvailabilityWeights(
        unit: UnitSummary,
        context: ForceGenerationContext,
        availabilityWeightCache?: ForceGenerationAvailabilityWeightCache,
    ): { requisition: number; salvage: number } {
        const cachedWeights = availabilityWeightCache?.weightsByUnitUuid.get(unit.uuid);
        if (cachedWeights !== undefined) {
            return cachedWeights;
        }

        const computedWeights = this.getAvailabilityWeights(unit, context, availabilityWeightCache?.scopeState);
        availabilityWeightCache?.weightsByUnitUuid.set(unit.uuid, computedWeights);
        return computedWeights;
    }

    private getCandidateAvailabilityWeights(
        unit: UnitSummary,
        context: ForceGenerationContext,
        options: ForceGenerationRequest,
        availabilityWeightCache?: ForceGenerationAvailabilityWeightCache,
    ): { requisition: number; salvage: number } {
        return options.ignoreRarityWeight === true
            ? IGNORED_RARITY_FORCE_GENERATOR_WEIGHTS
            : this.getCachedAvailabilityWeights(unit, context, availabilityWeightCache);
    }

    private resolvePreparedCandidateCache(
        eligibleUnits: readonly UnitSummary[],
        context: ForceGenerationContext,
        options: ForceGenerationRequest,
        availabilityWeightCache?: ForceGenerationAvailabilityWeightCache,
    ): ForceGenerationPreparedCandidateCache {
        const signature = this.buildPreparedCandidateCacheSignature(
            eligibleUnits,
            options,
            availabilityWeightCache,
        );
        if (this.preparedCandidateCache?.signature === signature) {
            return this.preparedCandidateCache;
        }

        this.preparedCandidateCache = this.buildPreparedCandidateCache(
            signature,
            eligibleUnits,
            context,
            options,
            availabilityWeightCache,
        );
        return this.preparedCandidateCache;
    }

    private buildPreparedCandidateCacheSignature(
        eligibleUnits: readonly UnitSummary[],
        options: ForceGenerationRequest,
        availabilityWeightCache?: ForceGenerationAvailabilityWeightCache,
    ): string {
        return [
            availabilityWeightCache?.signature ?? `availability:ignored:${this.dataService.searchCorpusVersion()}`,
            `eligible:${buildForceGenerationUnitListSignature(eligibleUnits)}`,
            `game:${options.gameSystem}`,
            `skills:${buildForceGenerationSkillSettingsSignature(options)}`,
        ].join('|');
    }

    private buildPreparedCandidateCache(
        signature: string,
        eligibleUnits: readonly UnitSummary[],
        context: ForceGenerationContext,
        options: ForceGenerationRequest,
        availabilityWeightCache?: ForceGenerationAvailabilityWeightCache,
    ): ForceGenerationPreparedCandidateCache {
        const baseCandidateCache = this.resolveBaseCandidateCache(eligibleUnits, options);
        const candidates: ForceGenerationCandidateUnit[] = [];

        for (const baseCandidate of baseCandidateCache.candidates) {
            const availabilityWeights = this.getCandidateAvailabilityWeights(
                baseCandidate.unit,
                context,
                options,
                availabilityWeightCache,
            );

            if (availabilityWeights.requisition <= 0 && availabilityWeights.salvage <= 0) {
                continue;
            }

            candidates.push({
                unit: baseCandidate.unit,
                requisitionWeight: availabilityWeights.requisition,
                salvageWeight: availabilityWeights.salvage,
                availabilityWeightsIgnored: options.ignoreRarityWeight === true,
                cost: baseCandidate.cost,
                skill: baseCandidate.skill,
                gunnery: baseCandidate.gunnery,
                piloting: baseCandidate.piloting,
                locked: false,
                megaMekUnitType: baseCandidate.megaMekUnitType,
                megaMekWeightClass: baseCandidate.megaMekWeightClass,
                role: baseCandidate.role,
                motive: baseCandidate.motive,
            });
        }

        return {
            signature,
            candidates,
        };
    }

    private resolveBaseCandidateCache(
        eligibleUnits: readonly UnitSummary[],
        options: ForceGenerationRequest,
    ): ForceGenerationBaseCandidateCache {
        const signature = this.buildBaseCandidateCacheSignature(eligibleUnits, options);
        if (this.baseCandidateCache?.signature === signature) {
            return this.baseCandidateCache;
        }

        this.baseCandidateCache = this.buildBaseCandidateCache(signature, eligibleUnits, options);
        return this.baseCandidateCache;
    }

    private buildBaseCandidateCacheSignature(
        eligibleUnits: readonly UnitSummary[],
        options: ForceGenerationRequest,
    ): string {
        return [
            `corpus:${this.dataService.searchCorpusVersion()}`,
            `eligible:${buildForceGenerationUnitListSignature(eligibleUnits)}`,
            `game:${options.gameSystem}`,
            `skills:${buildForceGenerationSkillSettingsSignature(options)}`,
        ].join('|');
    }

    private buildBaseCandidateCache(
        signature: string,
        eligibleUnits: readonly UnitSummary[],
        options: ForceGenerationRequest,
    ): ForceGenerationBaseCandidateCache {
        const candidates = eligibleUnits.map((unit) => this.createBaseCandidateUnit(unit, options));

        return {
            signature,
            candidates,
        };
    }

    private prepareSelectionPreparation(
        candidates: readonly ForceGenerationCandidateUnit[],
        preselectedCandidates: readonly ForceGenerationCandidateUnit[],
        context: ForceGenerationContext,
        minUnitCount: number,
        maxUnitCount: number,
        budgetRange?: ForceGenerationBudgetRange,
        options: {
            enforceRulesetRequiredUnitTypes?: boolean;
            preventDuplicateChassis?: boolean;
            skillBudgetPlanningCosts?: ForceGenerationSkillBudgetPlanningCosts;
        } = {},
    ): ForceGenerationSelectionPreparation {
        const enforceRulesetRequiredUnitTypes = options.enforceRulesetRequiredUnitTypes !== false;
        const rulesetProfile = this.buildRulesetProfile(
            candidates,
            context,
            minUnitCount,
            maxUnitCount,
            budgetRange,
            {
                lockedCandidates: preselectedCandidates,
                preventDuplicateChassis: options.preventDuplicateChassis === true,
                skillBudgetPlanningCosts: options.skillBudgetPlanningCosts,
            },
        );
        const selectableCandidates = enforceRulesetRequiredUnitTypes
            ? this.filterCandidatesForRulesetProfile(candidates, rulesetProfile)
            : [...candidates];
        const lowestCostCandidates = [...selectableCandidates].sort((left, right) => left.cost - right.cost);
        const highestCostCandidates = [...lowestCostCandidates].reverse();
        const rulesetScoreByCandidate = new Map<ForceGenerationCandidateUnit, number>();
        const rulesetReasonsByCandidate = new Map<ForceGenerationCandidateUnit, string[]>();

        if (rulesetProfile) {
            for (const candidate of [...preselectedCandidates, ...selectableCandidates]) {
                rulesetScoreByCandidate.set(candidate, getRulesetMatchScore(candidate, rulesetProfile));
                rulesetReasonsByCandidate.set(candidate, getRulesetMatchReasons(candidate, rulesetProfile));
            }
        }

        return {
            rulesetProfile,
            selectableCandidates,
            lowestCostCandidates,
            highestCostCandidates,
            rulesetScoreByCandidate,
            rulesetReasonsByCandidate,
        };
    }

    private resolveSelectionPreparationCache(
        preparedCandidateCache: ForceGenerationPreparedCandidateCache,
        context: ForceGenerationContext,
        minUnitCount: number,
        maxUnitCount: number,
        budgetRange: ForceGenerationBudgetRange,
    ): ForceGenerationSelectionPreparation {
        const signature = this.buildSelectionPreparationCacheSignature(
            preparedCandidateCache,
            context,
            minUnitCount,
            maxUnitCount,
            budgetRange,
        );
        if (this.selectionPreparationCache?.signature === signature) {
            return this.selectionPreparationCache.preparation;
        }

        const preparation = this.prepareSelectionPreparation(
            preparedCandidateCache.candidates,
            [],
            context,
            minUnitCount,
            maxUnitCount,
            budgetRange,
        );
        this.selectionPreparationCache = {
            signature,
            preparation,
        };
        return preparation;
    }

    private buildSelectionPreparationCacheSignature(
        preparedCandidateCache: ForceGenerationPreparedCandidateCache,
        context: ForceGenerationContext,
        minUnitCount: number,
        maxUnitCount: number,
        budgetRange: ForceGenerationBudgetRange,
    ): string {
        return [
            preparedCandidateCache.signature,
            `forceFaction:${context.forceFaction?.id ?? 'none'}`,
            `forceEra:${context.forceEra?.id ?? 'none'}`,
            `ruleset:${context.ruleset?.factionKey ?? 'none'}`,
            `min:${minUnitCount}`,
            `max:${maxUnitCount}`,
            `budget:${budgetRange.min}-${budgetRange.max}`,
        ].join('|');
    }

    private getAvailabilityWeights(
        unit: UnitSummary,
        context: ForceGenerationContext,
        availabilityScopeState?: ForceGenerationAvailabilityScopeState,
    ): AvailabilityWeights {
        const useMegaMekAvailability = this.unitAvailabilitySource.useMegaMekAvailability();
        const record = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
        const scope = availabilityScopeState ?? this.buildAvailabilityScopeState(context);
        const weights = getScopedAvailabilityWeights(record, scope, useMegaMekAvailability);
        if (!useMegaMekAvailability) {
            const unitKey = this.unitAvailabilitySource.getUnitAvailabilityKey(unit, 'mul');
            for (const { eraId, factionId } of scope.pairs) {
                const faction = this.dataService.getFactionById(factionId);
                const era = this.dataService.getEraById(eraId);
                if (faction && era && this.unitAvailabilitySource.getFactionEraUnitIds(faction, era, 'mul').has(unitKey)) {
                    includeMulAvailabilityFallback(weights, record?.e[String(eraId)]?.[String(factionId)]);
                }
            }
        }
        return weights;
    }

    private shouldUseAvailabilityEraScope(context: ForceGenerationContext): boolean {
        return context.useAvailabilityEraScope ?? false;
    }

    private shouldUseAvailabilityFactionScope(context: ForceGenerationContext): boolean {
        return context.useAvailabilityFactionScope ?? context.availabilityFactionIds.length > 1;
    }

    private shouldUseAvailabilityScope(context: ForceGenerationContext): boolean {
        return this.shouldUseAvailabilityEraScope(context) || this.shouldUseAvailabilityFactionScope(context);
    }

    private getScopedAvailabilityEraIds(context: ForceGenerationContext): readonly number[] {
        if (this.shouldUseAvailabilityEraScope(context)) {
            return context.availabilityEraIds;
        }

        return context.forceEra
            ? [context.forceEra.id]
            : context.availabilityEraIds.length > 0
                ? [context.availabilityEraIds[0]]
                : [];
    }

    private getScopedAvailabilityFactionIds(context: ForceGenerationContext): readonly number[] {
        if (this.shouldUseAvailabilityFactionScope(context)) {
            return context.availabilityFactionIds;
        }

        return context.availabilityFactionIds.length > 0
            ? [context.availabilityFactionIds[0]]
            : context.forceFaction
                ? [context.forceFaction.id]
                : [];
    }

    private createGeneratedUnit(candidate: ForceGenerationCandidateUnit): GeneratedForceUnit {
        const crew = candidate.gunnery !== undefined && candidate.piloting !== undefined
            ? normalizeGeneratedCBTCrew(
                candidate.unit,
                candidate.crew,
                candidate.gunnery,
                candidate.piloting,
                candidate.alias,
            )
            : undefined;
        const gunnery = candidate.gunnery === undefined
            ? undefined
            : getGeneratedCBTCrewSkill(crew, 'gunnery', candidate.gunnery);
        const piloting = candidate.piloting === undefined
            ? undefined
            : getGeneratedCBTCrewSkill(crew, 'piloting', candidate.piloting);
        return {
            unit: candidate.unit,
            cost: gunnery === undefined || piloting === undefined
                ? candidate.cost
                : getBudgetMetric(candidate.unit, GameSystem.CBT, gunnery, piloting),
            skill: candidate.skill,
            gunnery,
            piloting,
            crew,
            alias: candidate.alias,
            commander: candidate.commander,
            lockKey: candidate.lockKey ?? uuidv7(),
            variantGroupKey: candidate.variantGroupKey,
        };
    }

    private buildPreviewExplanation(
        gameSystem: GameSystem,
        eligibleUnitCount: number,
        candidateUnitCount: number,
        context: ForceGenerationContext,
        ignoreRarityWeight: boolean,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        skillSettings: ForceGenerationSkillSettings,
        selectionAttempt: ForceGenerationSelectionAttempt | null,
        error: string | null,
        lockedUnitCount: number,
        preventDuplicateChassis: boolean,
        useTaggedQuantities: boolean,
        useUnitTagsAsChassisTags: boolean,
        searchSettings: readonly string[] = [],
        availabilitySourceCandidates: readonly ForceGenerationCandidateUnit[] = [],
        attemptsTried?: number,
        attemptsElapsedMs?: number,
    ): string[] {
        const lines: string[] = [];
        const budgetLabel = gameSystem === GameSystem.AS ? 'PV' : 'BV';
        const maxLabel = Number.isFinite(budgetRange.max) ? budgetRange.max.toLocaleString() : 'no max';
        const availabilitySourceRollNote = ignoreRarityWeight
            ? null
            : this.getAvailabilitySourceRollNote(availabilitySourceCandidates);
        const candidateLabel = ignoreRarityWeight ? 'Uniform-weight candidates' : 'Availability-positive candidates';
        lines.push(`Eligible units: ${eligibleUnitCount} units. ${candidateLabel}: ${candidateUnitCount} units. Target: ${minUnitCount}-${maxUnitCount} units, ${budgetLabel} ${budgetRange.min.toLocaleString()} to ${maxLabel}.`);
        lines.push(formatForceGenerationSkillSettingsNote(gameSystem, skillSettings));
        lines.push(...searchSettings);
        const generatorFlagsNote = formatForceGeneratorFlags(
            preventDuplicateChassis,
            useTaggedQuantities,
            useUnitTagsAsChassisTags,
        );
        if (generatorFlagsNote) {
            lines.push(generatorFlagsNote);
        }

        if (lockedUnitCount > 0) {
            lines.push(`Locked units: ${lockedUnitCount} preserved across rerolls.`);
        }

        const contextParts = [context.forceFaction?.name, context.forceEra?.name].filter(Boolean);
        const weightScopeNote = ignoreRarityWeight
            ? 'Availability weights: ignored; all candidates use equal weight.'
            : this.getAvailabilityWeightScopeNote(context);
        if (contextParts.length > 0) {
            lines.push(weightScopeNote
                ? `Generation context: ${contextParts.join(' - ')}. ${weightScopeNote}`
                : `Generation context: ${contextParts.join(' - ')}.`);
        } else if (weightScopeNote) {
            lines.push(weightScopeNote);
        }

        if (selectionAttempt?.rulesetProfile) {
            const rulesetKey = context.ruleset?.factionKey ?? context.forceFaction?.name ?? 'unknown';
            const echelonNote = selectionAttempt.rulesetProfile.selectedEchelon
                ? `, echelon ${selectionAttempt.rulesetProfile.selectedEchelon}`
                : '';
            lines.push(`Ruleset guidance: ${rulesetKey}${echelonNote}.`);
            if (availabilitySourceRollNote) {
                lines.push(availabilitySourceRollNote);
            }
            for (const note of selectionAttempt.rulesetProfile.explanationNotes) {
                lines.push(note);
            }
            if (selectionAttempt.structureEvaluation) {
                lines.push(selectionAttempt.structureEvaluation.summary);
            }
        } else if (context.ruleset) {
            lines.push(`Ruleset guidance: ${context.ruleset.factionKey}, but no matching force node added extra constraints.`);
            if (availabilitySourceRollNote) {
                lines.push(availabilitySourceRollNote);
            }
        } else {
            lines.push(ignoreRarityWeight
                ? 'Ruleset guidance: none resolved, so picks used uniform random search.'
                : 'Ruleset guidance: none resolved, so picks used weighted search only.');
            if (availabilitySourceRollNote) {
                lines.push(availabilitySourceRollNote);
            }
        }

        for (const [index, step] of (selectionAttempt?.selectionSteps ?? []).entries()) {
            const skillSummary = formatForceGenerationSkillSummary(gameSystem, step);
            const skillNote = skillSummary ? `, ${skillSummary}` : '';
            const fallbackNote = !ignoreRarityWeight && step.usedFallbackSource && step.source !== step.rolledSource
                ? `; rolled ${step.rolledSource} but used ${step.source}`
                : '';
            const reasons = step.rulesetReasons.length > 0
                ? `; ruleset bias ${step.rulesetReasons.join(', ')}`
                : '';
            const selectionNote = step.locked
                ? 'locked'
                : ignoreRarityWeight
                    ? 'pick'
                    : `${step.source} pick${fallbackNote}`;
            const weightNote = ignoreRarityWeight
                ? ''
                : `, R ${formatForceGeneratorWeight(step.requisitionWeight)} / S ${formatForceGeneratorWeight(step.salvageWeight)}`;
            lines.push(
                `${index + 1}. ${formatUnitName(step.unit, this.optionsService.options().displayUnitNameFormat)}: ${selectionNote}${weightNote}${skillNote}, ${step.cost.toLocaleString()} ${budgetLabel}${reasons}.`,
            );
        }

        const searchEffortNote = this.formatGenerationSearchEffortNote(attemptsTried, attemptsElapsedMs);
        if (searchEffortNote) {
            lines.push(`Search effort: ${searchEffortNote}`);
            if (LOG_ATTEMPTS) {
                if (!error) {
                    lines.push(`Formation effort: ${this.formatFormationComputationEffortNote()}`);
                }
            }
        }

        if (error) {
            lines.push(`Result note: ${error}`);
        }

        return lines;
    }

    private getAvailabilitySourceRollNote(
        candidates: readonly Pick<ForceGenerationCandidateUnit, 'requisitionWeight' | 'salvageWeight'>[],
    ): string | null {
        if (candidates.length === 0) {
            return null;
        }

        const totals = this.getAvailabilitySourceRollTotals(candidates);
        const total = totals.requisition + totals.salvage;
        if (total <= 0) {
            return null;
        }

        const requisitionPercent = (totals.requisition / total) * 100;
        const salvagePercent = (totals.salvage / total) * 100;
        return `Source roll odds: requisition ${formatForceGeneratorPercent(requisitionPercent)}% / salvage ${formatForceGeneratorPercent(salvagePercent)}%.`;
    }

    private getPositiveAvailabilityMessage(candidateCount: number, context: ForceGenerationContext): string {
        if (!this.shouldUseAvailabilityScope(context)) {
            return `Only ${candidateCount} units have positive MegaMek availability in the rolled faction and era.`;
        }

        return `Only ${candidateCount} units have positive MegaMek availability within the current era/faction availability scope.`;
    }

    private getAvailabilityWeightScopeNote(context: ForceGenerationContext): string | null {
        const usesEraScope = this.shouldUseAvailabilityEraScope(context);
        const usesFactionScope = this.shouldUseAvailabilityFactionScope(context);
        if (!usesEraScope && !usesFactionScope) {
            return null;
        }

        const eraCount = this.getScopedAvailabilityEraIds(context).length;
        const factionCount = this.getScopedAvailabilityFactionIds(context).length;
        if (usesEraScope && usesFactionScope && eraCount > 0 && factionCount > 0) {
            return `Availability weights: max R/S across ${eraCount} eras x ${factionCount} factions.`;
        }
        if (usesEraScope && eraCount > 0) {
            return `Availability weights: max R/S across ${eraCount} eras.`;
        }
        if (usesFactionScope && factionCount > 0) {
            return `Availability weights: max R/S across ${factionCount} factions.`;
        }

        return null;
    }

    private buildPreviewFromSelectionAttempt(
        options: ForceGenerationRequest,
        eligibleUnitCount: number,
        candidateUnitCount: number,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        selectionAttempt: ForceGenerationSelectionAttempt,
        error: string | null,
        resultNote?: string,
        availabilitySourceCandidates: readonly ForceGenerationCandidateUnit[] = [],
        attemptsTried?: number,
        attemptsElapsedMs?: number,
    ): ForceGenerationPreview {
        if (!selectionAttempt.structureEvaluation) {
            const structureEvaluation = this.evaluateSelectionStructure(selectionAttempt, options.context);
            if (structureEvaluation) {
                selectionAttempt.structureEvaluation = structureEvaluation;
            }
        }

        const totalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        const units = selectionAttempt.selectedCandidates.map((candidate) => this.createGeneratedUnit(candidate));
        const targetFormations = this.resolveRequestedTargetFormations(options);
        const targetFormationId = targetFormations.length === 1 && targetFormations[0].count === 1
            ? targetFormations[0].formationId
            : undefined;
        const targetFormationGroups = this.cloneTargetFormationPreviewGroups(selectionAttempt.targetFormationGroups, options.gameSystem);
        const explanationLines = this.buildPreviewExplanation(
            options.gameSystem,
            eligibleUnitCount,
            candidateUnitCount,
            options.context,
            options.ignoreRarityWeight === true,
            budgetRange,
            minUnitCount,
            maxUnitCount,
            resolveForceGenerationSkillSettings(options),
            selectionAttempt,
            error,
            (options.lockedUnits ?? []).length,
            options.preventDuplicateChassis === true,
            options.useTaggedQuantities === true,
            options.useUnitTagsAsChassisTags === true,
            options.searchSettings ?? [],
            availabilitySourceCandidates,
            error ? attemptsTried ?? 0 : attemptsTried,
            attemptsElapsedMs,
        );

        if (resultNote && resultNote !== error) {
            explanationLines.push(`Result note: ${resultNote}`);
        }
        this.addTargetFormationExplanation(options, explanationLines);

        return {
            gameSystem: options.gameSystem,
            name: ForceNamerUtil.generateForceNameForFaction(options.context.forceFaction, this.dataService.getForceNameWords()),
            units,
            totalCost,
            faction: options.context.forceFaction,
            era: options.context.forceEra,
            explanationLines,
            error,
            targetFormationId,
            targetFormations: targetFormations.length > 0 ? targetFormations : undefined,
            targetFormationGroups,
        };
    }

    private buildEmptyPreview(
        options: ForceGenerationRequest,
        eligibleUnitCount: number,
        candidateUnitCount: number,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        error: string,
        availabilitySourceCandidates: readonly ForceGenerationCandidateUnit[] = [],
        attemptsTried = 0,
        attemptsElapsedMs?: number,
    ): ForceGenerationPreview {
        const explanationLines = this.buildPreviewExplanation(
            options.gameSystem,
            eligibleUnitCount,
            candidateUnitCount,
            options.context,
            options.ignoreRarityWeight === true,
            budgetRange,
            minUnitCount,
            maxUnitCount,
            resolveForceGenerationSkillSettings(options),
            null,
            error,
            (options.lockedUnits ?? []).length,
            options.preventDuplicateChassis === true,
            options.useTaggedQuantities === true,
            options.useUnitTagsAsChassisTags === true,
            options.searchSettings ?? [],
            availabilitySourceCandidates,
            attemptsTried,
            attemptsElapsedMs,
        );
        this.addTargetFormationExplanation(options, explanationLines);

        const targetFormations = this.resolveRequestedTargetFormations(options);
        const targetFormationId = targetFormations.length === 1 && targetFormations[0].count === 1
            ? targetFormations[0].formationId
            : undefined;

        return {
            gameSystem: options.gameSystem,
            units: [],
            totalCost: 0,
            faction: options.context.forceFaction,
            era: options.context.forceEra,
            explanationLines,
            error,
            targetFormationId,
            targetFormations: targetFormations.length > 0 ? targetFormations : undefined,
        };
    }

    private cloneTargetFormationPreviewGroups(
        groups: readonly ForceGenerationTargetFormationCandidateGroup[] | undefined,
        validatedGameSystem?: GameSystem,
    ): ForceGenerationTargetFormationPreviewGroup[] | undefined {
        if (!groups?.length) {
            return undefined;
        }

        return groups.map((group) => ({
            formationId: group.formationId,
            unitIndexes: [...group.unitIndexes],
            ...(validatedGameSystem ? { validatedGameSystem } : {}),
        }));
    }

    private isGeneratedPreviewValidForFormation(
        generatedUnits: readonly GeneratedForceUnit[],
        context: PreviewGroupPlanContext,
        formationId: string,
    ): boolean {
        const definition = LanceTypeIdentifierUtil.getDefinitionById(formationId, context.gameSystem);
        if (!definition) {
            return false;
        }

        const techBase = getUnitsAverageTechBase(generatedUnits.map((generatedUnit) => generatedUnit.unit));
        const forceContext = {
            faction: () => context.faction,
            era: () => context.era,
            techBase: () => techBase,
            gameSystem: context.gameSystem,
        };
        const formationUnits = generatedUnits.map((generatedUnit) => createPreviewFormationUnit(generatedUnit, forceContext));
        return LanceTypeIdentifierUtil.isValid(definition, formationUnits, context.gameSystem);
    }

    private buildTargetFormationPreviewGroups(
        generatedUnits: readonly GeneratedForceUnit[],
        context: PreviewGroupPlanContext,
        targetGroups: readonly ForceGenerationTargetFormationPreviewGroup[] | undefined,
    ): ForcePreviewGroup[] | null {
        if (!targetGroups?.length) {
            return null;
        }

        const usedUnitIndexes = new Set<number>();
        const previewGroups: ForcePreviewGroup[] = [];

        for (const targetGroup of targetGroups) {
            const groupUnits: GeneratedForceUnit[] = [];
            for (const unitIndex of targetGroup.unitIndexes) {
                if (unitIndex < 0 || unitIndex >= generatedUnits.length || usedUnitIndexes.has(unitIndex)) {
                    return null;
                }
                usedUnitIndexes.add(unitIndex);
                groupUnits.push(generatedUnits[unitIndex]);
            }

            const definition = LanceTypeIdentifierUtil.getDefinitionById(targetGroup.formationId, context.gameSystem);
            if (groupUnits.length === 0 || !definition) {
                return null;
            }

            if (targetGroup.validatedGameSystem !== context.gameSystem) {
                const isValid = this.isGeneratedPreviewValidForFormation(groupUnits, context, targetGroup.formationId);
                if (!isValid) {
                    return null;
                }
            }

            previewGroups.push(createGeneratedPreviewGroup(groupUnits, context.gameSystem, targetGroup.formationId));
        }

        const remainingUnits = generatedUnits.filter((_, index) => !usedUnitIndexes.has(index));
        return remainingUnits.length === 0
            ? previewGroups
            : [...previewGroups, ...buildPreviewGroups(remainingUnits, context)];
    }

    private addTargetFormationExplanation(options: ForceGenerationRequest, lines: string[]): string[] {
        const targetFormations = this.resolveRequestedTargetFormations(options);
        if (targetFormations.length === 0) {
            return lines;
        }

        if (targetFormations.length === 1 && targetFormations[0].count === 1) {
            const definition = LanceTypeIdentifierUtil.getDefinitionById(targetFormations[0].formationId, options.gameSystem);
            if (definition) {
                lines.splice(Math.min(2, lines.length), 0, `Target formation: ${definition.name}.`);
            }
            return lines;
        }

        const summary = this.formatTargetFormationSelections(targetFormations, options.gameSystem);
        if (summary) {
            lines.splice(Math.min(2, lines.length), 0, `Target formations: ${summary}.`);
        }

        return lines;
    }

    private formatTargetFormationSelections(
        targetFormations: readonly ForceGenerationTargetFormationSelection[],
        gameSystem: GameSystem,
    ): string {
        return targetFormations
            .map((targetFormation) => {
                const definition = LanceTypeIdentifierUtil.getDefinitionById(targetFormation.formationId, gameSystem);
                if (!definition) {
                    return '';
                }
                return targetFormation.count > 1
                    ? `${targetFormation.count} ${definition.name}`
                    : definition.name;
            })
            .filter((entry) => entry.length > 0)
            .join(', ');
    }

    private formatTargetFormationInstances(
        groups: readonly ForceGenerationTargetFormationCandidateGroup[],
        gameSystem: GameSystem,
    ): string {
        const countsByFormationId = new Map<string, number>();
        for (const group of groups) {
            countsByFormationId.set(group.formationId, (countsByFormationId.get(group.formationId) ?? 0) + 1);
        }

        return [...countsByFormationId.entries()]
            .map(([formationId, count]) => {
                const definition = LanceTypeIdentifierUtil.getDefinitionById(formationId, gameSystem);
                if (!definition) {
                    return '';
                }
                return count > 1 ? `${count} ${definition.name}` : definition.name;
            })
            .filter((entry) => entry.length > 0)
            .join(', ');
    }

    private clearGenerationCaches(): void {
        this.availabilityWeightCache = null;
        this.baseCandidateCache = null;
        this.preparedCandidateCache = null;
        this.selectionPreparationCache = null;
    }

    private normalizeBudgetRange(range: ForceGenerationBudgetRange): { min: number; max: number } {
        const min = Math.max(0, Math.floor(range.min));
        const rawMax = Math.max(0, Math.floor(range.max));
        return {
            min,
            max: rawMax > 0 ? Math.max(min, rawMax) : Number.POSITIVE_INFINITY,
        };
    }

    private isFirstCompatibleResultBudgetRequest(range: ForceGenerationBudgetRange): boolean {
        return Math.max(0, Math.floor(range.min)) === 0 && Math.max(0, Math.floor(range.max)) === 0;
    }

    private getFormattedBudgetRange(budgetRange: { min: number; max: number }): string {
        const formattedMin = budgetRange.min.toLocaleString();
        if (!Number.isFinite(budgetRange.max)) {
            return `${formattedMin}+`;
        }

        const formattedMax = budgetRange.max.toLocaleString();
        return budgetRange.min === budgetRange.max
            ? formattedMin
            : `${formattedMin}-${formattedMax}`;
    }

    private formatGenerationSearchEffortNote(attemptsTried?: number, attemptsElapsedMs?: number): string | null {
        if (attemptsTried === undefined) {
            return null;
        }
        const failureSearchWindowMs = this.resolveFailureSearchWindowMs();
        const roundedElapsedMs = attemptsElapsedMs === undefined
            ? undefined
            : Math.max(0, Math.round(attemptsElapsedMs));
        const elapsedNote = attemptsElapsedMs === undefined
            ? ''
            : ` in ${roundedElapsedMs}ms`;
        const searchWindowNote = roundedElapsedMs !== undefined && roundedElapsedMs >= failureSearchWindowMs
            ? ' Search window expired.'
            : '';
        return `${attemptsTried} attempts tried ${elapsedNote}.${searchWindowNote}`;
    }

    private formatFormationComputationEffortNote(): string {
        const roundedElapsedMs = Math.max(0, Math.round(this.formationComputationElapsedMs));
        return `Structure evaluations: ${this.formationComputationAttempts} in ${roundedElapsedMs}ms.`;
    }

    private *runTargetFormationAttemptSearch(options: {
        mode: 'single' | 'multi';
        candidateCount: number;
        minUnitCount: number;
        maxUnitCount: number;
        budgetRange: { min: number; max: number };
        interruptSignal?: ForceGenerationInterruptSignal;
        runAttempt: (deadline: ForceGenerationSearchDeadline) => ForceGenerationTargetSearchAttemptResult;
    }): Generator<void, ForceGenerationTargetSearchResult, void> {
        const failureSearchWindowMs = this.resolveFailureSearchWindowMs();
        const attemptBudget = this.createAttemptBudget(options.candidateCount, options.minUnitCount, options.maxUnitCount);
        const searchStartedAt = getForceGeneratorNow();
        const searchDeadline = this.createSearchDeadline(searchStartedAt, failureSearchWindowMs, options.interruptSignal);
        let attemptDurationEstimateMs = 0;
        let attemptLimit = attemptBudget.minAttempts;
        let attemptsTried = 0;
        let bestAttempt: ForceGenerationSelectionAttempt | null = null;
        let bestResult: ForceGenerationTargetSearchAttemptResult | null = null;

        for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
            if (this.hasSearchDeadlineExpired(searchDeadline)) {
                break;
            }
            yield;
            if (this.hasSearchDeadlineExpired(searchDeadline)) {
                break;
            }

            const attemptStartedAt = getForceGeneratorNow();
            attemptsTried = attempt + 1;
            const result = options.runAttempt(searchDeadline);

            if (this.isTargetFormationAttemptBetter(result.rank, bestResult?.rank ?? null)) {
                bestAttempt = result.attempt;
                bestResult = result;
            }

            this.logTargetFormationAttemptDiagnostics(
                options.mode,
                attempt + 1,
                result.attempt.selectedCandidates,
                result.rank,
                options.budgetRange,
                result.message,
                this.hasSearchDeadlineExpired(searchDeadline),
            );

            if (result.complete) {
                return {
                    bestAttempt,
                    bestResult,
                    completeAttempt: result.attempt,
                    attemptsTried,
                };
            }

            if (result.attempt.candidatePoolStarved) {
                break;
            }

            if (this.hasSearchDeadlineExpired(searchDeadline)) {
                break;
            }

            const attemptDurationMs = Math.max(0.05, getForceGeneratorNow() - attemptStartedAt);
            attemptDurationEstimateMs = this.updateAttemptDurationEstimate(attemptDurationEstimateMs, attemptDurationMs, attemptsTried);
            attemptLimit = this.resolveAttemptLimit(
                attemptBudget,
                attemptsTried,
                attemptDurationEstimateMs,
                getForceGeneratorNow() - searchStartedAt,
                false,
                failureSearchWindowMs,
            );
        }

        return {
            bestAttempt,
            bestResult,
            completeAttempt: null,
            attemptsTried,
        };
    }

    private getFormationDeficitScore(evaluation: FormationEvaluation | null): number {
        if (!evaluation) {
            return Number.POSITIVE_INFINITY;
        }

        return FormationRequirementEngine.getDeficits(evaluation)
            .reduce((sum, deficit) => sum + deficit.needed, 0);
    }

    private isTargetFormationAttemptBetter(
        current: ForceGenerationTargetAttemptRank,
        best: ForceGenerationTargetAttemptRank | null,
    ): boolean {
        if (!best) {
            return true;
        }
        if (current.satisfiedTargetCount !== best.satisfiedTargetCount) {
            return current.satisfiedTargetCount > best.satisfiedTargetCount;
        }
        if (current.formationDeficitScore !== best.formationDeficitScore) {
            return current.formationDeficitScore < best.formationDeficitScore;
        }
        if (current.unitCountDistance !== best.unitCountDistance) {
            return current.unitCountDistance < best.unitCountDistance;
        }

        return current.budgetDistance < best.budgetDistance;
    }

    private createSelectionAttemptFromCandidates(
        selectedCandidates: readonly ForceGenerationCandidateUnit[],
        rulesetProfile: RulesetProfile | null,
    ): ForceGenerationSelectionAttempt {
        const selectionSteps = selectedCandidates.map((candidate) => this.createSelectionStep(candidate, rulesetProfile));

        return {
            selectedCandidates: [...selectedCandidates],
            selectionSteps,
            rulesetProfile,
        };
    }

    private compareSuccessfulAttemptToBest(
        current: ForceGenerationSuccessfulAttemptRankSnapshot,
        best: ForceGenerationSuccessfulAttemptRankSnapshot | null,
    ): { becomesBest: boolean; reason: string } {
        if (!best) {
            return {
                becomesBest: true,
                reason: 'First successful attempt, so it becomes the current best.',
            };
        }

        if (current.structureScore !== best.structureScore) {
            return current.structureScore > best.structureScore
                ? {
                    becomesBest: true,
                    reason: `Higher structure score (${current.structureScore.toFixed(2)} > ${best.structureScore.toFixed(2)}).`,
                }
                : {
                    becomesBest: false,
                    reason: `Lower structure score (${current.structureScore.toFixed(2)} < ${best.structureScore.toFixed(2)}), so the current best stays ahead.`,
                };
        }

        if (current.midpointDistance !== best.midpointDistance) {
            return current.midpointDistance < best.midpointDistance
                ? {
                    becomesBest: true,
                    reason: `Same structure score, but closer to the budget target (${current.midpointDistance.toFixed(2)} < ${best.midpointDistance.toFixed(2)}).`,
                }
                : {
                    becomesBest: false,
                    reason: `Same structure score, but farther from the budget target (${current.midpointDistance.toFixed(2)} > ${best.midpointDistance.toFixed(2)}).`,
                };
        }

        if (current.unitCount !== best.unitCount) {
            return current.unitCount < best.unitCount
                ? {
                    becomesBest: true,
                    reason: `Same structure score and target distance, but fewer units (${current.unitCount} < ${best.unitCount}).`,
                }
                : {
                    becomesBest: false,
                    reason: `Same structure score and target distance, but more units (${current.unitCount} > ${best.unitCount}).`,
                };
        }

        return {
            becomesBest: false,
            reason: 'Tied with the current best attempt, so the earlier successful attempt was kept.',
        };
    }

    private createSuccessfulAttemptLog(
        attemptNumber: number,
        selectionAttempt: ForceGenerationSelectionAttempt,
        totalCost: number,
        midpointDistance: number,
        structureEvaluation: ForceGenerationStructureEvaluation | null,
        becameBest: boolean,
        decisionReason: string,
    ): ForceGenerationSuccessfulAttemptLog {
        return {
            attemptNumber,
            selectedEchelon: selectionAttempt.rulesetProfile?.selectedEchelon,
            totalCost,
            unitCount: selectionAttempt.selectedCandidates.length,
            structureScore: structureEvaluation?.score ?? 0,
            structureSummary: structureEvaluation?.summary ?? null,
            midpointDistance,
            perfectMatch: structureEvaluation?.perfectMatch ?? false,
            becameBest,
            decisionReason,
            units: selectionAttempt.selectedCandidates.map((candidate) => ({
                label: formatUnitName(candidate.unit, this.optionsService.options().displayUnitNameFormat),
                cost: candidate.cost,
            })),
        };
    }

    private logSuccessfulAttemptDiagnostics(
        options: ForceGenerationRequest,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        successfulAttempts: readonly ForceGenerationSuccessfulAttemptLog[],
        selectedAttemptNumber: number,
        selectedReason: string,
    ): void {
        if (!LOG_ATTEMPTS || successfulAttempts.length === 0) {
            return;
        }

        const budgetLabel = options.gameSystem === GameSystem.AS ? 'PV' : 'BV';
        const maxLabel = Number.isFinite(budgetRange.max) ? budgetRange.max.toLocaleString() : 'no max';
        const contextLabel = [options.context.forceFaction?.name, options.context.forceEra?.name]
            .filter(Boolean)
            .join(' - ') || 'unknown context';

        console.log('[ForceGenerator] Successful attempt search', {
            context: contextLabel,
            successfulAttempts: successfulAttempts.length,
            target: `${minUnitCount}-${maxUnitCount} units, ${budgetLabel} ${budgetRange.min.toLocaleString()} to ${maxLabel}`,
            ranking: 'Higher structure score, then closer to the budget target, then fewer units.',
        });

        for (const attempt of successfulAttempts) {
            console.log('[ForceGenerator] Successful attempt', {
                attempt: attempt.attemptNumber,
                echelon: attempt.selectedEchelon ?? 'none',
                totalCost: attempt.totalCost,
                budgetLabel,
                unitCount: attempt.unitCount,
                structureScore: Number(attempt.structureScore.toFixed(2)),
                structureSummary: attempt.structureSummary ?? 'No org-structure preference applied.',
                targetDistance: Number(attempt.midpointDistance.toFixed(2)),
                perfectMatch: attempt.perfectMatch,
                becameBest: attempt.becameBest,
                decision: attempt.decisionReason,
                units: attempt.units.map((unit) => `${unit.label} (${unit.cost.toLocaleString()} ${budgetLabel})`),
            });
        }

        console.log('[ForceGenerator] Best successful attempt selected', {
            attempt: selectedAttemptNumber,
            reason: selectedReason,
        });
    }

    private getUnitCountRangeDistance(unitCount: number, minUnitCount: number, maxUnitCount: number): number {
        if (unitCount < minUnitCount) {
            return minUnitCount - unitCount;
        }
        if (unitCount > maxUnitCount) {
            return unitCount - maxUnitCount;
        }

        return 0;
    }

    private createAttemptBudget(
        candidateCount: number,
        minUnitCount: number,
        maxUnitCount: number,
    ): ForceGenerationAttemptBudget {
        const unitSpan = Math.max(1, maxUnitCount - minUnitCount + 1);
        const minAttempts = Math.max(6, Math.min(14, 4 + (unitSpan * 2)));
        const maxAttempts = Math.max(minAttempts, Math.min(160, candidateCount * unitSpan * 2));
        const targetDurationMs = Math.max(12, Math.min(40, 8 + (unitSpan * 4) + (Math.sqrt(candidateCount) * 1.5)));

        return {
            minAttempts,
            maxAttempts,
            targetDurationMs,
        };
    }

    private updateAttemptDurationEstimate(
        currentEstimateMs: number,
        attemptDurationMs: number,
        completedAttempts: number,
    ): number {
        if (completedAttempts <= 1 || currentEstimateMs <= 0) {
            return attemptDurationMs;
        }

        return ((currentEstimateMs * (completedAttempts - 1)) + attemptDurationMs) / completedAttempts;
    }

    private createSearchDeadline(
        startedAtMs: number,
        durationMs: number,
        interruptSignal?: ForceGenerationInterruptSignal,
    ): ForceGenerationSearchDeadline {
        return { expiresAtMs: startedAtMs + Math.max(0, durationMs), interruptSignal };
    }

    private hasSearchDeadlineExpired(deadline?: ForceGenerationSearchDeadline): boolean {
        return !!deadline && (deadline.interruptSignal?.terminated === true || getForceGeneratorNow() >= deadline.expiresAtMs);
    }

    private resolveFailureSearchWindowMs(): number {
        const configuredMs = this.optionsService.options().forceGenerator?.failureSearchWindowMs;
        const normalizedMs = Number.isFinite(configuredMs)
            ? Math.floor(configuredMs)
            : DEFAULT_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS;

        return Math.min(
            MAX_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS,
            Math.max(MIN_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS, normalizedMs),
        );
    }

    private resolveAttemptLimit(
        attemptBudget: ForceGenerationAttemptBudget,
        completedAttempts: number,
        attemptDurationEstimateMs: number,
        elapsedMs: number,
        hasValidAttempt: boolean,
        failureSearchWindowMs: number,
    ): number {
        if (completedAttempts < attemptBudget.minAttempts) {
            return attemptBudget.minAttempts;
        }

        const targetDurationMs = hasValidAttempt
            ? attemptBudget.targetDurationMs
            : failureSearchWindowMs;
        const maxAttempts = hasValidAttempt ? attemptBudget.maxAttempts : Number.MAX_SAFE_INTEGER;

        if (completedAttempts >= maxAttempts) {
            return maxAttempts;
        }

        if (attemptDurationEstimateMs <= 0 || elapsedMs >= targetDurationMs) {
            return completedAttempts;
        }

        const remainingMs = Math.max(0, targetDurationMs - elapsedMs);
        const additionalAttempts = Math.max(1, Math.floor(remainingMs / Math.max(0.05, attemptDurationEstimateMs)));
        return Math.min(
            maxAttempts,
            Math.max(attemptBudget.minAttempts, completedAttempts + additionalAttempts),
        );
    }

    private getAvailabilityWeightForSource(
        candidate: ForceGenerationCandidateUnit,
        source: ForceGenerationAvailabilitySource,
    ): number {
        return source === 'requisition' ? candidate.requisitionWeight : candidate.salvageWeight;
    }

    private fillSelectionAttemptToMinimumUnitCount(
        selectionAttempt: ForceGenerationSelectionAttempt,
        candidates: readonly ForceGenerationCandidateUnit[],
        minUnitCount: number,
        maxUnitCount: number,
        preventDuplicateChassis: boolean,
        selectionPreparation?: ForceGenerationSelectionPreparation,
    ): ForceGenerationSelectionAttempt {
        if (selectionAttempt.selectedCandidates.length >= minUnitCount) {
            return selectionAttempt;
        }

        const selectedCandidates = [...selectionAttempt.selectedCandidates];
        const selectionSteps = [...selectionAttempt.selectionSteps];
        const allowUnlimitedDuplicateUnits = this.canReuseCandidateCopies(preventDuplicateChassis, candidates);

        while (selectedCandidates.length < minUnitCount && selectedCandidates.length < maxUnitCount) {
            const availableCandidates = this.filterAvailableTargetFormationCandidates(
                candidates,
                selectedCandidates,
                preventDuplicateChassis,
                allowUnlimitedDuplicateUnits,
            );
            if (availableCandidates.length === 0) {
                break;
            }

            const nextPick = this.pickNextCandidate(
                availableCandidates,
                selectionAttempt.rulesetProfile,
                selectionPreparation,
            );
            selectedCandidates.push(nextPick.candidate);
            selectionSteps.push(this.createSelectionStep(nextPick.candidate, selectionAttempt.rulesetProfile, {
                rolledSource: nextPick.rolledSource,
                source: nextPick.source,
                usedFallbackSource: nextPick.usedFallbackSource,
            }, selectionPreparation));
        }

        return {
            ...selectionAttempt,
            selectedCandidates,
            selectionSteps,
            candidatePoolStarved: selectedCandidates.length < minUnitCount,
        };
    }

    private getAvailabilitySourceRollWeight(source: ForceGenerationAvailabilitySource): number {
        return source === 'requisition'
            ? FORCE_GENERATION_PRODUCTION_SOURCE_ROLL_WEIGHT
            : FORCE_GENERATION_SALVAGE_SOURCE_ROLL_WEIGHT;
    }

    private getAvailabilitySourceRollTotals(
        candidates: readonly Pick<ForceGenerationCandidateUnit, 'requisitionWeight' | 'salvageWeight'>[],
    ): { requisition: number; salvage: number } {
        return {
            requisition: candidates.reduce((sum, candidate) => {
                return sum + (Math.max(0, candidate.requisitionWeight) * this.getAvailabilitySourceRollWeight('requisition'));
            }, 0),
            salvage: candidates.reduce((sum, candidate) => {
                return sum + (Math.max(0, candidate.salvageWeight) * this.getAvailabilitySourceRollWeight('salvage'));
            }, 0),
        };
    }

    private pickAvailabilitySource(candidates: readonly ForceGenerationCandidateUnit[]): ForceGenerationAvailabilitySource {
        const totals = this.getAvailabilitySourceRollTotals(candidates);

        return pickWeightedRandomEntry<ForceGenerationAvailabilitySource>(
            ['requisition', 'salvage'],
            (source) => source === 'requisition' ? totals.requisition : totals.salvage,
        );
    }

    private resolveRequestedTargetFormations(options: ForceGenerationRequest): ForceGenerationTargetFormationSelection[] {
        const targetCountByFormationId = new Map<string, number>();

        for (const rawTarget of this.resolveRawTargetFormationSelections(options)) {
            const formationId = rawTarget.formationId?.trim();
            if (!formationId) {
                continue;
            }
            const definition = LanceTypeIdentifierUtil.resolveDefinition(formationId, options.gameSystem);
            if (!definition || !this.isTargetFormationAvailableForGenerationContext(definition, options.context)) {
                continue;
            }
            const count = Number.isFinite(rawTarget.count)
                ? Math.max(1, Math.floor(rawTarget.count))
                : 1;
            targetCountByFormationId.set(
                definition.id,
                Math.min(FORCE_MAX_UNITS, (targetCountByFormationId.get(definition.id) ?? 0) + count),
            );
        }

        return [...targetCountByFormationId.entries()].map(([formationId, count]) => ({ formationId, count }));
    }

    private isTargetFormationAvailableForGenerationContext(
        definition: FormationTypeDefinition,
        context: ForceGenerationContext,
    ): boolean {
        if (!context.forceFaction) {
            return !definition.exclusiveFaction?.length;
        }

        return LanceTypeIdentifierUtil.isFormationAvailableForFaction(definition, context.forceFaction);
    }

    private resolveTargetFormationContext(
        options: ForceGenerationRequest,
        requestedMinUnitCount: number,
        requestedMaxUnitCount: number,
        requestedTargetFormations = this.resolveRequestedTargetFormations(options),
    ): ForceGenerationTargetFormationContext | null {
        if (requestedTargetFormations.length !== 1 || requestedTargetFormations[0].count !== 1) {
            return null;
        }

        const definition = LanceTypeIdentifierUtil.getDefinitionById(requestedTargetFormations[0].formationId, options.gameSystem);
        if (!definition || !FormationRequirementEngine.hasBlueprint(definition.id)) {
            return null;
        }

        const targetMinUnitCount = Math.max(1, definition.minUnits ?? 1);
        const targetMaxUnitCount = Math.min(FORCE_MAX_UNITS, definition.maxUnits ?? FORCE_MAX_UNITS);
        const minUnitCount = Math.max(requestedMinUnitCount, targetMinUnitCount);
        const maxUnitCount = Math.min(requestedMaxUnitCount, targetMaxUnitCount);
        if (minUnitCount > maxUnitCount) {
            return null;
        }

        return {
            definition,
            minUnitCount,
            maxUnitCount,
        };
    }

    private resolveTargetFormationSetContext(
        options: ForceGenerationRequest,
        requestedTargetFormations: readonly ForceGenerationTargetFormationSelection[],
    ): ForceGenerationTargetFormationSetContext | null {
        if (requestedTargetFormations.length === 0) {
            return null;
        }

        const selections: ForceGenerationTargetFormationSelection[] = [];
        const instances: ForceGenerationTargetFormationInstanceContext[] = [];

        for (const targetFormation of requestedTargetFormations) {
            const definition = LanceTypeIdentifierUtil.getDefinitionById(targetFormation.formationId, options.gameSystem);
            if (!definition || !FormationRequirementEngine.hasBlueprint(definition.id)) {
                return null;
            }

            const count = Math.min(FORCE_MAX_UNITS, Math.max(1, Math.floor(targetFormation.count)));
            selections.push({ formationId: definition.id, count });
            for (let index = 0; index < count; index += 1) {
                instances.push({
                    definition,
                    preferredUnitCount: this.getPreferredTargetFormationUnitCount(definition),
                });
            }
        }

        return instances.length > 0 ? { selections, instances } : null;
    }

    private getPreferredTargetFormationUnitCount(
        definition: FormationTypeDefinition,
        options?: Pick<ForceGenerationRequest, 'context'>,
        candidates: readonly ForceGenerationCandidateUnit[] = [],
    ): number {
        const minUnitCount = Math.max(1, definition.minUnits ?? 1);
        const maxUnitCount = Math.min(FORCE_MAX_UNITS, definition.maxUnits ?? FORCE_MAX_UNITS);
        const regularOrgUnitCount = options
            ? this.resolveRegularOrgTargetUnitCount(options.context, candidates, minUnitCount, maxUnitCount)
            : null;
        if (regularOrgUnitCount !== null) {
            return regularOrgUnitCount;
        }

        const nominalUnitCount = definition.id.endsWith('-star')
            ? 5
            : definition.id.endsWith('-squadron')
                ? 6
                : definition.id.endsWith('-lance')
                    ? 4
                    : minUnitCount;

        return Math.min(maxUnitCount, Math.max(minUnitCount, nominalUnitCount));
    }

    private resolveRegularOrgTargetUnitCount(
        context: ForceGenerationContext,
        candidates: readonly ForceGenerationCandidateUnit[],
        minUnitCount: number,
        maxUnitCount: number,
    ): number | null {
        if (!context.forceFaction || candidates.length < minUnitCount) {
            return null;
        }

        const maxProbeUnitCount = Math.min(maxUnitCount, FORCE_MAX_UNITS, 12);
        for (const candidateBucket of this.getRegularOrgProbeCandidateBuckets(candidates)) {
            const bucketMaxProbeUnitCount = Math.min(maxProbeUnitCount, candidateBucket.length);
            for (let unitCount = minUnitCount; unitCount <= bucketMaxProbeUnitCount; unitCount += 1) {
                const sampleUnits = candidateBucket.slice(0, unitCount).map((candidate) => candidate.unit);
                const resolvedGroups = resolveFromUnits(sampleUnits, context.forceFaction, context.forceEra);
                if (resolvedGroups.length !== 1) {
                    continue;
                }

                const resolvedGroup = resolvedGroups[0];
                if (
                    resolvedGroup.modifierKey === ''
                    && resolvedGroup.tier >= PREVIEW_GROUP_SPLIT_MIN_TIER
                    && collectGroupUnits(resolvedGroup).length === unitCount
                ) {
                    return unitCount;
                }
            }
        }

        return null;
    }

    private getRegularOrgProbeCandidateBuckets(
        candidates: readonly ForceGenerationCandidateUnit[],
    ): ForceGenerationCandidateUnit[][] {
        const bucketsByUnitKind = new Map<string, ForceGenerationCandidateUnit[]>();

        for (const candidate of candidates) {
            const key = [
                candidate.unit.as?.TP ?? candidate.unit.type,
                candidate.unit.type,
                candidate.unit.subtype,
                candidate.unit.moveType,
            ].join('|');
            const bucket = bucketsByUnitKind.get(key) ?? [];
            bucket.push(candidate);
            bucketsByUnitKind.set(key, bucket);
        }

        return [...bucketsByUnitKind.values()].sort((left, right) => right.length - left.length);
    }

    private createFormationUnitsForCandidates(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
    ): FormationUnitLike[] {
        const techBase = getUnitsAverageTechBase(candidates.map((candidate) => candidate.unit));
        const forceContext = {
            faction: () => options.context.forceFaction,
            era: () => options.context.forceEra,
            techBase: () => techBase,
            gameSystem: options.gameSystem,
        };

        return candidates.map((candidate) => ({
            force: forceContext,
            getFormationSummary: () => candidate.unit,
            pilotSkill: () => candidate.skill ?? candidate.gunnery ?? 4,
            gunnerySkill: () => candidate.gunnery ?? candidate.skill ?? 4,
        }));
    }

    private evaluateTargetFormationCandidate(
        definition: FormationTypeDefinition,
        selectedCandidates: readonly ForceGenerationCandidateUnit[],
        candidate: ForceGenerationCandidateUnit,
        options: ForceGenerationRequest,
        maxUnitCount: number,
        minUnitCount?: number,
        currentUnits?: readonly FormationUnitLike[],
    ): FormationSearchDecision {
        const resolvedCurrentUnits = currentUnits ?? this.createFormationUnitsForCandidates(selectedCandidates, options);
        const nextUnits = this.createFormationUnitsForCandidates([...selectedCandidates, candidate], options);
        const candidateUnit = nextUnits[nextUnits.length - 1];

        return FormationRequirementEngine.evaluateSearchCandidate(
            definition,
            resolvedCurrentUnits,
            candidateUnit,
            options.gameSystem,
            { minUnits: minUnitCount, maxUnits: maxUnitCount },
        );
    }

    private buildTargetedFormationSelection(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        definition: FormationTypeDefinition,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        preselectedCandidates: readonly ForceGenerationCandidateUnit[],
        preventDuplicateChassis: boolean,
        skillSettings: ForceGenerationSkillSettings,
        selectionPreparation?: ForceGenerationSelectionPreparation,
        deadline?: ForceGenerationSearchDeadline,
    ): ForceGenerationSelectionAttempt {
        const targetCandidates = this.createTargetFormationCandidatesForAttempt(
            candidates,
            options,
            definition,
            skillSettings,
        );
        const skillBudgetPlanningCosts = this.createTargetFormationSkillBudgetPlanningCosts(
            targetCandidates,
            options,
            definition,
            skillSettings,
        );
        const preparedSelection = selectionPreparation ?? this.prepareSelectionPreparation(
            targetCandidates,
            preselectedCandidates,
            options.context,
            minUnitCount,
            maxUnitCount,
            undefined,
            { enforceRulesetRequiredUnitTypes: false },
        );
        const rulesetProfile = preparedSelection.rulesetProfile;
        const selectedCandidates: ForceGenerationCandidateUnit[] = [...preselectedCandidates];
        const selectionSteps: ForceGenerationSelectionStep[] = preselectedCandidates.map((candidate) => {
            return this.createSelectionStep(candidate, rulesetProfile, {}, preparedSelection);
        });
        const remainingCandidates = [...preparedSelection.selectableCandidates];
        const lowestCostRemainingCandidates = skillBudgetPlanningCosts
            ? [...preparedSelection.selectableCandidates].sort((left, right) => (
                this.getSkillPlanningCost(left, skillBudgetPlanningCosts, 'min') - this.getSkillPlanningCost(right, skillBudgetPlanningCosts, 'min')
            ))
            : [...preparedSelection.lowestCostCandidates];
        const highestCostRemainingCandidates = skillBudgetPlanningCosts
            ? [...preparedSelection.selectableCandidates].sort((left, right) => (
                this.getSkillPlanningCost(right, skillBudgetPlanningCosts, 'max') - this.getSkillPlanningCost(left, skillBudgetPlanningCosts, 'max')
            ))
            : [...preparedSelection.highestCostCandidates];
        const selectedChassisKeys = new Set(
            selectedCandidates
                .map((candidate) => buildDuplicateChassisKey(candidate.unit))
                .filter((key) => key.length > 0),
        );
        const selectedTaggedQuantityCounts = new Map<string, number>();
        for (const candidate of selectedCandidates) {
            if (candidate.taggedQuantityCapKey) {
                selectedTaggedQuantityCounts.set(
                    candidate.taggedQuantityCapKey,
                    (selectedTaggedQuantityCounts.get(candidate.taggedQuantityCapKey) ?? 0) + 1,
                );
            }
        }

        let totalCost = selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        let minimumSkillAdjustedTotalCost = selectedCandidates.reduce((sum, candidate) => (
            sum + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'min')
        ), 0);
        let maximumSkillAdjustedTotalCost = selectedCandidates.reduce((sum, candidate) => (
            sum + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'max')
        ), 0);
        const removeRemainingCandidate = (candidate: ForceGenerationCandidateUnit): void => {
            const remainingIndex = remainingCandidates.indexOf(candidate);
            if (remainingIndex >= 0) {
                remainingCandidates.splice(remainingIndex, 1);
            }
            const lowestCostIndex = lowestCostRemainingCandidates.indexOf(candidate);
            if (lowestCostIndex >= 0) {
                lowestCostRemainingCandidates.splice(lowestCostIndex, 1);
            }
            const highestCostIndex = highestCostRemainingCandidates.indexOf(candidate);
            if (highestCostIndex >= 0) {
                highestCostRemainingCandidates.splice(highestCostIndex, 1);
            }
        };
        const addSelectedCandidate = (
            candidate: ForceGenerationCandidateUnit,
            stepOverrides: Partial<Pick<ForceGenerationSelectionStep, 'rolledSource' | 'source' | 'usedFallbackSource'>>,
            removeFromRemaining: boolean,
        ): void => {
            selectedCandidates.push(candidate);
            totalCost += candidate.cost;
            minimumSkillAdjustedTotalCost += this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'min');
            maximumSkillAdjustedTotalCost += this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'max');
            if (removeFromRemaining) {
                removeRemainingCandidate(candidate);
            }

            const chassisKey = buildDuplicateChassisKey(candidate.unit);
            if (chassisKey.length > 0) {
                selectedChassisKeys.add(chassisKey);
            }
            if (candidate.taggedQuantityCapKey) {
                selectedTaggedQuantityCounts.set(
                    candidate.taggedQuantityCapKey,
                    (selectedTaggedQuantityCounts.get(candidate.taggedQuantityCapKey) ?? 0) + 1,
                );
            }

            selectionSteps.push(this.createSelectionStep(candidate, rulesetProfile, stepOverrides, preparedSelection));
        };
        const hasMatchedPairConstraints = this.getMatchedPairConstraintIds(definition.id, options.gameSystem).size > 0;
        const allowUnlimitedDuplicateUnits = this.canReuseCandidateCopies(preventDuplicateChassis, targetCandidates);
        let candidatePoolStarved = false;

        while (selectedCandidates.length < maxUnitCount && !this.hasSearchDeadlineExpired(deadline)) {
            const currentEvaluation = FormationRequirementEngine.evaluateDefinition(
                definition,
                this.createFormationUnitsForCandidates(selectedCandidates, options),
                options.gameSystem,
            );
            const currentValid = currentEvaluation?.valid === true
                && selectedCandidates.length >= minUnitCount
                && selectedCandidates.length <= maxUnitCount;
            if (currentValid && (
                isBudgetWithinRange(totalCost, budgetRange)
                || this.canSkillAdjustedSelectionReachBudgetRange(minimumSkillAdjustedTotalCost, maximumSkillAdjustedTotalCost, budgetRange)
            )) {
                break;
            }
            if (currentEvaluation && FormationRequirementEngine.hasHardConstraintViolations(currentEvaluation)) {
                break;
            }

            const matchedPairCandidate = this.findMatchedPairCompletionCandidate(
                definition,
                selectedCandidates,
                options,
                maxUnitCount,
                currentEvaluation,
                selectedTaggedQuantityCounts,
                budgetRange,
                totalCost,
            );
            if (matchedPairCandidate) {
                const source = this.getPreferredAvailabilitySource(matchedPairCandidate);
                addSelectedCandidate(matchedPairCandidate, {
                    rolledSource: source,
                    source,
                }, false);
                continue;
            }

            const requiredAfterPick = Math.max(0, minUnitCount - selectedCandidates.length - 1);
            const remainingSlotsAfterPick = maxUnitCount - selectedCandidates.length - 1;
            const budgetFeasibleCandidates = remainingCandidates.filter((candidate) => {
                const nextMinimumTotal = minimumSkillAdjustedTotalCost + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'min');
                if (nextMinimumTotal > budgetRange.max) {
                    return false;
                }

                const minimumRemainingTotal = allowUnlimitedDuplicateUnits
                    ? getReusableCandidateCostTotal(
                        lowestCostRemainingCandidates,
                        requiredAfterPick,
                        (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'min'),
                    )
                    : getOrderedCandidateCostTotalExcluding(
                        lowestCostRemainingCandidates,
                        candidate,
                        requiredAfterPick,
                        (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'min'),
                    );
                if (nextMinimumTotal + minimumRemainingTotal > budgetRange.max) {
                    return false;
                }

                const nextMaximumTotal = maximumSkillAdjustedTotalCost + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'max');
                const standardMaximumRemainingTotal = allowUnlimitedDuplicateUnits
                    ? getReusableCandidateCostTotal(
                        highestCostRemainingCandidates,
                        remainingSlotsAfterPick,
                        (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'max'),
                    )
                    : getOrderedCandidateCostTotalExcluding(
                        highestCostRemainingCandidates,
                        candidate,
                        remainingSlotsAfterPick,
                        (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'max'),
                    );
                const matchedPairCopyMaximumRemainingTotal = !allowUnlimitedDuplicateUnits
                    && hasMatchedPairConstraints
                    && remainingSlotsAfterPick > 0
                    && this.hasPositiveAvailability(candidate)
                    && !candidate.taggedQuantityCapKey
                    ? this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'max')
                        + getOrderedCandidateCostTotalExcluding(
                            highestCostRemainingCandidates,
                            candidate,
                            remainingSlotsAfterPick - 1,
                            (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'max'),
                        )
                    : 0;
                const maximumRemainingTotal = Math.max(standardMaximumRemainingTotal, matchedPairCopyMaximumRemainingTotal);
                return nextMaximumTotal + maximumRemainingTotal >= budgetRange.min;
            });

            const cappedCandidatePool = budgetFeasibleCandidates.filter((candidate) => {
                if (!candidate.taggedQuantityCapKey) {
                    return true;
                }

                const quantityCap = Math.max(1, candidate.taggedQuantityCap ?? 1);
                return (selectedTaggedQuantityCounts.get(candidate.taggedQuantityCapKey) ?? 0) < quantityCap;
            });
            const duplicateFilteredCandidatePool = preventDuplicateChassis
                ? cappedCandidatePool.filter((candidate) => {
                    const chassisKey = buildDuplicateChassisKey(candidate.unit);
                    return chassisKey.length === 0 || !selectedChassisKeys.has(chassisKey);
                })
                : cappedCandidatePool;
            if (duplicateFilteredCandidatePool.length === 0) {
                candidatePoolStarved = this.isCandidatePoolStarved(
                    preparedSelection.selectableCandidates,
                    selectedCandidates,
                    preventDuplicateChassis,
                    allowUnlimitedDuplicateUnits,
                );
                break;
            }
            const currentFormationUnits = this.createFormationUnitsForCandidates(selectedCandidates, options);
            const searchPredicateFilter = FormationRequirementEngine.getSearchCandidatePredicateFilter(
                definition,
                currentFormationUnits,
                options.gameSystem,
            );
            const guidedCandidatePool = this.filterCandidatesByPredicateFilter(
                duplicateFilteredCandidatePool,
                options,
                searchPredicateFilter,
                currentEvaluation?.valid !== true,
            );

            const formationCandidateDecisions: Array<{ candidate: ForceGenerationCandidateUnit; decision: FormationSearchDecision }> = [];
            for (const candidate of guidedCandidatePool) {
                if (this.hasSearchDeadlineExpired(deadline)) {
                    break;
                }

                const decision = this.evaluateTargetFormationCandidate(definition, selectedCandidates, candidate, options, maxUnitCount, minUnitCount, currentFormationUnits);
                if (decision.allowed) {
                    formationCandidateDecisions.push({ candidate, decision });
                }
            }
            if (formationCandidateDecisions.length === 0) {
                break;
            }

            const improvingCandidateDecisions = currentValid
                ? formationCandidateDecisions
                : formationCandidateDecisions.filter((entry) => entry.decision.fillsDeficit);
            const candidateDecisions = improvingCandidateDecisions.length > 0
                ? improvingCandidateDecisions
                : formationCandidateDecisions;
            const candidateDecisionByUnit = new Map(candidateDecisions.map((entry) => [entry.candidate, entry.decision]));
            const pickableCandidates = candidateDecisions.map((entry) => entry.candidate);
            const nextPick = this.pickNextCandidate(
                pickableCandidates,
                rulesetProfile,
                preparedSelection,
            );
            const nextCandidate = nextPick.candidate;
            if (!candidateDecisionByUnit.has(nextCandidate)) {
                break;
            }

            addSelectedCandidate(nextCandidate, {
                rolledSource: nextPick.rolledSource,
                source: nextPick.source,
                usedFallbackSource: nextPick.usedFallbackSource,
            }, !allowUnlimitedDuplicateUnits);
        }

        return {
            selectedCandidates,
            selectionSteps,
            rulesetProfile,
            candidatePoolStarved,
        };
    }

    private findMatchedPairCompletionCandidate(
        definition: FormationTypeDefinition,
        selectedCandidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        maxUnitCount: number,
        currentEvaluation: FormationEvaluation | null,
        selectedTaggedQuantityCounts: ReadonlyMap<string, number>,
        budgetRange: { min: number; max: number },
        currentTotalCost: number,
    ): ForceGenerationCandidateUnit | null {
        if (selectedCandidates.length === 0 || selectedCandidates.length + 1 > maxUnitCount) {
            return null;
        }

        const matchedPairConstraintIds = this.getMatchedPairConstraintIds(definition.id, options.gameSystem);
        if (matchedPairConstraintIds.size === 0) {
            return null;
        }

        const current = this.evaluateTargetFormationConstraints(definition, selectedCandidates, options)
            ?? currentEvaluation;
        if (!current || current.valid) {
            return null;
        }

        for (let index = selectedCandidates.length - 1; index >= 0; index -= 1) {
            const selectedCandidate = selectedCandidates[index];
            if (!this.hasPositiveAvailability(selectedCandidate)
                || !this.hasTaggedQuantityCapacity(selectedCandidate, selectedTaggedQuantityCounts)) {
                continue;
            }

            const matchedPairCandidate = this.createMatchedPairCandidateCopy(selectedCandidate);
            if (Number.isFinite(budgetRange.max) && currentTotalCost + matchedPairCandidate.cost > budgetRange.max) {
                continue;
            }

            const decision = this.evaluateTargetFormationCandidate(
                definition,
                selectedCandidates,
                matchedPairCandidate,
                options,
                maxUnitCount,
                undefined,
            );
            if (!decision.allowed) {
                continue;
            }

            const nextEvaluation = this.evaluateTargetFormationConstraints(
                definition,
                [...selectedCandidates, matchedPairCandidate],
                options,
            );
            if (nextEvaluation && this.improvesMatchedPairRequirement(current, nextEvaluation, matchedPairConstraintIds)) {
                return matchedPairCandidate;
            }
        }

        return null;
    }

    private evaluateTargetFormationConstraints(
        definition: FormationTypeDefinition,
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
    ): FormationEvaluation | null {
        return FormationRequirementEngine.evaluateDefinition(
            { ...definition, minUnits: 0 },
            this.createFormationUnitsForCandidates(candidates, options),
            options.gameSystem,
        );
    }

    private countMatchedPairCopyCapacity(
        definition: FormationTypeDefinition,
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        maxUnitCount: number,
    ): number {
        let capacity = 0;
        const countedUnitUuids = new Set<string>();

        for (const candidate of candidates) {
            if (countedUnitUuids.has(candidate.unit.uuid)) {
                continue;
            }
            countedUnitUuids.add(candidate.unit.uuid);

            const currentEvaluation = FormationRequirementEngine.evaluateDefinition(
                definition,
                this.createFormationUnitsForCandidates([candidate], options),
                options.gameSystem,
            );
            if (this.findMatchedPairCompletionCandidate(
                definition,
                [candidate],
                options,
                maxUnitCount,
                currentEvaluation,
                this.countTaggedQuantitySelections([candidate]),
                { min: 0, max: Number.POSITIVE_INFINITY },
                candidate.cost,
            )) {
                capacity += 1;
            }
        }

        return capacity;
    }

    private getMatchedPairConstraintIds(formationId: string, gameSystem: GameSystem): Set<string> {
        const result = new Set<string>();
        this.collectMatchedPairConstraintIds(getFormationBlueprint(formationId, gameSystem)?.constraints ?? [], result);
        return result;
    }

    private collectMatchedPairConstraintIds(
        constraints: readonly FormationConstraint[],
        result: Set<string>,
    ): void {
        for (const constraint of constraints) {
            if (constraint.kind === 'matched-pairs-min') {
                result.add(constraint.id);
                continue;
            }
            if (constraint.kind === 'all-of' || constraint.kind === 'any-of' || constraint.kind === 'conditional') {
                this.collectMatchedPairConstraintIds(constraint.constraints, result);
            }
        }
    }

    private improvesMatchedPairRequirement(
        currentEvaluation: FormationEvaluation,
        nextEvaluation: FormationEvaluation,
        matchedPairConstraintIds: ReadonlySet<string>,
    ): boolean {
        for (const constraintId of matchedPairConstraintIds) {
            const currentConstraint = currentEvaluation.constraints.find((constraint) => constraint.constraintId === constraintId);
            const nextConstraint = nextEvaluation.constraints.find((constraint) => constraint.constraintId === constraintId);
            if (!currentConstraint || !nextConstraint || currentConstraint.satisfied) {
                continue;
            }

            if (nextConstraint.satisfied || (nextConstraint.actual ?? 0) > (currentConstraint.actual ?? 0)) {
                return true;
            }
        }

        return false;
    }

    private hasPositiveAvailability(candidate: ForceGenerationCandidateUnit): boolean {
        return candidate.requisitionWeight > 0 || candidate.salvageWeight > 0;
    }

    private hasTaggedQuantityCapacity(
        candidate: ForceGenerationCandidateUnit,
        selectedTaggedQuantityCounts: ReadonlyMap<string, number>,
    ): boolean {
        if (!candidate.taggedQuantityCapKey) {
            return true;
        }

        const quantityCap = Math.max(1, candidate.taggedQuantityCap ?? 1);
        return (selectedTaggedQuantityCounts.get(candidate.taggedQuantityCapKey) ?? 0) < quantityCap;
    }

    private canReuseCandidateCopies(
        preventDuplicateChassis: boolean,
        candidates: readonly ForceGenerationCandidateUnit[],
    ): boolean {
        return !preventDuplicateChassis && candidates.every((candidate) => !candidate.taggedQuantityCapKey);
    }

    private isCandidatePoolStarved(
        candidates: readonly ForceGenerationCandidateUnit[],
        selectedCandidates: readonly ForceGenerationCandidateUnit[],
        preventDuplicateChassis: boolean,
        allowUnlimitedDuplicateUnits: boolean,
    ): boolean {
        if (candidates.length === 0) {
            return true;
        }

        return this.filterAvailableTargetFormationCandidates(
            candidates,
            selectedCandidates,
            preventDuplicateChassis,
            allowUnlimitedDuplicateUnits,
        ).length === 0;
    }

    private countTaggedQuantitySelections(
        candidates: readonly ForceGenerationCandidateUnit[],
    ): Map<string, number> {
        const counts = new Map<string, number>();
        for (const candidate of candidates) {
            if (!candidate.taggedQuantityCapKey) {
                continue;
            }

            counts.set(candidate.taggedQuantityCapKey, (counts.get(candidate.taggedQuantityCapKey) ?? 0) + 1);
        }
        return counts;
    }

    private createMatchedPairCandidateCopy(candidate: ForceGenerationCandidateUnit): ForceGenerationCandidateUnit {
        return {
            ...candidate,
            alias: undefined,
            commander: undefined,
            lockKey: undefined,
            locked: false,
        };
    }

    private getPreferredAvailabilitySource(candidate: ForceGenerationCandidateUnit): ForceGenerationAvailabilitySource {
        return candidate.requisitionWeight > 0 ? 'requisition' : 'salvage';
    }

    private createTargetFormationBudgetReachabilityContext(
        candidatePool: readonly ForceGenerationCandidateUnit[],
        skillBudgetPlanningCosts?: ForceGenerationSkillBudgetPlanningCosts,
    ): ForceGenerationTargetFormationBudgetReachabilityContext {
        return {
            lowestCostCandidatePool: [...candidatePool].sort((left, right) => (
                this.getSkillPlanningCost(left, skillBudgetPlanningCosts, 'min')
                - this.getSkillPlanningCost(right, skillBudgetPlanningCosts, 'min')
            )),
        };
    }

    private createTargetFormationSetSkillOptionResolver(
        selectionAttempt: ForceGenerationSelectionAttempt,
        options: ForceGenerationRequest,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationSkillOptionResolver {
        const definitionByUnitIndex = new Map<number, FormationTypeDefinition>();
        for (const targetGroup of selectionAttempt.targetFormationGroups ?? []) {
            const definition = LanceTypeIdentifierUtil.getDefinitionById(targetGroup.formationId, options.gameSystem);
            if (!definition) {
                continue;
            }

            for (const unitIndex of targetGroup.unitIndexes) {
                definitionByUnitIndex.set(unitIndex, definition);
            }
        }

        return (candidate, index) => {
            const definition = definitionByUnitIndex.get(index);
            return definition
                ? this.createTargetFormationSkillAdjustedCandidateOptions(candidate, options, definition, skillSettings)
                : createSkillAdjustedCandidateOptions(candidate, options.gameSystem, skillSettings);
        };
    }

    private buildTargetFormationGroupSelection(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        definition: FormationTypeDefinition,
        budgetRange: { min: number; max: number },
        groupUnitCount: number,
        preventDuplicateChassis: boolean,
        skillSettings: ForceGenerationSkillSettings,
        baseSelectedCandidates: readonly ForceGenerationCandidateUnit[] = [],
        minTotalUnitCount = groupUnitCount,
        deadline?: ForceGenerationSearchDeadline,
    ): ForceGenerationSelectionAttempt {
        const targetCandidates = this.createTargetFormationCandidatesForAttempt(
            candidates,
            options,
            definition,
            skillSettings,
        );
        const skillBudgetPlanningCosts = this.createTargetFormationSkillBudgetPlanningCosts(
            targetCandidates,
            options,
            definition,
            skillSettings,
        );
        const selectedCandidates: ForceGenerationCandidateUnit[] = [];
        const remainingCandidates: ForceGenerationCandidateUnit[] = [...targetCandidates];
        const baseSelectedUnitCount = baseSelectedCandidates.length;
        const allowUnlimitedDuplicateUnits = this.canReuseCandidateCopies(preventDuplicateChassis, targetCandidates);
        const baseMinimumTotalCost = baseSelectedCandidates.reduce((sum, candidate) => (
            sum + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'min')
        ), 0);
        const groupSearchStartedAt = LOG_ATTEMPTS ? getForceGeneratorNow() : 0;
        let budgetReachabilityChecks = 0;
        let budgetReachabilitySorts = 0;
        let candidateEvaluationCount = 0;

        while (selectedCandidates.length < groupUnitCount && !this.hasSearchDeadlineExpired(deadline)) {
            const currentEvaluation = FormationRequirementEngine.evaluateDefinition(
                definition,
                this.createFormationUnitsForCandidates(selectedCandidates, options),
                options.gameSystem,
            );
            if (currentEvaluation && FormationRequirementEngine.hasHardConstraintViolations(currentEvaluation)) {
                break;
            }

            const matchedPairCandidate = this.findMatchedPairCompletionCandidate(
                definition,
                selectedCandidates,
                options,
                groupUnitCount,
                currentEvaluation,
                this.countTaggedQuantitySelections(selectedCandidates),
                budgetRange,
                baseMinimumTotalCost + selectedCandidates.reduce((sum, selectedCandidate) => (
                    sum + this.getSkillPlanningCost(selectedCandidate, skillBudgetPlanningCosts, 'min')
                ), 0),
            );
            const matchedPairCandidatePool = matchedPairCandidate
                ? [matchedPairCandidate, ...remainingCandidates]
                : [];
            const matchedPairReachabilityContext = matchedPairCandidate && Number.isFinite(budgetRange.max)
                ? this.createTargetFormationBudgetReachabilityContext(matchedPairCandidatePool, skillBudgetPlanningCosts)
                : undefined;
            if (matchedPairReachabilityContext) {
                budgetReachabilitySorts += 1;
            }
            if (matchedPairCandidate) {
                budgetReachabilityChecks += 1;
            }
            if (matchedPairCandidate && this.canTargetFormationGroupPickReachMinimumUnitsWithinBudget(
                matchedPairCandidate,
                matchedPairCandidatePool,
                budgetRange,
                baseMinimumTotalCost,
                selectedCandidates,
                baseSelectedUnitCount,
                minTotalUnitCount,
                skillBudgetPlanningCosts,
                allowUnlimitedDuplicateUnits,
                matchedPairReachabilityContext,
            )) {
                selectedCandidates.push(matchedPairCandidate);
                continue;
            }

            const localCandidatePool = this.filterAvailableTargetFormationCandidates(
                remainingCandidates,
                selectedCandidates,
                preventDuplicateChassis,
                allowUnlimitedDuplicateUnits,
            );
            const currentFormationUnits = this.createFormationUnitsForCandidates(selectedCandidates, options);
            const searchPredicateFilter = FormationRequirementEngine.getSearchCandidatePredicateFilter(
                definition,
                currentFormationUnits,
                options.gameSystem,
            );
            const guidedCandidatePool = this.filterCandidatesByPredicateFilter(
                localCandidatePool,
                options,
                searchPredicateFilter,
                currentEvaluation?.valid !== true,
            );
            const reachabilityContext = Number.isFinite(budgetRange.max)
                ? this.createTargetFormationBudgetReachabilityContext(guidedCandidatePool, skillBudgetPlanningCosts)
                : undefined;
            if (reachabilityContext) {
                budgetReachabilitySorts += 1;
            }
            const candidateSearchDecisions: Array<{ candidate: ForceGenerationCandidateUnit; decision: FormationSearchDecision }> = [];
            for (const candidate of guidedCandidatePool) {
                if (this.hasSearchDeadlineExpired(deadline)) {
                    break;
                }

                budgetReachabilityChecks += 1;
                if (!this.canTargetFormationGroupPickReachMinimumUnitsWithinBudget(
                    candidate,
                    guidedCandidatePool,
                    budgetRange,
                    baseMinimumTotalCost,
                    selectedCandidates,
                    baseSelectedUnitCount,
                    minTotalUnitCount,
                    skillBudgetPlanningCosts,
                    allowUnlimitedDuplicateUnits,
                    reachabilityContext,
                )) {
                    continue;
                }

                candidateEvaluationCount += 1;
                const decision = this.evaluateTargetFormationCandidate(definition, selectedCandidates, candidate, options, groupUnitCount, groupUnitCount, currentFormationUnits);
                candidateSearchDecisions.push({ candidate, decision });
            }
            const formationCandidateDecisions = candidateSearchDecisions.filter((entry) => entry.decision.allowed);
            const fallbackCandidateDecisions = formationCandidateDecisions.length > 0
                ? formationCandidateDecisions
                : candidateSearchDecisions.filter((entry) => !entry.decision.violatesHardConstraint);
            if (fallbackCandidateDecisions.length === 0) {
                break;
            }

            const currentValid = currentEvaluation?.valid === true;
            const improvingCandidateDecisions = currentValid
                ? []
                : fallbackCandidateDecisions.filter((entry) => entry.decision.fillsDeficit);
            const candidateDecisions = improvingCandidateDecisions.length > 0
                ? improvingCandidateDecisions
                : fallbackCandidateDecisions;
            const candidateDecisionByUnit = new Map(candidateDecisions.map((entry) => [entry.candidate, entry.decision]));
            const nextPick = this.pickNextCandidate(
                candidateDecisions.map((entry) => entry.candidate),
                null,
            );
            const nextCandidate = nextPick.candidate;
            if (!candidateDecisionByUnit.has(nextCandidate)) {
                break;
            }

            selectedCandidates.push(nextCandidate);
            if (!allowUnlimitedDuplicateUnits) {
                const remainingIndex = remainingCandidates.indexOf(nextCandidate);
                if (remainingIndex >= 0) {
                    remainingCandidates.splice(remainingIndex, 1);
                }
            }
        }

        this.logTargetFormationGroupSelectionDiagnostics(
            definition,
            targetCandidates.length,
            selectedCandidates.length,
            budgetReachabilityChecks,
            budgetReachabilitySorts,
            candidateEvaluationCount,
            this.hasSearchDeadlineExpired(deadline),
            LOG_ATTEMPTS ? getForceGeneratorNow() - groupSearchStartedAt : 0,
        );

        return this.createSelectionAttemptFromCandidates(selectedCandidates, null);
    }

    private canTargetFormationGroupPickReachMinimumUnitsWithinBudget(
        candidate: ForceGenerationCandidateUnit,
        candidatePool: readonly ForceGenerationCandidateUnit[],
        budgetRange: { min: number; max: number },
        baseMinimumTotalCost: number,
        selectedGroupCandidates: readonly ForceGenerationCandidateUnit[],
        baseSelectedUnitCount: number,
        minTotalUnitCount: number,
        skillBudgetPlanningCosts?: ForceGenerationSkillBudgetPlanningCosts,
        allowUnlimitedDuplicateUnits = false,
        reachabilityContext?: ForceGenerationTargetFormationBudgetReachabilityContext,
    ): boolean {
        if (!Number.isFinite(budgetRange.max)) {
            return true;
        }

        const selectedGroupMinimumTotalCost = selectedGroupCandidates.reduce((sum, selectedCandidate) => (
            sum + this.getSkillPlanningCost(selectedCandidate, skillBudgetPlanningCosts, 'min')
        ), 0);
        const nextMinimumTotalCost = baseMinimumTotalCost
            + selectedGroupMinimumTotalCost
            + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'min');
        if (nextMinimumTotalCost > budgetRange.max) {
            return false;
        }

        const nextUnitCount = baseSelectedUnitCount + selectedGroupCandidates.length + 1;
        const requiredAfterPick = Math.max(0, minTotalUnitCount - nextUnitCount);
        if (requiredAfterPick === 0) {
            return true;
        }

        const lowestCostCandidatePool = reachabilityContext?.lowestCostCandidatePool
            ?? this.createTargetFormationBudgetReachabilityContext(candidatePool, skillBudgetPlanningCosts).lowestCostCandidatePool;
        const minimumRemainingTotalCost = allowUnlimitedDuplicateUnits
            ? getReusableCandidateCostTotal(
                lowestCostCandidatePool,
                requiredAfterPick,
                (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'min'),
            )
            : getOrderedCandidateCostTotalExcluding(
                lowestCostCandidatePool,
                candidate,
                requiredAfterPick,
                (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'min'),
            );

        return nextMinimumTotalCost + minimumRemainingTotalCost <= budgetRange.max;
    }

    private logTargetFormationGroupSelectionDiagnostics(
        definition: FormationTypeDefinition,
        availableCandidateCount: number,
        selectedCandidateCount: number,
        budgetReachabilityChecks: number,
        budgetReachabilitySorts: number,
        candidateEvaluationCount: number,
        deadlineExpired: boolean,
        elapsedMs: number,
    ): void {
        if (!LOG_ATTEMPTS) {
            return;
        }

        console.log('[ForceGenerator] Target formation group selection', {
            formationId: definition.id,
            formationName: definition.name,
            availableCandidateCount,
            selectedCandidateCount,
            budgetReachabilityChecks,
            budgetReachabilitySorts,
            candidateEvaluationCount,
            deadlineExpired,
            elapsedMs: Math.round(elapsedMs),
        });
    }

    private logTargetFormationAttemptDiagnostics(
        mode: 'single' | 'multi',
        attemptNumber: number,
        selectedCandidates: readonly ForceGenerationCandidateUnit[],
        rank: ForceGenerationTargetAttemptRank,
        budgetRange: { min: number; max: number },
        message: string | null,
        deadlineExpired: boolean,
    ): void {
        if (!LOG_ATTEMPTS) {
            return;
        }

        const totalCost = selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        console.log('[ForceGenerator] Target formation attempt', {
            mode,
            attemptNumber,
            selectedUnitCount: selectedCandidates.length,
            totalCost,
            budgetMin: budgetRange.min,
            budgetMax: Number.isFinite(budgetRange.max) ? budgetRange.max : null,
            rank,
            message,
            deadlineExpired,
        });
    }

    private buildMultiTargetedFormationSelection(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        targetFormationSetContext: ForceGenerationTargetFormationSetContext,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        lockedCandidates: readonly ForceGenerationCandidateUnit[],
        preventDuplicateChassis: boolean,
        skillSettings: ForceGenerationSkillSettings,
        deadline?: ForceGenerationSearchDeadline,
    ): ForceGenerationSelectionAttempt {
        const selectedCandidates: ForceGenerationCandidateUnit[] = [...lockedCandidates];
        const targetFormationGroups: ForceGenerationTargetFormationCandidateGroup[] = [];
        const orderedTargetInstances = this.rotateTargetFormationInstances(targetFormationSetContext.instances);
        const skillBudgetPlanningCosts = this.createSkillBudgetPlanningCosts(
            candidates,
            options.gameSystem,
            skillSettings,
        );
        const allowUnlimitedDuplicateUnits = this.canReuseCandidateCopies(preventDuplicateChassis, candidates);

        for (const [targetIndex, targetInstance] of orderedTargetInstances.entries()) {
            if (this.hasSearchDeadlineExpired(deadline)) {
                break;
            }

            const remainingSlots = maxUnitCount - selectedCandidates.length;
            const remainingTargetMinimumUnits = this.getTargetFormationMinimumUnitTotal(orderedTargetInstances.slice(targetIndex + 1));
            const preferredUnitCount = this.getPreferredTargetFormationUnitCount(targetInstance.definition, options, candidates);
            const groupUnitCount = this.resolveTargetFormationGroupUnitCount(
                targetInstance,
                remainingSlots,
                remainingTargetMinimumUnits,
                preferredUnitCount,
            );
            if (groupUnitCount <= 0) {
                continue;
            }

            const availableCandidates = this.filterAvailableTargetFormationCandidates(
                candidates,
                selectedCandidates,
                preventDuplicateChassis,
                allowUnlimitedDuplicateUnits,
            );
            const groupAttempt = this.buildTargetFormationGroupSelection(
                availableCandidates,
                options,
                targetInstance.definition,
                budgetRange,
                groupUnitCount,
                preventDuplicateChassis,
                skillSettings,
                selectedCandidates,
                minUnitCount,
                deadline,
            );
            const groupEvaluation = FormationRequirementEngine.evaluateDefinition(
                targetInstance.definition,
                this.createFormationUnitsForCandidates(groupAttempt.selectedCandidates, options),
                options.gameSystem,
            );
            const groupValid = groupEvaluation?.valid === true
                && groupAttempt.selectedCandidates.length === groupUnitCount;
            if (!groupValid) {
                continue;
            }

            const startIndex = selectedCandidates.length;
            selectedCandidates.push(...groupAttempt.selectedCandidates);
            targetFormationGroups.push({
                formationId: targetInstance.definition.id,
                unitIndexes: groupAttempt.selectedCandidates.map((_, index) => startIndex + index),
            });
        }

        const totalCost = selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        const shouldFill = selectedCandidates.length < minUnitCount
            || (!isBudgetWithinRange(totalCost, budgetRange) && selectedCandidates.length < maxUnitCount);
        if (shouldFill && !this.hasSearchDeadlineExpired(deadline)) {
            const availableCandidates = this.filterAvailableTargetFormationCandidates(
                candidates,
                selectedCandidates,
                preventDuplicateChassis,
                allowUnlimitedDuplicateUnits,
            );
            const fillAttempt = this.buildCandidateSelection(
                availableCandidates,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                false,
                selectedCandidates,
                preventDuplicateChassis,
                undefined,
                skillBudgetPlanningCosts,
                deadline,
            );
            return {
                ...fillAttempt,
                targetFormationGroups,
            };
        }

        return {
            ...this.createSelectionAttemptFromCandidates(selectedCandidates, null),
            targetFormationGroups,
        };
    }

    private rotateTargetFormationInstances(
        instances: readonly ForceGenerationTargetFormationInstanceContext[],
    ): ForceGenerationTargetFormationInstanceContext[] {
        if (instances.length <= 1) {
            return [...instances];
        }

        const startIndex = Math.floor(Math.random() * instances.length);
        return [...instances.slice(startIndex), ...instances.slice(0, startIndex)];
    }

    private getTargetFormationMinimumUnitTotal(
        instances: readonly ForceGenerationTargetFormationInstanceContext[],
    ): number {
        return instances.reduce((sum, instance) => (
            sum + Math.max(1, instance.definition.minUnits ?? 1)
        ), 0);
    }

    private resolveTargetFormationGroupUnitCount(
        targetInstance: ForceGenerationTargetFormationInstanceContext,
        remainingSlots: number,
        remainingTargetMinimumUnits: number,
        preferredTargetUnitCount = targetInstance.preferredUnitCount,
    ): number {
        const minUnitCount = Math.max(1, targetInstance.definition.minUnits ?? 1);
        const maxUnitCount = Math.min(FORCE_MAX_UNITS, targetInstance.definition.maxUnits ?? FORCE_MAX_UNITS);
        if (remainingSlots < minUnitCount) {
            return 0;
        }

        const preferredUnitCount = Math.min(maxUnitCount, Math.max(minUnitCount, preferredTargetUnitCount));
        const maxCurrentUnitsWhilePreservingOtherTargets = remainingSlots - remainingTargetMinimumUnits;
        const resolvedUnitCount = maxCurrentUnitsWhilePreservingOtherTargets >= minUnitCount
            ? Math.min(preferredUnitCount, maxCurrentUnitsWhilePreservingOtherTargets)
            : minUnitCount;

        return Math.min(maxUnitCount, resolvedUnitCount);
    }

    private filterAvailableTargetFormationCandidates(
        candidates: readonly ForceGenerationCandidateUnit[],
        selectedCandidates: readonly ForceGenerationCandidateUnit[],
        preventDuplicateChassis: boolean,
        allowUnlimitedDuplicateUnits = false,
    ): ForceGenerationCandidateUnit[] {
        const selectedCandidateSet = new Set(selectedCandidates);
        const selectedUnitUuids = new Set(selectedCandidates.map((candidate) => candidate.unit.uuid));
        const selectedLockKeys = new Set(
            selectedCandidates
                .map((candidate) => candidate.lockKey)
                .filter((lockKey): lockKey is string => !!lockKey),
        );
        const selectedTaggedQuantityCounts = new Map<string, number>();
        const selectedChassisKeys = new Set<string>();

        for (const selectedCandidate of selectedCandidates) {
            if (selectedCandidate.taggedQuantityCapKey) {
                selectedTaggedQuantityCounts.set(
                    selectedCandidate.taggedQuantityCapKey,
                    (selectedTaggedQuantityCounts.get(selectedCandidate.taggedQuantityCapKey) ?? 0) + 1,
                );
            }
            const chassisKey = buildDuplicateChassisKey(selectedCandidate.unit);
            if (chassisKey.length > 0) {
                selectedChassisKeys.add(chassisKey);
            }
        }

        return candidates.filter((candidate) => {
            if (!allowUnlimitedDuplicateUnits && selectedCandidateSet.has(candidate)) {
                return false;
            }
            if (candidate.lockKey && selectedLockKeys.has(candidate.lockKey)) {
                return false;
            }
            if (candidate.taggedQuantityCapKey) {
                const quantityCap = Math.max(1, candidate.taggedQuantityCap ?? 1);
                if ((selectedTaggedQuantityCounts.get(candidate.taggedQuantityCapKey) ?? 0) >= quantityCap) {
                    return false;
                }
            } else if (!allowUnlimitedDuplicateUnits && selectedUnitUuids.has(candidate.unit.uuid)) {
                return false;
            }
            if (preventDuplicateChassis) {
                const chassisKey = buildDuplicateChassisKey(candidate.unit);
                if (chassisKey.length > 0 && selectedChassisKeys.has(chassisKey)) {
                    return false;
                }
            }

            return true;
        });
    }

    private filterTargetFormationCandidatePool(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        definition: FormationTypeDefinition,
    ): ForceGenerationCandidateUnit[] {
        return this.filterCandidatesByPredicateFilter(
            candidates,
            options,
            FormationRequirementEngine.getBaseCandidatePredicateFilter(definition, options.gameSystem),
            false,
        );
    }

    private filterCandidatesByPredicateFilter(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        filter: FormationCandidatePredicateFilter,
        requireHelpfulPredicate: boolean,
    ): ForceGenerationCandidateUnit[] {
        if (filter.requiredPredicates.length === 0
            && filter.helpfulPredicates.length === 0
            && filter.forbiddenPredicates.length === 0
            && filter.conditionalForbiddenPredicates.length === 0) {
            return [...candidates];
        }

        const candidateUnits = this.createFormationUnitsForCandidates(candidates, options);
        return candidates.filter((_, index) => {
            const facts = compileFormationUnitFacts(candidateUnits[index]);
            for (const predicateId of filter.requiredPredicates) {
                if (!evaluateFormationPredicate(predicateId, facts, options.gameSystem)) {
                    return false;
                }
            }
            for (const predicateId of filter.forbiddenPredicates) {
                if (evaluateFormationPredicate(predicateId, facts, options.gameSystem)) {
                    return false;
                }
            }
            if (!filter.conditionalForbiddenPredicates.every(entry => !evaluateFormationPredicate(entry.when, facts, options.gameSystem)
                || !evaluateFormationPredicate(entry.predicate, facts, options.gameSystem))) {
                return false;
            }

            return !requireHelpfulPredicate
                || filter.helpfulPredicates.length === 0
                || filter.helpfulPredicates.some(predicateId => evaluateFormationPredicate(predicateId, facts, options.gameSystem));
        });
    }

    private evaluateTargetFormationSetAttempt(
        selectionAttempt: ForceGenerationSelectionAttempt,
        options: ForceGenerationRequest,
        targetFormationSetContext: ForceGenerationTargetFormationSetContext,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
    ): ForceGenerationTargetFormationSetAttemptEvaluation {
        const groups = selectionAttempt.targetFormationGroups ?? [];
        let satisfiedTargetCount = 0;
        let formationDeficitScore = 0;

        for (const group of groups) {
            const definition = LanceTypeIdentifierUtil.getDefinitionById(group.formationId, options.gameSystem);
            const groupCandidates = group.unitIndexes
                .map((unitIndex) => selectionAttempt.selectedCandidates[unitIndex])
                .filter((candidate): candidate is ForceGenerationCandidateUnit => candidate !== undefined);
            const evaluation = definition
                ? FormationRequirementEngine.evaluateDefinition(
                    definition,
                    this.createFormationUnitsForCandidates(groupCandidates, options),
                    options.gameSystem,
                )
                : null;

            if (evaluation?.valid === true) {
                satisfiedTargetCount += 1;
            } else {
                formationDeficitScore += this.getFormationDeficitScore(evaluation);
            }
        }

        for (let index = satisfiedTargetCount; index < targetFormationSetContext.instances.length; index += 1) {
            formationDeficitScore += Math.max(1, targetFormationSetContext.instances[index].definition.minUnits ?? 1);
        }

        const totalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        const budgetDistance = getBudgetRangeDistance(totalCost, budgetRange);
        const budgetValid = budgetDistance === 0;
        const unitCountDistance = this.getUnitCountRangeDistance(selectionAttempt.selectedCandidates.length, minUnitCount, maxUnitCount);
        const unitCountValid = unitCountDistance === 0;
        const requestedTargetCount = targetFormationSetContext.instances.length;
        const achievedSummary = this.formatTargetFormationInstances(groups.slice(0, satisfiedTargetCount), options.gameSystem);
        const baseMessage = satisfiedTargetCount === requestedTargetCount
            ? `Target formations achieved: ${achievedSummary || `${satisfiedTargetCount} of ${requestedTargetCount}`}.`
            : satisfiedTargetCount > 0
                ? `Target formations achieved: ${satisfiedTargetCount} of ${requestedTargetCount} requested${achievedSummary ? ` (${achievedSummary})` : ''}.`
                : 'Unable to complete any requested target formation within the selected filters, budget, and locked units.';
        const budgetLabel = options.gameSystem === GameSystem.AS ? 'PV' : 'BV';
        const budgetIssue = budgetValid
            ? null
            : `Budget mismatch: ${totalCost.toLocaleString()} ${budgetLabel} is outside ${this.getFormattedBudgetRange(budgetRange)}.`;
        const unitCountIssue = unitCountValid
            ? null
            : `Unit count mismatch: ${selectionAttempt.selectedCandidates.length} is outside ${minUnitCount}-${maxUnitCount}.`;
        const message = [baseMessage, budgetIssue, unitCountIssue]
            .filter((entry): entry is string => !!entry)
            .join(' ');

        return {
            rank: {
                satisfiedTargetCount,
                requestedTargetCount,
                formationDeficitScore,
                budgetDistance,
                unitCountDistance,
            },
            allTargetsSatisfied: satisfiedTargetCount === requestedTargetCount,
            budgetValid,
            unitCountValid,
            message,
        };
    }

    private pickNextCandidate(
        candidates: readonly ForceGenerationCandidateUnit[],
        rulesetProfile: RulesetProfile | null,
        selectionPreparation?: ForceGenerationSelectionPreparation,
    ): {
        candidate: ForceGenerationCandidateUnit;
        rolledSource: ForceGenerationAvailabilitySource;
        source: ForceGenerationAvailabilitySource;
        usedFallbackSource: boolean;
    } {
        const getRulesetScore = (candidate: ForceGenerationCandidateUnit): number => (
            selectionPreparation?.rulesetScoreByCandidate.get(candidate)
                ?? getRulesetMatchScore(candidate, rulesetProfile)
        );
        if (candidates.every((candidate) => candidate.availabilityWeightsIgnored)) {
            return {
                candidate: pickWeightedRandomEntry(candidates, getRulesetScore),
                rolledSource: 'requisition',
                source: 'requisition',
                usedFallbackSource: false,
            };
        }

        const source = this.pickAvailabilitySource(candidates);
        const alternateSource: ForceGenerationAvailabilitySource = source === 'requisition' ? 'salvage' : 'requisition';
        const sourceCandidates = candidates.filter((candidate) => this.getAvailabilityWeightForSource(candidate, source) > 0);
        const alternateCandidates = candidates.filter((candidate) => this.getAvailabilityWeightForSource(candidate, alternateSource) > 0);
        const weightedCandidates = sourceCandidates.length > 0
            ? sourceCandidates
            : alternateCandidates.length > 0
                ? alternateCandidates
                : candidates;
        const weightedSource = sourceCandidates.length > 0 ? source : alternateCandidates.length > 0 ? alternateSource : source;

        return {
            candidate: pickWeightedRandomEntry(weightedCandidates, (candidate) => {
                const availabilityWeight = Math.max(0.05, this.getAvailabilityWeightForSource(candidate, weightedSource));
                return availabilityWeight * getRulesetScore(candidate);
            }),
            rolledSource: source,
            source: weightedSource,
            usedFallbackSource: weightedSource !== source,
        };
    }

    private buildCandidateSelection(
        candidates: readonly ForceGenerationCandidateUnit[],
        context: ForceGenerationContext,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        allowOverMaxFallbackSelection = false,
        preselectedCandidates: readonly ForceGenerationCandidateUnit[] = [],
        preventDuplicateChassis = false,
        selectionPreparation?: ForceGenerationSelectionPreparation,
        skillBudgetPlanningCosts?: ForceGenerationSkillBudgetPlanningCosts,
        deadline?: ForceGenerationSearchDeadline,
    ): ForceGenerationSelectionAttempt {
        const preparedSelection = selectionPreparation ?? this.prepareSelectionPreparation(
            candidates,
            preselectedCandidates,
            context,
            minUnitCount,
            maxUnitCount,
            budgetRange,
        );
        const rulesetProfile = preparedSelection.rulesetProfile;
        const remainingCandidates = [...preparedSelection.selectableCandidates];
        const lowestCostRemainingCandidates = skillBudgetPlanningCosts
            ? [...preparedSelection.selectableCandidates].sort((left, right) => (
                this.getSkillPlanningCost(left, skillBudgetPlanningCosts, 'min') - this.getSkillPlanningCost(right, skillBudgetPlanningCosts, 'min')
            ))
            : [...preparedSelection.lowestCostCandidates];
        const highestCostRemainingCandidates = skillBudgetPlanningCosts
            ? [...preparedSelection.selectableCandidates].sort((left, right) => (
                this.getSkillPlanningCost(right, skillBudgetPlanningCosts, 'max') - this.getSkillPlanningCost(left, skillBudgetPlanningCosts, 'max')
            ))
            : [...preparedSelection.highestCostCandidates];
        const selectedCandidates: ForceGenerationCandidateUnit[] = [...preselectedCandidates];
        const selectionSteps: ForceGenerationSelectionStep[] = preselectedCandidates.map((candidate) => {
            return this.createSelectionStep(candidate, rulesetProfile, {}, preparedSelection);
        });
        let totalCost = selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        let minimumSkillAdjustedTotalCost = selectedCandidates.reduce((sum, candidate) => (
            sum + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'min')
        ), 0);
        let maximumSkillAdjustedTotalCost = selectedCandidates.reduce((sum, candidate) => (
            sum + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'max')
        ), 0);
        const preferredSelectionUnitCount = this.getPreferredSelectionUnitCount(
            rulesetProfile?.preferredUnitCount,
            minUnitCount,
            maxUnitCount,
        );
        const targetBudget = getBudgetTarget(budgetRange);
        const useOverMaxFallbackSelection = allowOverMaxFallbackSelection && Number.isFinite(budgetRange.max);
        const selectedChassisKeys = new Set(
            selectedCandidates
                .map((candidate) => buildDuplicateChassisKey(candidate.unit))
                .filter((key) => key.length > 0),
        );
        const selectedTaggedQuantityCounts = new Map<string, number>();
        for (const candidate of selectedCandidates) {
            if (!candidate.taggedQuantityCapKey) {
                continue;
            }

            selectedTaggedQuantityCounts.set(
                candidate.taggedQuantityCapKey,
                (selectedTaggedQuantityCounts.get(candidate.taggedQuantityCapKey) ?? 0) + 1,
            );
        }
        const allowUnlimitedDuplicateUnits = this.canReuseCandidateCopies(preventDuplicateChassis, candidates);
        let candidatePoolStarved = false;

        while (selectedCandidates.length < maxUnitCount && !this.hasSearchDeadlineExpired(deadline)) {
            if (
                selectedCandidates.length >= minUnitCount
                && (
                    (
                        (
                            isBudgetWithinRange(totalCost, budgetRange)
                            || this.canSkillAdjustedSelectionReachBudgetRange(minimumSkillAdjustedTotalCost, maximumSkillAdjustedTotalCost, budgetRange)
                        )
                        && ((preferredSelectionUnitCount !== undefined && selectedCandidates.length >= preferredSelectionUnitCount)
                            || (preferredSelectionUnitCount === undefined && maximumSkillAdjustedTotalCost >= targetBudget))
                    )
                    || (useOverMaxFallbackSelection && totalCost > budgetRange.max)
                )
            ) {
                break;
            }

            const requiredAfterPick = Math.max(0, minUnitCount - selectedCandidates.length - 1);
            const remainingSlotsAfterPick = maxUnitCount - selectedCandidates.length - 1;

            const underMaxCandidates = remainingCandidates.filter((candidate) => {
                const nextMinimumTotal = minimumSkillAdjustedTotalCost + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'min');
                if (nextMinimumTotal > budgetRange.max) {
                    return false;
                }

                const minimumRemainingTotal = allowUnlimitedDuplicateUnits
                    ? getReusableCandidateCostTotal(
                        lowestCostRemainingCandidates,
                        requiredAfterPick,
                        (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'min'),
                    )
                    : getOrderedCandidateCostTotalExcluding(
                        lowestCostRemainingCandidates,
                        candidate,
                        requiredAfterPick,
                        (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'min'),
                    );
                if (nextMinimumTotal + minimumRemainingTotal > budgetRange.max) {
                    return false;
                }

                return true;
            });

            const feasibleCandidates = underMaxCandidates.filter((candidate) => {
                const nextMaximumTotal = maximumSkillAdjustedTotalCost + this.getSkillPlanningCost(candidate, skillBudgetPlanningCosts, 'max');

                const maximumRemainingTotal = allowUnlimitedDuplicateUnits
                    ? getReusableCandidateCostTotal(
                        highestCostRemainingCandidates,
                        remainingSlotsAfterPick,
                        (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'max'),
                    )
                    : getOrderedCandidateCostTotalExcluding(
                        highestCostRemainingCandidates,
                        candidate,
                        remainingSlotsAfterPick,
                        (remainingCandidate) => this.getSkillPlanningCost(remainingCandidate, skillBudgetPlanningCosts, 'max'),
                    );
                return nextMaximumTotal + maximumRemainingTotal >= budgetRange.min;
            });

            const candidatePool = feasibleCandidates.length > 0
                ? feasibleCandidates
                : useOverMaxFallbackSelection && selectedCandidates.length < minUnitCount
                    ? remainingCandidates
                    : underMaxCandidates;

            const cappedCandidatePool = candidatePool.filter((candidate) => {
                if (!candidate.taggedQuantityCapKey) {
                    return true;
                }

                const quantityCap = Math.max(1, candidate.taggedQuantityCap ?? 1);
                return (selectedTaggedQuantityCounts.get(candidate.taggedQuantityCapKey) ?? 0) < quantityCap;
            });

            const chassisFilteredCandidatePool = preventDuplicateChassis
                ? cappedCandidatePool.filter((candidate) => {
                    const chassisKey = buildDuplicateChassisKey(candidate.unit);
                    return chassisKey.length === 0 || !selectedChassisKeys.has(chassisKey);
                })
                : cappedCandidatePool;

            if (chassisFilteredCandidatePool.length === 0) {
                candidatePoolStarved = this.isCandidatePoolStarved(
                    preparedSelection.selectableCandidates,
                    selectedCandidates,
                    preventDuplicateChassis,
                    allowUnlimitedDuplicateUnits,
                );
                break;
            }

            const nextPick = this.pickNextCandidate(
                chassisFilteredCandidatePool,
                rulesetProfile,
                preparedSelection,
            );
            const nextCandidate = nextPick.candidate;
            selectedCandidates.push(nextCandidate);
            totalCost += nextCandidate.cost;
            minimumSkillAdjustedTotalCost += this.getSkillPlanningCost(nextCandidate, skillBudgetPlanningCosts, 'min');
            maximumSkillAdjustedTotalCost += this.getSkillPlanningCost(nextCandidate, skillBudgetPlanningCosts, 'max');
            if (!allowUnlimitedDuplicateUnits) {
                remainingCandidates.splice(remainingCandidates.indexOf(nextCandidate), 1);
                const lowestCostIndex = lowestCostRemainingCandidates.indexOf(nextCandidate);
                if (lowestCostIndex >= 0) {
                    lowestCostRemainingCandidates.splice(lowestCostIndex, 1);
                }
                const highestCostIndex = highestCostRemainingCandidates.indexOf(nextCandidate);
                if (highestCostIndex >= 0) {
                    highestCostRemainingCandidates.splice(highestCostIndex, 1);
                }
            }
            const chassisKey = buildDuplicateChassisKey(nextCandidate.unit);
            if (chassisKey.length > 0) {
                selectedChassisKeys.add(chassisKey);
            }
            if (nextCandidate.taggedQuantityCapKey) {
                selectedTaggedQuantityCounts.set(
                    nextCandidate.taggedQuantityCapKey,
                    (selectedTaggedQuantityCounts.get(nextCandidate.taggedQuantityCapKey) ?? 0) + 1,
                );
            }

            selectionSteps.push(this.createSelectionStep(nextCandidate, rulesetProfile, {
                rolledSource: nextPick.rolledSource,
                source: nextPick.source,
                usedFallbackSource: nextPick.usedFallbackSource,
            }, preparedSelection));
        }

        return {
            selectedCandidates,
            selectionSteps,
            rulesetProfile,
            candidatePoolStarved,
        };
    }

    private createSelectionStep(
        candidate: ForceGenerationCandidateUnit,
        rulesetProfile: RulesetProfile | null,
        overrides: Partial<Pick<ForceGenerationSelectionStep, 'rolledSource' | 'source' | 'usedFallbackSource'>> = {},
        selectionPreparation?: ForceGenerationSelectionPreparation,
    ): ForceGenerationSelectionStep {
        const source: ForceGenerationAvailabilitySource = candidate.requisitionWeight >= candidate.salvageWeight
            ? 'requisition'
            : 'salvage';

        return {
            unit: candidate.unit,
            locked: candidate.locked,
            rolledSource: overrides.rolledSource ?? source,
            source: overrides.source ?? source,
            usedFallbackSource: overrides.usedFallbackSource ?? false,
            requisitionWeight: candidate.requisitionWeight,
            salvageWeight: candidate.salvageWeight,
            cost: candidate.cost,
            skill: candidate.skill,
            gunnery: candidate.gunnery,
            piloting: candidate.piloting,
            rulesetReasons: selectionPreparation?.rulesetReasonsByCandidate.get(candidate)
                ?? getRulesetMatchReasons(candidate, rulesetProfile),
        };
    }

    private getPreferredSelectionUnitCount(
        preferredUnitCount: number | undefined,
        minUnitCount: number,
        maxUnitCount: number,
    ): number | undefined {
        if (preferredUnitCount === undefined || preferredUnitCount <= 0) {
            return undefined;
        }

        return Math.max(minUnitCount, Math.min(maxUnitCount, preferredUnitCount));
    }

    private buildRulesetProfile(
        candidates: readonly ForceGenerationCandidateUnit[],
        context: ForceGenerationContext,
        minUnitCount: number,
        maxUnitCount: number,
        budgetRange?: ForceGenerationBudgetRange,
        feasibilityContext: {
            lockedCandidates?: readonly ForceGenerationCandidateUnit[];
            preventDuplicateChassis?: boolean;
            skillBudgetPlanningCosts?: ForceGenerationSkillBudgetPlanningCosts;
        } = {},
    ): RulesetProfile | null {
        const rulesetContext = this.resolveRulesetContext(context.forceFaction, context.forceEra);
        if (rulesetContext.chain.length === 0) {
            return null;
        }

        const baseMatchContext: RulesetMatchContext = {
            year: getEraReferenceYear(context.forceEra),
            factionKey: rulesetContext.primary?.factionKey,
            topLevel: true,
        };
        const orgDefinition = context.forceFaction ? resolveOrgDefinition(context.forceFaction, context.forceEra) : null;
        const topLevelChoiceContext: ForceGenerationTopLevelChoiceContext = {
            unitTypeGroups: this.getCandidateUnitTypeGroups(candidates),
            baseMatchContext,
            minUnitCount,
            maxUnitCount,
            orgDefinition,
            budgetRange,
            lockedCandidates: feasibilityContext.lockedCandidates ?? [],
            preventDuplicateChassis: feasibilityContext.preventDuplicateChassis === true,
            skillBudgetPlanningCosts: feasibilityContext.skillBudgetPlanningCosts,
        };
        const topLevelMatchContext = this.resolveAttemptTopLevelMatchContext(
            rulesetContext.chain,
            topLevelChoiceContext,
        );
        const hasFeasibleTopLevelSelection = !!topLevelMatchContext.unitType || !!topLevelMatchContext.echelon;
        const forceNodeSelection: ForceNodeSelection = budgetRange && !hasFeasibleTopLevelSelection
            ? { matchContext: topLevelMatchContext }
            : resolvePreferredForceNode(rulesetContext.chain, topLevelMatchContext, 'weighted');
        const forceNode = forceNodeSelection.forceNode;
        const resolvedSelectedEchelon = topLevelMatchContext.echelon
            ?? forceNodeSelection.matchContext.echelon
            ?? forceNode?.echelon?.code;
        const profile: RulesetProfile = {
            selectedEchelon: resolvedSelectedEchelon,
            preferredOrgType: undefined,
            preferredUnitCount: undefined,
            requiredUnitTypes: new Set<string>(),
            preferredUnitTypes: new Set<string>(),
            preferredWeightClasses: new Set<string>(),
            preferredRoles: new Set<string>(),
            preferredMotives: new Set<string>(),
            templates: [],
            explanationNotes: [],
        };

        profile.preferredOrgType = getPreferredOrgTypeForEchelon(resolvedSelectedEchelon);
        profile.preferredUnitCount = getPreferredUnitCountForEchelon(resolvedSelectedEchelon, orgDefinition);
        addRulesetValues(profile.requiredUnitTypes, topLevelMatchContext.unitType ? [topLevelMatchContext.unitType] : []);
        mergeRulesetNodeIntoProfile(profile, rulesetContext.primary?.assign);

        if (profile.preferredOrgType) {
            const regularSizeNote = profile.preferredUnitCount ? ` (regular size ${profile.preferredUnitCount})` : '';
            this.appendRulesetNote(profile, `Org target: ${profile.preferredOrgType}${regularSizeNote}.`);
        }

        if (!forceNode) {
            this.appendRulesetNote(profile, 'Ruleset chain resolved, but no matching force node was found for the chosen echelon.');
            return profile;
        }

        applyForceNodeToProfile(profile, forceNode, forceNodeSelection.matchContext);
        this.collectRulesetTemplates(
            profile,
            forceNode,
            forceNodeSelection.matchContext,
            rulesetContext,
            context.forceEra,
            Math.max(0, maxUnitCount - 1),
            0,
            new Set<string>(),
        );
        return profile;
    }

    private resolveAttemptTopLevelMatchContext(
        rulesetChain: readonly MegaMekRulesetRecord[],
        context: ForceGenerationTopLevelChoiceContext,
    ): RulesetMatchContext {
        const unitTypeChoices = this.getTopLevelUnitTypeChoices(rulesetChain, context);
        if (unitTypeChoices.length === 0) {
            const forceNodeChoices = this.getForceNodeBackedTopLevelUnitTypeChoices(rulesetChain, context);
            if (forceNodeChoices.length === 0) {
                return context.baseMatchContext;
            }

            return pickWeightedRandomEntry(forceNodeChoices, (choice) => {
                return Math.max(0.05, choice.summary.totalAvailabilityWeight);
            }).matchContext;
        }

        const selectedUnitTypeChoice = pickWeightedRandomEntry(unitTypeChoices, (choice) => {
            return Math.max(0.05, choice.summary.totalAvailabilityWeight);
        });
        const selectedEchelonChoice = pickWeightedRandomEntry(selectedUnitTypeChoice.echelons, (choice) => {
            return Math.max(0.05, choice.weight);
        });
        const nextMatchContext: RulesetMatchContext = {
            ...context.baseMatchContext,
            unitType: selectedUnitTypeChoice.summary.unitType,
            echelon: selectedEchelonChoice.echelon,
        };
        const previewSelection = resolvePreferredForceNode(rulesetChain, nextMatchContext, 'first');
        const resolvedEchelon = selectedEchelonChoice.echelon
            ?? previewSelection.matchContext.echelon
            ?? previewSelection.forceNode?.echelon?.code;

        return {
            ...previewSelection.matchContext,
            unitType: selectedUnitTypeChoice.summary.unitType,
            echelon: resolvedEchelon,
        };
    }

    private getTopLevelUnitTypeChoices(
        rulesetChain: readonly MegaMekRulesetRecord[],
        context: ForceGenerationTopLevelChoiceContext,
    ): ForceGenerationTopLevelUnitTypeChoice[] {
        return context.unitTypeGroups
            .map((group) => {
                const echelons = this.getValidTopLevelEchelonOptions(
                    rulesetChain,
                    {
                        ...context.baseMatchContext,
                        unitType: group.summary.unitType,
                    },
                    context.minUnitCount,
                    context.maxUnitCount,
                    context.orgDefinition,
                );

                return {
                    summary: group.summary,
                    echelons: context.budgetRange
                        ? echelons.filter((echelon) => this.canCandidatePoolPotentiallyReachBudget(
                            group.candidates,
                            {
                                unitCount: echelon.preferredUnitCount,
                                budgetRange: context.budgetRange,
                                lockedCandidates: context.lockedCandidates,
                                preventDuplicateChassis: context.preventDuplicateChassis,
                                skillBudgetPlanningCosts: context.skillBudgetPlanningCosts,
                            },
                        ))
                        : echelons,
                };
            })
            .filter((choice) => choice.echelons.length > 0);
    }

    private canCandidatePoolPotentiallyReachBudget(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationBudgetFeasibilityOptions,
    ): boolean {
        const remainingCount = options.unitCount - options.lockedCandidates.length;
        if (remainingCount < 0) {
            return false;
        }

        const lockedTotal = options.lockedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        if (remainingCount === 0) {
            return !options.budgetRange || isBudgetWithinRange(lockedTotal, options.budgetRange);
        }

        const lockedChassisKeys = new Set(options.lockedCandidates
            .map((candidate) => buildDuplicateChassisKey(candidate.unit))
            .filter((key) => key.length > 0));
        const availableCandidates = options.preventDuplicateChassis
            ? candidates.filter((candidate) => {
                const chassisKey = buildDuplicateChassisKey(candidate.unit);
                return chassisKey.length === 0 || !lockedChassisKeys.has(chassisKey);
            })
            : candidates;
        if (availableCandidates.length === 0) {
            return false;
        }

        const getMinimumCost = (candidate: ForceGenerationCandidateUnit): number => (
            this.getSkillPlanningCost(candidate, options.skillBudgetPlanningCosts, 'min')
        );
        const getMaximumCost = (candidate: ForceGenerationCandidateUnit): number => (
            this.getSkillPlanningCost(candidate, options.skillBudgetPlanningCosts, 'max')
        );
        let minimumCosts: number[];
        let maximumCosts: number[];

        if (options.preventDuplicateChassis) {
            const candidatesByChassis = new Map<string, ForceGenerationCandidateUnit[]>();
            for (const [candidateIndex, candidate] of availableCandidates.entries()) {
                const chassisKey = buildDuplicateChassisKey(candidate.unit) || `unconstrained:${candidateIndex}`;
                const chassisCandidates = candidatesByChassis.get(chassisKey) ?? [];
                chassisCandidates.push(candidate);
                candidatesByChassis.set(chassisKey, chassisCandidates);
            }
            minimumCosts = [...candidatesByChassis.values()].map((group) => Math.min(...group.map(getMinimumCost)));
            maximumCosts = [...candidatesByChassis.values()].map((group) => Math.max(...group.map(getMaximumCost)));
        } else if (this.canReuseCandidateCopies(false, availableCandidates)) {
            minimumCosts = Array(remainingCount).fill(Math.min(...availableCandidates.map(getMinimumCost)));
            maximumCosts = Array(remainingCount).fill(Math.max(...availableCandidates.map(getMaximumCost)));
        } else {
            const uncappedCandidates = availableCandidates.filter((candidate) => !candidate.taggedQuantityCapKey);
            minimumCosts = uncappedCandidates.map(getMinimumCost);
            maximumCosts = uncappedCandidates.map(getMaximumCost);

            const candidatesByCapKey = new Map<string, ForceGenerationCandidateUnit[]>();
            for (const candidate of availableCandidates) {
                if (!candidate.taggedQuantityCapKey) {
                    continue;
                }
                const cappedCandidates = candidatesByCapKey.get(candidate.taggedQuantityCapKey) ?? [];
                cappedCandidates.push(candidate);
                candidatesByCapKey.set(candidate.taggedQuantityCapKey, cappedCandidates);
            }
            for (const cappedCandidates of candidatesByCapKey.values()) {
                const capacity = Math.min(
                    cappedCandidates.length,
                    Math.max(...cappedCandidates.map((candidate) => candidate.taggedQuantityCap ?? 1)),
                );
                minimumCosts.push(...cappedCandidates.map(getMinimumCost).sort((left, right) => left - right).slice(0, capacity));
                maximumCosts.push(...cappedCandidates.map(getMaximumCost).sort((left, right) => right - left).slice(0, capacity));
            }
        }

        if (minimumCosts.length < remainingCount || maximumCosts.length < remainingCount) {
            return false;
        }

        minimumCosts.sort((left, right) => left - right);
        maximumCosts.sort((left, right) => right - left);
        const minimumTotal = lockedTotal + minimumCosts.slice(0, remainingCount).reduce((sum, cost) => sum + cost, 0);
        const maximumTotal = lockedTotal + maximumCosts.slice(0, remainingCount).reduce((sum, cost) => sum + cost, 0);
        return !options.budgetRange
            || (minimumTotal <= options.budgetRange.max && maximumTotal >= options.budgetRange.min);
    }

    private getValidTopLevelEchelonOptions(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
        minUnitCount: number,
        maxUnitCount: number,
        orgDefinition: OrgDefinition | null,
    ): ForceGenerationTopLevelEchelonOption[] {
        for (const ruleset of rulesetChain) {
            const matchingOptions = (ruleset.toc?.echelon?.options ?? [])
                .filter((option) => matchesRulesetWhen(option.when, matchContext));
            if (matchingOptions.length === 0) {
                continue;
            }

            const validEchelons = matchingOptions.flatMap((option) => {
                return getRulesetOptionEchelons(option)
                    .map((token) => token.code)
                    .filter((echelon): echelon is string => !!echelon)
                    .map((echelon) => {
                        const preferredUnitCount = getPreferredUnitCountForEchelon(echelon, orgDefinition);
                        if (
                            preferredUnitCount === undefined
                            || preferredUnitCount < minUnitCount
                            || preferredUnitCount > maxUnitCount
                        ) {
                            return null;
                        }

                        return {
                            echelon,
                            preferredUnitCount,
                            weight: (option.weight ?? 1),
                        };
                    })
                    .filter((entry): entry is ForceGenerationTopLevelEchelonOption => entry !== null);
            });

            if (validEchelons.length > 0) {
                return validEchelons;
            }
        }

        return [];
    }

    private getForceNodeBackedTopLevelUnitTypeChoices(
        rulesetChain: readonly MegaMekRulesetRecord[],
        context: ForceGenerationTopLevelChoiceContext,
    ): ForceGenerationTopLevelForceNodeChoice[] {
        const choices: ForceGenerationTopLevelForceNodeChoice[] = [];

        for (const group of context.unitTypeGroups) {
            const previewSelection = resolvePreferredForceNode(rulesetChain, {
                ...context.baseMatchContext,
                unitType: group.summary.unitType,
            }, 'first');
            if (!previewSelection.forceNode) {
                continue;
            }

            const echelon = previewSelection.matchContext.echelon
                ?? previewSelection.forceNode.echelon?.code;
            const preferredUnitCount = getPreferredUnitCountForEchelon(echelon, context.orgDefinition);
            if (previewSelection.forceNode.when?.topLevel === true) {
                const feasibleUnitCounts = preferredUnitCount === undefined
                    ? Array.from(
                        { length: context.maxUnitCount - context.minUnitCount + 1 },
                        (_, index) => context.minUnitCount + index,
                    )
                    : preferredUnitCount >= context.minUnitCount && preferredUnitCount <= context.maxUnitCount
                        ? [preferredUnitCount]
                        : [];
                if (!feasibleUnitCounts.some((unitCount) => this.canCandidatePoolPotentiallyReachBudget(
                    group.candidates,
                    {
                        unitCount,
                        budgetRange: context.budgetRange,
                        lockedCandidates: context.lockedCandidates,
                        preventDuplicateChassis: context.preventDuplicateChassis,
                        skillBudgetPlanningCosts: context.skillBudgetPlanningCosts,
                    },
                ))) {
                    continue;
                }
            }

            choices.push({
                summary: group.summary,
                matchContext: {
                    ...previewSelection.matchContext,
                    unitType: group.summary.unitType,
                },
            });
        }

        return choices;
    }

    private getCandidateUnitTypeGroups(
        candidates: readonly ForceGenerationCandidateUnit[],
    ): ForceGenerationUnitTypeGroup[] {
        const groups = new Map<string, { summary: ForceGenerationCandidateUnitTypeSummary; candidates: ForceGenerationCandidateUnit[] }>();

        for (const candidate of candidates) {
            const group = groups.get(candidate.megaMekUnitType) ?? {
                summary: {
                    unitType: candidate.megaMekUnitType,
                    candidateCount: 0,
                    totalAvailabilityWeight: 0,
                },
                candidates: [],
            };
            group.summary.candidateCount += 1;
            group.summary.totalAvailabilityWeight += Math.max(0, candidate.requisitionWeight) + Math.max(0, candidate.salvageWeight);
            group.candidates.push(candidate);
            groups.set(candidate.megaMekUnitType, group);
        }

        return [...groups.values()].sort((left, right) => {
            if (left.summary.totalAvailabilityWeight !== right.summary.totalAvailabilityWeight) {
                return right.summary.totalAvailabilityWeight - left.summary.totalAvailabilityWeight;
            }
            if (left.summary.candidateCount !== right.summary.candidateCount) {
                return right.summary.candidateCount - left.summary.candidateCount;
            }

            return left.summary.unitType.localeCompare(right.summary.unitType);
        });
    }

    private filterCandidatesForAvailableTopLevelEchelons(
        candidates: readonly ForceGenerationCandidateUnit[],
        context: ForceGenerationContext,
        minUnitCount: number,
        maxUnitCount: number,
    ): ForceGenerationCandidateUnit[] {
        const rulesetContext = this.resolveRulesetContext(context.forceFaction, context.forceEra);
        if (rulesetContext.chain.length === 0) {
            return [...candidates];
        }

        const orgDefinition = context.forceFaction ? resolveOrgDefinition(context.forceFaction, context.forceEra) : null;
        const topLevelChoiceContext: ForceGenerationTopLevelChoiceContext = {
            unitTypeGroups: this.getCandidateUnitTypeGroups(candidates),
            baseMatchContext: {
                year: getEraReferenceYear(context.forceEra),
                factionKey: rulesetContext.primary?.factionKey,
                topLevel: true,
            },
            minUnitCount,
            maxUnitCount,
            orgDefinition,
            lockedCandidates: [],
            preventDuplicateChassis: false,
        };
        const unitTypeChoices = this.getTopLevelUnitTypeChoices(rulesetContext.chain, topLevelChoiceContext);
        const allowedUnitTypes = new Set(
            (unitTypeChoices.length > 0
                ? unitTypeChoices.map((choice) => choice.summary.unitType)
                : this.getForceNodeBackedTopLevelUnitTypeChoices(
                    rulesetContext.chain,
                    topLevelChoiceContext,
                ).map((choice) => choice.summary.unitType))
                .map((unitType) => normalizeRulesetToken(unitType)),
        );
        if (allowedUnitTypes.size === 0) {
            return [...candidates];
        }

        return candidates.filter((candidate) => allowedUnitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType)));
    }

    private filterCandidatesForRulesetProfile(
        candidates: readonly ForceGenerationCandidateUnit[],
        rulesetProfile: RulesetProfile | null,
    ): ForceGenerationCandidateUnit[] {
        if (!rulesetProfile || rulesetProfile.requiredUnitTypes.size === 0) {
            return [...candidates];
        }

        return candidates.filter((candidate) => {
            return rulesetProfile.requiredUnitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType));
        });
    }

    private pickPreferredEchelon(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
        minUnitCount: number,
        maxUnitCount: number,
    ): string | undefined {
        const targetCount = Math.round((minUnitCount + maxUnitCount) / 2);

        for (const ruleset of rulesetChain) {
            const echelonGroup = ruleset.toc?.echelon;
            const echelonOptions = (echelonGroup?.options ?? [])
                .filter((option) => matchesRulesetWhen(option.when, matchContext));
            if (echelonOptions.length === 0) {
                continue;
            }

            const candidates = echelonOptions.flatMap((option) => getRulesetOptionEchelons(option))
                .map((token) => token.code)
                .filter((echelon): echelon is string => !!echelon);

            if (candidates.length === 0) {
                continue;
            }

            let bestEchelon = candidates[candidates.length - 1];
            let bestScore = Number.POSITIVE_INFINITY;
            for (const echelon of candidates) {
                const knownUnitCount = COMMON_ECHELON_UNIT_COUNTS.get(echelon);
                const score = knownUnitCount === undefined
                    ? Number.POSITIVE_INFINITY
                    : Math.abs(knownUnitCount - targetCount);
                if (score < bestScore) {
                    bestScore = score;
                    bestEchelon = echelon;
                }
            }

            return bestEchelon;
        }

        return undefined;
    }

    private collectRulesetTemplates(
        profile: RulesetProfile,
        forceNode: MegaMekRulesetForceNode,
        matchContext: RulesetMatchContext,
        rulesetContext: ResolvedRulesetContext,
        forceEra: Era | null,
        limit: number,
        depth: number,
        visited: Set<string>,
    ): number {
        if (limit <= 0 || depth > 4) {
            return 0;
        }

        let templateCount = 0;
        for (const subforceGroup of [...(forceNode.subforces ?? []), ...(forceNode.attachedForces ?? [])]) {
            if (!matchesRulesetWhen(subforceGroup.when, matchContext)) {
                continue;
            }

            mergeRulesetNodeIntoProfile(profile, subforceGroup.assign);
            const groupRulesetContext = this.resolveSwitchedRulesetContext(
                rulesetContext,
                forceEra,
                subforceGroup.asFactionKey,
                subforceGroup.useParentFaction,
            );
            if (groupRulesetContext.primary && groupRulesetContext.primary.factionKey !== rulesetContext.primary?.factionKey) {
                this.appendRulesetNote(profile, `Subforce rules switched to ${groupRulesetContext.primary.factionKey}.`);
            }

            for (const subforceOptionGroup of subforceGroup.subforceOptions ?? []) {
                if (!matchesRulesetWhen(subforceOptionGroup.when, matchContext)) {
                    continue;
                }

                const matchingOptions = (subforceOptionGroup.options ?? [])
                    .filter((option) => matchesRulesetWhen(option.when, matchContext));
                if (matchingOptions.length === 0) {
                    continue;
                }

                const selectedOption = pickWeightedRandomEntry(matchingOptions, (option) => (option.weight ?? 1));
                templateCount += this.applySubforceNodeToProfile(
                    profile,
                    selectedOption,
                    matchContext,
                    groupRulesetContext,
                    forceEra,
                    limit - templateCount,
                    depth + 1,
                    visited,
                );
                if (templateCount >= limit) {
                    return templateCount;
                }
            }

            for (const directSubforce of subforceGroup.subforces ?? []) {
                if (!matchesRulesetWhen(directSubforce.when, matchContext)) {
                    continue;
                }

                templateCount += this.applySubforceNodeToProfile(
                    profile,
                    directSubforce,
                    matchContext,
                    groupRulesetContext,
                    forceEra,
                    limit - templateCount,
                    depth + 1,
                    visited,
                );
                if (templateCount >= limit) {
                    return templateCount;
                }
            }
        }

        return templateCount;
    }

    private applySubforceNodeToProfile(
        profile: RulesetProfile,
        node: MegaMekRulesetSubforceNode,
        parentMatchContext: RulesetMatchContext,
        baseRulesetContext: ResolvedRulesetContext,
        forceEra: Era | null,
        limit: number,
        depth: number,
        visited: Set<string>,
    ): number {
        if (limit <= 0) {
            return 0;
        }

        mergeRulesetNodeIntoProfile(profile, node);
        mergeRulesetNodeIntoProfile(profile, node.assign);

        const nodeRulesetContext = this.resolveSwitchedRulesetContext(
            baseRulesetContext,
            forceEra,
            node.asFactionKey,
            node.useParentFaction,
        );
        if (nodeRulesetContext.primary && nodeRulesetContext.primary.factionKey !== baseRulesetContext.primary?.factionKey) {
            this.appendRulesetNote(profile, `Nested subforce rules switched to ${nodeRulesetContext.primary.factionKey}.`);
        }

        let templateCount = 0;
        const repeatCount = Math.max(1, Math.floor(node.count ?? 1));
        const template = createRulesetTemplate(node);
        for (let index = 0; template && index < repeatCount && templateCount < limit; index += 1) {
            profile.templates.push(template);
            templateCount += 1;
        }

        const childMatchContext = this.buildSubforceMatchContext(parentMatchContext, node, nodeRulesetContext);
        const visitationKey = [
            nodeRulesetContext.primary?.factionKey ?? 'none',
            childMatchContext.echelon ?? '',
            childMatchContext.unitType ?? '',
            childMatchContext.weightClass ?? '',
            childMatchContext.role ?? '',
            childMatchContext.motive ?? '',
        ].join('|');
        if (visited.has(visitationKey) || nodeRulesetContext.chain.length === 0) {
            return templateCount;
        }

        visited.add(visitationKey);
        const childForceNode = findMatchingForceNode(nodeRulesetContext.chain, childMatchContext);
        if (childForceNode) {
            applyForceNodeToProfile(profile, childForceNode, childMatchContext);
            templateCount += this.collectRulesetTemplates(
                profile,
                childForceNode,
                childMatchContext,
                nodeRulesetContext,
                forceEra,
                limit - templateCount,
                depth,
                visited,
            );
        }
        visited.delete(visitationKey);

        return templateCount;
    }

    private buildSubforceMatchContext(
        parentMatchContext: RulesetMatchContext,
        node: MegaMekRulesetSubforceNode,
        rulesetContext: ResolvedRulesetContext,
    ): RulesetMatchContext {
        const assign = node.assign;
        const matchContext: RulesetMatchContext = {
            ...parentMatchContext,
            unitType: node.unitTypes?.[0] ?? assign?.unitTypes?.[0] ?? parentMatchContext.unitType,
            weightClass: node.weightClasses?.[0] ?? assign?.weightClasses?.[0] ?? parentMatchContext.weightClass,
            role: node.roles?.[0] ?? assign?.roles?.[0] ?? parentMatchContext.role,
            motive: node.motives?.[0] ?? assign?.motives?.[0] ?? parentMatchContext.motive,
            echelon: node.echelon?.code
                ?? assign?.echelon?.code
                ?? parentMatchContext.echelon,
            augmented: node.augmented ?? assign?.augmented ?? parentMatchContext.augmented,
            factionKey: rulesetContext.primary?.factionKey ?? parentMatchContext.factionKey,
            topLevel: false,
        };

        if (!matchContext.echelon && rulesetContext.chain.length > 0) {
            matchContext.echelon = this.pickPreferredEchelon(rulesetContext.chain, matchContext, 1, 1);
        }

        return matchContext;
    }

    private resolveSwitchedRulesetContext(
        currentContext: ResolvedRulesetContext,
        forceEra: Era | null,
        asFactionKey?: string,
        useParentFaction?: boolean,
    ): ResolvedRulesetContext {
        if (asFactionKey) {
            return this.resolveRulesetContextByFactionKey(asFactionKey, forceEra);
        }

        if (useParentFaction) {
            const parentFactionKey = this.resolveParentFactionKey(currentContext);
            return this.resolveRulesetContextByFactionKey(parentFactionKey, forceEra);
        }

        return currentContext;
    }

    private resolveParentFactionKey(currentContext: ResolvedRulesetContext): string | undefined {
        const primaryFactionKey = currentContext.primary?.factionKey;
        if (!primaryFactionKey) {
            return currentContext.chain[1]?.factionKey;
        }

        const megaMekFaction = this.dataService.getMegaMekFactionByKey(primaryFactionKey);
        for (const fallbackFactionKey of megaMekFaction?.fallBackFactions ?? []) {
            if (fallbackFactionKey !== primaryFactionKey && this.dataService.getMegaMekRulesetByFactionKey(fallbackFactionKey)) {
                return fallbackFactionKey;
            }
        }

        if (currentContext.primary?.parentFactionKey && this.dataService.getMegaMekRulesetByFactionKey(currentContext.primary.parentFactionKey)) {
            return currentContext.primary.parentFactionKey;
        }

        return currentContext.chain[1]?.factionKey;
    }

    private appendRulesetNote(profile: RulesetProfile, note: string): void {
        if (!profile.explanationNotes.includes(note)) {
            profile.explanationNotes.push(note);
        }
    }

    private evaluateSelectionStructure(
        selectionAttempt: ForceGenerationSelectionAttempt,
        context: ForceGenerationContext,
    ): ForceGenerationStructureEvaluation | null {
        const evaluationStartedAt = getForceGeneratorNow();
        this.formationComputationAttempts += 1;

        try {
            const preferredOrgType = selectionAttempt.rulesetProfile?.preferredOrgType;
            if (!preferredOrgType || !context.forceFaction || selectionAttempt.selectedCandidates.length === 0) {
                return null;
            }

            const resolvedGroups = resolveFromUnits(
                selectionAttempt.selectedCandidates.map((candidate) => candidate.unit),
                context.forceFaction,
                context.forceEra,
            ).sort(compareResolvedOrgGroups);
            if (resolvedGroups.length === 0) {
                return {
                    score: 0,
                    perfectMatch: false,
                    summary: `Resolved org shape: none. Does not match requested ${preferredOrgType}.`,
                };
            }

            const topGroup = resolvedGroups[0];
            const matchedExactGroup = resolvedGroups.find((group) => group.type === preferredOrgType);
            const matchedCountsAsGroup = matchedExactGroup
                ? undefined
                : resolvedGroups.find((group) => group.countsAsType === preferredOrgType);
            const matchedGroup = matchedExactGroup ?? matchedCountsAsGroup;
            const exactMatch = topGroup.type === preferredOrgType;
            const countsAsMatch = topGroup.countsAsType === preferredOrgType;
            const anyExactMatch = matchedExactGroup !== undefined;
            const anyCountsAsMatch = matchedCountsAsGroup !== undefined;
            const preferredUnitCount = selectionAttempt.rulesetProfile?.preferredUnitCount;
            const unitCountDistance = preferredUnitCount === undefined
                ? 0
                : Math.abs(selectionAttempt.selectedCandidates.length - preferredUnitCount);

            let score = 0;
            if (exactMatch) {
                score = 4;
            } else if (countsAsMatch) {
                score = 3.5;
            } else if (anyExactMatch) {
                score = 2.5;
            } else if (anyCountsAsMatch) {
                score = 2;
            }

            score -= unitCountDistance * 0.15;
            score -= Math.max(0, resolvedGroups.length - 1) * 0.1;

            const relation = exactMatch
                ? `Matches requested ${preferredOrgType}.`
                : countsAsMatch
                    ? `Counts as requested ${preferredOrgType}.`
                    : anyExactMatch
                        ? `Matches requested ${preferredOrgType}.`
                        : anyCountsAsMatch
                            ? `Counts as requested ${preferredOrgType}.`
                            : `Does not match requested ${preferredOrgType}.`;
            const summaryGroup = matchedGroup ?? topGroup;
            const topGroupNote = matchedGroup && matchedGroup !== topGroup
                ? ` (top group ${getResolvedOrgGroupLabel(topGroup)})`
                : '';

            return {
                score,
                perfectMatch: resolvedGroups.length === 1 && (exactMatch || countsAsMatch),
                summary: `Resolved org shape: ${getResolvedOrgGroupLabel(summaryGroup)}${topGroupNote}. ${relation}`,
            };
        } finally {
            this.formationComputationElapsedMs += Math.max(0, getForceGeneratorNow() - evaluationStartedAt);
        }
    }

}
