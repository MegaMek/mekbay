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

import { Injectable, OnDestroy, inject } from '@angular/core';

import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { ForcePreviewEntry, ForcePreviewGroup } from '../models/force-preview.model';
import type { MegaMekWeightedAvailabilityRecord } from '../models/megamek/availability.model';
import type {
    MegaMekRulesetAssign,
    MegaMekRulesetEchelonToken,
    MegaMekRulesetForceNode,
    MegaMekRulesetNodeBase,
    MegaMekRulesetOptionGroup,
    MegaMekRulesetOptionNode,
    MegaMekRulesetRecord,
    MegaMekRulesetRuleGroup,
    MegaMekRulesetSubforceGroup,
    MegaMekRulesetSubforceNode,
    MegaMekRulesetWhen,
} from '../models/megamek/rulesets.model';
import { LoadForceEntry } from '../models/load-force-entry.model';
import { MAX_UNITS as FORCE_MAX_UNITS } from '../models/force.model';
import { MULFACTION_EXTINCT, MULFACTION_MERCENARY } from '../models/mulfactions.model';
import type { Options } from '../models/options.model';
import { getUnitsAverageTechBase } from '../models/tech.model';
import type { Unit } from '../models/units.model';
import { resolveOrgDefinition } from '../utils/org/org-registry.util';
import { resolveFromGroups, resolveFromUnits } from '../utils/org/org-solver.util';
import { LanceTypeIdentifierUtil, type FormationGroupLike } from '../utils/lance-type-identifier.util';
import { FormationRequirementEngine } from '../utils/formation-requirement-engine.util';
import type { FormationConstraint, FormationEvaluation, FormationSearchDecision } from '../utils/formation-requirement.model';
import { getFormationBlueprint } from '../utils/formation-blueprints';
import type { FormationTypeDefinition } from '../utils/formation-type.model';
import type { FormationUnitLike } from '../utils/formation-unit-facts.util';
import { collectGroupUnits } from '../utils/org/org-facts.util';
import type { GroupSizeResult, OrgDefinition, OrgRuleDefinition, OrgType } from '../utils/org/org-types';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { getEffectivePilotingSkill } from '../utils/cbt-common.util';
import { resolveDropdownNamesFromFilter } from '../utils/filter-name-resolution.util';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { PVCalculatorUtil } from '../utils/pv-calculator.util';
import { normalizeMultiStateSelection } from '../utils/unit-search-shared.util';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';
import { TagsService } from './tags.service';
import { generateUUID } from './ws.service';

/**
 * Author: Drake
 */
const LOG_ATTEMPTS = false;
const FORCE_GENERATION_OPTIMIZE_SELECTED_SKILLS_FOR_BUDGET = true;
const FORCE_GENERATION_SKILL_OPTIMIZATION_STATE_LIMIT = 5_000;
const DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT = 1;
const FORCE_GENERATION_PRODUCTION_SOURCE_ROLL_WEIGHT = 5;
const FORCE_GENERATION_SALVAGE_SOURCE_ROLL_WEIGHT = 1;
const IMPLICIT_MULTI_FACTION_EXCLUDED_IDS = new Set<number>([MULFACTION_EXTINCT]);
const DEFAULT_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS = 300;
const MIN_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS = 300;
const MAX_FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS = 5000;
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

interface RulesetPreferenceSource {
    unitTypes?: string[];
    weightClasses?: string[];
    roles?: string[];
    motives?: string[];
}

interface ForceGenerationCandidateUnit {
    unit: Unit;
    requisitionWeight: number;
    salvageWeight: number;
    cost: number;
    alias?: string;
    commander?: boolean;
    skill?: number;
    gunnery?: number;
    piloting?: number;
    lockKey?: string;
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
    keyByUnitName: ReadonlyMap<string, string>;
}

type ForceGenerationAvailabilitySource = 'requisition' | 'salvage';

type ForceGenerationForceNodeSelectionMode = 'first' | 'weighted';

interface ForceGenerationAvailabilityPair {
    eraId: number;
    factionId: number;
}

interface RulesetMatchContext {
    year?: number;
    unitType?: string;
    weightClass?: string;
    role?: string;
    motive?: string;
    echelon?: string;
    factionKey?: string;
    augmented?: boolean;
    topLevel?: boolean;
    flags?: readonly string[];
}

interface ForceGenerationRulesetTemplate {
    unitTypes: Set<string>;
    weightClasses: Set<string>;
    roles: Set<string>;
    motives: Set<string>;
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
    weightsByUnitName: Map<string, { requisition: number; salvage: number }>;
}

interface ForceGenerationPreparedCandidateCache {
    signature: string;
    candidates: readonly ForceGenerationCandidateUnit[];
}

interface ForceGenerationBaseCandidateUnit {
    unit: Unit;
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
    factionIdTexts: readonly string[];
    factionIdTextSet: ReadonlySet<string>;
    pairCount: number;
}

interface ForceGenerationAvailabilityReductionState {
    requisitionMax: number;
    salvageMax: number;
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

interface ForceGenerationRulesetProfile {
    selectedEchelon?: string;
    preferredOrgType?: OrgType;
    preferredUnitCount?: number;
    requiredUnitTypes: Set<string>;
    preferredUnitTypes: Set<string>;
    preferredWeightClasses: Set<string>;
    preferredRoles: Set<string>;
    preferredMotives: Set<string>;
    templates: ForceGenerationRulesetTemplate[];
    explanationNotes: string[];
}

interface ResolvedRulesetContext {
    primary: MegaMekRulesetRecord | null;
    chain: MegaMekRulesetRecord[];
}

interface ForceGenerationSelectionStep {
    unit: Unit;
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
    rulesetProfile: ForceGenerationRulesetProfile | null;
    structureEvaluation?: ForceGenerationStructureEvaluation;
    targetFormationGroups?: ForceGenerationTargetFormationCandidateGroup[];
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

interface ForcePreviewEntryBuildMetrics {
    totalMs: number;
    targetGroupBuildMs: number;
    targetFormationGroupValidationMs: number;
    targetRemainingGroupBuildMs: number;
    targetFormationValidationMs: number;
    fallbackGroupBuildMs: number;
    previewGroupOrgResolveMs: number;
    previewGroupFormationMatchMs: number;
    previewGroupFormationMatchCacheHits: number;
    previewGroupFormationMatchCacheMisses: number;
}

interface TargetFormationPreviewGroupBuildResult {
    groups: ForcePreviewGroup[];
    validationMs: number;
    remainingGroupBuildMs: number;
}

interface PreviewGroupBuildMetrics {
    orgResolveMs: number;
    formationMatchMs: number;
    formationMatchCacheHits: number;
    formationMatchCacheMisses: number;
}

interface ForceGenerationSelectionPreparation {
    rulesetProfile: ForceGenerationRulesetProfile | null;
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

interface ForceGenerationSearchDeadline {
    expiresAtMs: number;
}

interface ForceGenerationSkillBudgetPlanningCosts {
    minCostByCandidate: ReadonlyMap<ForceGenerationCandidateUnit, number>;
    maxCostByCandidate: ReadonlyMap<ForceGenerationCandidateUnit, number>;
}

interface ForceGenerationTargetFormationBudgetReachabilityContext {
    lowestCostCandidatePool: readonly ForceGenerationCandidateUnit[];
}

interface ForceGenerationSkillOptimizationState {
    totalCost: number;
    selectedCandidates: ForceGenerationCandidateUnit[];
}

interface ForceGenerationTargetAttemptRank {
    satisfiedTargetCount: number;
    requestedTargetCount: number;
    formationDeficitScore: number;
    budgetDistance: number;
    unitCountDistance: number;
}

interface ForceGenerationSkillSettings {
    gunnery: ForceGenerationSkillRange;
    piloting: ForceGenerationSkillRange;
    maxDelta: number;
}

interface ForceGenerationClassicSkillPair {
    gunnery: number;
    piloting: number;
}

interface ForceGenerationStructureEvaluation {
    score: number;
    perfectMatch: boolean;
    summary: string;
}

interface ForceGenerationForceNodeSelection {
    forceNode?: MegaMekRulesetForceNode;
    matchContext: RulesetMatchContext;
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
    eligibleUnits?: readonly Unit[];
    gameSystem: GameSystem;
    budgetRange: ForceGenerationBudgetRange;
    minUnitCount: number;
    maxUnitCount: number;
    gunnery: number;
    piloting: number;
    skillRanges?: ForceGenerationSkillRanges;
    lockedUnits?: readonly GeneratedForceUnit[];
    preventDuplicateChassis?: boolean;
    useTaggedQuantities?: boolean;
    useUnitTagsAsChassisTags?: boolean;
    targetFormationId?: string;
    targetFormations?: readonly ForceGenerationTargetFormationSelection[];
}

export interface ForceGenerationSkillRange {
    min: number;
    max: number;
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
    unit: Unit;
    cost: number;
    skill?: number;
    gunnery?: number;
    piloting?: number;
    alias?: string;
    commander?: boolean;
    lockKey?: string;
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
    metrics: PreviewGroupBuildMetrics;
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

function createGeneratedUnitQueues(generatedUnits: readonly GeneratedForceUnit[]): Map<Unit, GeneratedForceUnit[]> {
    const queueByUnit = new Map<Unit, GeneratedForceUnit[]>();

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
    units: readonly Unit[],
    queueByUnit: Map<Unit, GeneratedForceUnit[]>,
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

function countQueuedGeneratedUnits(queueByUnit: ReadonlyMap<Unit, readonly GeneratedForceUnit[]>): number {
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
    return {
        formationId,
        units: generatedUnits.map((generatedUnit) => ({
            unit: generatedUnit.unit,
            destroyed: false,
            gunnery: gameSystem === GameSystem.CLASSIC ? generatedUnit.gunnery : undefined,
            piloting: gameSystem === GameSystem.CLASSIC ? generatedUnit.piloting : undefined,
            skill: gameSystem === GameSystem.ALPHA_STRIKE ? generatedUnit.skill : undefined,
            alias: generatedUnit.alias,
            commander: generatedUnit.commander,
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
        getUnit: () => generatedUnit.unit,
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
        const formationMatchStartedAt = getForceGeneratorNow();
        bestMatch = getBestPreviewFormationMatch(orderedGeneratedUnits, resolvedGroup, context) ?? null;
        context.metrics.formationMatchMs += Math.max(0, getForceGeneratorNow() - formationMatchStartedAt);
        context.metrics.formationMatchCacheMisses += 1;
        context.formationMatchCache.set(formationMatchCacheKey, bestMatch);
    } else {
        context.metrics.formationMatchCacheHits += 1;
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
                    const childResolveStartedAt = getForceGeneratorNow();
                    resolvedChildGroups = resolveFromUnits(
                        childGeneratedUnits.map((generatedUnit) => generatedUnit.unit),
                        context.faction,
                        context.era,
                    );
                    context.metrics.orgResolveMs += Math.max(0, getForceGeneratorNow() - childResolveStartedAt);
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
    const unitResolveStartedAt = getForceGeneratorNow();
    const resolvedUnitGroups = resolveFromUnits(
        generatedUnits.map((generatedUnit) => generatedUnit.unit),
        context.faction,
        context.era,
    );
    context.metrics.orgResolveMs += Math.max(0, getForceGeneratorNow() - unitResolveStartedAt);
    const resolvedGroups = resolvedUnitGroups.length > 1
        ? (() => {
            const groupResolveStartedAt = getForceGeneratorNow();
            const groups = resolveFromGroups(resolvedUnitGroups, context.faction, context.era);
            context.metrics.orgResolveMs += Math.max(0, getForceGeneratorNow() - groupResolveStartedAt);
            return groups;
        })()
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

function isForceGenerationSkillRangeVariable(range: ForceGenerationSkillRange): boolean {
    return range.min !== range.max;
}

function hasVariableForceGenerationSkillSettings(
    gameSystem: GameSystem,
    settings: ForceGenerationSkillSettings,
): boolean {
    return isForceGenerationSkillRangeVariable(settings.gunnery)
        || (gameSystem === GameSystem.CLASSIC && isForceGenerationSkillRangeVariable(settings.piloting));
}

function pickRandomIntegerInRange(range: ForceGenerationSkillRange): number {
    if (range.min === range.max) {
        return range.min;
    }

    return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
}

function getForceGenerationClassicSkillPairs(
    settings: ForceGenerationSkillSettings,
    unit?: Unit,
): ForceGenerationClassicSkillPair[] {
    const pairs: ForceGenerationClassicSkillPair[] = [];
    const pairKeys = new Set<string>();

    for (let gunnery = settings.gunnery.min; gunnery <= settings.gunnery.max; gunnery += 1) {
        for (let requestedPiloting = settings.piloting.min; requestedPiloting <= settings.piloting.max; requestedPiloting += 1) {
            const piloting = unit ? getEffectivePilotingSkill(unit, requestedPiloting) : requestedPiloting;
            if (Math.abs(gunnery - piloting) <= settings.maxDelta) {
                const pairKey = `${gunnery}:${piloting}`;
                if (!pairKeys.has(pairKey)) {
                    pairKeys.add(pairKey);
                    pairs.push({ gunnery, piloting });
                }
            }
        }
    }

    return pairs;
}

function hasValidForceGenerationSkillSettings(
    gameSystem: GameSystem,
    settings: ForceGenerationSkillSettings,
): boolean {
    return gameSystem !== GameSystem.CLASSIC || getForceGenerationClassicSkillPairs(settings).length > 0;
}

function formatForceGenerationSkillRange(range: ForceGenerationSkillRange): string {
    return range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`;
}

function formatForceGenerationSkillSettingsNote(
    gameSystem: GameSystem,
    skillSettings: ForceGenerationSkillSettings,
): string {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
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
        units: group.units.map((unit) => ({ ...unit })),
    }));
}

function resolveBudgetRangeWithEditedMin(
    range: ForceGenerationBudgetRange,
    editedMin: number,
): ForceGenerationBudgetRange {
    const nextMin = normalizeBudgetBound(editedMin);
    const currentMax = normalizeBudgetBound(range.max);

    return {
        min: nextMin,
        max: currentMax > 0 ? Math.max(nextMin, currentMax) : 0,
    };
}

function resolveBudgetRangeWithEditedMax(
    range: ForceGenerationBudgetRange,
    editedMax: number,
): ForceGenerationBudgetRange {
    const currentMin = normalizeBudgetBound(range.min);
    const nextMax = normalizeBudgetBound(editedMax);

    return {
        min: nextMax > 0 ? Math.min(currentMin, nextMax) : currentMin,
        max: nextMax,
    };
}

function resolveUnitCountRangeWithEditedMin(
    range: ForceGeneratorUnitCountDefaults,
    editedMin: number,
): ForceGeneratorUnitCountDefaults {
    const nextMin = normalizeUnitCountBound(editedMin);
    const currentMax = normalizeUnitCountBound(range.max);

    return {
        min: nextMin,
        max: Math.max(nextMin, currentMax),
    };
}

function resolveUnitCountRangeWithEditedMax(
    range: ForceGeneratorUnitCountDefaults,
    editedMax: number,
): ForceGeneratorUnitCountDefaults {
    const currentMin = normalizeUnitCountBound(range.min);
    const nextMax = normalizeUnitCountBound(editedMax);

    return {
        min: Math.min(currentMin, nextMax),
        max: nextMax,
    };
}

function getBudgetMetric(unit: Unit, gameSystem: GameSystem, gunnery: number, piloting: number): number {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        return Math.max(0, PVCalculatorUtil.calculateAdjustedPV(unit.as.PV, gunnery));
    }

    return Math.max(0, BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, getEffectivePilotingSkill(unit, piloting)));
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

function getPositiveRulesetValues(values: readonly string[] | undefined): string[] {
    return (values ?? []).filter((value) => !value.startsWith('!'));
}

function getFirstPositiveRulesetValue(values: readonly string[] | undefined): string | undefined {
    return getPositiveRulesetValues(values)[0];
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

function pickWeightedRandomEntry<T>(entries: readonly T[], getWeight: (entry: T) => number): T {
    if (entries.length === 1) {
        return entries[0];
    }

    const weights = entries.map((entry) => Math.max(0, getWeight(entry)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight <= 0) {
        return entries[Math.floor(Math.random() * entries.length)];
    }

    let cursor = Math.random() * totalWeight;
    for (let index = 0; index < entries.length; index++) {
        cursor -= weights[index];
        if (cursor <= 0) {
            return entries[index];
        }
    }

    return entries[entries.length - 1];
}

function normalizeRulesetToken(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeRole(value: string | undefined): string | undefined {
    return value?.trim().toLowerCase() || undefined;
}

function normalizeSelectionKey(value: string | undefined): string {
    return value?.trim().toLowerCase() || '';
}

function buildDuplicateChassisKey(unit: Pick<Unit, 'chassis' | 'type'>): string {
    const chassisKey = normalizeSelectionKey(unit.chassis);
    if (chassisKey.length === 0) {
        return '';
    }

    const typeKey = normalizeSelectionKey(unit.type);
    return typeKey.length > 0 ? `${chassisKey}|${typeKey}` : chassisKey;
}

function buildTaggedQuantityUnitKey(unit: Unit): string {
    return `unit:${normalizeSelectionKey(unit.name)}`;
}

function buildTaggedQuantityChassisKey(unit: Unit): string {
    const chassisKey = normalizeSelectionKey(TagsService.getChassisTagKey(unit));
    return chassisKey.length > 0 ? `chassis:${chassisKey}` : buildTaggedQuantityUnitKey(unit);
}

function buildAvailabilityPairKey(eraId: number, factionId: number): string {
    return `${eraId}:${factionId}`;
}

function serializeForceGenerationCacheIds(ids: readonly number[]): string {
    return [...new Set(ids)].sort((left, right) => left - right).join(',');
}

function buildForceGenerationUnitListSignature(units: readonly Pick<Unit, 'name'>[]): string {
    return [units.length, ...units.map((unit) => unit.name)].join('\u001f');
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

function getRulesetEchelonCode(token: MegaMekRulesetEchelonToken | undefined): string | undefined {
    return token?.code;
}

function getRulesetOptionWeight(node: Pick<MegaMekRulesetNodeBase, 'weight'> | undefined): number {
    return node?.weight ?? 1;
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

function getForceGeneratorNow(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }

    return Date.now();
}

function formatForceGenerationUnitLabel(unit: Pick<Unit, 'chassis' | 'model'>): string {
    const model = unit.model.trim();
    return model.length > 0 ? `${unit.chassis} ${model}` : unit.chassis;
}

function formatForceGenerationSkillSummary(
    gameSystem: GameSystem,
    step: Pick<ForceGenerationSelectionStep, 'skill' | 'gunnery' | 'piloting'>,
): string | null {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        return step.skill === undefined ? null : `Skill ${step.skill}`;
    }

    return step.gunnery === undefined || step.piloting === undefined
        ? null
        : `G/P ${step.gunnery}/${step.piloting}`;
}

function toMegaMekUnitType(unit: Unit): string {
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

function toMegaMekWeightClass(unit: Unit): string | undefined {
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

function toMegaMekMotive(unit: Unit): string | undefined {
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
    private lastPreviewEntryBuildMetrics: ForcePreviewEntryBuildMetrics | null = null;

    public ngOnDestroy(): void {
        this.clearGenerationCaches();
    }

    public resolveInitialBudgetDefaults(
        options: Pick<Options,
            'forceGenLastBVMin'
            | 'forceGenLastBVMax'
            | 'forceGenLastPVMin'
            | 'forceGenLastPVMax'>,
        unitSearchLimit: number,
        unitSearchGameSystem: GameSystem,
    ): ForceGeneratorBudgetDefaults {
        const hasUnitSearchLimit = Number.isFinite(unitSearchLimit) && unitSearchLimit > 0;

        return {
            classic: normalizeInitialBudgetRange(
                options.forceGenLastBVMin,
                unitSearchGameSystem === GameSystem.CLASSIC && hasUnitSearchLimit
                    ? unitSearchLimit
                    : options.forceGenLastBVMax,
            ),
            alphaStrike: normalizeInitialBudgetRange(
                options.forceGenLastPVMin,
                unitSearchGameSystem === GameSystem.ALPHA_STRIKE && hasUnitSearchLimit
                    ? unitSearchLimit
                    : options.forceGenLastPVMax,
            ),
        };
    }

    public resolveInitialUnitCountDefaults(
        options: Pick<Options,
            'forceGenLastMinUnitCount'
            | 'forceGenLastMaxUnitCount'>,
    ): ForceGeneratorUnitCountDefaults {
        return normalizeInitialUnitCountRange(
            options.forceGenLastMinUnitCount,
            options.forceGenLastMaxUnitCount,
        );
    }

    public resolveInitialSkillDefaults(
        options: Pick<Options,
            'forceGenLastGunnerySkillMin'
            | 'forceGenLastGunnerySkillMax'
            | 'forceGenLastPilotingSkillMin'
            | 'forceGenLastPilotingSkillMax'
            | 'forceGenLastMaxPilotSkillDelta'>,
    ): ForceGeneratorSkillDefaults {
        return {
            gunnery: normalizeForceGenerationSkillRange({
                min: options.forceGenLastGunnerySkillMin,
                max: options.forceGenLastGunnerySkillMax,
            }, 4),
            piloting: normalizeForceGenerationSkillRange({
                min: options.forceGenLastPilotingSkillMin,
                max: options.forceGenLastPilotingSkillMax,
            }, 5),
            maxDelta: normalizeForceGenerationMaxSkillDelta(options.forceGenLastMaxPilotSkillDelta),
        };
    }

    public getStoredBudgetOptionKeys(gameSystem: GameSystem): {
        min: 'forceGenLastBVMin' | 'forceGenLastPVMin';
        max: 'forceGenLastBVMax' | 'forceGenLastPVMax';
    } {
        return gameSystem === GameSystem.ALPHA_STRIKE
            ? { min: 'forceGenLastPVMin', max: 'forceGenLastPVMax' }
            : { min: 'forceGenLastBVMin', max: 'forceGenLastBVMax' };
    }

    public getStoredUnitCountOptionKeys(): {
        min: 'forceGenLastMinUnitCount';
        max: 'forceGenLastMaxUnitCount';
    } {
        return {
            min: 'forceGenLastMinUnitCount',
            max: 'forceGenLastMaxUnitCount',
        };
    }

    public getStoredSkillOptionKeys(): {
        gunneryMin: 'forceGenLastGunnerySkillMin';
        gunneryMax: 'forceGenLastGunnerySkillMax';
        pilotingMin: 'forceGenLastPilotingSkillMin';
        pilotingMax: 'forceGenLastPilotingSkillMax';
        maxDelta: 'forceGenLastMaxPilotSkillDelta';
    } {
        return {
            gunneryMin: 'forceGenLastGunnerySkillMin',
            gunneryMax: 'forceGenLastGunnerySkillMax',
            pilotingMin: 'forceGenLastPilotingSkillMin',
            pilotingMax: 'forceGenLastPilotingSkillMax',
            maxDelta: 'forceGenLastMaxPilotSkillDelta',
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

    public getBudgetMetric(unit: Unit, gameSystem: GameSystem, gunnery: number, piloting: number): number {
        return getBudgetMetric(unit, gameSystem, gunnery, piloting);
    }

    public resolveGenerationContext(
        eligibleUnits: readonly Unit[],
        options: ForceGenerationContextOptions = {},
    ): ForceGenerationContext {
        const selectedEras = this.resolveSelectedEras();
        const excludedEraIds = this.resolveExcludedEraIds();
        const selectedFactions = this.resolveSelectedFactions();
        const excludedFactionIds = this.resolveExcludedFactionIds();
        const crossEraAvailabilityInMultiEraSelection = options.crossEraAvailabilityInMultiEraSelection ?? false;
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
                : this.dataService.getFactionById(MULFACTION_MERCENARY) ?? null);
        const forceEra = this.resolveContextEra(
            selectedEras,
            excludedEraIds,
            selectedFactions.length > 0 || targetFormationFaction ? forceFaction : null,
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
            : this.resolveAvailabilityFactionIds(
                selectedFactions,
                excludedFactionIds,
                availablePairs,
                availabilityEraIds,
            );
        const useAvailabilityFactionScope = targetFormationFaction
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
        const availabilityWeightCache = this.resolveAvailabilityWeightCache(eligibleUnits, options.context);

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
        const lockedCandidates = (options.lockedUnits ?? []).map((lockedUnit) => this.createCandidateUnit(
            lockedUnit.unit,
            options.context,
            options,
            {
                ...lockedUnit,
                lockKey: lockedUnit.lockKey ?? generateUUID(),
            },
            availabilityWeightCache,
        ));
        const lockedUnitNames = new Set(lockedCandidates.map((candidate) => candidate.unit.name));
        const taggedQuantityCaps = options.useTaggedQuantities === true && options.preventDuplicateChassis !== true
            ? this.resolveTaggedQuantityCaps(eligibleUnits, maxUnitCount, options.useUnitTagsAsChassisTags === true)
            : null;
        const useTaggedQuantityCaps = (taggedQuantityCaps?.capByKey.size ?? 0) > 0;
        const allowUnlimitedDuplicateUnits = options.preventDuplicateChassis !== true && !useTaggedQuantityCaps;
        const lockedTaggedQuantityCounts = useTaggedQuantityCaps && taggedQuantityCaps
            ? this.countTaggedQuantityCandidates(lockedCandidates, taggedQuantityCaps)
            : new Map<string, number>();
        const unlockedEligibleUnits = eligibleUnits.filter((unit) => !lockedUnitNames.has(unit.name));
        const preparedCandidateCache = this.resolvePreparedCandidateCache(
            eligibleUnits,
            options.context,
            options,
            availabilityWeightCache,
        );
        const availabilityCandidates = lockedUnitNames.size === 0 || useTaggedQuantityCaps
            ? preparedCandidateCache.candidates
            : preparedCandidateCache.candidates.filter((candidate) => !lockedUnitNames.has(candidate.unit.name));
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
        const availableMatchedPairCopyCapacity = targetFormationContext && !useTaggedQuantityCaps && !allowUnlimitedDuplicateUnits
            ? this.countMatchedPairCopyCapacity(
                targetFormationContext.definition,
                [...lockedCandidates, ...availabilityCandidates],
                options,
                maxUnitCount,
            )
            : 0;
        const availableUnitCapacity = useTaggedQuantityCaps
            ? lockedCandidates.length + this.countTaggedQuantityCapacity(
                eligibleUnits,
                (unit) => unit,
                taggedQuantityCaps!,
                lockedTaggedQuantityCounts,
                maxUnitCount,
            )
            : allowUnlimitedDuplicateUnits
                ? (eligibleUnits.length > 0 ? maxUnitCount : lockedCandidates.length)
                : unlockedEligibleUnits.length + lockedCandidates.length + availableMatchedPairCopyCapacity;

        if (availableUnitCapacity < minUnitCount) {
            const message = lockedCandidates.length > 0
                ? `Only ${availableUnitCapacity} total units are available after preserving ${lockedCandidates.length} locked ${lockedCandidates.length === 1 ? 'unit' : 'units'}.`
                : `Only ${eligibleUnits.length} eligible units match the current filters.`;

            if (lockedCandidates.length > 0) {
                return this.buildPreviewFromSelectionAttempt(
                    options,
                    eligibleUnits.length,
                    availableUnitCapacity,
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
                availableUnitCapacity,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                message,
                candidates,
            );
        }

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
        const selectableCandidateCapacity = allowUnlimitedDuplicateUnits
            ? (skillCompatibleCandidates.length > 0 ? maxUnitCount : lockedCandidates.length)
            : availableCandidateCapacity;

        if (selectableCandidateCapacity < minUnitCount) {
            const message = lockedCandidates.length > 0
                ? `Only ${selectableCandidateCapacity} total units are available after preserving ${lockedCandidates.length} locked ${lockedCandidates.length === 1 ? 'unit' : 'units'}.`
                : candidates.length < availabilityCandidates.length
                    ? `Only ${candidates.length} availability-positive units can satisfy the selected skill ranges with max delta ${skillSettings.maxDelta}.`
                    : this.getPositiveAvailabilityMessage(candidates.length, options.context);

            if (lockedCandidates.length > 0) {
                return this.buildPreviewFromSelectionAttempt(
                    options,
                    eligibleUnits.length,
                    selectableCandidateCapacity,
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
                selectableCandidateCapacity,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                message,
                candidates,
            );
        }

        const hasResolvedRuleset = this.resolveRulesetContext(options.context.forceFaction, options.context.forceEra).primary !== null;
        const didFilterCandidatesForSkills = candidates.length !== availabilityCandidates.length;
        const canReuseSelectionPreparationCache = !hasVariableSkillSettings
            && !didFilterCandidatesForSkills
            && lockedCandidates.length === 0
            && !useTaggedQuantityCaps
            && !hasResolvedRuleset;
        const selectionPreparation = hasVariableSkillSettings
            ? undefined
            : (canReuseSelectionPreparationCache
                ? this.resolveSelectionPreparationCache(
                    preparedCandidateCache,
                    options.context,
                    minUnitCount,
                    maxUnitCount,
                )
                : this.prepareSelectionPreparation(
                    candidates,
                    lockedCandidates,
                    options.context,
                    minUnitCount,
                    maxUnitCount,
                ));

        if (targetFormationContext) {
            const failureSearchWindowMs = this.resolveFailureSearchWindowMs();
            const targetAttemptBudget = this.createAttemptBudget(candidates.length, minUnitCount, maxUnitCount);
            const targetSearchStartedAt = getForceGeneratorNow();
            const targetSearchDeadline = this.createSearchDeadline(targetSearchStartedAt, failureSearchWindowMs);
            let targetAttemptDurationEstimateMs = 0;
            let targetAttemptLimit = targetAttemptBudget.minAttempts;
            let targetAttemptsTried = 0;
            let bestTargetAttempt: ForceGenerationSelectionAttempt | null = null;
            let bestTargetRank: ForceGenerationTargetAttemptRank | null = null;

            for (let attempt = 0; attempt < targetAttemptLimit; attempt += 1) {
                if (this.hasSearchDeadlineExpired(targetSearchDeadline)) {
                    break;
                }
                const attemptStartedAt = getForceGeneratorNow();
                targetAttemptsTried = attempt + 1;
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
                    selectionPreparation,
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
                const targetValid = formationValid && this.isBudgetWithinRange(targetTotalCost, budgetRange);
                const targetRank: ForceGenerationTargetAttemptRank = {
                    satisfiedTargetCount: formationValid ? 1 : 0,
                    requestedTargetCount: 1,
                    formationDeficitScore: this.getFormationDeficitScore(targetEvaluation),
                    budgetDistance: this.getBudgetRangeDistance(targetTotalCost, budgetRange),
                    unitCountDistance: this.getUnitCountRangeDistance(targetAttempt.selectedCandidates.length, minUnitCount, maxUnitCount),
                };

                if (this.isTargetFormationAttemptBetter(targetRank, bestTargetRank)) {
                    bestTargetAttempt = optimizedTargetAttempt;
                    bestTargetRank = targetRank;
                }

                this.logTargetFormationAttemptDiagnostics(
                    'single',
                    attempt + 1,
                    optimizedTargetAttempt.selectedCandidates,
                    targetRank,
                    budgetRange,
                    null,
                    this.hasSearchDeadlineExpired(targetSearchDeadline),
                );

                if (targetValid) {
                    return this.buildPreviewFromSelectionAttempt(
                        options,
                        eligibleUnits.length,
                        availableCandidateCapacity,
                        budgetRange,
                        minUnitCount,
                        maxUnitCount,
                        optimizedTargetAttempt,
                        null,
                        undefined,
                        candidates,
                        targetAttemptsTried,
                        getForceGeneratorNow() - previewStartedAt,
                    );
                }

                if (this.hasSearchDeadlineExpired(targetSearchDeadline)) {
                    break;
                }

                const attemptDurationMs = Math.max(0.05, getForceGeneratorNow() - attemptStartedAt);
                targetAttemptDurationEstimateMs = this.updateAttemptDurationEstimate(targetAttemptDurationEstimateMs, attemptDurationMs, targetAttemptsTried);
                targetAttemptLimit = this.resolveAttemptLimit(
                    targetAttemptBudget,
                    targetAttemptsTried,
                    targetAttemptDurationEstimateMs,
                    getForceGeneratorNow() - targetSearchStartedAt,
                    false,
                    failureSearchWindowMs,
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
                bestTargetAttempt ?? this.createSelectionAttemptFromCandidates(lockedCandidates, selectionPreparation?.rulesetProfile ?? null),
                targetMessage,
                targetMessage,
                candidates,
                targetAttemptsTried,
                getForceGeneratorNow() - previewStartedAt,
            );
        }

        if (targetFormationSetContext) {
            const failureSearchWindowMs = this.resolveFailureSearchWindowMs();
            const targetAttemptBudget = this.createAttemptBudget(candidates.length, minUnitCount, maxUnitCount);
            const targetSearchStartedAt = getForceGeneratorNow();
            const targetSearchDeadline = this.createSearchDeadline(targetSearchStartedAt, failureSearchWindowMs);
            let targetAttemptDurationEstimateMs = 0;
            let targetAttemptLimit = targetAttemptBudget.minAttempts;
            let targetAttemptsTried = 0;
            let bestTargetAttempt: ForceGenerationSelectionAttempt | null = null;
            let bestTargetEvaluation: ForceGenerationTargetFormationSetAttemptEvaluation | null = null;

            for (let attempt = 0; attempt < targetAttemptLimit; attempt += 1) {
                if (this.hasSearchDeadlineExpired(targetSearchDeadline)) {
                    break;
                }
                const attemptStartedAt = getForceGeneratorNow();
                targetAttemptsTried = attempt + 1;
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
                );
                const targetEvaluation = this.evaluateTargetFormationSetAttempt(
                    optimizedTargetAttempt,
                    options,
                    targetFormationSetContext,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                );

                if (this.isTargetFormationAttemptBetter(targetEvaluation.rank, bestTargetEvaluation?.rank ?? null)) {
                    bestTargetAttempt = optimizedTargetAttempt;
                    bestTargetEvaluation = targetEvaluation;
                }

                this.logTargetFormationAttemptDiagnostics(
                    'multi',
                    attempt + 1,
                    optimizedTargetAttempt.selectedCandidates,
                    targetEvaluation.rank,
                    budgetRange,
                    targetEvaluation.message,
                    this.hasSearchDeadlineExpired(targetSearchDeadline),
                );

                if (targetEvaluation.allTargetsSatisfied && targetEvaluation.budgetValid && targetEvaluation.unitCountValid) {
                    return this.buildPreviewFromSelectionAttempt(
                        options,
                        eligibleUnits.length,
                        availableCandidateCapacity,
                        budgetRange,
                        minUnitCount,
                        maxUnitCount,
                        optimizedTargetAttempt,
                        null,
                        undefined,
                        candidates,
                        targetAttemptsTried,
                        getForceGeneratorNow() - previewStartedAt,
                    );
                }

                if (this.hasSearchDeadlineExpired(targetSearchDeadline)) {
                    break;
                }

                const attemptDurationMs = Math.max(0.05, getForceGeneratorNow() - attemptStartedAt);
                targetAttemptDurationEstimateMs = this.updateAttemptDurationEstimate(targetAttemptDurationEstimateMs, attemptDurationMs, targetAttemptsTried);
                targetAttemptLimit = this.resolveAttemptLimit(
                    targetAttemptBudget,
                    targetAttemptsTried,
                    targetAttemptDurationEstimateMs,
                    getForceGeneratorNow() - targetSearchStartedAt,
                    bestTargetEvaluation !== null
                        && bestTargetEvaluation.allTargetsSatisfied
                        && bestTargetEvaluation.budgetValid
                        && bestTargetEvaluation.unitCountValid,
                    failureSearchWindowMs,
                );
            }

            const fallbackAttempt = bestTargetAttempt
                ?? this.createSelectionAttemptFromCandidates(lockedCandidates, selectionPreparation?.rulesetProfile ?? null);
            const fallbackEvaluation = bestTargetEvaluation
                ?? this.evaluateTargetFormationSetAttempt(
                    fallbackAttempt,
                    options,
                    targetFormationSetContext,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                );
            const fullyValidTargetSuccess = fallbackEvaluation.allTargetsSatisfied
                && fallbackEvaluation.budgetValid
                && fallbackEvaluation.unitCountValid;
            const targetFormationError = fullyValidTargetSuccess
                ? null
                : fallbackEvaluation.message;
            const targetFormationResultNote = fullyValidTargetSuccess
                ? undefined
                : fallbackEvaluation.message;

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
                targetAttemptsTried,
                getForceGeneratorNow() - previewStartedAt,
            );
        }

        if (this.isFirstCompatibleResultBudgetRequest(options.budgetRange)) {
            const firstCompatibleSearchStartedAt = getForceGeneratorNow();
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
            ? effectiveFallbackCandidates.map((candidate) => this.createLowestCostCandidateForSkillSettings(
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
        let bestAttemptTotalCost = Number.POSITIVE_INFINITY;
        let bestAttemptExceedsMax = true;
        let bestAttemptUnitCountDistance = Number.POSITIVE_INFINITY;
        let bestValidAttempt: ForceGenerationSelectionAttempt | null = null;
        let bestValidAttemptNumber: number | null = null;
        let bestValidMidpointDistance = Number.POSITIVE_INFINITY;
        let bestValidStructureScore = Number.NEGATIVE_INFINITY;
        const successfulAttempts: ForceGenerationSuccessfulAttemptLog[] = [];
        const failureSearchWindowMs = this.resolveFailureSearchWindowMs();
        let attemptDurationEstimateMs = 0;
        let attemptLimit = attemptBudget.minAttempts;
        let attemptsTried = 0;

        for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
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
            );
            const selectionAttempt = this.optimizeSelectionAttemptSkillsForBudget(
                rawSelectionAttempt,
                options.gameSystem,
                skillSettings,
                budgetRange,
            );
            const totalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
            const attemptExceedsMax = Number.isFinite(budgetRange.max) && totalCost > budgetRange.max;
            const attemptUnitCountDistance = this.getUnitCountRangeDistance(selectionAttempt.selectedCandidates.length, minUnitCount, maxUnitCount);

            if (
                bestAttempt.selectedCandidates.length === 0
                || (
                    attemptExceedsMax !== bestAttemptExceedsMax
                    && !attemptExceedsMax
                )
                || (
                    attemptExceedsMax === bestAttemptExceedsMax
                    && (
                        (!attemptExceedsMax && totalCost > bestAttemptTotalCost)
                        || (attemptExceedsMax && totalCost < bestAttemptTotalCost)
                    )
                )
                || (
                    attemptExceedsMax === bestAttemptExceedsMax
                    && totalCost === bestAttemptTotalCost
                    && attemptUnitCountDistance < bestAttemptUnitCountDistance
                )
            ) {
                bestAttempt = selectionAttempt;
                bestAttemptTotalCost = totalCost;
                bestAttemptExceedsMax = attemptExceedsMax;
                bestAttemptUnitCountDistance = attemptUnitCountDistance;
            }

            const isValid = selectionAttempt.selectedCandidates.length >= minUnitCount
                && selectionAttempt.selectedCandidates.length <= maxUnitCount
                && this.isBudgetWithinRange(totalCost, budgetRange);
            if (isValid) {
                const structureEvaluation = this.evaluateSelectionStructure(selectionAttempt, options.context);
                if (structureEvaluation) {
                    selectionAttempt.structureEvaluation = structureEvaluation;
                }

                const midpointDistance = Math.abs(totalCost - this.getBudgetTarget(budgetRange));
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
            const budgetLabel = options.gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
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

        return this.buildEmptyPreview(
            options,
            eligibleUnits.length,
            availableCandidateCapacity,
            budgetRange,
            minUnitCount,
            maxUnitCount,
            'Unable to build a force within the selected BV/PV range and unit count constraints.',
            candidates,
            attemptsTried,
                getForceGeneratorNow() - previewStartedAt,
        );
    }

    public createForceEntry(preview: ForceGenerationPreview, name?: string): LoadForceEntry | null {
        const previewEntry = this.createForcePreviewEntry(preview, name);
        if (!previewEntry) {
            return null;
        }

        return new LoadForceEntry({
            ...previewEntry,
            instanceId: `generated-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
            timestamp: new Date().toISOString(),
            groups: clonePreviewGroups(previewEntry.groups),
        });
    }

    public createForcePreviewEntry(preview: ForceGenerationPreview, name?: string): ForcePreviewEntry | null {
        if (preview.units.length === 0) {
            this.lastPreviewEntryBuildMetrics = null;
            return null;
        }

        const previewEntryStartedAt = getForceGeneratorNow();
        const faction = preview.faction ?? null;
        const era = preview.era ?? null;
        const resolvedName = name?.trim() || preview.name?.trim() || ForceNamerUtil.generateForceNameForFaction(faction);
        const previewGroupBuildMetrics: PreviewGroupBuildMetrics = {
            orgResolveMs: 0,
            formationMatchMs: 0,
            formationMatchCacheHits: 0,
            formationMatchCacheMisses: 0,
        };
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
            metrics: previewGroupBuildMetrics,
        };
        const targetGroupStartedAt = getForceGeneratorNow();
        const targetPreviewGroupResult = this.buildTargetFormationPreviewGroups(
            preview.units,
            previewGroupContext,
            preview.targetFormationGroups,
        );
        const targetPreviewGroups = targetPreviewGroupResult?.groups ?? null;
        const targetGroupBuildMs = Math.max(0, getForceGeneratorNow() - targetGroupStartedAt);
        const targetFormationGroupValidationMs = targetPreviewGroupResult?.validationMs ?? 0;
        const targetRemainingGroupBuildMs = targetPreviewGroupResult?.remainingGroupBuildMs ?? 0;

        let targetFormationValidationMs = 0;
        let fallbackGroupBuildMs = 0;
        const previewGroups = targetPreviewGroups ?? (() => {
            if (preview.targetFormationId) {
                const validationStartedAt = getForceGeneratorNow();
                const isValidTargetFormation = this.isGeneratedPreviewValidForFormation(
                    preview.units,
                    previewGroupContext,
                    preview.targetFormationId,
                );
                targetFormationValidationMs = Math.max(0, getForceGeneratorNow() - validationStartedAt);
                if (isValidTargetFormation) {
                    return [createGeneratedPreviewGroup(preview.units, preview.gameSystem, preview.targetFormationId)];
                }
            }

            const fallbackBuildStartedAt = getForceGeneratorNow();
            const fallbackGroups = buildPreviewGroups(preview.units, previewGroupContext);
            fallbackGroupBuildMs = Math.max(0, getForceGeneratorNow() - fallbackBuildStartedAt);
            return fallbackGroups;
        })();

        const previewEntry: ForcePreviewEntry = {
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
            bv: preview.gameSystem === GameSystem.CLASSIC ? preview.totalCost : undefined,
            pv: preview.gameSystem === GameSystem.ALPHA_STRIKE ? preview.totalCost : undefined,
            groups: previewGroups,
        };

        for (const group of previewGroups) {
            group.force = previewEntry;
        }

        this.lastPreviewEntryBuildMetrics = {
            totalMs: Math.max(0, getForceGeneratorNow() - previewEntryStartedAt),
            targetGroupBuildMs,
            targetFormationGroupValidationMs,
            targetRemainingGroupBuildMs,
            targetFormationValidationMs,
            fallbackGroupBuildMs,
            previewGroupOrgResolveMs: previewGroupBuildMetrics.orgResolveMs,
            previewGroupFormationMatchMs: previewGroupBuildMetrics.formationMatchMs,
            previewGroupFormationMatchCacheHits: previewGroupBuildMetrics.formationMatchCacheHits,
            previewGroupFormationMatchCacheMisses: previewGroupBuildMetrics.formationMatchCacheMisses,
        };

        return previewEntry;
    }

    public getLastPreviewEntryBuildMetrics(): ForcePreviewEntryBuildMetrics | null {
        return this.lastPreviewEntryBuildMetrics;
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

    private resolveRemainingFactionIds(excludedFactionIds: ReadonlySet<number>): number[] {
        return this.dataService.getFactions()
            .filter((faction) => {
                return !this.shouldExcludeFactionFromImplicitAvailabilityScope(faction.id)
                    && !excludedFactionIds.has(faction.id);
            })
            .map((faction) => faction.id);
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

        return candidateFactions[0] ?? null;
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
                    && LanceTypeIdentifierUtil.isFormationAvailableForFaction(definition, faction.name)
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
        eligibleUnits: readonly Unit[],
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
        eligibleUnits: readonly Unit[],
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
            ? selectedFactions.filter((faction) => candidateFactionIds.has(faction.id))
            : [...candidateFactionIds]
                .map((factionId) => this.dataService.getFactionById(factionId))
                .filter((faction): faction is Faction => faction !== undefined && faction.id !== MULFACTION_EXTINCT);

        if (candidates.length > 0) {
            return pickWeightedRandomEntry(candidates, () => 1);
        }

        if (selectedFactions.length > 0) {
            return pickWeightedRandomEntry(selectedFactions, () => 1);
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
        unit: Unit,
        context: ForceGenerationContext,
        options: ForceGenerationRequest,
        lockedUnit?: GeneratedForceUnit,
        availabilityWeightCache?: ForceGenerationAvailabilityWeightCache,
    ): ForceGenerationCandidateUnit {
        const availabilityWeights = this.getCachedAvailabilityWeights(unit, context, availabilityWeightCache);
        const baseCandidate = this.createBaseCandidateUnit(unit, options);

        return {
            unit,
            requisitionWeight: availabilityWeights.requisition,
            salvageWeight: availabilityWeights.salvage,
            cost: lockedUnit?.cost ?? baseCandidate.cost,
            alias: lockedUnit?.alias,
            commander: lockedUnit?.commander,
            skill: lockedUnit?.skill ?? baseCandidate.skill,
            gunnery: lockedUnit?.gunnery ?? baseCandidate.gunnery,
            piloting: lockedUnit?.piloting ?? baseCandidate.piloting,
            lockKey: lockedUnit?.lockKey,
            locked: lockedUnit !== undefined,
            megaMekUnitType: baseCandidate.megaMekUnitType,
            megaMekWeightClass: baseCandidate.megaMekWeightClass,
            role: baseCandidate.role,
            motive: baseCandidate.motive,
        };
    }

    private createBaseCandidateUnit(
        unit: Unit,
        options: ForceGenerationRequest,
    ): ForceGenerationBaseCandidateUnit {
        const skillSettings = resolveForceGenerationSkillSettings(options);
        const skill = options.gameSystem === GameSystem.ALPHA_STRIKE
            ? skillSettings.gunnery.min
            : undefined;
        const gunnery = options.gameSystem === GameSystem.CLASSIC
            ? skillSettings.gunnery.min
            : undefined;
        const piloting = options.gameSystem === GameSystem.CLASSIC
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
        eligibleUnits: readonly Unit[],
        maxUnitCount: number,
        useUnitTagsAsChassisTags = false,
    ): ForceGenerationTaggedQuantityCaps {
        const selectedTagKeys = this.resolvePositiveTaggedQuantityFilterKeys(eligibleUnits);
        if (selectedTagKeys.size === 0) {
            return {
                capByKey: new Map<string, number>(),
                keyByUnitName: new Map<string, string>(),
            };
        }

        if (useUnitTagsAsChassisTags) {
            return this.resolveChassisSharedTaggedQuantityCaps(eligibleUnits, selectedTagKeys, maxUnitCount);
        }

        const capByKey = new Map<string, number>();
        const keyByUnitName = new Map<string, string>();
        for (const unit of eligibleUnits) {
            const resolvedCap = this.getTaggedQuantityCapForUnit(unit, selectedTagKeys, maxUnitCount)
                ?? {
                    key: buildTaggedQuantityUnitKey(unit),
                    cap: 1,
                };
            keyByUnitName.set(unit.name, resolvedCap.key);
            capByKey.set(resolvedCap.key, Math.max(capByKey.get(resolvedCap.key) ?? 1, resolvedCap.cap));
        }

        return {
            capByKey,
            keyByUnitName,
        };
    }

    private resolveChassisSharedTaggedQuantityCaps(
        eligibleUnits: readonly Unit[],
        selectedTagKeys: ReadonlySet<string>,
        maxUnitCount: number,
    ): ForceGenerationTaggedQuantityCaps {
        const capByKey = new Map<string, number>();
        const keyByUnitName = new Map<string, string>();

        for (const unit of eligibleUnits) {
            const chassisQuantityCap = this.getTaggedQuantityCapFromEntries(unit._chassisTags, selectedTagKeys, maxUnitCount);
            const unitQuantityCap = this.getTaggedQuantityCapFromEntries(unit._nameTags, selectedTagKeys, maxUnitCount);
            const resolvedCap = Math.max(chassisQuantityCap, unitQuantityCap);
            const resolvedKey = resolvedCap > 0
                ? buildTaggedQuantityChassisKey(unit)
                : buildTaggedQuantityUnitKey(unit);

            keyByUnitName.set(unit.name, resolvedKey);
            capByKey.set(resolvedKey, Math.max(capByKey.get(resolvedKey) ?? 1, resolvedCap || 1));
        }

        return {
            capByKey,
            keyByUnitName,
        };
    }

    private resolvePositiveTaggedQuantityFilterKeys(eligibleUnits: readonly Unit[]): Set<string> {
        const filterState = this.filtersService.effectiveFilterState()['_tags'];
        if (!filterState?.interactedWith) {
            return new Set<string>();
        }

        const resolvedNames = resolveDropdownNamesFromFilter(
            normalizeMultiStateSelection(filterState.value),
            this.collectTaggedQuantityFilterNames(eligibleUnits),
            filterState.wildcardPatterns,
        );

        return new Set(
            [...resolvedNames.or, ...resolvedNames.and]
                .map((tagName) => normalizeSelectionKey(tagName))
                .filter((tagKey) => tagKey.length > 0),
        );
    }

    private collectTaggedQuantityFilterNames(eligibleUnits: readonly Unit[]): string[] {
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
        unit: Unit,
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
        unit: Unit,
        taggedQuantityCaps: ForceGenerationTaggedQuantityCaps,
    ): string | null {
        const mappedKey = taggedQuantityCaps.keyByUnitName.get(unit.name);
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
        getUnit: (item: T) => Unit,
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

        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            const skill = pickRandomIntegerInRange(skillSettings.gunnery);
            return {
                ...candidate,
                cost: getBudgetMetric(candidate.unit, gameSystem, skill, skillSettings.piloting.min),
                skill,
                gunnery: undefined,
                piloting: undefined,
            };
        }

        const classicSkillPairs = getForceGenerationClassicSkillPairs(skillSettings, candidate.unit);
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

    private createSkillAdjustedCandidateOptions(
        candidate: ForceGenerationCandidateUnit,
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationCandidateUnit[] {
        if (candidate.locked || !hasVariableForceGenerationSkillSettings(gameSystem, skillSettings)) {
            return [candidate];
        }

        const options: ForceGenerationCandidateUnit[] = [];
        const optionKeys = new Set<string>();
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            for (let skill = skillSettings.gunnery.min; skill <= skillSettings.gunnery.max; skill += 1) {
                const adjustedCandidate = this.createCandidateWithSpecificSkills(
                    candidate,
                    gameSystem,
                    skill,
                    skillSettings.piloting.min,
                );
                const optionKey = `${adjustedCandidate.cost}:${adjustedCandidate.skill ?? ''}`;
                if (!optionKeys.has(optionKey)) {
                    optionKeys.add(optionKey);
                    options.push(adjustedCandidate);
                }
            }
        } else {
            for (const skillPair of getForceGenerationClassicSkillPairs(skillSettings, candidate.unit)) {
                const adjustedCandidate = this.createCandidateWithSpecificSkills(
                    candidate,
                    gameSystem,
                    skillPair.gunnery,
                    skillPair.piloting,
                );
                const optionKey = `${adjustedCandidate.cost}:${adjustedCandidate.gunnery ?? ''}:${adjustedCandidate.piloting ?? ''}`;
                if (!optionKeys.has(optionKey)) {
                    optionKeys.add(optionKey);
                    options.push(adjustedCandidate);
                }
            }
        }

        return options.length > 0 ? options : [candidate];
    }

    private createSkillBudgetPlanningCosts(
        candidates: readonly ForceGenerationCandidateUnit[],
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationSkillBudgetPlanningCosts | undefined {
        if (!FORCE_GENERATION_OPTIMIZE_SELECTED_SKILLS_FOR_BUDGET || !hasVariableForceGenerationSkillSettings(gameSystem, skillSettings)) {
            return undefined;
        }

        const minCostByCandidate = new Map<ForceGenerationCandidateUnit, number>();
        const maxCostByCandidate = new Map<ForceGenerationCandidateUnit, number>();
        for (const candidate of candidates) {
            const options = this.createSkillAdjustedCandidateOptions(candidate, gameSystem, skillSettings);
            minCostByCandidate.set(candidate, Math.min(...options.map(option => option.cost)));
            maxCostByCandidate.set(candidate, Math.max(...options.map(option => option.cost)));
        }

        return { minCostByCandidate, maxCostByCandidate };
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
    ): ForceGenerationSelectionAttempt {
        if (
            !FORCE_GENERATION_OPTIMIZE_SELECTED_SKILLS_FOR_BUDGET
            || !hasVariableForceGenerationSkillSettings(gameSystem, skillSettings)
            || selectionAttempt.selectedCandidates.length === 0
        ) {
            return selectionAttempt;
        }

        const originalTotalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        const originalState: ForceGenerationSkillOptimizationState = {
            totalCost: originalTotalCost,
            selectedCandidates: selectionAttempt.selectedCandidates,
        };
        const skillOptionsByCandidate = selectionAttempt.selectedCandidates.map((candidate) => (
            this.createSkillAdjustedCandidateOptions(candidate, gameSystem, skillSettings)
        ));
        let states: ForceGenerationSkillOptimizationState[] = [{ totalCost: 0, selectedCandidates: [] }];

        for (const candidateOptions of skillOptionsByCandidate) {
            const nextStatesByCost = new Map<number, ForceGenerationSkillOptimizationState>();
            for (const state of states) {
                for (const candidateOption of candidateOptions) {
                    const nextTotalCost = state.totalCost + candidateOption.cost;
                    if (nextStatesByCost.has(nextTotalCost)) {
                        continue;
                    }
                    nextStatesByCost.set(nextTotalCost, {
                        totalCost: nextTotalCost,
                        selectedCandidates: [...state.selectedCandidates, candidateOption],
                    });
                }
            }

            states = this.pruneSkillOptimizationStates([...nextStatesByCost.values()], budgetRange);
        }

        const bestState = states.reduce((best, state) => (
            this.compareSkillOptimizationStates(state, best, budgetRange) < 0 ? state : best
        ), originalState);
        if (this.compareSkillOptimizationStates(bestState, originalState, budgetRange) >= 0) {
            return selectionAttempt;
        }

        return {
            ...selectionAttempt,
            selectedCandidates: bestState.selectedCandidates,
            selectionSteps: selectionAttempt.selectionSteps.map((step, index) => {
                const candidate = bestState.selectedCandidates[index];
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

    private pruneSkillOptimizationStates(
        states: ForceGenerationSkillOptimizationState[],
        budgetRange: { min: number; max: number },
    ): ForceGenerationSkillOptimizationState[] {
        if (states.length <= FORCE_GENERATION_SKILL_OPTIMIZATION_STATE_LIMIT) {
            return states;
        }

        return states
            .sort((left, right) => this.compareSkillOptimizationStates(left, right, budgetRange))
            .slice(0, FORCE_GENERATION_SKILL_OPTIMIZATION_STATE_LIMIT);
    }

    private compareSkillOptimizationStates(
        left: ForceGenerationSkillOptimizationState,
        right: ForceGenerationSkillOptimizationState,
        budgetRange: { min: number; max: number },
    ): number {
        const leftInRange = this.isBudgetWithinRange(left.totalCost, budgetRange);
        const rightInRange = this.isBudgetWithinRange(right.totalCost, budgetRange);
        if (leftInRange !== rightInRange) {
            return leftInRange ? -1 : 1;
        }

        const leftDistance = this.getBudgetRangeDistance(left.totalCost, budgetRange);
        const rightDistance = this.getBudgetRangeDistance(right.totalCost, budgetRange);
        if (leftDistance !== rightDistance) {
            return leftDistance - rightDistance;
        }

        return Math.abs(left.totalCost - this.getBudgetTarget(budgetRange))
            - Math.abs(right.totalCost - this.getBudgetTarget(budgetRange));
    }

    private createCandidateWithSpecificSkills(
        candidate: ForceGenerationCandidateUnit,
        gameSystem: GameSystem,
        gunnery: number,
        piloting: number,
    ): ForceGenerationCandidateUnit {
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            return {
                ...candidate,
                cost: getBudgetMetric(candidate.unit, gameSystem, gunnery, piloting),
                skill: gunnery,
                gunnery: undefined,
                piloting: undefined,
            };
        }

        const effectivePiloting = getEffectivePilotingSkill(candidate.unit, piloting);
        return {
            ...candidate,
            cost: getBudgetMetric(candidate.unit, gameSystem, gunnery, effectivePiloting),
            skill: undefined,
            gunnery,
            piloting: effectivePiloting,
        };
    }

    private createLowestCostCandidateForSkillSettings(
        candidate: ForceGenerationCandidateUnit,
        gameSystem: GameSystem,
        skillSettings: ForceGenerationSkillSettings,
    ): ForceGenerationCandidateUnit {
        let lowestCostCandidate: ForceGenerationCandidateUnit | null = null;

        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            for (let skill = skillSettings.gunnery.min; skill <= skillSettings.gunnery.max; skill += 1) {
                const adjustedCandidate = this.createCandidateWithSpecificSkills(
                    candidate,
                    gameSystem,
                    skill,
                    skillSettings.piloting.min,
                );
                if (!lowestCostCandidate || adjustedCandidate.cost < lowestCostCandidate.cost) {
                    lowestCostCandidate = adjustedCandidate;
                }
            }
        } else {
            for (const skillPair of getForceGenerationClassicSkillPairs(skillSettings, candidate.unit)) {
                const adjustedCandidate = this.createCandidateWithSpecificSkills(
                    candidate,
                    gameSystem,
                    skillPair.gunnery,
                    skillPair.piloting,
                );
                if (!lowestCostCandidate || adjustedCandidate.cost < lowestCostCandidate.cost) {
                    lowestCostCandidate = adjustedCandidate;
                }
            }
        }

        return lowestCostCandidate ?? candidate;
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
        if (gameSystem !== GameSystem.CLASSIC) {
            return candidates;
        }

        return candidates.filter((candidate) => {
            return getForceGenerationClassicSkillPairs(skillSettings, candidate.unit).length > 0;
        });
    }

    private resolveAvailabilityWeightCache(
        eligibleUnits: readonly Unit[],
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
        eligibleUnits: readonly Unit[],
    ): ForceGenerationAvailabilityWeightCache {
        const unitsByMulId = new Map<number, Unit[]>();
        for (const unit of eligibleUnits) {
            const unitsForMulId = unitsByMulId.get(unit.id) ?? [];
            unitsForMulId.push(unit);
            unitsByMulId.set(unit.id, unitsForMulId);
        }

        const weightsByUnitName = useMegaMekAvailability
            ? this.buildMegaMekAvailabilityWeightMap(scopeState, eligibleUnits)
            : this.buildMulAvailabilityWeightMap(scopeState, eligibleUnits, unitsByMulId);

        return {
            signature,
            useMegaMekAvailability,
            scopeState,
            weightsByUnitName,
        };
    }

    private buildMegaMekAvailabilityWeightMap(
        scopeState: ForceGenerationAvailabilityScopeState,
        eligibleUnits: readonly Unit[],
        exactPairKeysByUnitName?: Map<string, Set<string>>,
        includeUnknownForMissingRecords = true,
    ): Map<string, { requisition: number; salvage: number }> {
        const weightsByUnitName = new Map<string, { requisition: number; salvage: number }>();
        if (scopeState.pairCount <= 0) {
            if (includeUnknownForMissingRecords) {
                for (const unit of eligibleUnits) {
                    weightsByUnitName.set(unit.name, {
                        requisition: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                        salvage: 0,
                    });
                }
            }
            return weightsByUnitName;
        }

        const exactEraIdText = scopeState.eraIdTexts.length === 1 ? scopeState.eraIdTexts[0] : null;
        const exactFactionIdText = scopeState.factionIdTexts.length === 1 ? scopeState.factionIdTexts[0] : null;
        const exactPairKey = exactEraIdText !== null && exactFactionIdText !== null
            ? `${exactEraIdText}:${exactFactionIdText}`
            : null;

        for (const unit of eligibleUnits) {
            const record = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            if (!record) {
                if (includeUnknownForMissingRecords) {
                    weightsByUnitName.set(unit.name, {
                        requisition: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                        salvage: 0,
                    });
                }
                continue;
            }

            if (exactEraIdText !== null && exactFactionIdText !== null) {
                const exactWeights = {
                    requisition: record.e[exactEraIdText]?.[exactFactionIdText]?.[0] ?? 0,
                    salvage: record.e[exactEraIdText]?.[exactFactionIdText]?.[1] ?? 0,
                };
                const exactValue = record.e[exactEraIdText]?.[exactFactionIdText];
                weightsByUnitName.set(unit.name, exactWeights);

                if (exactValue && exactPairKeysByUnitName && exactPairKey !== null) {
                    exactPairKeysByUnitName.set(unit.name, new Set<string>([exactPairKey]));
                }

                continue;
            }

            let requisitionMax = 0;
            let salvageMax = 0;
            let exactPairKeys: Set<string> | undefined;

            for (const eraIdText of scopeState.eraIdTexts) {
                const eraAvailability = record.e[eraIdText];
                if (!eraAvailability) {
                    continue;
                }

                for (const factionIdText in eraAvailability) {
                    if (!scopeState.factionIdTextSet.has(factionIdText)) {
                        continue;
                    }

                    if (exactPairKeysByUnitName) {
                        exactPairKeys ??= new Set<string>();
                        exactPairKeys.add(`${eraIdText}:${factionIdText}`);
                    }

                    const value = eraAvailability[factionIdText];
                    const requisition = value[0] ?? 0;
                    const salvage = value[1] ?? 0;
                    if (requisition > requisitionMax) {
                        requisitionMax = requisition;
                    }
                    if (salvage > salvageMax) {
                        salvageMax = salvage;
                    }
                }
            }

            weightsByUnitName.set(unit.name, {
                requisition: requisitionMax,
                salvage: salvageMax,
            });

            if (exactPairKeysByUnitName && exactPairKeys && exactPairKeys.size > 0) {
                exactPairKeysByUnitName.set(unit.name, exactPairKeys);
            }
        }

        return weightsByUnitName;
    }

    private buildMulAvailabilityWeightMap(
        scopeState: ForceGenerationAvailabilityScopeState,
        eligibleUnits: readonly Unit[],
        unitsByMulId: ReadonlyMap<number, readonly Unit[]>,
    ): Map<string, { requisition: number; salvage: number }> {
        if (scopeState.pairCount <= 0) {
            const zeroWeightsByUnitName = new Map<string, { requisition: number; salvage: number }>();
            for (const unit of eligibleUnits) {
                zeroWeightsByUnitName.set(unit.name, {
                    requisition: 0,
                    salvage: 0,
                });
            }
            return zeroWeightsByUnitName;
        }

        const exactPairKeysByUnitName = new Map<string, Set<string>>();
        const weightsByUnitName = this.buildMegaMekAvailabilityWeightMap(
            scopeState,
            eligibleUnits,
            exactPairKeysByUnitName,
            false,
        );

        for (const pair of scopeState.pairs) {
            const forceFaction = this.dataService.getFactionById(pair.factionId);
            const forceEra = this.dataService.getEraById(pair.eraId);
            if (!forceFaction || !forceEra) {
                continue;
            }

            const pairKey = buildAvailabilityPairKey(pair.eraId, pair.factionId);
            const mulUnitIds = this.unitAvailabilitySource.getFactionEraUnitIds(forceFaction, forceEra, 'mul');
            for (const unitIdText of mulUnitIds) {
                const unitId = Number(unitIdText);
                const matchingUnits = Number.isNaN(unitId) ? undefined : unitsByMulId.get(unitId);
                if (!matchingUnits?.length) {
                    continue;
                }

                for (const unit of matchingUnits) {
                    if (exactPairKeysByUnitName.get(unit.name)?.has(pairKey)) {
                        continue;
                    }

                    const exactValue = this.dataService.getMegaMekAvailabilityRecordForUnit(unit)?.e[String(pair.eraId)]?.[String(pair.factionId)];
                    if (exactValue !== undefined) {
                        const weights = weightsByUnitName.get(unit.name) ?? {
                            requisition: 0,
                            salvage: 0,
                        };
                        const requisition = exactValue[0] ?? 0;
                        const salvage = exactValue[1] ?? 0;
                        if (requisition > weights.requisition) {
                            weights.requisition = requisition;
                        }
                        if (salvage > weights.salvage) {
                            weights.salvage = salvage;
                        }
                        weightsByUnitName.set(unit.name, weights);
                        continue;
                    }

                    const existingScopedWeights = weightsByUnitName.get(unit.name);
                    if (existingScopedWeights) {
                        if (existingScopedWeights.requisition < DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT) {
                            existingScopedWeights.requisition = DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT;
                        }
                        continue;
                    }

                    weightsByUnitName.set(unit.name, {
                        requisition: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                        salvage: 0,
                    });
                }
            }
        }

        for (const unit of eligibleUnits) {
            if (!weightsByUnitName.has(unit.name)) {
                weightsByUnitName.set(unit.name, {
                    requisition: 0,
                    salvage: 0,
                });
            }
        }

        return weightsByUnitName;
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
            factionIdTexts: factionIds.map((factionId) => String(factionId)),
            factionIdTextSet: new Set(factionIds.map((factionId) => String(factionId))),
            pairCount: pairs.length,
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
            `source:${useMegaMekAvailability ? 'megamek' : 'mul'}`,
            `weightEras:${serializeForceGenerationCacheIds(resolvedScopeState.eraIds)}`,
            `weightFactions:${serializeForceGenerationCacheIds(resolvedScopeState.factionIds)}`,
        ].join('|');
    }

    private getCachedAvailabilityWeights(
        unit: Unit,
        context: ForceGenerationContext,
        availabilityWeightCache?: ForceGenerationAvailabilityWeightCache,
    ): { requisition: number; salvage: number } {
        const cachedWeights = availabilityWeightCache?.weightsByUnitName.get(unit.name);
        if (cachedWeights !== undefined) {
            return cachedWeights;
        }

        const computedWeights = this.getAvailabilityWeights(unit, context, availabilityWeightCache?.scopeState);
        availabilityWeightCache?.weightsByUnitName.set(unit.name, computedWeights);
        return computedWeights;
    }

    private resolvePreparedCandidateCache(
        eligibleUnits: readonly Unit[],
        context: ForceGenerationContext,
        options: ForceGenerationRequest,
        availabilityWeightCache: ForceGenerationAvailabilityWeightCache,
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
        eligibleUnits: readonly Unit[],
        options: ForceGenerationRequest,
        availabilityWeightCache: ForceGenerationAvailabilityWeightCache,
    ): string {
        return [
            availabilityWeightCache.signature,
            `eligible:${buildForceGenerationUnitListSignature(eligibleUnits)}`,
            `game:${options.gameSystem}`,
            `skills:${buildForceGenerationSkillSettingsSignature(options)}`,
        ].join('|');
    }

    private buildPreparedCandidateCache(
        signature: string,
        eligibleUnits: readonly Unit[],
        context: ForceGenerationContext,
        options: ForceGenerationRequest,
        availabilityWeightCache: ForceGenerationAvailabilityWeightCache,
    ): ForceGenerationPreparedCandidateCache {
        const baseCandidateCache = this.resolveBaseCandidateCache(eligibleUnits, options);
        const candidates: ForceGenerationCandidateUnit[] = [];

        for (const baseCandidate of baseCandidateCache.candidates) {
            const availabilityWeights = this.getCachedAvailabilityWeights(
                baseCandidate.unit,
                context,
                availabilityWeightCache,
            );

            if (availabilityWeights.requisition <= 0 && availabilityWeights.salvage <= 0) {
                continue;
            }

            candidates.push({
                unit: baseCandidate.unit,
                requisitionWeight: availabilityWeights.requisition,
                salvageWeight: availabilityWeights.salvage,
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
        eligibleUnits: readonly Unit[],
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
        eligibleUnits: readonly Unit[],
        options: ForceGenerationRequest,
    ): string {
        return [
            `eligible:${buildForceGenerationUnitListSignature(eligibleUnits)}`,
            `game:${options.gameSystem}`,
            `skills:${buildForceGenerationSkillSettingsSignature(options)}`,
        ].join('|');
    }

    private buildBaseCandidateCache(
        signature: string,
        eligibleUnits: readonly Unit[],
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
    ): ForceGenerationSelectionPreparation {
        const rulesetProfile = this.buildRulesetProfile(
            [...preselectedCandidates, ...candidates],
            context,
            minUnitCount,
            maxUnitCount,
        );
        const selectableCandidates = this.filterCandidatesForRulesetProfile(candidates, rulesetProfile);
        const lowestCostCandidates = [...selectableCandidates].sort((left, right) => left.cost - right.cost);
        const highestCostCandidates = [...lowestCostCandidates].reverse();
        const rulesetScoreByCandidate = new Map<ForceGenerationCandidateUnit, number>();
        const rulesetReasonsByCandidate = new Map<ForceGenerationCandidateUnit, string[]>();

        if (rulesetProfile) {
            for (const candidate of [...preselectedCandidates, ...selectableCandidates]) {
                rulesetScoreByCandidate.set(candidate, this.getRulesetMatchScore(candidate, rulesetProfile));
                rulesetReasonsByCandidate.set(candidate, this.getRulesetMatchReasons(candidate, rulesetProfile));
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
    ): ForceGenerationSelectionPreparation {
        const signature = this.buildSelectionPreparationCacheSignature(
            preparedCandidateCache,
            context,
            minUnitCount,
            maxUnitCount,
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
    ): string {
        return [
            preparedCandidateCache.signature,
            `forceFaction:${context.forceFaction?.id ?? 'none'}`,
            `forceEra:${context.forceEra?.id ?? 'none'}`,
            `ruleset:${context.ruleset?.factionKey ?? 'none'}`,
            `min:${minUnitCount}`,
            `max:${maxUnitCount}`,
        ].join('|');
    }

    private getAvailabilityWeights(
        unit: Unit,
        context: ForceGenerationContext,
        availabilityScopeState?: ForceGenerationAvailabilityScopeState,
    ): { requisition: number; salvage: number } {
        const useMegaMekAvailability = this.unitAvailabilitySource.useMegaMekAvailability();
        const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
        return this.getScopedAvailabilityWeights(
            unit,
            context,
            availabilityRecord,
            useMegaMekAvailability,
            availabilityScopeState,
        );
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

        return context.forceFaction
            ? [context.forceFaction.id]
            : context.availabilityFactionIds.length > 0
                ? [context.availabilityFactionIds[0]]
                : [];
    }

    private getScopedAvailabilityWeights(
        unit: Unit,
        context: ForceGenerationContext,
        availabilityRecord: MegaMekWeightedAvailabilityRecord | undefined,
        useMegaMekAvailability: boolean,
        availabilityScopeState?: ForceGenerationAvailabilityScopeState,
    ): { requisition: number; salvage: number } {
        const scopeState = availabilityScopeState ?? this.buildAvailabilityScopeState(context);
        if (scopeState.pairCount <= 0) {
            return useMegaMekAvailability
                ? {
                    requisition: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                    salvage: 0,
                }
                : {
                    requisition: 0,
                    salvage: 0,
                };
        }

        if (!availabilityRecord && useMegaMekAvailability) {
            return {
                requisition: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                salvage: 0,
            };
        }

        if (useMegaMekAvailability) {
            return this.reduceMegaMekScopedAvailabilityWeights(availabilityRecord, scopeState);
        }

        return this.reduceScopedAvailabilityWeights(
            scopeState,
            (eraId, factionId) => {
                return availabilityRecord
                    ? this.getAvailabilityWeightsForPair(
                        unit,
                        availabilityRecord,
                        eraId,
                        factionId,
                        useMegaMekAvailability,
                    )
                    : this.getMissingAvailabilityWeightsForPair(unit, eraId, factionId, useMegaMekAvailability);
            },
        );
    }

    private createAvailabilityReductionState(): ForceGenerationAvailabilityReductionState {
        return {
            requisitionMax: 0,
            salvageMax: 0,
        };
    }

    private accumulateAvailabilityReductionState(
        state: ForceGenerationAvailabilityReductionState,
        weights: { requisition: number; salvage: number },
    ): void {
        this.accumulateAvailabilityReductionValues(state, weights.requisition, weights.salvage);
    }

    private accumulateAvailabilityReductionValues(
        state: ForceGenerationAvailabilityReductionState,
        requisition: number,
        salvage: number,
    ): void {
        if (requisition > state.requisitionMax) {
            state.requisitionMax = requisition;
        }

        if (salvage > state.salvageMax) {
            state.salvageMax = salvage;
        }
    }

    private finalizeAvailabilityReductionState(
        state: ForceGenerationAvailabilityReductionState,
    ): { requisition: number; salvage: number } {
        return {
            requisition: state.requisitionMax,
            salvage: state.salvageMax,
        };
    }

    private reduceScopedAvailabilityWeights(
        scopeState: ForceGenerationAvailabilityScopeState,
        getPairWeights: (eraId: number, factionId: number) => { requisition: number; salvage: number },
    ): { requisition: number; salvage: number } {
        const state = this.createAvailabilityReductionState();

        for (const eraId of scopeState.eraIds) {
            for (const factionId of scopeState.factionIds) {
                this.accumulateAvailabilityReductionState(state, getPairWeights(eraId, factionId));
            }
        }

        return this.finalizeAvailabilityReductionState(state);
    }

    private reduceMegaMekScopedAvailabilityWeights(
        availabilityRecord: MegaMekWeightedAvailabilityRecord | undefined,
        scopeState: ForceGenerationAvailabilityScopeState,
    ): { requisition: number; salvage: number } {
        if (!availabilityRecord) {
            return {
                requisition: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                salvage: 0,
            };
        }

        const state = this.createAvailabilityReductionState();

        for (const eraIdText of scopeState.eraIdTexts) {
            const eraAvailability = availabilityRecord.e[eraIdText];
            if (!eraAvailability) {
                continue;
            }

            for (const factionIdText in eraAvailability) {
                if (!scopeState.factionIdTextSet.has(factionIdText)) {
                    continue;
                }

                const value = eraAvailability[factionIdText];
                this.accumulateAvailabilityReductionValues(state, value[0] ?? 0, value[1] ?? 0);
            }
        }

        return this.finalizeAvailabilityReductionState(state);
    }

    private getMissingAvailabilityWeightsForPair(
        unit: Unit,
        eraId: number,
        factionId: number,
        useMegaMekAvailability: boolean,
    ): { requisition: number; salvage: number } {
        if (useMegaMekAvailability) {
            return {
                requisition: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                salvage: 0,
            };
        }

        return this.getMulFallbackWeightsForPair(unit, eraId, factionId) ?? {
            requisition: 0,
            salvage: 0,
        };
    }

    private getAvailabilityWeightsForPair(
        unit: Unit,
        availabilityRecord: MegaMekWeightedAvailabilityRecord,
        eraId: number,
        factionId: number,
        useMegaMekAvailability: boolean,
    ): { requisition: number; salvage: number } {
        const exactValue = availabilityRecord.e[String(eraId)]?.[String(factionId)];

        if (useMegaMekAvailability || exactValue) {
            return {
                requisition: exactValue?.[0] ?? 0,
                salvage: exactValue?.[1] ?? 0,
            };
        }

        const mulFallbackWeights = this.getMulFallbackWeightsForPair(unit, eraId, factionId);
        if (mulFallbackWeights) {
            return mulFallbackWeights;
        }

        return {
            requisition: 0,
            salvage: 0,
        };
    }

    private getMulFallbackWeightsForPair(
        unit: Unit,
        eraId: number,
        factionId: number,
    ): { requisition: number; salvage: number } | null {
        const forceFaction = this.dataService.getFactionById(factionId);
        const forceEra = this.dataService.getEraById(eraId);
        if (!forceFaction || !forceEra) {
            return null;
        }

        const mulUnitIds = this.unitAvailabilitySource.getFactionEraUnitIds(forceFaction, forceEra, 'mul');
        const mulUnitKey = this.unitAvailabilitySource.getUnitAvailabilityKey(unit, 'mul');
        if (!mulUnitIds.has(mulUnitKey)) {
            return null;
        }

        return {
            requisition: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
            salvage: 0,
        };
    }

    private createGeneratedUnit(candidate: ForceGenerationCandidateUnit): GeneratedForceUnit {
        return {
            unit: candidate.unit,
            cost: candidate.cost,
            skill: candidate.skill,
            gunnery: candidate.gunnery,
            piloting: candidate.piloting,
            alias: candidate.alias,
            commander: candidate.commander,
            lockKey: candidate.lockKey ?? generateUUID(),
        };
    }

    private buildPreviewExplanation(
        gameSystem: GameSystem,
        eligibleUnitCount: number,
        candidateUnitCount: number,
        context: ForceGenerationContext,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        skillSettings: ForceGenerationSkillSettings,
        selectionAttempt: ForceGenerationSelectionAttempt | null,
        error: string | null,
        lockedUnitCount: number,
        preventDuplicateChassis: boolean,
        availabilitySourceCandidates: readonly ForceGenerationCandidateUnit[] = [],
        attemptsTried?: number,
        attemptsElapsedMs?: number,
    ): string[] {
        const lines: string[] = [];
        const budgetLabel = gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
        const maxLabel = Number.isFinite(budgetRange.max) ? budgetRange.max.toLocaleString() : 'no max';
        const availabilitySourceRollNote = this.getAvailabilitySourceRollNote(availabilitySourceCandidates);
        lines.push(`Eligible units: ${eligibleUnitCount} units. Availability-positive candidates: ${candidateUnitCount} units. Target: ${minUnitCount}-${maxUnitCount} units, ${budgetLabel} ${budgetRange.min.toLocaleString()} to ${maxLabel}.`);
        lines.push(formatForceGenerationSkillSettingsNote(gameSystem, skillSettings));

        if (lockedUnitCount > 0) {
            lines.push(`Locked units: ${lockedUnitCount} preserved across rerolls.`);
        }
        if (preventDuplicateChassis) {
            lines.push('Duplicate chassis prevention: enabled.');
        }

        const contextParts = [context.forceFaction?.name, context.forceEra?.name].filter(Boolean);
        const weightScopeNote = this.getAvailabilityWeightScopeNote(context);
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
            lines.push('Ruleset guidance: none resolved, so picks used weighted search only.');
            if (availabilitySourceRollNote) {
                lines.push(availabilitySourceRollNote);
            }
        }

        for (const [index, step] of (selectionAttempt?.selectionSteps ?? []).entries()) {
            const skillSummary = formatForceGenerationSkillSummary(gameSystem, step);
            const skillNote = skillSummary ? `, ${skillSummary}` : '';
            if (step.locked) {
                const reasons = step.rulesetReasons.length > 0
                    ? `; ruleset bias ${step.rulesetReasons.join(', ')}`
                    : '';
                lines.push(
                    `${index + 1}. ${formatForceGenerationUnitLabel(step.unit)}: locked, P ${formatForceGeneratorWeight(step.requisitionWeight)} / S ${formatForceGeneratorWeight(step.salvageWeight)}${skillNote}, ${step.cost.toLocaleString()} ${budgetLabel}${reasons}.`,
                );
                continue;
            }

            const fallbackNote = step.usedFallbackSource && step.source !== step.rolledSource
                ? `; rolled ${step.rolledSource} but used ${step.source}`
                : '';
            const reasons = step.rulesetReasons.length > 0
                ? `; ruleset bias ${step.rulesetReasons.join(', ')}`
                : '';
            lines.push(
                `${index + 1}. ${formatForceGenerationUnitLabel(step.unit)}: ${step.source} pick${fallbackNote}, P ${formatForceGeneratorWeight(step.requisitionWeight)} / S ${formatForceGeneratorWeight(step.salvageWeight)}${skillNote}, ${step.cost.toLocaleString()} ${budgetLabel}${reasons}.`,
            );
        }

        const searchEffortNote = this.formatGenerationSearchEffortNote(attemptsTried, attemptsElapsedMs);
        if (searchEffortNote) {
            lines.push(`Search effort: ${searchEffortNote}`);
            if (!error) {
                lines.push(`Formation effort: ${this.formatFormationComputationEffortNote()}`);
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
            return `Availability weights: max P/S across ${eraCount} eras x ${factionCount} factions.`;
        }
        if (usesEraScope && eraCount > 0) {
            return `Availability weights: max P/S across ${eraCount} eras.`;
        }
        if (usesFactionScope && factionCount > 0) {
            return `Availability weights: max P/S across ${factionCount} factions.`;
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
            budgetRange,
            minUnitCount,
            maxUnitCount,
            resolveForceGenerationSkillSettings(options),
            selectionAttempt,
            error,
            (options.lockedUnits ?? []).length,
            options.preventDuplicateChassis === true,
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
            name: ForceNamerUtil.generateForceNameForFaction(options.context.forceFaction),
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
            budgetRange,
            minUnitCount,
            maxUnitCount,
            resolveForceGenerationSkillSettings(options),
            null,
            error,
            (options.lockedUnits ?? []).length,
            options.preventDuplicateChassis === true,
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
    ): TargetFormationPreviewGroupBuildResult | null {
        if (!targetGroups?.length) {
            return null;
        }

        const usedUnitIndexes = new Set<number>();
        const previewGroups: ForcePreviewGroup[] = [];
        let validationMs = 0;
        let remainingGroupBuildMs = 0;

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
                const validationStartedAt = getForceGeneratorNow();
                const isValid = this.isGeneratedPreviewValidForFormation(groupUnits, context, targetGroup.formationId);
                validationMs += Math.max(0, getForceGeneratorNow() - validationStartedAt);
                if (!isValid) {
                    return null;
                }
            }

            previewGroups.push(createGeneratedPreviewGroup(groupUnits, context.gameSystem, targetGroup.formationId));
        }

        const remainingUnits = generatedUnits.filter((_, index) => !usedUnitIndexes.has(index));
        if (remainingUnits.length === 0) {
            return { groups: previewGroups, validationMs, remainingGroupBuildMs };
        }

        const remainingGroupBuildStartedAt = getForceGeneratorNow();
        const remainingPreviewGroups = buildPreviewGroups(remainingUnits, context);
        remainingGroupBuildMs = Math.max(0, getForceGeneratorNow() - remainingGroupBuildStartedAt);

        return {
            groups: [...previewGroups, ...remainingPreviewGroups],
            validationMs,
            remainingGroupBuildMs,
        };
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

    private isBudgetWithinRange(totalCost: number, budgetRange: { min: number; max: number }): boolean {
        return totalCost >= budgetRange.min && totalCost <= budgetRange.max;
    }

    private getBudgetRangeDistance(totalCost: number, budgetRange: { min: number; max: number }): number {
        if (totalCost < budgetRange.min) {
            return budgetRange.min - totalCost;
        }
        if (totalCost > budgetRange.max) {
            return totalCost - budgetRange.max;
        }

        return 0;
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
        rulesetProfile: ForceGenerationRulesetProfile | null,
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
                label: formatForceGenerationUnitLabel(candidate.unit),
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
        if (!LOG_ATTEMPTS) return;
        if (successfulAttempts.length === 0 || typeof console === 'undefined' || typeof console.log !== 'function') {
            return;
        }

        const budgetLabel = options.gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
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

    private createSearchDeadline(startedAtMs: number, durationMs: number): ForceGenerationSearchDeadline {
        return { expiresAtMs: startedAtMs + Math.max(0, durationMs) };
    }

    private hasSearchDeadlineExpired(deadline?: ForceGenerationSearchDeadline): boolean {
        return !!deadline && getForceGeneratorNow() >= deadline.expiresAtMs;
    }

    private resolveFailureSearchWindowMs(): number {
        const configuredMs = this.optionsService.options().forceGenFailureSearchWindowMs;
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

    private getBudgetTarget(budgetRange: { min: number; max: number }): number {
        if (Number.isFinite(budgetRange.max)) {
            return budgetRange.min > 0
                ? budgetRange.min + ((budgetRange.max - budgetRange.min) / 2)
                : budgetRange.max;
        }

        return budgetRange.min;
    }

    private getAvailabilityWeightForSource(
        candidate: ForceGenerationCandidateUnit,
        source: ForceGenerationAvailabilitySource,
    ): number {
        return source === 'requisition' ? candidate.requisitionWeight : candidate.salvageWeight;
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

        return LanceTypeIdentifierUtil.isFormationAvailableForFaction(definition, context.forceFaction.name);
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
            getUnit: () => candidate.unit,
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
            { maxUnits: maxUnitCount },
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
        const attemptCandidates = hasVariableForceGenerationSkillSettings(options.gameSystem, skillSettings)
            ? this.createSkillAdjustedCandidatesForAttempt(candidates, options.gameSystem, skillSettings)
            : candidates;
        const skillBudgetPlanningCosts = this.createSkillBudgetPlanningCosts(
            attemptCandidates,
            options.gameSystem,
            skillSettings,
        );
        const preparedSelection = selectionPreparation ?? this.prepareSelectionPreparation(
            attemptCandidates,
            preselectedCandidates,
            options.context,
            minUnitCount,
            maxUnitCount,
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
        const hasMatchedPairConstraints = this.getMatchedPairConstraintIds(definition.id).size > 0;
        const allowUnlimitedDuplicateUnits = this.canReuseCandidateCopies(preventDuplicateChassis, candidates);

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
                this.isBudgetWithinRange(totalCost, budgetRange)
                || this.canSkillAdjustedSelectionReachBudgetRange(minimumSkillAdjustedTotalCost, maximumSkillAdjustedTotalCost, budgetRange)
            )) {
                break;
            }
            if (currentEvaluation && FormationRequirementEngine.hasHardConstraintViolations(currentEvaluation)) {
                break;
            }

            const matchedPairCandidate = preventDuplicateChassis
                ? null
                : this.findMatchedPairCompletionCandidate(
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

            const remainingCandidateCountAfterPick = remainingCandidates.length - 1;
            const requiredAfterPick = Math.max(0, minUnitCount - selectedCandidates.length - 1);
            if (!allowUnlimitedDuplicateUnits && !hasMatchedPairConstraints && requiredAfterPick > remainingCandidateCountAfterPick) {
                break;
            }

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

            const formationCandidateDecisions: Array<{ candidate: ForceGenerationCandidateUnit; decision: FormationSearchDecision }> = [];
            for (const candidate of duplicateFilteredCandidatePool) {
                if (this.hasSearchDeadlineExpired(deadline)) {
                    break;
                }

                const decision = this.evaluateTargetFormationCandidate(definition, selectedCandidates, candidate, options, maxUnitCount);
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

        const matchedPairConstraintIds = this.getMatchedPairConstraintIds(definition.id);
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
        const countedUnitNames = new Set<string>();

        for (const candidate of candidates) {
            if (countedUnitNames.has(candidate.unit.name)) {
                continue;
            }
            countedUnitNames.add(candidate.unit.name);

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

    private getMatchedPairConstraintIds(formationId: string): Set<string> {
        const result = new Set<string>();
        this.collectMatchedPairConstraintIds(getFormationBlueprint(formationId)?.constraints ?? [], result);
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

    private buildTargetFormationGroupSelection(
        candidates: readonly ForceGenerationCandidateUnit[],
        options: ForceGenerationRequest,
        definition: FormationTypeDefinition,
        budgetRange: { min: number; max: number },
        groupUnitCount: number,
        preventDuplicateChassis: boolean,
        baseSelectedCandidates: readonly ForceGenerationCandidateUnit[] = [],
        minTotalUnitCount = groupUnitCount,
        skillBudgetPlanningCosts?: ForceGenerationSkillBudgetPlanningCosts,
        deadline?: ForceGenerationSearchDeadline,
    ): ForceGenerationSelectionAttempt {
        const selectedCandidates: ForceGenerationCandidateUnit[] = [];
        const remainingCandidates: ForceGenerationCandidateUnit[] = [...candidates];
        const baseSelectedUnitCount = baseSelectedCandidates.length;
        const allowUnlimitedDuplicateUnits = this.canReuseCandidateCopies(preventDuplicateChassis, candidates);
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

            const matchedPairCandidate = preventDuplicateChassis
                ? null
                : this.findMatchedPairCompletionCandidate(
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
            const reachabilityContext = Number.isFinite(budgetRange.max)
                ? this.createTargetFormationBudgetReachabilityContext(localCandidatePool, skillBudgetPlanningCosts)
                : undefined;
            if (reachabilityContext) {
                budgetReachabilitySorts += 1;
            }
            const candidateSearchDecisions: Array<{ candidate: ForceGenerationCandidateUnit; decision: FormationSearchDecision }> = [];
            const currentFormationUnits = this.createFormationUnitsForCandidates(selectedCandidates, options);
            for (const candidate of localCandidatePool) {
                if (this.hasSearchDeadlineExpired(deadline)) {
                    break;
                }

                budgetReachabilityChecks += 1;
                if (!this.canTargetFormationGroupPickReachMinimumUnitsWithinBudget(
                    candidate,
                    localCandidatePool,
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
                const decision = this.evaluateTargetFormationCandidate(definition, selectedCandidates, candidate, options, groupUnitCount, currentFormationUnits);
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
            candidates.length,
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

        if (!allowUnlimitedDuplicateUnits && candidatePool.length - 1 < requiredAfterPick) {
            return false;
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
        if (!LOG_ATTEMPTS || typeof console === 'undefined' || typeof console.log !== 'function') {
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
        if (!LOG_ATTEMPTS || typeof console === 'undefined' || typeof console.log !== 'function') {
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
            if (!allowUnlimitedDuplicateUnits && availableCandidates.length + selectedCandidates.length < selectedCandidates.length + groupUnitCount) {
                continue;
            }

            const groupAttempt = this.buildTargetFormationGroupSelection(
                availableCandidates,
                options,
                targetInstance.definition,
                budgetRange,
                groupUnitCount,
                preventDuplicateChassis,
                selectedCandidates,
                minUnitCount,
                skillBudgetPlanningCosts,
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
            || (!this.isBudgetWithinRange(totalCost, budgetRange) && selectedCandidates.length < maxUnitCount);
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
        const selectedUnitNames = new Set(selectedCandidates.map((candidate) => candidate.unit.name));
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
            } else if (!allowUnlimitedDuplicateUnits && selectedUnitNames.has(candidate.unit.name)) {
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
        const budgetDistance = this.getBudgetRangeDistance(totalCost, budgetRange);
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
        const budgetLabel = options.gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
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
        rulesetProfile: ForceGenerationRulesetProfile | null,
        selectionPreparation?: ForceGenerationSelectionPreparation,
    ): {
        candidate: ForceGenerationCandidateUnit;
        rolledSource: ForceGenerationAvailabilitySource;
        source: ForceGenerationAvailabilitySource;
        usedFallbackSource: boolean;
    } {
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
                const rulesetScore = selectionPreparation?.rulesetScoreByCandidate.get(candidate)
                    ?? this.getRulesetMatchScore(candidate, rulesetProfile);
                return availabilityWeight * rulesetScore;
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
        const targetBudget = this.getBudgetTarget(budgetRange);
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

        while (selectedCandidates.length < maxUnitCount && !this.hasSearchDeadlineExpired(deadline)) {
            if (
                selectedCandidates.length >= minUnitCount
                && (
                    (
                        (
                            this.isBudgetWithinRange(totalCost, budgetRange)
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

            const remainingCandidateCountAfterPick = remainingCandidates.length - 1;
            const requiredAfterPick = Math.max(0, minUnitCount - selectedCandidates.length - 1);
            if (!allowUnlimitedDuplicateUnits && requiredAfterPick > remainingCandidateCountAfterPick) {
                break;
            }

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
        };
    }

    private createSelectionStep(
        candidate: ForceGenerationCandidateUnit,
        rulesetProfile: ForceGenerationRulesetProfile | null,
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
                ?? this.getRulesetMatchReasons(candidate, rulesetProfile),
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
    ): ForceGenerationRulesetProfile | null {
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
        const topLevelMatchContext = this.resolveAttemptTopLevelMatchContext(
            rulesetContext.chain,
            candidates,
            baseMatchContext,
            minUnitCount,
            maxUnitCount,
            orgDefinition,
        );
        const forceNodeSelection = this.findPreferredForceNode(rulesetContext.chain, {
            ...topLevelMatchContext,
        });
        const forceNode = forceNodeSelection.forceNode;
        const resolvedSelectedEchelon = topLevelMatchContext.echelon
            ?? forceNodeSelection.matchContext.echelon
            ?? getRulesetEchelonCode(forceNode?.echelon);
        const profile: ForceGenerationRulesetProfile = {
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
        this.addRulesetValues(profile.requiredUnitTypes, topLevelMatchContext.unitType ? [topLevelMatchContext.unitType] : []);
        this.mergeRulesetNodeIntoProfile(profile, rulesetContext.primary?.assign);

        if (profile.preferredOrgType) {
            const regularSizeNote = profile.preferredUnitCount ? ` (regular size ${profile.preferredUnitCount})` : '';
            this.appendRulesetNote(profile, `Org target: ${profile.preferredOrgType}${regularSizeNote}.`);
        }

        if (!forceNode) {
            this.appendRulesetNote(profile, 'Ruleset chain resolved, but no matching force node was found for the chosen echelon.');
            return profile;
        }

        this.applyForceNodeToProfile(profile, forceNode, forceNodeSelection.matchContext);
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
        candidates: readonly ForceGenerationCandidateUnit[],
        baseMatchContext: RulesetMatchContext,
        minUnitCount: number,
        maxUnitCount: number,
        orgDefinition: OrgDefinition | null,
    ): RulesetMatchContext {
        const unitTypeChoices = this.getTopLevelUnitTypeChoices(
            rulesetChain,
            candidates,
            baseMatchContext,
            minUnitCount,
            maxUnitCount,
            orgDefinition,
        );
        if (unitTypeChoices.length === 0) {
            const forceNodeChoices = this.getForceNodeBackedTopLevelUnitTypeChoices(
                rulesetChain,
                candidates,
                baseMatchContext,
            );
            if (forceNodeChoices.length === 0) {
                return baseMatchContext;
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
            ...baseMatchContext,
            unitType: selectedUnitTypeChoice.summary.unitType,
            echelon: selectedEchelonChoice.echelon,
        };
        const previewSelection = this.peekPreferredForceNode(rulesetChain, nextMatchContext);
        const resolvedEchelon = selectedEchelonChoice.echelon
            ?? previewSelection.matchContext.echelon
            ?? getRulesetEchelonCode(previewSelection.forceNode?.echelon);

        return {
            ...previewSelection.matchContext,
            unitType: selectedUnitTypeChoice.summary.unitType,
            echelon: resolvedEchelon,
        };
    }

    private getTopLevelUnitTypeChoices(
        rulesetChain: readonly MegaMekRulesetRecord[],
        candidates: readonly ForceGenerationCandidateUnit[],
        baseMatchContext: RulesetMatchContext,
        minUnitCount: number,
        maxUnitCount: number,
        orgDefinition: OrgDefinition | null,
    ): ForceGenerationTopLevelUnitTypeChoice[] {
        return this.getCandidateUnitTypeSummaries(candidates)
            .map((summary) => {
                const echelons = this.getValidTopLevelEchelonOptions(
                    rulesetChain,
                    {
                        ...baseMatchContext,
                        unitType: summary.unitType,
                    },
                    minUnitCount,
                    maxUnitCount,
                    summary.candidateCount,
                    orgDefinition,
                );

                return {
                    summary,
                    echelons,
                };
            })
            .filter((choice) => choice.echelons.length > 0);
    }

    private getValidTopLevelEchelonOptions(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
        minUnitCount: number,
        maxUnitCount: number,
        candidateCount: number,
        orgDefinition: OrgDefinition | null,
    ): ForceGenerationTopLevelEchelonOption[] {
        for (const ruleset of rulesetChain) {
            const matchingOptions = (ruleset.toc?.echelon?.options ?? [])
                .filter((option) => this.matchesRulesetWhen(option.when, matchContext));
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
                            || preferredUnitCount > candidateCount
                        ) {
                            return null;
                        }

                        return {
                            echelon,
                            preferredUnitCount,
                            weight: getRulesetOptionWeight(option),
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
        candidates: readonly ForceGenerationCandidateUnit[],
        baseMatchContext: RulesetMatchContext,
    ): ForceGenerationTopLevelForceNodeChoice[] {
        const choices: ForceGenerationTopLevelForceNodeChoice[] = [];

        for (const summary of this.getCandidateUnitTypeSummaries(candidates)) {
            const previewSelection = this.peekPreferredForceNode(rulesetChain, {
                ...baseMatchContext,
                unitType: summary.unitType,
            });
            if (!previewSelection.forceNode) {
                continue;
            }

            choices.push({
                summary,
                matchContext: {
                    ...previewSelection.matchContext,
                    unitType: summary.unitType,
                },
            });
        }

        return choices;
    }

    private getCandidateUnitTypeSummaries(
        candidates: readonly ForceGenerationCandidateUnit[],
    ): ForceGenerationCandidateUnitTypeSummary[] {
        const summaries = new Map<string, ForceGenerationCandidateUnitTypeSummary>();

        for (const candidate of candidates) {
            const currentSummary = summaries.get(candidate.megaMekUnitType) ?? {
                unitType: candidate.megaMekUnitType,
                candidateCount: 0,
                totalAvailabilityWeight: 0,
            };
            currentSummary.candidateCount += 1;
            currentSummary.totalAvailabilityWeight += Math.max(0, candidate.requisitionWeight) + Math.max(0, candidate.salvageWeight);
            summaries.set(candidate.megaMekUnitType, currentSummary);
        }

        return [...summaries.values()].sort((left, right) => {
            if (left.totalAvailabilityWeight !== right.totalAvailabilityWeight) {
                return right.totalAvailabilityWeight - left.totalAvailabilityWeight;
            }
            if (left.candidateCount !== right.candidateCount) {
                return right.candidateCount - left.candidateCount;
            }

            return left.unitType.localeCompare(right.unitType);
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
        const unitTypeChoices = this.getTopLevelUnitTypeChoices(
            rulesetContext.chain,
            candidates,
            {
                year: getEraReferenceYear(context.forceEra),
                factionKey: rulesetContext.primary?.factionKey,
                topLevel: true,
            },
            minUnitCount,
            maxUnitCount,
            orgDefinition,
        );
        const allowedUnitTypes = new Set(
            (unitTypeChoices.length > 0
                ? unitTypeChoices.map((choice) => choice.summary.unitType)
                : this.getForceNodeBackedTopLevelUnitTypeChoices(
                    rulesetContext.chain,
                    candidates,
                    {
                        year: getEraReferenceYear(context.forceEra),
                        factionKey: rulesetContext.primary?.factionKey,
                        topLevel: true,
                    },
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
        rulesetProfile: ForceGenerationRulesetProfile | null,
    ): ForceGenerationCandidateUnit[] {
        if (!rulesetProfile || rulesetProfile.requiredUnitTypes.size === 0) {
            return [...candidates];
        }

        return candidates.filter((candidate) => {
            return rulesetProfile.requiredUnitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType));
        });
    }

    private peekPreferredForceNode(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
    ): ForceGenerationForceNodeSelection {
        return this.resolvePreferredForceNode(rulesetChain, matchContext, 'first');
    }

    private resolvePreferredForceNode(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
        selectionMode: ForceGenerationForceNodeSelectionMode,
    ): ForceGenerationForceNodeSelection {
        const exactMatch = this.selectMatchingForceNode(
            rulesetChain,
            matchContext,
            (when, nextContext) => this.matchesRulesetWhen(when, nextContext),
            selectionMode,
        );
        if (exactMatch) {
            return this.createForceNodeSelection(matchContext, exactMatch);
        }

        const structuralMatch = this.selectMatchingForceNode(
            rulesetChain,
            matchContext,
            (when, nextContext) => this.matchesRulesetWhenForForceSelection(when, nextContext),
            selectionMode,
        );
        if (structuralMatch) {
            return this.createForceNodeSelection(matchContext, structuralMatch);
        }

        if (!matchContext.echelon) {
            return { matchContext };
        }

        const fallbackContext = { ...matchContext, echelon: undefined };
        const fallbackExactMatch = this.selectMatchingForceNode(
            rulesetChain,
            fallbackContext,
            (when, nextContext) => this.matchesRulesetWhen(when, nextContext),
            selectionMode,
        );
        if (fallbackExactMatch) {
            return this.createForceNodeSelection(fallbackContext, fallbackExactMatch);
        }

        const fallbackStructuralMatch = this.selectMatchingForceNode(
            rulesetChain,
            fallbackContext,
            (when, nextContext) => this.matchesRulesetWhenForForceSelection(when, nextContext),
            selectionMode,
        );
        if (fallbackStructuralMatch) {
            return this.createForceNodeSelection(fallbackContext, fallbackStructuralMatch);
        }

        return { matchContext };
    }

    private createForceNodeSelection(
        matchContext: RulesetMatchContext,
        forceNode: MegaMekRulesetForceNode,
    ): ForceGenerationForceNodeSelection {
        return {
            forceNode,
            matchContext: this.deriveForceNodeMatchContext(matchContext, forceNode),
        };
    }

    private findPreferredForceNode(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
    ): ForceGenerationForceNodeSelection {
        return this.resolvePreferredForceNode(rulesetChain, matchContext, 'weighted');
    }

    private selectMatchingForceNode(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
        matcher: (when: MegaMekRulesetWhen | undefined, matchContext: RulesetMatchContext) => boolean,
        selectionMode: ForceGenerationForceNodeSelectionMode,
    ): MegaMekRulesetForceNode | undefined {
        for (const ruleset of rulesetChain) {
            const indexedForceNodes = matchContext.echelon
                ? (ruleset.indexes.forceIndexesByEchelon[matchContext.echelon] ?? [])
                    .map((index) => ruleset.forces[index])
                    .filter((forceNode): forceNode is MegaMekRulesetForceNode => forceNode !== undefined)
                : ruleset.forces;

            const forceNodes = indexedForceNodes.length > 0 ? indexedForceNodes : ruleset.forces;
            if (selectionMode === 'first') {
                const matchingForceNode = forceNodes.find((forceNode) => matcher(forceNode.when, matchContext));
                if (matchingForceNode) {
                    return matchingForceNode;
                }
                continue;
            }

            const matchingForceNodes = forceNodes.filter((forceNode) => matcher(forceNode.when, matchContext));
            if (matchingForceNodes.length > 0) {
                return pickWeightedRandomEntry(matchingForceNodes, (forceNode) => getRulesetOptionWeight(forceNode));
            }
        }

        return undefined;
    }

    private matchesRulesetWhenForForceSelection(
        when: MegaMekRulesetWhen | undefined,
        matchContext: RulesetMatchContext,
    ): boolean {
        if (!when) {
            return true;
        }

        const fromYear = when.fromYear;
        if (fromYear !== undefined && (matchContext.year === undefined || matchContext.year < fromYear)) {
            return false;
        }

        const toYear = when.toYear;
        if (toYear !== undefined && (matchContext.year === undefined || matchContext.year > toYear)) {
            return false;
        }

        if (!this.matchesRulesetStringValues(when.factions ?? [], matchContext.factionKey)) {
            return false;
        }
        if (!this.matchesRulesetStringValues(when.unitTypes ?? [], matchContext.unitType)) {
            return false;
        }

        const topLevel = when.topLevel;
        if (topLevel !== undefined && topLevel !== (matchContext.topLevel ?? false)) {
            return false;
        }

        const augmented = when.augmented;
        if (augmented !== undefined && augmented !== (matchContext.augmented ?? false)) {
            return false;
        }

        const echelons = when.echelons ?? [];
        if (echelons.length > 0) {
            const matchedEchelon = echelons.some((echelonNode) => {
                const echelon = echelonNode.code;
                if (!echelon || !matchContext.echelon) {
                    return false;
                }

                const requiredAugmented = echelonNode.augmented;
                return echelon === matchContext.echelon
                    && (requiredAugmented === undefined || requiredAugmented === (matchContext.augmented ?? false));
            });
            if (!matchedEchelon) {
                return false;
            }
        }

        return true;
    }

    private deriveForceNodeMatchContext(
        matchContext: RulesetMatchContext,
        forceNode: MegaMekRulesetForceNode,
    ): RulesetMatchContext {
        return {
            ...matchContext,
            unitType: getFirstPositiveRulesetValue(forceNode.when?.unitTypes) ?? matchContext.unitType,
            weightClass: getFirstPositiveRulesetValue(forceNode.when?.weightClasses) ?? matchContext.weightClass,
            role: getFirstPositiveRulesetValue(forceNode.when?.roles) ?? matchContext.role,
            motive: getFirstPositiveRulesetValue(forceNode.when?.motives) ?? matchContext.motive,
            echelon: getRulesetEchelonCode(forceNode.echelon) ?? matchContext.echelon,
            augmented: forceNode.echelon?.augmented ?? forceNode.when?.augmented ?? matchContext.augmented,
        };
    }

    private applyForceNodeToProfile(
        profile: ForceGenerationRulesetProfile,
        forceNode: MegaMekRulesetForceNode,
        matchContext: RulesetMatchContext,
    ): void {
        this.addRulesetValues(profile.requiredUnitTypes, getPositiveRulesetValues(forceNode.when?.unitTypes));
        this.mergeRulesetWhenIntoProfile(profile, forceNode.when);
        this.mergeRulesetNodeIntoProfile(profile, forceNode.assign);
        this.mergeRulesetGroupIntoProfile(profile, forceNode.unitType, matchContext);
        this.mergeRulesetGroupIntoProfile(profile, forceNode.weightClass, matchContext);
        this.mergeRulesetGroupIntoProfile(profile, forceNode.role, matchContext);
        this.mergeRulesetGroupIntoProfile(profile, forceNode.motive, matchContext);

        for (const ruleGroup of forceNode.ruleGroup ?? []) {
            if (!this.matchesRulesetWhen(ruleGroup.when, matchContext)) {
                continue;
            }

            this.mergeRulesetGroupIntoProfile(profile, ruleGroup.unitType, matchContext);
            this.mergeRulesetGroupIntoProfile(profile, ruleGroup.weightClass, matchContext);
            this.mergeRulesetGroupIntoProfile(profile, ruleGroup.role, matchContext);
            this.mergeRulesetGroupIntoProfile(profile, ruleGroup.motive, matchContext);
        }
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
                .filter((option) => this.matchesRulesetWhen(option.when, matchContext));
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

    private findMatchingForceNode(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
    ): MegaMekRulesetForceNode | undefined {
        for (const ruleset of rulesetChain) {
            const indexedForceNodes = matchContext.echelon
                ? (ruleset.indexes.forceIndexesByEchelon[matchContext.echelon] ?? [])
                    .map((index) => ruleset.forces[index])
                    .filter((forceNode): forceNode is MegaMekRulesetForceNode => forceNode !== undefined)
                : ruleset.forces;

            const forceNodes = indexedForceNodes.length > 0 ? indexedForceNodes : ruleset.forces;
            for (const forceNode of forceNodes) {
                if (matchContext.echelon && getRulesetEchelonCode(forceNode.echelon) !== matchContext.echelon) {
                    continue;
                }

                if (this.matchesRulesetWhen(forceNode.when, matchContext)) {
                    return forceNode;
                }
            }
        }

        if (!matchContext.echelon) {
            return undefined;
        }

        const fallbackContext = { ...matchContext, echelon: undefined };
        for (const ruleset of rulesetChain) {
            const forceNodes = ruleset.forces;
            for (const forceNode of forceNodes) {
                if (this.matchesRulesetWhen(forceNode.when, fallbackContext)) {
                    return forceNode;
                }
            }
        }

        return undefined;
    }

    private mergeRulesetGroupIntoProfile(
        profile: ForceGenerationRulesetProfile,
        groupNode: MegaMekRulesetOptionGroup | undefined,
        matchContext: RulesetMatchContext,
    ): void {
        if (!groupNode || !this.matchesRulesetWhen(groupNode.when, matchContext)) {
            return;
        }

        this.mergeRulesetNodeIntoProfile(profile, groupNode);

        const matchingOptions = (groupNode.options ?? [])
            .filter((option) => this.matchesRulesetWhen(option.when, matchContext));
        if (matchingOptions.length === 0) {
            return;
        }

        const selectedOption = pickWeightedRandomEntry(matchingOptions, (option) => getRulesetOptionWeight(option));
        this.mergeRulesetWhenIntoProfile(profile, selectedOption.when);
        this.mergeRulesetNodeIntoProfile(profile, selectedOption);
        this.mergeRulesetNodeIntoProfile(profile, selectedOption.assign);
    }

    private mergeRulesetWhenIntoProfile(
        profile: ForceGenerationRulesetProfile,
        when: MegaMekRulesetWhen | undefined,
    ): void {
        if (!when) {
            return;
        }

        this.addRulesetValues(profile.preferredUnitTypes, getPositiveRulesetValues(when.unitTypes));
        this.addRulesetValues(profile.preferredWeightClasses, getPositiveRulesetValues(when.weightClasses));
        this.addRulesetValues(profile.preferredRoles, getPositiveRulesetValues(when.roles));
        this.addRulesetValues(profile.preferredMotives, getPositiveRulesetValues(when.motives));
    }

    private mergeRulesetNodeIntoProfile(
        profile: ForceGenerationRulesetProfile,
        node: (RulesetPreferenceSource & { assign?: MegaMekRulesetAssign }) | MegaMekRulesetAssign | undefined,
    ): void {
        if (!node) {
            return;
        }

        this.addRulesetValues(profile.preferredUnitTypes, node.unitTypes ?? []);
        this.addRulesetValues(profile.preferredWeightClasses, node.weightClasses ?? []);
        this.addRulesetValues(profile.preferredRoles, node.roles ?? []);
        this.addRulesetValues(profile.preferredMotives, node.motives ?? []);
    }

    private collectRulesetTemplates(
        profile: ForceGenerationRulesetProfile,
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
            if (!this.matchesRulesetWhen(subforceGroup.when, matchContext)) {
                continue;
            }

            this.mergeRulesetNodeIntoProfile(profile, subforceGroup.assign);
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
                if (!this.matchesRulesetWhen(subforceOptionGroup.when, matchContext)) {
                    continue;
                }

                const matchingOptions = (subforceOptionGroup.options ?? [])
                    .filter((option) => this.matchesRulesetWhen(option.when, matchContext));
                if (matchingOptions.length === 0) {
                    continue;
                }

                const selectedOption = pickWeightedRandomEntry(matchingOptions, (option) => getRulesetOptionWeight(option));
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
                if (!this.matchesRulesetWhen(directSubforce.when, matchContext)) {
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
        profile: ForceGenerationRulesetProfile,
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

        this.mergeRulesetNodeIntoProfile(profile, node);
        this.mergeRulesetNodeIntoProfile(profile, node.assign);

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
        const template = this.createRulesetTemplate(node);
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
        const childForceNode = this.findMatchingForceNode(nodeRulesetContext.chain, childMatchContext);
        if (childForceNode) {
            this.applyForceNodeToProfile(profile, childForceNode, childMatchContext);
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
            echelon: getRulesetEchelonCode(node.echelon)
                ?? getRulesetEchelonCode(assign?.echelon)
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

    private createRulesetTemplate(node: MegaMekRulesetSubforceNode): ForceGenerationRulesetTemplate | null {
        const template: ForceGenerationRulesetTemplate = {
            unitTypes: new Set<string>(),
            weightClasses: new Set<string>(),
            roles: new Set<string>(),
            motives: new Set<string>(),
        };

        this.addRulesetValues(template.unitTypes, node.unitTypes ?? []);
        this.addRulesetValues(template.weightClasses, node.weightClasses ?? []);
        this.addRulesetValues(template.roles, node.roles ?? []);
        this.addRulesetValues(template.motives, node.motives ?? []);

        const assignedNode = node.assign;
        this.addRulesetValues(template.unitTypes, assignedNode?.unitTypes ?? []);
        this.addRulesetValues(template.weightClasses, assignedNode?.weightClasses ?? []);
        this.addRulesetValues(template.roles, assignedNode?.roles ?? []);
        this.addRulesetValues(template.motives, assignedNode?.motives ?? []);

        return template.unitTypes.size > 0 || template.weightClasses.size > 0 || template.roles.size > 0 || template.motives.size > 0
            ? template
            : null;
    }

    private addRulesetValues(target: Set<string>, values: readonly string[]): void {
        for (const value of values) {
            target.add(normalizeRulesetToken(value));
        }
    }

    private appendRulesetNote(profile: ForceGenerationRulesetProfile, note: string): void {
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

    private getRulesetMatchReasons(
        candidate: ForceGenerationCandidateUnit,
        profile: ForceGenerationRulesetProfile | null,
    ): string[] {
        if (!profile) {
            return [];
        }

        const reasons: string[] = [];
        if (profile.preferredUnitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType))) {
            reasons.push(`unit type ${candidate.megaMekUnitType}`);
        }
        if (candidate.megaMekWeightClass && profile.preferredWeightClasses.has(normalizeRulesetToken(candidate.megaMekWeightClass))) {
            reasons.push(`weight ${candidate.megaMekWeightClass}`);
        }
        if (candidate.role && profile.preferredRoles.has(normalizeRulesetToken(candidate.role))) {
            reasons.push(`role ${candidate.role}`);
        }
        if (candidate.motive && profile.preferredMotives.has(normalizeRulesetToken(candidate.motive))) {
            reasons.push(`motive ${candidate.motive}`);
        }

        for (const template of profile.templates) {
            if (
                template.unitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType))
                || (candidate.megaMekWeightClass && template.weightClasses.has(normalizeRulesetToken(candidate.megaMekWeightClass)))
                || (candidate.role && template.roles.has(normalizeRulesetToken(candidate.role)))
                || (candidate.motive && template.motives.has(normalizeRulesetToken(candidate.motive)))
            ) {
                reasons.push('matched a child template');
                break;
            }
        }

        return reasons.slice(0, 3);
    }

    private getRulesetMatchScore(
        candidate: ForceGenerationCandidateUnit,
        profile: ForceGenerationRulesetProfile | null,
    ): number {
        if (!profile) {
            return 1;
        }

        let score = 1;
        score *= this.getPreferredValueScore(profile.preferredUnitTypes, candidate.megaMekUnitType, 1.6, 0.75);
        score *= this.getPreferredValueScore(profile.preferredWeightClasses, candidate.megaMekWeightClass, 1.3, 0.9);
        score *= this.getPreferredValueScore(profile.preferredRoles, candidate.role, 1.2, 0.95);
        score *= this.getPreferredValueScore(profile.preferredMotives, candidate.motive, 1.1, 0.98);

        let templateScore = 1;
        for (const template of profile.templates) {
            let nextTemplateScore = 1;
            let constrained = false;

            if (template.unitTypes.size > 0) {
                constrained = true;
                nextTemplateScore *= template.unitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType)) ? 1.5 : 0.8;
            }
            if (template.weightClasses.size > 0 && candidate.megaMekWeightClass) {
                constrained = true;
                nextTemplateScore *= template.weightClasses.has(normalizeRulesetToken(candidate.megaMekWeightClass)) ? 1.25 : 0.9;
            }
            if (template.roles.size > 0 && candidate.role) {
                constrained = true;
                nextTemplateScore *= template.roles.has(normalizeRulesetToken(candidate.role)) ? 1.15 : 0.95;
            }
            if (template.motives.size > 0 && candidate.motive) {
                constrained = true;
                nextTemplateScore *= template.motives.has(normalizeRulesetToken(candidate.motive)) ? 1.05 : 0.98;
            }

            if (constrained) {
                templateScore = Math.max(templateScore, nextTemplateScore);
            }
        }

        return Math.max(0.05, score * templateScore);
    }

    private getPreferredValueScore(
        preferredValues: ReadonlySet<string>,
        candidateValue: string | undefined,
        matchScore: number,
        mismatchScore: number,
    ): number {
        if (preferredValues.size === 0 || !candidateValue) {
            return 1;
        }

        return preferredValues.has(normalizeRulesetToken(candidateValue)) ? matchScore : mismatchScore;
    }

    private matchesRulesetWhen(when: MegaMekRulesetWhen | undefined, matchContext: RulesetMatchContext): boolean {
        if (!when) {
            return true;
        }

        const fromYear = when.fromYear;
        if (fromYear !== undefined && (matchContext.year === undefined || matchContext.year < fromYear)) {
            return false;
        }

        const toYear = when.toYear;
        if (toYear !== undefined && (matchContext.year === undefined || matchContext.year > toYear)) {
            return false;
        }

        if (!this.matchesRulesetStringValues(when.unitTypes ?? [], matchContext.unitType)) {
            return false;
        }
        if (!this.matchesRulesetStringValues(when.weightClasses ?? [], matchContext.weightClass)) {
            return false;
        }
        if (!this.matchesRulesetStringValues(when.roles ?? [], matchContext.role)) {
            return false;
        }
        if (!this.matchesRulesetStringValues(when.motives ?? [], matchContext.motive)) {
            return false;
        }
        if (!this.matchesRulesetStringValues(when.factions ?? [], matchContext.factionKey)) {
            return false;
        }

        const topLevel = when.topLevel;
        if (topLevel !== undefined && topLevel !== (matchContext.topLevel ?? false)) {
            return false;
        }

        const augmented = when.augmented;
        if (augmented !== undefined && augmented !== (matchContext.augmented ?? false)) {
            return false;
        }

        const flagValues = when.flags ?? [];
        if (flagValues.length > 0 && !this.matchesRulesetFlags(flagValues, matchContext.flags ?? [])) {
            return false;
        }

        const echelons = when.echelons ?? [];
        if (echelons.length > 0) {
            const matchedEchelon = echelons.some((echelonNode) => {
                const echelon = echelonNode.code;
                if (!echelon || !matchContext.echelon) {
                    return false;
                }

                const requiredAugmented = echelonNode.augmented;
                return echelon === matchContext.echelon
                    && (requiredAugmented === undefined || requiredAugmented === (matchContext.augmented ?? false));
            });
            if (!matchedEchelon) {
                return false;
            }
        }

        return true;
    }

    private matchesRulesetStringValues(values: readonly string[], candidateValue: string | undefined): boolean {
        if (values.length === 0) {
            return true;
        }

        const positiveValues = values.filter((value) => !value.startsWith('!')).map((value) => normalizeRulesetToken(value));
        const negativeValues = values.filter((value) => value.startsWith('!')).map((value) => normalizeRulesetToken(value.slice(1)));

        if (!candidateValue) {
            return positiveValues.length === 0;
        }

        const normalizedCandidate = normalizeRulesetToken(candidateValue);
        if (negativeValues.includes(normalizedCandidate)) {
            return false;
        }

        return positiveValues.length === 0 || positiveValues.includes(normalizedCandidate);
    }

    private matchesRulesetFlags(values: readonly string[], flags: readonly string[]): boolean {
        if (values.length === 0) {
            return true;
        }

        const normalizedFlags = new Set(flags.map((flag) => normalizeRulesetToken(flag)));
        const positiveValues = values.filter((value) => !value.startsWith('!')).map((value) => normalizeRulesetToken(value));
        const negativeValues = values.filter((value) => value.startsWith('!')).map((value) => normalizeRulesetToken(value.slice(1)));

        for (const negativeValue of negativeValues) {
            if (normalizedFlags.has(negativeValue)) {
                return false;
            }
        }

        return positiveValues.length === 0 || positiveValues.some((value) => normalizedFlags.has(value));
    }
}