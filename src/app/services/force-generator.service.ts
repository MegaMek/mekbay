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

import { Injectable, inject } from '@angular/core';

import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
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
import { LoadForceEntry, type LoadForceGroup } from '../models/load-force-entry.model';
import { MULFACTION_EXTINCT, MULFACTION_MERCENARY } from '../models/mulfactions.model';
import type { Options } from '../models/options.model';
import type { Unit } from '../models/units.model';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { getEffectivePilotingSkill } from '../utils/cbt-common.util';
import { getPositiveFactionNamesFromFilter } from '../utils/faction-filter.util';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { PVCalculatorUtil } from '../utils/pv-calculator.util';
import { DataService } from './data.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';

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
    megaMekUnitType: string;
    megaMekWeightClass?: string;
    role?: string;
    motive?: string;
}

type ForceGenerationAvailabilitySource = 'production' | 'salvage';
type ForceGenerationSelectionStrategy = 'greedy' | 'weighted';

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

interface ForceGenerationRulesetProfile {
    selectedEchelon?: string;
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
    rolledSource: ForceGenerationAvailabilitySource;
    source: ForceGenerationAvailabilitySource;
    usedFallbackSource: boolean;
    sourceRollProbability: number;
    candidatePickProbability: number;
    productionWeight: number;
    salvageWeight: number;
    cost: number;
    rulesetReasons: string[];
}

interface ForceGenerationSelectionAttempt {
    selectedCandidates: ForceGenerationCandidateUnit[];
    selectionSteps: ForceGenerationSelectionStep[];
    rulesetProfile: ForceGenerationRulesetProfile | null;
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
}

export interface ForceGenerationBudgetRange {
    min: number;
    max: number;
}

export interface ForceGenerationContext {
    forceFaction: Faction | null;
    forceEra: Era | null;
    averagingFactionIds: readonly number[];
    averagingEraIds: readonly number[];
    availablePairCount: number;
    ruleset: MegaMekRulesetRecord | null;
}

export interface GeneratedForceUnit {
    unit: Unit;
    cost: number;
    skill?: number;
    gunnery?: number;
    piloting?: number;
}

export interface ForceGeneratorBudgetDefaults {
    classic: ForceGenerationBudgetRange;
    alphaStrike: ForceGenerationBudgetRange;
}

const DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT = 1;
const FORCE_GENERATION_MIN_RANDOM_ATTEMPTS = 8;
const FORCE_GENERATION_MAX_RANDOM_ATTEMPTS = 64;
const FORCE_GENERATION_MAX_EXACT_RANDOM_ATTEMPTS = 72;
const FORCE_GENERATION_CHEAP_TARGET_WINDOW_MS = 10;
const FORCE_GENERATION_MAX_SEARCH_WINDOW_MS = 50;
const FORCE_GENERATION_MAX_EXACT_SEARCH_WINDOW_MS = 45;
const FORCE_GENERATION_FAST_SUCCESS_POOL_SIZE = 6;
const FORCE_GENERATION_MEDIUM_SUCCESS_POOL_SIZE = 4;
const FORCE_GENERATION_MIN_SUCCESS_POOL_SIZE = 2;

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

function normalizeInitialBudgetRange(min: number, max: number): ForceGenerationBudgetRange {
    const normalizedMin = Math.max(0, min);
    const normalizedMax = Math.max(0, max);

    return {
        min: normalizedMax > 0 ? Math.min(normalizedMin, normalizedMax) : normalizedMin,
        max: normalizedMax,
    };
}

function getForceGenerationSearchTime(): number {
    return typeof globalThis.performance?.now === 'function'
        ? globalThis.performance.now()
        : Date.now();
}

function getBudgetMetric(unit: Unit, gameSystem: GameSystem, gunnery: number, piloting: number): number {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        return Math.max(0, PVCalculatorUtil.calculateAdjustedPV(unit.as.PV, gunnery));
    }

    return Math.max(0, BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, getEffectivePilotingSkill(unit, piloting)));
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

function getMaximumMetricTotal(values: readonly number[], count: number): number {
    if (count <= 0) {
        return 0;
    }

    return [...values]
        .sort((left, right) => right - left)
        .slice(0, count)
        .reduce((sum, value) => sum + value, 0);
}

function pickWeightedRandomEntry<T>(entries: readonly T[], getWeight: (entry: T) => number): T {
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

function buildAvailabilityPairKey(eraId: number, factionId: number): string {
    return `${eraId}:${factionId}`;
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

function formatForceGenerationPercent(value: number): string {
    const boundedPercent = Math.max(0, Math.min(100, value * 100));
    const digits = boundedPercent >= 10 ? 0 : 1;
    return `${boundedPercent.toFixed(digits)}%`;
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

@Injectable({
    providedIn: 'root',
})
export class ForceGeneratorService {
    private readonly dataService = inject(DataService);
    private readonly filtersService = inject(UnitSearchFiltersService);

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

    public getStoredBudgetOptionKeys(gameSystem: GameSystem): {
        min: 'forceGenLastBVMin' | 'forceGenLastPVMin';
        max: 'forceGenLastBVMax' | 'forceGenLastPVMax';
    } {
        return gameSystem === GameSystem.ALPHA_STRIKE
            ? { min: 'forceGenLastPVMin', max: 'forceGenLastPVMax' }
            : { min: 'forceGenLastBVMin', max: 'forceGenLastBVMax' };
    }

    public getBudgetMetric(unit: Unit, gameSystem: GameSystem, gunnery: number, piloting: number): number {
        return getBudgetMetric(unit, gameSystem, gunnery, piloting);
    }

    public resolveGenerationContext(eligibleUnits: readonly Unit[]): ForceGenerationContext {
        const selectedEras = this.resolveSelectedEras();
        const selectedFactions = this.resolveSelectedFactions();
        const availablePairs = this.collectPositiveAvailabilityPairs(
            eligibleUnits,
            selectedEras.map((era) => era.id),
            selectedFactions.map((faction) => faction.id),
        );
        const forceFaction = this.pickForceFaction(selectedFactions, availablePairs);
        const forceEra = this.pickForceEra(selectedEras, forceFaction, availablePairs);
        const averagingFactionIds = selectedFactions.length > 0
            ? selectedFactions.map((faction) => faction.id)
            : forceFaction
                ? [forceFaction.id]
                : [];
        const averagingEraIds = selectedEras.length > 0
            ? selectedEras.map((era) => era.id)
            : forceEra
                ? [forceEra.id]
                : [];
        const rulesetContext = this.resolveRulesetContext(forceFaction, forceEra);

        return {
            forceFaction,
            forceEra,
            averagingFactionIds,
            averagingEraIds,
            availablePairCount: availablePairs.length,
            ruleset: rulesetContext.primary,
        };
    }

    public buildPreview(options: ForceGenerationRequest): ForceGenerationPreview {
        const eligibleUnits = options.eligibleUnits ?? this.filtersService.filteredUnits();
        const minUnitCount = Math.max(1, Math.floor(options.minUnitCount));
        const maxUnitCount = Math.max(minUnitCount, Math.floor(options.maxUnitCount));
        const budgetRange = this.normalizeBudgetRange(options.budgetRange);
        const candidates = eligibleUnits.map((unit) => this.createCandidateUnit(unit, options.context, options));

        if (eligibleUnits.length < minUnitCount) {
            return {
                gameSystem: options.gameSystem,
                units: [],
                totalCost: 0,
                faction: options.context.forceFaction,
                era: options.context.forceEra,
                explanationLines: this.buildPreviewExplanation(
                    options.gameSystem,
                    eligibleUnits.length,
                    options.context,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    null,
                    `Only ${eligibleUnits.length} eligible units match the current filters.`,
                ),
                error: `Only ${eligibleUnits.length} eligible units match the current filters.`,
            };
        }

        const candidateCosts = candidates.map((candidate) => candidate.cost);
        if (getMinimumMetricTotal(candidateCosts, minUnitCount) > budgetRange.max) {
            return {
                gameSystem: options.gameSystem,
                units: [],
                totalCost: 0,
                faction: options.context.forceFaction,
                era: options.context.forceEra,
                explanationLines: this.buildPreviewExplanation(
                    options.gameSystem,
                    eligibleUnits.length,
                    options.context,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    null,
                    'The selected BV/PV maximum is too low to satisfy the minimum unit count.',
                ),
                error: 'The selected BV/PV maximum is too low to satisfy the minimum unit count.',
            };
        }

        if (budgetRange.min > 0 && getMaximumMetricTotal(candidateCosts, Math.min(maxUnitCount, candidateCosts.length)) < budgetRange.min) {
            return {
                gameSystem: options.gameSystem,
                units: [],
                totalCost: 0,
                faction: options.context.forceFaction,
                era: options.context.forceEra,
                explanationLines: this.buildPreviewExplanation(
                    options.gameSystem,
                    eligibleUnits.length,
                    options.context,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    null,
                    'The selected BV/PV minimum is too high for the current unit count range.',
                ),
                error: 'The selected BV/PV minimum is too high for the current unit count range.',
            };
        }

        let bestAttempt: ForceGenerationSelectionAttempt = {
            selectedCandidates: [],
            selectionSteps: [],
            rulesetProfile: null,
        };
        let bestAttemptTotalCost = 0;
        let bestAttemptDistance = Number.POSITIVE_INFINITY;
        const successfulAttempts: Array<{ selectionAttempt: ForceGenerationSelectionAttempt; totalCost: number }> = [];
        const successfulAttemptKeys = new Set<string>();
        let successPoolTarget: number | null = null;
        const targetBudget = this.getBudgetTarget(budgetRange);
        const searchStartedAt = getForceGenerationSearchTime();
        const exactBudgetRequested = this.isExactBudgetRange(budgetRange);
        const randomAttemptCount = this.getRandomAttemptCount(candidates.length, budgetRange, exactBudgetRequested);
        const searchWindowMs = exactBudgetRequested
            ? FORCE_GENERATION_MAX_EXACT_SEARCH_WINDOW_MS
            : FORCE_GENERATION_MAX_SEARCH_WINDOW_MS;

        const buildSuccessfulPreview = (selectionAttempt: ForceGenerationSelectionAttempt, totalCost: number): ForceGenerationPreview => {
            const generatedUnits = selectionAttempt.selectedCandidates.map((candidate) => this.createGeneratedUnit(
                candidate.unit,
                options.gameSystem,
                options.gunnery,
                options.piloting,
            ));

            return {
                gameSystem: options.gameSystem,
                units: generatedUnits,
                totalCost,
                faction: options.context.forceFaction,
                era: options.context.forceEra,
                explanationLines: this.buildPreviewExplanation(
                    options.gameSystem,
                    eligibleUnits.length,
                    options.context,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    selectionAttempt,
                    null,
                ),
                error: null,
            };
        };

        const rememberSuccessfulAttempt = (selectionAttempt: ForceGenerationSelectionAttempt, totalCost: number): void => {
            const attemptKey = this.getSelectionAttemptKey(selectionAttempt);
            if (successfulAttemptKeys.has(attemptKey)) {
                return;
            }

            successfulAttemptKeys.add(attemptKey);
            successfulAttempts.push({ selectionAttempt, totalCost });
        };

        const considerAttempt = (
            selectionAttempt: ForceGenerationSelectionAttempt,
            collectSuccess: boolean,
        ): { totalCost: number; isValid: boolean; reachedBudgetGoal: boolean } => {
            const totalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
            const distance = this.getBudgetRangeDistance(totalCost, budgetRange);
            const isValid = selectionAttempt.selectedCandidates.length >= minUnitCount
                && selectionAttempt.selectedCandidates.length <= maxUnitCount
                && this.isBudgetWithinRange(totalCost, budgetRange);

            if (
                distance < bestAttemptDistance
                || (distance === bestAttemptDistance && selectionAttempt.selectedCandidates.length > bestAttempt.selectedCandidates.length)
            ) {
                bestAttempt = selectionAttempt;
                bestAttemptDistance = distance;
                bestAttemptTotalCost = totalCost;
            }

            if (isValid && !exactBudgetRequested && collectSuccess) {
                rememberSuccessfulAttempt(selectionAttempt, totalCost);
            }

            return {
                totalCost,
                isValid,
                reachedBudgetGoal: isValid && this.hasReachedBudgetTarget(totalCost, budgetRange, targetBudget),
            };
        };

        if (exactBudgetRequested) {
            const greedyAttempt = this.buildCandidateSelection(
                candidates,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                'greedy',
            );
            const greedyResult = considerAttempt(greedyAttempt, false);
            if (greedyResult.reachedBudgetGoal) {
                return buildSuccessfulPreview(bestAttempt, bestAttemptTotalCost);
            }
        }

        for (let attempt = 0; attempt < randomAttemptCount; attempt += 1) {
            if (getForceGenerationSearchTime() - searchStartedAt >= searchWindowMs) {
                break;
            }

            const selectionAttempt = this.buildCandidateSelection(
                candidates,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                'weighted',
            );
            const result = considerAttempt(selectionAttempt, true);

            if (result.reachedBudgetGoal && exactBudgetRequested) {
                return buildSuccessfulPreview(bestAttempt, bestAttemptTotalCost);
            }

            if (!exactBudgetRequested && result.isValid) {
                if (successPoolTarget === null) {
                    const elapsed = getForceGenerationSearchTime() - searchStartedAt;
                    successPoolTarget = this.getSuccessPoolTarget(elapsed, searchWindowMs);
                }

                if (successfulAttempts.length >= successPoolTarget) {
                    break;
                }
            }
        }

        if (!exactBudgetRequested && successfulAttempts.length > 0) {
            const successIndex = Math.floor(Math.random() * successfulAttempts.length);
            const selectedSuccess = successfulAttempts[successIndex];
            return buildSuccessfulPreview(selectedSuccess.selectionAttempt, selectedSuccess.totalCost);
        }

        if (
            bestAttempt.selectedCandidates.length >= minUnitCount
            && bestAttempt.selectedCandidates.length <= maxUnitCount
            && this.isBudgetWithinRange(bestAttemptTotalCost, budgetRange)
        ) {
            return buildSuccessfulPreview(bestAttempt, bestAttemptTotalCost);
        }

        if (exactBudgetRequested) {
            const repairedAttempt = this.tryRepairSelectionAttemptToExactBudget(
                candidates,
                bestAttempt,
                budgetRange.min,
                minUnitCount,
                maxUnitCount,
            );
            if (repairedAttempt) {
                return buildSuccessfulPreview(repairedAttempt, budgetRange.min);
            }
        }

        const fallbackUnits = bestAttempt.selectedCandidates.map((candidate) => this.createGeneratedUnit(
            candidate.unit,
            options.gameSystem,
            options.gunnery,
            options.piloting,
        ));

        return {
            gameSystem: options.gameSystem,
            units: fallbackUnits,
            totalCost: fallbackUnits.reduce((sum, unit) => sum + unit.cost, 0),
            faction: options.context.forceFaction,
            era: options.context.forceEra,
            explanationLines: this.buildPreviewExplanation(
                options.gameSystem,
                eligibleUnits.length,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
                bestAttempt,
                'Unable to build a force within the selected BV/PV range and unit count constraints.',
            ),
            error: 'Unable to build a force within the selected BV/PV range and unit count constraints.',
        };
    }

    public createForceEntry(preview: ForceGenerationPreview, name?: string): LoadForceEntry | null {
        if (preview.units.length === 0 || preview.error) {
            return null;
        }

        const previewGroup: LoadForceGroup = {
            units: preview.units.map((generatedUnit) => ({
                unit: generatedUnit.unit,
                alias: undefined,
                destroyed: false,
                gunnery: preview.gameSystem === GameSystem.CLASSIC ? generatedUnit.gunnery : undefined,
                piloting: preview.gameSystem === GameSystem.CLASSIC ? generatedUnit.piloting : undefined,
                skill: preview.gameSystem === GameSystem.ALPHA_STRIKE ? generatedUnit.skill : undefined,
            })),
        };

        const faction = preview.faction ?? null;
        const era = preview.era ?? null;
        const resolvedName = name?.trim() || ForceNamerUtil.generateForceNameForFaction(faction);

        return new LoadForceEntry({
            instanceId: `generated-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
            timestamp: new Date().toISOString(),
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
            groups: [previewGroup],
        });
    }

    private resolveSelectedEras(): Era[] {
        const filterState = this.filtersService.effectiveFilterState()['era'];
        if (!filterState?.interactedWith || !Array.isArray(filterState.value) || filterState.value.length === 0) {
            return [];
        }

        return filterState.value
            .map((eraName) => this.dataService.getEraByName(eraName))
            .filter((era): era is Era => era !== undefined);
    }

    private resolveSelectedFactions(): Faction[] {
        const filterState = this.filtersService.effectiveFilterState()['faction'];
        if (!filterState?.interactedWith || !filterState.value) {
            return [];
        }

        const selection = filterState.value as MultiStateSelection | undefined;
        const allFactionNames = this.dataService.getFactions().map((faction) => faction.name);
        return getPositiveFactionNamesFromFilter(selection, allFactionNames, filterState.wildcardPatterns)
            .map((factionName) => this.dataService.getFactionByName(factionName))
            .filter((faction): faction is Faction => faction !== undefined && faction.id !== MULFACTION_EXTINCT);
    }

    private collectPositiveAvailabilityPairs(
        eligibleUnits: readonly Unit[],
        eraIds: readonly number[],
        factionIds: readonly number[],
    ): ForceGenerationAvailabilityPair[] {
        const scopedEraIds = new Set(eraIds);
        const scopedFactionIds = new Set(factionIds);
        const pairMap = new Map<string, ForceGenerationAvailabilityPair>();

        for (const unit of eligibleUnits) {
            const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            if (!availabilityRecord) {
                continue;
            }

            for (const [eraIdText, eraAvailability] of Object.entries(availabilityRecord.e)) {
                const eraId = Number(eraIdText);
                if (Number.isNaN(eraId) || (scopedEraIds.size > 0 && !scopedEraIds.has(eraId))) {
                    continue;
                }

                for (const [factionIdText, value] of Object.entries(eraAvailability)) {
                    const factionId = Number(factionIdText);
                    if (
                        Number.isNaN(factionId)
                        || factionId === MULFACTION_EXTINCT
                        || (scopedFactionIds.size > 0 && !scopedFactionIds.has(factionId))
                    ) {
                        continue;
                    }

                    if ((value[0] ?? 0) + (value[1] ?? 0) <= 0) {
                        continue;
                    }

                    pairMap.set(buildAvailabilityPairKey(eraId, factionId), { eraId, factionId });
                }
            }
        }

        return [...pairMap.values()];
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
    ): ForceGenerationCandidateUnit {
        const availabilityWeights = this.getAvailabilityWeights(unit, context);
        return {
            unit,
            productionWeight: availabilityWeights.production,
            salvageWeight: availabilityWeights.salvage,
            cost: getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting),
            megaMekUnitType: toMegaMekUnitType(unit),
            megaMekWeightClass: toMegaMekWeightClass(unit),
            role: normalizeRole(unit.role),
            motive: toMegaMekMotive(unit),
        };
    }

    private getAvailabilityWeights(unit: Unit, context: ForceGenerationContext): { production: number; salvage: number } {
        const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
        if (!availabilityRecord) {
            return {
                production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
            };
        }

        const pairCount = context.averagingEraIds.length * context.averagingFactionIds.length;
        if (pairCount <= 0) {
            return {
                production: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
                salvage: DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT,
            };
        }

        let productionWeight = 0;
        let salvageWeight = 0;
        for (const eraId of context.averagingEraIds) {
            const eraAvailability = availabilityRecord.e[String(eraId)];
            for (const factionId of context.averagingFactionIds) {
                const value = eraAvailability?.[String(factionId)];
                productionWeight += value?.[0] ?? 0;
                salvageWeight += value?.[1] ?? 0;
            }
        }

        return {
            production: productionWeight / pairCount,
            salvage: salvageWeight / pairCount,
        };
    }

    private createGeneratedUnit(
        unit: Unit,
        gameSystem: GameSystem,
        gunnery: number,
        piloting: number,
    ): GeneratedForceUnit {
        return {
            unit,
            cost: getBudgetMetric(unit, gameSystem, gunnery, piloting),
            skill: gameSystem === GameSystem.ALPHA_STRIKE ? gunnery : undefined,
            gunnery: gameSystem === GameSystem.CLASSIC ? gunnery : undefined,
            piloting: gameSystem === GameSystem.CLASSIC ? getEffectivePilotingSkill(unit, piloting) : undefined,
        };
    }

    private buildPreviewExplanation(
        gameSystem: GameSystem,
        eligibleUnitCount: number,
        context: ForceGenerationContext,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        selectionAttempt: ForceGenerationSelectionAttempt | null,
        error: string | null,
    ): string[] {
        const lines: string[] = [];
        const budgetLabel = gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
        const maxLabel = Number.isFinite(budgetRange.max) ? budgetRange.max.toLocaleString() : 'no max';
        lines.push(`Eligible pool: ${eligibleUnitCount} units. Target: ${minUnitCount}-${maxUnitCount} units, ${budgetLabel} ${budgetRange.min.toLocaleString()} to ${maxLabel}.`);

        const contextParts = [context.forceFaction?.name, context.forceEra?.name].filter(Boolean);
        if (contextParts.length > 0) {
            lines.push(`Resolved generation context: ${contextParts.join(' - ')}.`);
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
        } else if (context.ruleset) {
            lines.push(`Ruleset guidance: ${context.ruleset.factionKey}, but no matching force node added extra constraints.`);
        } else {
            lines.push('Ruleset guidance: none resolved, so picks used weighted search only.');
        }

        for (const [index, step] of (selectionAttempt?.selectionSteps ?? []).entries()) {
            const probabilityNote = step.usedFallbackSource && step.source !== step.rolledSource
                ? `roll ${formatForceGenerationPercent(step.sourceRollProbability)} to ${step.rolledSource}, fallback ${step.source}, pick ${formatForceGenerationPercent(step.candidatePickProbability)}`
                : `roll ${formatForceGenerationPercent(step.sourceRollProbability)}, pick ${formatForceGenerationPercent(step.candidatePickProbability)}`;
            const reasons = step.rulesetReasons.length > 0
                ? `; ruleset bias ${step.rulesetReasons.join(', ')}`
                : '';
            lines.push(
                `${index + 1}. ${formatForceGenerationUnitLabel(step.unit)}: ${step.source} pick (${probabilityNote}), P ${formatForceGeneratorWeight(step.productionWeight)} / S ${formatForceGeneratorWeight(step.salvageWeight)}, ${step.cost.toLocaleString()} ${budgetLabel}${reasons}.`,
            );
        }

        if (error) {
            lines.push(`Result note: ${error}`);
        }

        return lines;
    }

    private normalizeBudgetRange(range: ForceGenerationBudgetRange): { min: number; max: number } {
        const min = Math.max(0, Math.floor(range.min));
        const rawMax = Math.max(0, Math.floor(range.max));
        return {
            min,
            max: rawMax > 0 ? Math.max(min, rawMax) : Number.POSITIVE_INFINITY,
        };
    }

    private isBudgetWithinRange(totalCost: number, budgetRange: { min: number; max: number }): boolean {
        return totalCost >= budgetRange.min && totalCost <= budgetRange.max;
    }

    private isExactBudgetRange(budgetRange: { min: number; max: number }): boolean {
        return Number.isFinite(budgetRange.max) && budgetRange.min === budgetRange.max;
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

    private getRandomAttemptCount(
        candidateCount: number,
        budgetRange: { min: number; max: number },
        exactBudgetRequested: boolean,
    ): number {
        const exactRangeBonus = budgetRange.min > 0 && budgetRange.min === budgetRange.max ? 8 : 0;
        const scaledAttemptCount = Math.ceil(Math.sqrt(candidateCount) * 1.5) + exactRangeBonus;
        const maxAttemptCount = exactBudgetRequested ? FORCE_GENERATION_MAX_EXACT_RANDOM_ATTEMPTS : FORCE_GENERATION_MAX_RANDOM_ATTEMPTS;
        return Math.max(FORCE_GENERATION_MIN_RANDOM_ATTEMPTS, Math.min(maxAttemptCount, scaledAttemptCount));
    }

    private getSuccessPoolTarget(elapsedMs: number, searchWindowMs: number): number {
        if (elapsedMs <= FORCE_GENERATION_CHEAP_TARGET_WINDOW_MS) {
            return FORCE_GENERATION_FAST_SUCCESS_POOL_SIZE;
        }

        if (elapsedMs <= searchWindowMs / 2) {
            return FORCE_GENERATION_MEDIUM_SUCCESS_POOL_SIZE;
        }

        return FORCE_GENERATION_MIN_SUCCESS_POOL_SIZE;
    }

    private getBudgetTarget(budgetRange: { min: number; max: number }): number {
        if (Number.isFinite(budgetRange.max)) {
            return budgetRange.min > 0
                ? budgetRange.min + ((budgetRange.max - budgetRange.min) / 2)
                : budgetRange.max;
        }

        return budgetRange.min;
    }

    private hasReachedBudgetTarget(
        totalCost: number,
        budgetRange: { min: number; max: number },
        targetBudget: number,
    ): boolean {
        if (this.isExactBudgetRange(budgetRange)) {
            return totalCost === targetBudget;
        }

        return this.isBudgetWithinRange(totalCost, budgetRange);
    }

    private getBudgetProgressScore(
        nextTotal: number,
        budgetRange: { min: number; max: number },
        targetBudget: number,
    ): number {
        if (!this.isExactBudgetRange(budgetRange)) {
            if (budgetRange.min > 0 && nextTotal < budgetRange.min) {
                const denominator = Math.max(1, budgetRange.min);
                return 1 + ((denominator - Math.min(denominator, budgetRange.min - nextTotal)) / denominator);
            }

            if (this.isBudgetWithinRange(nextTotal, budgetRange)) {
                return 2;
            }

            return 0.25;
        }

        if (budgetRange.min > 0 && nextTotal < budgetRange.min) {
            const denominator = Math.max(1, budgetRange.min);
            return 1 + ((denominator - Math.min(denominator, budgetRange.min - nextTotal)) / denominator);
        }

        if (!Number.isFinite(targetBudget) || targetBudget <= 0) {
            return 1;
        }

        const span = Number.isFinite(budgetRange.max)
            ? Math.max(1, budgetRange.max - budgetRange.min)
            : Math.max(1, targetBudget);
        return 1 + ((span - Math.min(span, Math.abs(targetBudget - nextTotal))) / span);
    }

    private getAvailabilityWeightForSource(
        candidate: ForceGenerationCandidateUnit,
        source: ForceGenerationAvailabilitySource,
    ): number {
        return source === 'production' ? candidate.productionWeight : candidate.salvageWeight;
    }

    private getAvailabilitySourceProbability(
        candidates: readonly ForceGenerationCandidateUnit[],
        source: ForceGenerationAvailabilitySource,
    ): number {
        const productionTotal = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.productionWeight), 0);
        const salvageTotal = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.salvageWeight), 0);
        const totalWeight = productionTotal + salvageTotal;
        if (totalWeight <= 0) {
            return 0.5;
        }

        return (source === 'production' ? productionTotal : salvageTotal) / totalWeight;
    }

    private getCandidatePickProbability<T>(
        candidates: readonly T[],
        selectedCandidate: T,
        getWeight: (candidate: T) => number,
    ): number {
        if (candidates.length === 0) {
            return 0;
        }

        const selectedIndex = candidates.indexOf(selectedCandidate);
        if (selectedIndex < 0) {
            return 0;
        }

        const weights = candidates.map((candidate) => Math.max(0, getWeight(candidate)));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        if (totalWeight <= 0) {
            return 1 / candidates.length;
        }

        return weights[selectedIndex] / totalWeight;
    }

    private getBudgetGoalDistance(
        totalCost: number,
        budgetRange: { min: number; max: number },
        targetBudget: number,
    ): number {
        return this.isExactBudgetRange(budgetRange)
            ? Math.abs(targetBudget - totalCost)
            : this.getBudgetRangeDistance(totalCost, budgetRange);
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
        strategy: ForceGenerationSelectionStrategy,
    ): {
        candidate: ForceGenerationCandidateUnit;
        rolledSource: ForceGenerationAvailabilitySource;
        source: ForceGenerationAvailabilitySource;
        usedFallbackSource: boolean;
        sourceRollProbability: number;
        candidatePickProbability: number;
    } {
        if (strategy === 'greedy') {
            return this.pickGreedyCandidate(candidates, rulesetProfile, totalCost, budgetRange);
        }

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
        const candidate = pickWeightedRandomEntry(weightedCandidates, (weightedCandidate) => {
            return this.getCandidateSelectionWeight(weightedCandidate, weightedSource, rulesetProfile, totalCost, budgetRange, targetBudget);
        });

        return {
            candidate,
            rolledSource: source,
            source: weightedSource,
            usedFallbackSource: weightedSource !== source,
            sourceRollProbability: this.getAvailabilitySourceProbability(candidates, source),
            candidatePickProbability: this.getCandidatePickProbability(
                weightedCandidates,
                candidate,
                (weightedCandidate) => this.getCandidateSelectionWeight(
                    weightedCandidate,
                    weightedSource,
                    rulesetProfile,
                    totalCost,
                    budgetRange,
                    targetBudget,
                ),
            ),
        };
    }

    private pickGreedyCandidate(
        candidates: readonly ForceGenerationCandidateUnit[],
        rulesetProfile: ForceGenerationRulesetProfile | null,
        totalCost: number,
        budgetRange: { min: number; max: number },
    ): {
        candidate: ForceGenerationCandidateUnit;
        rolledSource: ForceGenerationAvailabilitySource;
        source: ForceGenerationAvailabilitySource;
        usedFallbackSource: boolean;
        sourceRollProbability: number;
        candidatePickProbability: number;
    } {
        const targetBudget = this.getBudgetTarget(budgetRange);
        const rolledSource = this.pickAvailabilitySource(candidates);
        const alternateSource: ForceGenerationAvailabilitySource = rolledSource === 'production' ? 'salvage' : 'production';
        const sourceCandidates = candidates.filter((candidate) => this.getAvailabilityWeightForSource(candidate, rolledSource) > 0);
        const alternateCandidates = candidates.filter((candidate) => this.getAvailabilityWeightForSource(candidate, alternateSource) > 0);
        const weightedCandidates = sourceCandidates.length > 0
            ? sourceCandidates
            : alternateCandidates.length > 0
                ? alternateCandidates
                : candidates;
        const source = sourceCandidates.length > 0 ? rolledSource : alternateCandidates.length > 0 ? alternateSource : rolledSource;
        let bestChoice: {
            reachedTarget: boolean;
            targetDistance: number;
            selectionWeight: number;
        } | null = null;
        const bestCandidates: ForceGenerationCandidateUnit[] = [];

        for (const candidate of weightedCandidates) {
            const nextTotal = totalCost + candidate.cost;
            const reachedTarget = this.hasReachedBudgetTarget(nextTotal, budgetRange, targetBudget);
            const targetDistance = this.getBudgetGoalDistance(nextTotal, budgetRange, targetBudget);
            const selectionWeight = this.getCandidateSelectionWeight(candidate, source, rulesetProfile, totalCost, budgetRange, targetBudget);

            if (!bestChoice) {
                bestChoice = {
                    reachedTarget,
                    targetDistance,
                    selectionWeight,
                };
                bestCandidates.length = 0;
                bestCandidates.push(candidate);
                continue;
            }

            const isBetter = reachedTarget !== bestChoice.reachedTarget
                ? reachedTarget
                : targetDistance !== bestChoice.targetDistance
                    ? targetDistance < bestChoice.targetDistance
                    : selectionWeight > bestChoice.selectionWeight;

            const isEquivalent = reachedTarget === bestChoice.reachedTarget
                && targetDistance === bestChoice.targetDistance
                && Math.abs(selectionWeight - bestChoice.selectionWeight) < 0.0001;

            if (isBetter) {
                bestChoice = {
                    reachedTarget,
                    targetDistance,
                    selectionWeight,
                };
                bestCandidates.length = 0;
                bestCandidates.push(candidate);
                continue;
            }

            if (isEquivalent) {
                bestCandidates.push(candidate);
            }
        }

        if (bestCandidates.length > 0) {
            const candidate = bestCandidates.length === 1
                ? bestCandidates[0]
                : pickWeightedRandomEntry(bestCandidates, (bestCandidate) => {
                    return this.getCandidateSelectionWeight(bestCandidate, source, rulesetProfile, totalCost, budgetRange, targetBudget);
                });
            return {
                candidate,
                rolledSource,
                source,
                usedFallbackSource: source !== rolledSource,
                sourceRollProbability: this.getAvailabilitySourceProbability(candidates, rolledSource),
                candidatePickProbability: this.getCandidatePickProbability(
                    bestCandidates,
                    candidate,
                    (bestCandidate) => this.getCandidateSelectionWeight(
                        bestCandidate,
                        source,
                        rulesetProfile,
                        totalCost,
                        budgetRange,
                        targetBudget,
                    ),
                ),
            };
        }

        return this.pickNextCandidate(candidates, rulesetProfile, totalCost, budgetRange, 'weighted');
    }

    private getCandidateSelectionWeight(
        candidate: ForceGenerationCandidateUnit,
        source: ForceGenerationAvailabilitySource,
        rulesetProfile: ForceGenerationRulesetProfile | null,
        totalCost: number,
        budgetRange: { min: number; max: number },
        targetBudget: number,
    ): number {
        const availabilityWeight = Math.max(0.05, this.getAvailabilityWeightForSource(candidate, source));
        const budgetScore = this.getBudgetProgressScore(totalCost + candidate.cost, budgetRange, targetBudget);
        const rulesetScore = this.getRulesetMatchScore(candidate, rulesetProfile);
        return availabilityWeight * budgetScore * rulesetScore;
    }

    private buildCandidateSelection(
        candidates: readonly ForceGenerationCandidateUnit[],
        context: ForceGenerationContext,
        budgetRange: { min: number; max: number },
        minUnitCount: number,
        maxUnitCount: number,
        strategy: ForceGenerationSelectionStrategy,
    ): ForceGenerationSelectionAttempt {
        const remainingCandidates = [...candidates];
        const selectedCandidates: ForceGenerationCandidateUnit[] = [];
        const selectionSteps: ForceGenerationSelectionStep[] = [];
        let totalCost = 0;
        let rulesetProfile: ForceGenerationRulesetProfile | null = null;
        const targetBudget = this.getBudgetTarget(budgetRange);
        const exactBudgetRequested = this.isExactBudgetRange(budgetRange);

        while (selectedCandidates.length < maxUnitCount) {
            if (
                selectedCandidates.length >= minUnitCount
                && (exactBudgetRequested
                    ? this.hasReachedBudgetTarget(totalCost, budgetRange, targetBudget)
                    : this.isBudgetWithinRange(totalCost, budgetRange))
            ) {
                break;
            }

            const feasibleCandidates = remainingCandidates.filter((candidate) => {
                const nextTotal = totalCost + candidate.cost;
                if (nextTotal > budgetRange.max) {
                    return false;
                }

                const remainingAfterPick = remainingCandidates.filter((remainingCandidate) => remainingCandidate !== candidate);
                const requiredAfterPick = Math.max(0, minUnitCount - selectedCandidates.length - 1);
                if (requiredAfterPick > remainingAfterPick.length) {
                    return false;
                }

                const minimumRemainingTotal = getMinimumMetricTotal(
                    remainingAfterPick.map((remainingCandidate) => remainingCandidate.cost),
                    requiredAfterPick,
                );
                if (nextTotal + minimumRemainingTotal > budgetRange.max) {
                    return false;
                }

                const remainingSlotsAfterPick = maxUnitCount - selectedCandidates.length - 1;
                const maximumRemainingTotal = getMaximumMetricTotal(
                    remainingAfterPick.map((remainingCandidate) => remainingCandidate.cost),
                    remainingSlotsAfterPick,
                );
                return nextTotal + maximumRemainingTotal >= budgetRange.min;
            });

            if (feasibleCandidates.length === 0) {
                break;
            }

            const nextPick = this.pickNextCandidate(feasibleCandidates, rulesetProfile, totalCost, budgetRange, strategy);
            const nextCandidate = nextPick.candidate;
            selectedCandidates.push(nextCandidate);
            totalCost += nextCandidate.cost;
            remainingCandidates.splice(remainingCandidates.indexOf(nextCandidate), 1);

            if (!rulesetProfile) {
                rulesetProfile = this.buildRulesetProfile(context, nextCandidate.unit, minUnitCount, maxUnitCount);
            }

            selectionSteps.push({
                unit: nextCandidate.unit,
                rolledSource: nextPick.rolledSource,
                source: nextPick.source,
                usedFallbackSource: nextPick.usedFallbackSource,
                sourceRollProbability: nextPick.sourceRollProbability,
                candidatePickProbability: nextPick.candidatePickProbability,
                productionWeight: nextCandidate.productionWeight,
                salvageWeight: nextCandidate.salvageWeight,
                cost: nextCandidate.cost,
                rulesetReasons: this.getRulesetMatchReasons(nextCandidate, rulesetProfile),
            });
        }

        return {
            selectedCandidates,
            selectionSteps,
            rulesetProfile,
        };
    }

    private getSelectionAttemptKey(selectionAttempt: ForceGenerationSelectionAttempt): string {
        return selectionAttempt.selectedCandidates
            .map((candidate) => candidate.unit.id)
            .sort((left, right) => left - right)
            .join(':');
    }

    private tryRepairSelectionAttemptToExactBudget(
        allCandidates: readonly ForceGenerationCandidateUnit[],
        selectionAttempt: ForceGenerationSelectionAttempt,
        targetTotal: number,
        minUnitCount: number,
        maxUnitCount: number,
    ): ForceGenerationSelectionAttempt | null {
        if (selectionAttempt.selectedCandidates.length === 0) {
            return null;
        }

        const selectedCandidates = this.shuffleForceGenerationCandidates(selectionAttempt.selectedCandidates);
        const selectedCandidateSet = new Set(selectionAttempt.selectedCandidates);
        const remainingCandidates = this.shuffleForceGenerationCandidates(
            allCandidates.filter((candidate) => !selectedCandidateSet.has(candidate)),
        );
        const currentTotal = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
        if (currentTotal === targetTotal) {
            return selectionAttempt;
        }

        const remainingCandidatesByCost = new Map<number, ForceGenerationCandidateUnit[]>();
        for (const candidate of remainingCandidates) {
            const bucket = remainingCandidatesByCost.get(candidate.cost) ?? [];
            bucket.push(candidate);
            remainingCandidatesByCost.set(candidate.cost, bucket);
        }

        const createAttempt = (nextCandidates: ForceGenerationCandidateUnit[]): ForceGenerationSelectionAttempt => {
            const nextSelectionSteps: ForceGenerationSelectionStep[] = nextCandidates.map((candidate) => {
                const source: ForceGenerationAvailabilitySource = candidate.productionWeight >= candidate.salvageWeight ? 'production' : 'salvage';
                return {
                    unit: candidate.unit,
                    rolledSource: source,
                    source,
                    usedFallbackSource: false,
                    sourceRollProbability: 1,
                    candidatePickProbability: 1,
                    productionWeight: candidate.productionWeight,
                    salvageWeight: candidate.salvageWeight,
                    cost: candidate.cost,
                    rulesetReasons: this.getRulesetMatchReasons(candidate, selectionAttempt.rulesetProfile),
                };
            });

            return {
                selectedCandidates: nextCandidates,
                selectionSteps: nextSelectionSteps,
                rulesetProfile: selectionAttempt.rulesetProfile,
            };
        };

        if (selectionAttempt.selectedCandidates.length + 1 <= maxUnitCount) {
            for (const candidate of remainingCandidates) {
                if (currentTotal + candidate.cost === targetTotal) {
                    return createAttempt([...selectionAttempt.selectedCandidates, candidate]);
                }
            }
        }

        if (selectionAttempt.selectedCandidates.length - 1 >= minUnitCount) {
            for (const candidate of selectedCandidates) {
                if (currentTotal - candidate.cost === targetTotal) {
                    return createAttempt(selectionAttempt.selectedCandidates.filter((selectedCandidate) => selectedCandidate !== candidate));
                }
            }
        }

        for (const selectedCandidate of selectedCandidates) {
            const targetReplacementCost = targetTotal - (currentTotal - selectedCandidate.cost);
            const replacementCandidates = remainingCandidatesByCost.get(targetReplacementCost) ?? [];
            if (replacementCandidates.length > 0) {
                const replacementCandidate = replacementCandidates[0];
                return createAttempt(
                    selectionAttempt.selectedCandidates.map((candidate) => candidate === selectedCandidate ? replacementCandidate : candidate),
                );
            }
        }

        if (selectionAttempt.selectedCandidates.length + 2 <= maxUnitCount) {
            for (let leftIndex = 0; leftIndex < remainingCandidates.length; leftIndex += 1) {
                for (let rightIndex = leftIndex + 1; rightIndex < remainingCandidates.length; rightIndex += 1) {
                    const leftCandidate = remainingCandidates[leftIndex];
                    const rightCandidate = remainingCandidates[rightIndex];
                    if (currentTotal + leftCandidate.cost + rightCandidate.cost === targetTotal) {
                        return createAttempt([...selectionAttempt.selectedCandidates, leftCandidate, rightCandidate]);
                    }
                }
            }
        }

        if (selectionAttempt.selectedCandidates.length + 1 <= maxUnitCount) {
            for (const selectedCandidate of selectedCandidates) {
                for (let leftIndex = 0; leftIndex < remainingCandidates.length; leftIndex += 1) {
                    for (let rightIndex = leftIndex + 1; rightIndex < remainingCandidates.length; rightIndex += 1) {
                        const leftCandidate = remainingCandidates[leftIndex];
                        const rightCandidate = remainingCandidates[rightIndex];
                        if (currentTotal - selectedCandidate.cost + leftCandidate.cost + rightCandidate.cost === targetTotal) {
                            return createAttempt([
                                ...selectionAttempt.selectedCandidates.filter((candidate) => candidate !== selectedCandidate),
                                leftCandidate,
                                rightCandidate,
                            ]);
                        }
                    }
                }
            }
        }

        if (selectionAttempt.selectedCandidates.length - 1 >= minUnitCount) {
            for (let leftIndex = 0; leftIndex < selectedCandidates.length; leftIndex += 1) {
                for (let rightIndex = leftIndex + 1; rightIndex < selectedCandidates.length; rightIndex += 1) {
                    const leftCandidate = selectedCandidates[leftIndex];
                    const rightCandidate = selectedCandidates[rightIndex];
                    const targetReplacementCost = targetTotal - (currentTotal - leftCandidate.cost - rightCandidate.cost);
                    const replacementCandidates = remainingCandidatesByCost.get(targetReplacementCost) ?? [];
                    if (replacementCandidates.length > 0) {
                        const replacementCandidate = replacementCandidates[0];
                        return createAttempt([
                            ...selectionAttempt.selectedCandidates.filter((candidate) => candidate !== leftCandidate && candidate !== rightCandidate),
                            replacementCandidate,
                        ]);
                    }
                }
            }
        }

        return null;
    }

    private shuffleForceGenerationCandidates(
        candidates: readonly ForceGenerationCandidateUnit[],
    ): ForceGenerationCandidateUnit[] {
        const shuffled = [...candidates];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        return shuffled;
    }

    private buildRulesetProfile(
        context: ForceGenerationContext,
        seedUnit: Unit,
        minUnitCount: number,
        maxUnitCount: number,
    ): ForceGenerationRulesetProfile | null {
        const rulesetContext = this.resolveRulesetContext(context.forceFaction, context.forceEra);
        if (rulesetContext.chain.length === 0) {
            return null;
        }

        const unitType = toMegaMekUnitType(seedUnit);
        const weightClass = toMegaMekWeightClass(seedUnit);
        const role = normalizeRole(seedUnit.role);
        const motive = toMegaMekMotive(seedUnit);
        const selectedEchelon = this.pickPreferredEchelon(rulesetContext.chain, {
            year: getEraReferenceYear(context.forceEra) ?? seedUnit.year,
            unitType,
            weightClass,
            role,
            motive,
            factionKey: rulesetContext.primary?.factionKey,
            topLevel: true,
        }, minUnitCount, maxUnitCount);
        const forceNode = this.findMatchingForceNode(rulesetContext.chain, {
            year: getEraReferenceYear(context.forceEra) ?? seedUnit.year,
            unitType,
            weightClass,
            role,
            motive,
            echelon: selectedEchelon,
            factionKey: rulesetContext.primary?.factionKey,
            topLevel: true,
        });
        const profile: ForceGenerationRulesetProfile = {
            selectedEchelon,
            preferredUnitTypes: new Set([unitType]),
            preferredWeightClasses: new Set(weightClass ? [weightClass] : []),
            preferredRoles: new Set(role ? [role] : []),
            preferredMotives: new Set(motive ? [motive] : []),
            templates: [],
            explanationNotes: [],
        };

        if (selectedEchelon) {
            this.appendRulesetNote(profile, `Ruleset selected echelon ${selectedEchelon}.`);
        }

        if (!forceNode) {
            this.appendRulesetNote(profile, 'Ruleset chain resolved, but no matching force node was found for the seed unit.');
            return profile;
        }

        const matchContext: RulesetMatchContext = {
            year: getEraReferenceYear(context.forceEra) ?? seedUnit.year,
            unitType,
            weightClass,
            role,
            motive,
            echelon: selectedEchelon,
            factionKey: rulesetContext.primary?.factionKey,
            topLevel: true,
        };

        this.applyForceNodeToProfile(profile, forceNode, matchContext);
        this.collectRulesetTemplates(
            profile,
            forceNode,
            matchContext,
            rulesetContext,
            context.forceEra,
            Math.max(0, maxUnitCount - 1),
            0,
            new Set<string>(),
        );
        return profile;
    }

    private applyForceNodeToProfile(
        profile: ForceGenerationRulesetProfile,
        forceNode: MegaMekRulesetForceNode,
        matchContext: RulesetMatchContext,
    ): void {
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
        this.mergeRulesetNodeIntoProfile(profile, selectedOption);
        this.mergeRulesetNodeIntoProfile(profile, selectedOption.assign);
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