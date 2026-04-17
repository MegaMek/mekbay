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

import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
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
import type { ForceUnit } from '../models/force-unit.model';
import { MAX_UNITS as FORCE_MAX_UNITS } from '../models/force.model';
import { MULFACTION_EXTINCT, MULFACTION_MERCENARY } from '../models/mulfactions.model';
import type { Options } from '../models/options.model';
import { getUnitsAverageTechBase } from '../models/tech.model';
import type { Unit } from '../models/units.model';
import { resolveOrgDefinition } from '../utils/org/org-registry.util';
import { resolveFromGroups, resolveFromUnits } from '../utils/org/org-solver.util';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import { collectGroupUnits } from '../utils/org/org-facts.util';
import type { GroupSizeResult, OrgDefinition, OrgRuleDefinition, OrgType } from '../utils/org/org-types';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { getEffectivePilotingSkill } from '../utils/cbt-common.util';
import { resolveDropdownNamesFromFilter } from '../utils/filter-name-resolution.util';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { PVCalculatorUtil } from '../utils/pv-calculator.util';
import { normalizeMultiStateSelection } from '../utils/unit-search-shared.util';
import { DataService } from './data.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';

/**
 * Author: Drake
 */
const LOG_ATTEMPTS = false;
const DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT = 1;
const IMPLICIT_MULTI_FACTION_EXCLUDED_IDS = new Set<number>([MULFACTION_EXTINCT]);
const FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS = 200;
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
    productionWeight: number;
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
}

type ForceGenerationAvailabilitySource = 'production' | 'salvage';

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
    weightsByUnitId: Map<number, { production: number; salvage: number }>;
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
    productionMax: number;
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
    productionWeight: number;
    salvageWeight: number;
    cost: number;
    rulesetReasons: string[];
}

interface ForceGenerationSelectionAttempt {
    selectedCandidates: ForceGenerationCandidateUnit[];
    selectionSteps: ForceGenerationSelectionStep[];
    rulesetProfile: ForceGenerationRulesetProfile | null;
    structureEvaluation?: ForceGenerationStructureEvaluation;
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
    units: GeneratedForceUnit[];
    totalCost: number;
    error: string | null;
    faction: Faction | null;
    era: Era | null;
    explanationLines: string[];
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
    lockedUnits?: readonly GeneratedForceUnit[];
    preventDuplicateChassis?: boolean;
}

export interface ForceGenerationBudgetRange {
    min: number;
    max: number;
}

export interface ForceGenerationContextOptions {
    crossEraAvailabilityInMultiEraSelection?: boolean;
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

interface PreviewGroupPlanContext {
    faction: Faction;
    era: Era | null;
    gameSystem: GameSystem;
    factionName: string;
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

function createPreviewForceUnitStub(
    generatedUnit: GeneratedForceUnit,
    forceContext: {
        faction: () => Faction | null;
        era: () => Era | null;
        techBase: () => string;
        gameSystem: GameSystem;
    },
): ForceUnit {
    return {
        force: forceContext,
        getUnit: () => generatedUnit.unit,
        getBv: () => generatedUnit.cost,
        pilotSkill: () => generatedUnit.skill ?? generatedUnit.gunnery ?? 4,
        gunnerySkill: () => generatedUnit.gunnery ?? generatedUnit.skill ?? 4,
    } as unknown as ForceUnit;
}

function getBestPreviewFormationMatch(
    generatedUnits: readonly GeneratedForceUnit[],
    resolvedGroup: GroupSizeResult,
    context: PreviewGroupPlanContext,
): ReturnType<typeof LanceTypeIdentifierUtil.getBestMatchForGroup> {
    const techBase = getUnitsAverageTechBase(generatedUnits.map((generatedUnit) => generatedUnit.unit));
    const forceContext = {
        faction: () => context.faction,
        era: () => context.era,
        techBase: () => techBase,
        gameSystem: context.gameSystem,
    };
    const forceUnits = generatedUnits.map((generatedUnit) => createPreviewForceUnitStub(generatedUnit, forceContext));
    const group = {
        force: forceContext,
        units: () => forceUnits,
        organizationalResult: () => ({
            name: resolvedGroup.name,
            tier: resolvedGroup.tier,
            groups: [resolvedGroup],
        }),
        formationHistory: new Set<string>(),
    } as unknown as import('../models/force.model').UnitGroup<ForceUnit>;

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
    const bestMatch = getBestPreviewFormationMatch(orderedGeneratedUnits, resolvedGroup, context);
    const formationId = bestMatch?.definition.id;

    return {
        groups: [{
            previewGroup: createGeneratedPreviewGroup(orderedGeneratedUnits, context.gameSystem, formationId),
            firstUnitIndex: getGeneratedUnitFirstIndex(orderedGeneratedUnits, unitIndexByGeneratedUnit),
        }],
        score: bestMatch
            ? LanceTypeIdentifierUtil.getFormationPriorityWeight(bestMatch.definition, context.factionName)
            : 0,
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
    searchState: PreviewGroupSearchState,
    templateIndex: number,
    remainingIndices: readonly number[],
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

    const evaluateSelection = (selectedIndices: readonly number[]): boolean => {
        if (searchState.visits >= PREVIEW_GROUP_SEARCH_MAX_VISITS) {
            searchState.aborted = true;
            return true;
        }

        searchState.visits += 1;

        const cacheKey = `${template.signature}:${selectedIndices.join(',')}`;
        let childPlan = evaluationCache.get(cacheKey);
        if (childPlan === undefined) {
            const selectedIndexSet = new Set(selectedIndices);
            const childGeneratedUnits = generatedUnits.filter((_, index) => selectedIndexSet.has(index));
            const resolvedChildGroups = resolveFromUnits(
                childGeneratedUnits.map((generatedUnit) => generatedUnit.unit),
                context.faction,
                context.era,
            );
            const resolvedChildGroup = resolvedChildGroups.length === 1 && matchesPreviewGroupTemplate(resolvedChildGroups[0], template.group)
                ? resolvedChildGroups[0]
                : (!shouldSplitPreviewGroup(template.group) && childGeneratedUnits.length === template.unitCount
                    ? materializePreviewTemplateLeafGroup(template.group, childGeneratedUnits)
                    : null);

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

        const selectedIndexSet = new Set(selectedIndices);
        const nextRemainingIndices = remainingIndices.filter((index) => !selectedIndexSet.has(index));
        const tailPlan = searchOptimizedPreviewGroupPlan(
            templates,
            generatedUnits,
            context,
            unitIndexByGeneratedUnit,
            evaluationCache,
            searchState,
            templateIndex + 1,
            nextRemainingIndices,
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
    const searchState: PreviewGroupSearchState = { visits: 0, aborted: false };

    return searchOptimizedPreviewGroupPlan(
        templates,
        generatedUnits,
        context,
        unitIndexByGeneratedUnit,
        evaluationCache,
        searchState,
        0,
        generatedUnits.map((_, index) => index),
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

        total += candidate.cost;
        includedCount += 1;
        if (includedCount >= boundedCount) {
            break;
        }
    }

    return total;
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

function normalizeChassisKey(value: string | undefined): string {
    return value?.trim().toLowerCase() || '';
}

function buildAvailabilityPairKey(eraId: number, factionId: number): string {
    return `${eraId}:${factionId}`;
}

function serializeForceGenerationCacheIds(ids: readonly number[]): string {
    return [...new Set(ids)].sort((left, right) => left - right).join(',');
}

function buildForceGenerationUnitListSignature(units: readonly Pick<Unit, 'id'>[]): string {
    let rollingHash = 0;
    let weightedSum = 0;

    for (let index = 0; index < units.length; index += 1) {
        const unitId = units[index].id | 0;
        rollingHash = (((rollingHash * 33) ^ unitId) | 0);
        weightedSum = ((weightedSum + ((unitId * (index + 1)) | 0)) | 0);
    }

    return [
        units.length,
        units[0]?.id ?? 'none',
        units[units.length - 1]?.id ?? 'none',
        rollingHash >>> 0,
        weightedSum >>> 0,
    ].join(':');
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
    private readonly filtersService = inject(UnitSearchFiltersService);
    private readonly unitAvailabilitySource = inject(UnitAvailabilitySourceService);
    private availabilityWeightCache: ForceGenerationAvailabilityWeightCache | null = null;
    private baseCandidateCache: ForceGenerationBaseCandidateCache | null = null;
    private preparedCandidateCache: ForceGenerationPreparedCandidateCache | null = null;
    private selectionPreparationCache: ForceGenerationSelectionPreparationCache | null = null;

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
        const forceFaction = selectedFactions.length > 0
            ? this.pickForceFaction(selectedFactions, availablePairs)
            : this.dataService.getFactionById(MULFACTION_MERCENARY) ?? null;
        const forceEra = this.resolveContextEra(
            selectedEras,
            excludedEraIds,
            selectedFactions.length > 0 ? forceFaction : null,
            availablePairs,
            crossEraAvailabilityInMultiEraSelection,
        );
        const availabilityEraIds = this.resolveAvailabilityEraIds(
            selectedEras,
            excludedEraIds,
            forceEra,
            crossEraAvailabilityInMultiEraSelection,
        );
        const availabilityFactionIds = this.resolveAvailabilityFactionIds(
            selectedFactions,
            excludedFactionIds,
            availablePairs,
            availabilityEraIds,
        );
        const useAvailabilityFactionScope = this.shouldUseAvailabilityFactionScopeFromFilters(selectedFactions, availabilityFactionIds);
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
        };
    }

    public buildPreview(options: ForceGenerationRequest): ForceGenerationPreview {
        const eligibleUnits = options.eligibleUnits ?? this.filtersService.filteredUnits();
        const minUnitCount = Math.min(FORCE_MAX_UNITS, Math.max(1, Math.floor(options.minUnitCount)));
        const maxUnitCount = Math.min(FORCE_MAX_UNITS, Math.max(minUnitCount, Math.floor(options.maxUnitCount)));
        const budgetRange = this.normalizeBudgetRange(options.budgetRange);
        const availabilityWeightCache = this.resolveAvailabilityWeightCache(eligibleUnits, options.context);
        const lockedCandidates = (options.lockedUnits ?? []).map((lockedUnit, index) => this.createCandidateUnit(
            lockedUnit.unit,
            options.context,
            options,
            {
                ...lockedUnit,
                lockKey: lockedUnit.lockKey ?? `locked:${index}:${lockedUnit.unit.name}`,
            },
            availabilityWeightCache,
        ));
        const lockedUnitNames = new Set(lockedCandidates.map((candidate) => candidate.unit.name));
        const unlockedEligibleUnits = eligibleUnits.filter((unit) => !lockedUnitNames.has(unit.name));
        const preparedCandidateCache = this.resolvePreparedCandidateCache(
            eligibleUnits,
            options.context,
            options,
            availabilityWeightCache,
        );
        const availableUnitCapacity = unlockedEligibleUnits.length + lockedCandidates.length;

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
            );
        }

        const candidates = lockedUnitNames.size === 0
            ? preparedCandidateCache.candidates
            : preparedCandidateCache.candidates.filter((candidate) => !lockedUnitNames.has(candidate.unit.name));
        const availableCandidateCapacity = candidates.length + lockedCandidates.length;

        if (availableCandidateCapacity < minUnitCount) {
            const message = lockedCandidates.length > 0
                ? `Only ${availableCandidateCapacity} total units are available after preserving ${lockedCandidates.length} locked ${lockedCandidates.length === 1 ? 'unit' : 'units'}.`
                : this.getPositiveAvailabilityMessage(candidates.length, options.context);

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
            );
        }

        const hasResolvedRuleset = this.resolveRulesetContext(options.context.forceFaction, options.context.forceEra).primary !== null;
        const canReuseSelectionPreparationCache = lockedCandidates.length === 0 && !hasResolvedRuleset;
        const selectionPreparation = canReuseSelectionPreparationCache
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
            );

        if (this.isFirstCompatibleResultBudgetRequest(options.budgetRange)) {
            const selectionAttempt = this.buildCandidateSelection(
                candidates,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                false,
                lockedCandidates,
                options.preventDuplicateChassis === true,
                selectionPreparation,
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
        const candidateCosts = effectiveFallbackCandidates.map((candidate) => candidate.cost);
        const noUnderMaxForcePossible = Number.isFinite(budgetRange.max)
            && (lockedTotalCost > budgetRange.max
                || lockedTotalCost + getMinimumMetricTotal(candidateCosts, remainingMinUnitCount) > budgetRange.max);

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
        let attemptDurationEstimateMs = 0;
        let attemptLimit = attemptBudget.minAttempts;

        for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
            const attemptStartedAt = getForceGeneratorNow();
            const selectionAttempt = this.buildCandidateSelection(
                candidates,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                noUnderMaxForcePossible,
                lockedCandidates,
                options.preventDuplicateChassis === true,
                selectionPreparation,
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
                    const generatedUnits = selectionAttempt.selectedCandidates.map((candidate, index) => {
                        return this.createGeneratedUnit(candidate, index);
                    });

                    return {
                        gameSystem: options.gameSystem,
                        units: generatedUnits,
                        totalCost,
                        faction: options.context.forceFaction,
                        era: options.context.forceEra,
                        explanationLines: this.buildPreviewExplanation(
                            options.gameSystem,
                            eligibleUnits.length,
                            availableCandidateCapacity,
                            options.context,
                            budgetRange,
                            minUnitCount,
                            maxUnitCount,
                            selectionAttempt,
                            null,
                            lockedCandidates.length,
                            options.preventDuplicateChassis === true,
                        ),
                        error: null,
                    };
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
            const totalCost = bestValidAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
            const generatedUnits = bestValidAttempt.selectedCandidates.map((candidate, index) => {
                return this.createGeneratedUnit(candidate, index);
            });

            return {
                gameSystem: options.gameSystem,
                units: generatedUnits,
                totalCost,
                faction: options.context.forceFaction,
                era: options.context.forceEra,
                explanationLines: this.buildPreviewExplanation(
                    options.gameSystem,
                    eligibleUnits.length,
                    availableCandidateCapacity,
                    options.context,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    bestValidAttempt,
                    null,
                    lockedCandidates.length,
                    options.preventDuplicateChassis === true,
                ),
                error: null,
            };
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
            return null;
        }

        const faction = preview.faction ?? null;
        const era = preview.era ?? null;
        const resolvedName = name?.trim() || ForceNamerUtil.generateForceNameForFaction(faction);
        const previewGroups = buildPreviewGroups(preview.units, {
            faction: preview.faction
                ?? this.dataService.getFactionById(MULFACTION_MERCENARY)
                ?? DEFAULT_PREVIEW_FORCE_FACTION,
            era,
            gameSystem: preview.gameSystem,
            factionName: preview.faction?.name
                ?? this.dataService.getFactionById(MULFACTION_MERCENARY)?.name
                ?? DEFAULT_PREVIEW_FORCE_FACTION.name,
        });

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

                    const productionWeight = weights[0] ?? 0;
                    const salvageWeight = weights[1] ?? 0;
                    if (productionWeight <= 0 && salvageWeight <= 0) {
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
            productionWeight: availabilityWeights.production,
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
        const skill = options.gameSystem === GameSystem.ALPHA_STRIKE
            ? options.gunnery
            : undefined;
        const gunnery = options.gameSystem === GameSystem.CLASSIC
            ? options.gunnery
            : undefined;
        const piloting = options.gameSystem === GameSystem.CLASSIC
            ? getEffectivePilotingSkill(unit, options.piloting)
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
        const unitById = new Map(eligibleUnits.map((unit) => [unit.id, unit]));
        const weightsByUnitId = useMegaMekAvailability
            ? this.buildMegaMekAvailabilityWeightMap(scopeState, eligibleUnits)
            : this.buildMulAvailabilityWeightMap(scopeState, eligibleUnits, unitById);

        return {
            signature,
            useMegaMekAvailability,
            scopeState,
            weightsByUnitId,
        };
    }

    private buildMegaMekAvailabilityWeightMap(
        scopeState: ForceGenerationAvailabilityScopeState,
        eligibleUnits: readonly Unit[],
        exactPairKeysByUnitId?: Map<number, Set<string>>,
        includeUnknownForMissingRecords = true,
    ): Map<number, { production: number; salvage: number }> {
        const weightsByUnitId = new Map<number, { production: number; salvage: number }>();
        if (scopeState.pairCount <= 0) {
            if (includeUnknownForMissingRecords) {
                for (const unit of eligibleUnits) {
                    weightsByUnitId.set(unit.id, {
                        production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                        salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                    });
                }
            }
            return weightsByUnitId;
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
                    weightsByUnitId.set(unit.id, {
                        production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                        salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                    });
                }
                continue;
            }

            if (exactEraIdText !== null && exactFactionIdText !== null) {
                const exactWeights = {
                    production: record.e[exactEraIdText]?.[exactFactionIdText]?.[0] ?? 0,
                    salvage: record.e[exactEraIdText]?.[exactFactionIdText]?.[1] ?? 0,
                };
                const exactValue = record.e[exactEraIdText]?.[exactFactionIdText];
                weightsByUnitId.set(unit.id, exactWeights);

                if (exactValue && exactPairKeysByUnitId && exactPairKey !== null) {
                    exactPairKeysByUnitId.set(unit.id, new Set<string>([exactPairKey]));
                }

                continue;
            }

            let productionMax = 0;
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

                    if (exactPairKeysByUnitId) {
                        exactPairKeys ??= new Set<string>();
                        exactPairKeys.add(`${eraIdText}:${factionIdText}`);
                    }

                    const value = eraAvailability[factionIdText];
                    const production = value[0] ?? 0;
                    const salvage = value[1] ?? 0;
                    if (production > productionMax) {
                        productionMax = production;
                    }
                    if (salvage > salvageMax) {
                        salvageMax = salvage;
                    }
                }
            }

            weightsByUnitId.set(unit.id, {
                production: productionMax,
                salvage: salvageMax,
            });

            if (exactPairKeysByUnitId && exactPairKeys && exactPairKeys.size > 0) {
                exactPairKeysByUnitId.set(unit.id, exactPairKeys);
            }
        }

        return weightsByUnitId;
    }

    private buildMulAvailabilityWeightMap(
        scopeState: ForceGenerationAvailabilityScopeState,
        eligibleUnits: readonly Unit[],
        unitById: ReadonlyMap<number, Unit>,
    ): Map<number, { production: number; salvage: number }> {
        if (scopeState.pairCount <= 0) {
            const zeroWeightsByUnitId = new Map<number, { production: number; salvage: number }>();
            for (const unit of eligibleUnits) {
                zeroWeightsByUnitId.set(unit.id, {
                    production: 0,
                    salvage: 0,
                });
            }
            return zeroWeightsByUnitId;
        }

        const exactPairKeysByUnitId = new Map<number, Set<string>>();
        const eligibleUnitIds = new Set(eligibleUnits.map((unit) => unit.id));
        const weightsByUnitId = this.buildMegaMekAvailabilityWeightMap(
            scopeState,
            eligibleUnits,
            exactPairKeysByUnitId,
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
                if (Number.isNaN(unitId) || !eligibleUnitIds.has(unitId) || exactPairKeysByUnitId.get(unitId)?.has(pairKey)) {
                    continue;
                }

                const unit = unitById.get(unitId);
                const exactValue = unit
                    ? this.dataService.getMegaMekAvailabilityRecordForUnit(unit)?.e[String(pair.eraId)]?.[String(pair.factionId)]
                    : undefined;
                if (exactValue !== undefined) {
                    const weights = weightsByUnitId.get(unitId) ?? {
                        production: 0,
                        salvage: 0,
                    };
                    const production = exactValue[0] ?? 0;
                    const salvage = exactValue[1] ?? 0;
                    if (production > weights.production) {
                        weights.production = production;
                    }
                    if (salvage > weights.salvage) {
                        weights.salvage = salvage;
                    }
                    weightsByUnitId.set(unitId, weights);
                    continue;
                }

                const weights = weightsByUnitId.get(unitId);
                if (weights) {
                    if (weights.production < DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT) {
                        weights.production = DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT;
                    }
                    if (weights.salvage < DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT) {
                        weights.salvage = DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT;
                    }
                    continue;
                }

                weightsByUnitId.set(unitId, {
                    production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                    salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                });
            }
        }

        for (const unit of eligibleUnits) {
            if (!weightsByUnitId.has(unit.id)) {
                weightsByUnitId.set(unit.id, {
                    production: 0,
                    salvage: 0,
                });
            }
        }

        return weightsByUnitId;
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
    ): { production: number; salvage: number } {
        const cachedWeights = availabilityWeightCache?.weightsByUnitId.get(unit.id);
        if (cachedWeights !== undefined) {
            return cachedWeights;
        }

        const computedWeights = this.getAvailabilityWeights(unit, context, availabilityWeightCache?.scopeState);
        availabilityWeightCache?.weightsByUnitId.set(unit.id, computedWeights);
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
            `g:${options.gunnery}`,
            `p:${options.piloting}`,
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
        const weightsByUnitId = availabilityWeightCache.weightsByUnitId;
        const candidates: ForceGenerationCandidateUnit[] = [];

        for (const baseCandidate of baseCandidateCache.candidates) {
            const availabilityWeights = this.getCachedAvailabilityWeights(
                baseCandidate.unit,
                context,
                availabilityWeightCache,
            );

            if (availabilityWeights.production <= 0 && availabilityWeights.salvage <= 0) {
                continue;
            }

            candidates.push({
                unit: baseCandidate.unit,
                productionWeight: availabilityWeights.production,
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
            `g:${options.gunnery}`,
            `p:${options.piloting}`,
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
    ): { production: number; salvage: number } {
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
    ): { production: number; salvage: number } {
        const scopeState = availabilityScopeState ?? this.buildAvailabilityScopeState(context);
        if (scopeState.pairCount <= 0) {
            return useMegaMekAvailability
                ? {
                    production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                    salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                }
                : {
                    production: 0,
                    salvage: 0,
                };
        }

        if (!availabilityRecord && useMegaMekAvailability) {
            return {
                production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
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
            productionMax: 0,
            salvageMax: 0,
        };
    }

    private accumulateAvailabilityReductionState(
        state: ForceGenerationAvailabilityReductionState,
        weights: { production: number; salvage: number },
    ): void {
        this.accumulateAvailabilityReductionValues(state, weights.production, weights.salvage);
    }

    private accumulateAvailabilityReductionValues(
        state: ForceGenerationAvailabilityReductionState,
        production: number,
        salvage: number,
    ): void {
        if (production > state.productionMax) {
            state.productionMax = production;
        }

        if (salvage > state.salvageMax) {
            state.salvageMax = salvage;
        }
    }

    private finalizeAvailabilityReductionState(
        state: ForceGenerationAvailabilityReductionState,
    ): { production: number; salvage: number } {
        return {
            production: state.productionMax,
            salvage: state.salvageMax,
        };
    }

    private reduceScopedAvailabilityWeights(
        scopeState: ForceGenerationAvailabilityScopeState,
        getPairWeights: (eraId: number, factionId: number) => { production: number; salvage: number },
    ): { production: number; salvage: number } {
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
    ): { production: number; salvage: number } {
        if (!availabilityRecord) {
            return {
                production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
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
    ): { production: number; salvage: number } {
        if (useMegaMekAvailability) {
            return {
                production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
            };
        }

        return this.getMulFallbackWeightsForPair(unit, eraId, factionId) ?? {
            production: 0,
            salvage: 0,
        };
    }

    private getAvailabilityWeightsForPair(
        unit: Unit,
        availabilityRecord: MegaMekWeightedAvailabilityRecord,
        eraId: number,
        factionId: number,
        useMegaMekAvailability: boolean,
    ): { production: number; salvage: number } {
        const exactValue = availabilityRecord.e[String(eraId)]?.[String(factionId)];

        if (useMegaMekAvailability || exactValue) {
            return {
                production: exactValue?.[0] ?? 0,
                salvage: exactValue?.[1] ?? 0,
            };
        }

        const mulFallbackWeights = this.getMulFallbackWeightsForPair(unit, eraId, factionId);
        if (mulFallbackWeights) {
            return mulFallbackWeights;
        }

        return {
            production: 0,
            salvage: 0,
        };
    }

    private getMulFallbackWeightsForPair(
        unit: Unit,
        eraId: number,
        factionId: number,
    ): { production: number; salvage: number } | null {
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
            production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
            salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
        };
    }

    private createGeneratedUnit(candidate: ForceGenerationCandidateUnit, index: number): GeneratedForceUnit {
        return {
            unit: candidate.unit,
            cost: candidate.cost,
            skill: candidate.skill,
            gunnery: candidate.gunnery,
            piloting: candidate.piloting,
            alias: candidate.alias,
            commander: candidate.commander,
            lockKey: candidate.lockKey ?? `generated:${index}:${candidate.unit.name}`,
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
        selectionAttempt: ForceGenerationSelectionAttempt | null,
        error: string | null,
        lockedUnitCount: number,
        preventDuplicateChassis: boolean,
    ): string[] {
        const lines: string[] = [];
        const budgetLabel = gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
        const maxLabel = Number.isFinite(budgetRange.max) ? budgetRange.max.toLocaleString() : 'no max';
        lines.push(`Eligible units: ${eligibleUnitCount} units. Availability-positive candidates: ${candidateUnitCount} units. Target: ${minUnitCount}-${maxUnitCount} units, ${budgetLabel} ${budgetRange.min.toLocaleString()} to ${maxLabel}.`);

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
            for (const note of selectionAttempt.rulesetProfile.explanationNotes) {
                lines.push(note);
            }
            if (selectionAttempt.structureEvaluation) {
                lines.push(selectionAttempt.structureEvaluation.summary);
            }
        } else if (context.ruleset) {
            lines.push(`Ruleset guidance: ${context.ruleset.factionKey}, but no matching force node added extra constraints.`);
        } else {
            lines.push('Ruleset guidance: none resolved, so picks used weighted search only.');
        }

        for (const [index, step] of (selectionAttempt?.selectionSteps ?? []).entries()) {
            if (step.locked) {
                const reasons = step.rulesetReasons.length > 0
                    ? `; ruleset bias ${step.rulesetReasons.join(', ')}`
                    : '';
                lines.push(
                    `${index + 1}. ${formatForceGenerationUnitLabel(step.unit)}: locked, P ${formatForceGeneratorWeight(step.productionWeight)} / S ${formatForceGeneratorWeight(step.salvageWeight)}, ${step.cost.toLocaleString()} ${budgetLabel}${reasons}.`,
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
                `${index + 1}. ${formatForceGenerationUnitLabel(step.unit)}: ${step.source} pick${fallbackNote}, P ${formatForceGeneratorWeight(step.productionWeight)} / S ${formatForceGeneratorWeight(step.salvageWeight)}, ${step.cost.toLocaleString()} ${budgetLabel}${reasons}.`,
            );
        }

        if (error) {
            lines.push(`Result note: ${error}`);
        }

        return lines;
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
    ): ForceGenerationPreview {
        if (!selectionAttempt.structureEvaluation) {
            const structureEvaluation = this.evaluateSelectionStructure(selectionAttempt, options.context);
            if (structureEvaluation) {
                selectionAttempt.structureEvaluation = structureEvaluation;
            }
        }

        const totalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        const units = selectionAttempt.selectedCandidates.map((candidate, index) => this.createGeneratedUnit(candidate, index));
        const explanationLines = this.buildPreviewExplanation(
            options.gameSystem,
            eligibleUnitCount,
            candidateUnitCount,
            options.context,
            budgetRange,
            minUnitCount,
            maxUnitCount,
            selectionAttempt,
            error,
            (options.lockedUnits ?? []).length,
            options.preventDuplicateChassis === true,
        );

        if (resultNote && resultNote !== error) {
            explanationLines.push(`Result note: ${resultNote}`);
        }

        return {
            gameSystem: options.gameSystem,
            units,
            totalCost,
            faction: options.context.forceFaction,
            era: options.context.forceEra,
            explanationLines,
            error,
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
    ): ForceGenerationPreview {
        return {
            gameSystem: options.gameSystem,
            units: [],
            totalCost: 0,
            faction: options.context.forceFaction,
            era: options.context.forceEra,
            explanationLines: this.buildPreviewExplanation(
                options.gameSystem,
                eligibleUnitCount,
                candidateUnitCount,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                null,
                error,
                (options.lockedUnits ?? []).length,
                options.preventDuplicateChassis === true,
            ),
            error,
        };
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

    private resolveAttemptLimit(
        attemptBudget: ForceGenerationAttemptBudget,
        completedAttempts: number,
        attemptDurationEstimateMs: number,
        elapsedMs: number,
        hasValidAttempt: boolean,
    ): number {
        if (completedAttempts < attemptBudget.minAttempts) {
            return attemptBudget.minAttempts;
        }

        const targetDurationMs = hasValidAttempt
            ? attemptBudget.targetDurationMs
            : FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS;
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

    private getBudgetProgressScore(
        nextTotal: number,
        budgetRange: { min: number; max: number },
        targetBudget: number,
        nextUnitCount: number,
        preferredUnitCount?: number,
    ): number {
        let score: number;

        if (budgetRange.min > 0 && nextTotal < budgetRange.min) {
            const denominator = Math.max(1, budgetRange.min);
            score = 1 + ((denominator - Math.min(denominator, budgetRange.min - nextTotal)) / denominator);
        } else if (!Number.isFinite(targetBudget) || targetBudget <= 0) {
            score = 1;
        } else {
            const span = Number.isFinite(budgetRange.max)
                ? Math.max(1, budgetRange.max - budgetRange.min)
                : Math.max(1, targetBudget);
            score = 1 + ((span - Math.min(span, Math.abs(targetBudget - nextTotal))) / span);
        }

        if (preferredUnitCount !== undefined && preferredUnitCount > 0 && Number.isFinite(targetBudget) && targetBudget > 0) {
            const boundedPreferredCount = Math.max(1, preferredUnitCount);
            const boundedStepCount = Math.min(nextUnitCount, boundedPreferredCount);
            const expectedTotal = targetBudget * (boundedStepCount / boundedPreferredCount);
            const denominator = Math.max(1, expectedTotal);
            score *= 1 + ((denominator - Math.min(denominator, Math.abs(expectedTotal - nextTotal))) / denominator);
        }

        return score;
    }

    private getAvailabilityWeightForSource(
        candidate: ForceGenerationCandidateUnit,
        source: ForceGenerationAvailabilitySource,
    ): number {
        return source === 'production' ? candidate.productionWeight : candidate.salvageWeight;
    }

    private pickAvailabilitySource(candidates: readonly ForceGenerationCandidateUnit[]): ForceGenerationAvailabilitySource {
        const productionTotal = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.productionWeight), 0);
        const salvageTotal = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.salvageWeight), 0);

        return pickWeightedRandomEntry<ForceGenerationAvailabilitySource>(
            ['production', 'salvage'],
            (source) => source === 'production' ? productionTotal : salvageTotal,
        );
    }

    private pickNextCandidate(
        candidates: readonly ForceGenerationCandidateUnit[],
        rulesetProfile: ForceGenerationRulesetProfile | null,
        totalCost: number,
        budgetRange: { min: number; max: number },
        currentUnitCount: number,
        preferredUnitCount?: number,
        selectionPreparation?: ForceGenerationSelectionPreparation,
    ): {
        candidate: ForceGenerationCandidateUnit;
        rolledSource: ForceGenerationAvailabilitySource;
        source: ForceGenerationAvailabilitySource;
        usedFallbackSource: boolean;
    } {
        const source = this.pickAvailabilitySource(candidates);
        const alternateSource: ForceGenerationAvailabilitySource = source === 'production' ? 'salvage' : 'production';
        const sourceCandidates = candidates.filter((candidate) => this.getAvailabilityWeightForSource(candidate, source) > 0);
        const alternateCandidates = candidates.filter((candidate) => this.getAvailabilityWeightForSource(candidate, alternateSource) > 0);
        const weightedCandidates = sourceCandidates.length > 0
            ? sourceCandidates
            : alternateCandidates.length > 0
                ? alternateCandidates
                : candidates;
        const weightedSource = sourceCandidates.length > 0 ? source : alternateCandidates.length > 0 ? alternateSource : source;
        const targetBudget = this.getBudgetTarget(budgetRange);

        return {
            candidate: pickWeightedRandomEntry(weightedCandidates, (candidate) => {
                const availabilityWeight = Math.max(0.05, this.getAvailabilityWeightForSource(candidate, weightedSource));
                const budgetScore = this.getBudgetProgressScore(
                    totalCost + candidate.cost,
                    budgetRange,
                    targetBudget,
                    currentUnitCount + 1,
                    preferredUnitCount,
                );
                const rulesetScore = selectionPreparation?.rulesetScoreByCandidate.get(candidate)
                    ?? this.getRulesetMatchScore(candidate, rulesetProfile);
                return availabilityWeight * budgetScore * rulesetScore;
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
        const lowestCostRemainingCandidates = [...preparedSelection.lowestCostCandidates];
        const highestCostRemainingCandidates = [...preparedSelection.highestCostCandidates];
        const selectedCandidates: ForceGenerationCandidateUnit[] = [...preselectedCandidates];
        const selectionSteps: ForceGenerationSelectionStep[] = preselectedCandidates.map((candidate) => {
            return this.createSelectionStep(candidate, rulesetProfile, {}, preparedSelection);
        });
        let totalCost = selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        const preferredSelectionUnitCount = this.getPreferredSelectionUnitCount(
            rulesetProfile?.preferredUnitCount,
            minUnitCount,
            maxUnitCount,
        );
        const targetBudget = this.getBudgetTarget(budgetRange);
        const useOverMaxFallbackSelection = allowOverMaxFallbackSelection && Number.isFinite(budgetRange.max);
        const selectedChassisKeys = new Set(
            selectedCandidates
                .map((candidate) => normalizeChassisKey(candidate.unit.chassis))
                .filter((key) => key.length > 0),
        );

        while (selectedCandidates.length < maxUnitCount) {
            if (
                selectedCandidates.length >= minUnitCount
                && (
                    (
                        this.isBudgetWithinRange(totalCost, budgetRange)
                        && ((preferredSelectionUnitCount !== undefined && selectedCandidates.length >= preferredSelectionUnitCount)
                            || (preferredSelectionUnitCount === undefined && totalCost >= targetBudget))
                    )
                    || (useOverMaxFallbackSelection && totalCost > budgetRange.max)
                )
            ) {
                break;
            }

            const remainingCandidateCountAfterPick = remainingCandidates.length - 1;
            const requiredAfterPick = Math.max(0, minUnitCount - selectedCandidates.length - 1);
            if (requiredAfterPick > remainingCandidateCountAfterPick) {
                break;
            }

            const remainingSlotsAfterPick = maxUnitCount - selectedCandidates.length - 1;

            const underMaxCandidates = remainingCandidates.filter((candidate) => {
                const nextTotal = totalCost + candidate.cost;
                if (nextTotal > budgetRange.max) {
                    return false;
                }

                const minimumRemainingTotal = getOrderedCandidateCostTotalExcluding(
                    lowestCostRemainingCandidates,
                    candidate,
                    requiredAfterPick,
                );
                if (nextTotal + minimumRemainingTotal > budgetRange.max) {
                    return false;
                }

                return true;
            });

            const feasibleCandidates = underMaxCandidates.filter((candidate) => {
                const nextTotal = totalCost + candidate.cost;

                const maximumRemainingTotal = getOrderedCandidateCostTotalExcluding(
                    highestCostRemainingCandidates,
                    candidate,
                    remainingSlotsAfterPick,
                );
                return nextTotal + maximumRemainingTotal >= budgetRange.min;
            });

            const candidatePool = feasibleCandidates.length > 0
                ? feasibleCandidates
                : useOverMaxFallbackSelection && selectedCandidates.length < minUnitCount
                    ? remainingCandidates
                    : underMaxCandidates;

            const chassisFilteredCandidatePool = preventDuplicateChassis
                ? candidatePool.filter((candidate) => {
                    const chassisKey = normalizeChassisKey(candidate.unit.chassis);
                    return chassisKey.length === 0 || !selectedChassisKeys.has(chassisKey);
                })
                : candidatePool;

            if (chassisFilteredCandidatePool.length === 0) {
                break;
            }

            const nextPick = this.pickNextCandidate(
                chassisFilteredCandidatePool,
                rulesetProfile,
                totalCost,
                budgetRange,
                selectedCandidates.length,
                preferredSelectionUnitCount,
                preparedSelection,
            );
            const nextCandidate = nextPick.candidate;
            selectedCandidates.push(nextCandidate);
            totalCost += nextCandidate.cost;
            remainingCandidates.splice(remainingCandidates.indexOf(nextCandidate), 1);
            const lowestCostIndex = lowestCostRemainingCandidates.indexOf(nextCandidate);
            if (lowestCostIndex >= 0) {
                lowestCostRemainingCandidates.splice(lowestCostIndex, 1);
            }
            const highestCostIndex = highestCostRemainingCandidates.indexOf(nextCandidate);
            if (highestCostIndex >= 0) {
                highestCostRemainingCandidates.splice(highestCostIndex, 1);
            }
            const chassisKey = normalizeChassisKey(nextCandidate.unit.chassis);
            if (chassisKey.length > 0) {
                selectedChassisKeys.add(chassisKey);
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
        const source: ForceGenerationAvailabilitySource = candidate.productionWeight >= candidate.salvageWeight
            ? 'production'
            : 'salvage';

        return {
            unit: candidate.unit,
            locked: candidate.locked,
            rolledSource: overrides.rolledSource ?? source,
            source: overrides.source ?? source,
            usedFallbackSource: overrides.usedFallbackSource ?? false,
            productionWeight: candidate.productionWeight,
            salvageWeight: candidate.salvageWeight,
            cost: candidate.cost,
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
            currentSummary.totalAvailabilityWeight += Math.max(0, candidate.productionWeight) + Math.max(0, candidate.salvageWeight);
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