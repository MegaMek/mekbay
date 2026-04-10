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
import { resolveOrgDefinitionSpec } from '../utils/org/org-registry.util';
import { resolveFromUnits } from '../utils/org/org-solver.util';
import type { GroupSizeResult, OrgDefinitionSpec, OrgRuleDefinition, OrgType } from '../utils/org/org-types';
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
    preferredOrgType?: OrgType;
    preferredUnitCount?: number;
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

interface ForceGenerationAttemptBudget {
    minAttempts: number;
    maxAttempts: number;
    targetDurationMs: number;
}

interface ForceGenerationCostBoundsIndex {
    candidateCount: number;
    ascendingPositions: Map<ForceGenerationCandidateUnit, number>;
    descendingPositions: Map<ForceGenerationCandidateUnit, number>;
    ascendingPrefixSums: number[];
    descendingPrefixSums: number[];
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

export interface ForceGeneratorUnitCountDefaults {
    min: number;
    max: number;
}

const DEFAULT_UNKNOWN_FORCE_GENERATOR_WEIGHT = 1;
const FORCE_GENERATION_FAILURE_SEARCH_WINDOW_MS = 300;

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

function normalizeInitialBudgetRange(min: number, max: number): ForceGenerationBudgetRange {
    const normalizedMin = Math.max(0, min);
    const normalizedMax = Math.max(0, max);

    return {
        min: normalizedMax > 0 ? Math.min(normalizedMin, normalizedMax) : normalizedMin,
        max: normalizedMax,
    };
}

function normalizeInitialUnitCountRange(min: number, max: number): ForceGeneratorUnitCountDefaults {
    const normalizedMin = Math.max(1, Math.floor(min));
    const normalizedMax = Math.max(normalizedMin, Math.floor(max));

    return {
        min: normalizedMin,
        max: normalizedMax,
    };
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

function buildCostBoundsIndex(candidates: readonly ForceGenerationCandidateUnit[]): ForceGenerationCostBoundsIndex {
    const ascendingPositions = new Map<ForceGenerationCandidateUnit, number>();
    const descendingPositions = new Map<ForceGenerationCandidateUnit, number>();
    const ascendingPrefixSums = [0];
    const descendingPrefixSums = [0];

    const ascendingCandidates = [...candidates].sort((left, right) => left.cost - right.cost);
    const descendingCandidates = [...candidates].sort((left, right) => right.cost - left.cost);

    for (const [index, candidate] of ascendingCandidates.entries()) {
        ascendingPositions.set(candidate, index);
        ascendingPrefixSums.push(ascendingPrefixSums[index] + candidate.cost);
    }

    for (const [index, candidate] of descendingCandidates.entries()) {
        descendingPositions.set(candidate, index);
        descendingPrefixSums.push(descendingPrefixSums[index] + candidate.cost);
    }

    return {
        candidateCount: candidates.length,
        ascendingPositions,
        descendingPositions,
        ascendingPrefixSums,
        descendingPrefixSums,
    };
}

function getExcludedOrderedMetricTotal(
    prefixSums: readonly number[],
    candidateCount: number,
    excludedPosition: number | undefined,
    excludedCost: number,
    count: number,
): number {
    if (count <= 0 || candidateCount <= 1) {
        return 0;
    }

    const boundedCount = Math.min(count, candidateCount - 1);
    if (boundedCount <= 0) {
        return 0;
    }

    if (excludedPosition !== undefined && excludedPosition < boundedCount) {
        return prefixSums[Math.min(candidateCount, boundedCount + 1)] - excludedCost;
    }

    return prefixSums[boundedCount];
}

function getExcludedMinimumMetricTotal(
    costBoundsIndex: ForceGenerationCostBoundsIndex,
    excludedCandidate: ForceGenerationCandidateUnit,
    count: number,
): number {
    return getExcludedOrderedMetricTotal(
        costBoundsIndex.ascendingPrefixSums,
        costBoundsIndex.candidateCount,
        costBoundsIndex.ascendingPositions.get(excludedCandidate),
        excludedCandidate.cost,
        count,
    );
}

function getExcludedMaximumMetricTotal(
    costBoundsIndex: ForceGenerationCostBoundsIndex,
    excludedCandidate: ForceGenerationCandidateUnit,
    count: number,
): number {
    return getExcludedOrderedMetricTotal(
        costBoundsIndex.descendingPrefixSums,
        costBoundsIndex.candidateCount,
        costBoundsIndex.descendingPositions.get(excludedCandidate),
        excludedCandidate.cost,
        count,
    );
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

function findOrgRuleByType(definition: OrgDefinitionSpec, type: OrgType): OrgRuleDefinition | undefined {
    return definition.rules.find((rule) => rule.type === type);
}

function resolveRegularUnitCountForOrgType(
    definition: OrgDefinitionSpec,
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
    definition: OrgDefinitionSpec | null,
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

        const candidates = eligibleUnits
            .map((unit) => this.createCandidateUnit(unit, options.context, options))
            .filter((candidate) => this.hasPositiveAvailability(candidate));

        if (candidates.length < minUnitCount) {
            const message = `Only ${candidates.length} units have positive MegaMek availability in the rolled faction and era.`;
            return {
                gameSystem: options.gameSystem,
                units: [],
                totalCost: 0,
                faction: options.context.forceFaction,
                era: options.context.forceEra,
                explanationLines: this.buildPreviewExplanation(
                    options.gameSystem,
                    candidates.length,
                    options.context,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    null,
                    message,
                ),
                error: message,
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
                    candidates.length,
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
                    candidates.length,
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

        const attemptBudget = this.createAttemptBudget(candidates.length, minUnitCount, maxUnitCount);
        const searchStartedAt = getForceGeneratorNow();
        let bestAttempt: ForceGenerationSelectionAttempt = {
            selectedCandidates: [],
            selectionSteps: [],
            rulesetProfile: null,
        };
        let bestAttemptDistance = Number.POSITIVE_INFINITY;
        let bestValidAttempt: ForceGenerationSelectionAttempt | null = null;
        let bestValidMidpointDistance = Number.POSITIVE_INFINITY;
        let bestValidStructureScore = Number.NEGATIVE_INFINITY;
        let averageAttemptDurationMs = 0;
        let attemptLimit = attemptBudget.minAttempts;

        for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
            const attemptStartedAt = getForceGeneratorNow();
            const selectionAttempt = this.buildCandidateSelection(
                candidates,
                options.context,
                budgetRange,
                minUnitCount,
                maxUnitCount,
            );
            const totalCost = selectionAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
            const attemptDistance = this.getBudgetRangeDistance(totalCost, budgetRange)
                + (selectionAttempt.selectedCandidates.length < minUnitCount
                    ? (minUnitCount - selectionAttempt.selectedCandidates.length) * Math.max(1, this.getBudgetTarget(budgetRange))
                    : 0);

            if (attemptDistance < bestAttemptDistance) {
                bestAttempt = selectionAttempt;
                bestAttemptDistance = attemptDistance;
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
                if (
                    !bestValidAttempt
                    || structureScore > bestValidStructureScore
                    || (structureScore === bestValidStructureScore && midpointDistance < bestValidMidpointDistance)
                    || (
                        structureScore === bestValidStructureScore
                        && midpointDistance === bestValidMidpointDistance
                        && selectionAttempt.selectedCandidates.length < bestValidAttempt.selectedCandidates.length
                    )
                ) {
                    bestValidAttempt = selectionAttempt;
                    bestValidStructureScore = structureScore;
                    bestValidMidpointDistance = midpointDistance;
                }

                if (!structureEvaluation || structureEvaluation.perfectMatch) {
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
                            candidates.length,
                            options.context,
                            budgetRange,
                            minUnitCount,
                            maxUnitCount,
                            selectionAttempt,
                            null,
                        ),
                        error: null,
                    };
                }
            }

            const attemptDurationMs = Math.max(0.05, getForceGeneratorNow() - attemptStartedAt);
            averageAttemptDurationMs = this.updateAverageAttemptDuration(averageAttemptDurationMs, attemptDurationMs, attempt + 1);
            attemptLimit = this.resolveAttemptLimit(
                attemptBudget,
                attempt + 1,
                averageAttemptDurationMs,
                getForceGeneratorNow() - searchStartedAt,
                bestValidAttempt !== null,
            );
        }

        if (bestValidAttempt) {
            const totalCost = bestValidAttempt.selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0);
            const generatedUnits = bestValidAttempt.selectedCandidates.map((candidate) => this.createGeneratedUnit(
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
                    candidates.length,
                    options.context,
                    budgetRange,
                    minUnitCount,
                    maxUnitCount,
                    bestValidAttempt,
                    null,
                ),
                error: null,
            };
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
                candidates.length,
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

        const forceEraId = context.forceEra?.id;
        const forceFactionId = context.forceFaction?.id;
        if (forceEraId !== undefined && forceFactionId !== undefined) {
            const exactValue = availabilityRecord.e[String(forceEraId)]?.[String(forceFactionId)];
            return {
                production: exactValue?.[0] ?? 0,
                salvage: exactValue?.[1] ?? 0,
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

    private hasPositiveAvailability(candidate: ForceGenerationCandidateUnit): boolean {
        return candidate.productionWeight > 0 || candidate.salvageWeight > 0;
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
            if (selectionAttempt.structureEvaluation) {
                lines.push(selectionAttempt.structureEvaluation.summary);
            }
        } else if (context.ruleset) {
            lines.push(`Ruleset guidance: ${context.ruleset.factionKey}, but no matching force node added extra constraints.`);
        } else {
            lines.push('Ruleset guidance: none resolved, so picks used weighted search only.');
        }

        for (const [index, step] of (selectionAttempt?.selectionSteps ?? []).entries()) {
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

    private getBudgetRangeDistance(totalCost: number, budgetRange: { min: number; max: number }): number {
        if (totalCost < budgetRange.min) {
            return budgetRange.min - totalCost;
        }
        if (totalCost > budgetRange.max) {
            return totalCost - budgetRange.max;
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

    private updateAverageAttemptDuration(
        currentAverageMs: number,
        attemptDurationMs: number,
        completedAttempts: number,
    ): number {
        if (completedAttempts <= 1 || currentAverageMs <= 0) {
            return attemptDurationMs;
        }

        return ((currentAverageMs * (completedAttempts - 1)) + attemptDurationMs) / completedAttempts;
    }

    private resolveAttemptLimit(
        attemptBudget: ForceGenerationAttemptBudget,
        completedAttempts: number,
        averageAttemptDurationMs: number,
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

        if (averageAttemptDurationMs <= 0 || elapsedMs >= targetDurationMs) {
            return completedAttempts;
        }

        const remainingMs = Math.max(0, targetDurationMs - elapsedMs);
        const additionalAttempts = Math.max(1, Math.floor(remainingMs / Math.max(0.05, averageAttemptDurationMs)));
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
                const rulesetScore = this.getRulesetMatchScore(candidate, rulesetProfile);
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
    ): ForceGenerationSelectionAttempt {
        const remainingCandidates = [...candidates];
        const selectedCandidates: ForceGenerationCandidateUnit[] = [];
        const selectionSteps: ForceGenerationSelectionStep[] = [];
        let totalCost = 0;
        const rulesetProfile = this.buildRulesetProfile(context, minUnitCount, maxUnitCount);
        const preferredSelectionUnitCount = this.getPreferredSelectionUnitCount(
            rulesetProfile?.preferredUnitCount,
            minUnitCount,
            maxUnitCount,
        );
        const targetBudget = this.getBudgetTarget(budgetRange);

        while (selectedCandidates.length < maxUnitCount) {
            if (
                selectedCandidates.length >= minUnitCount
                && this.isBudgetWithinRange(totalCost, budgetRange)
                && ((preferredSelectionUnitCount !== undefined && selectedCandidates.length >= preferredSelectionUnitCount)
                    || (preferredSelectionUnitCount === undefined && totalCost >= targetBudget))
            ) {
                break;
            }

            const remainingCandidateCountAfterPick = remainingCandidates.length - 1;
            const requiredAfterPick = Math.max(0, minUnitCount - selectedCandidates.length - 1);
            if (requiredAfterPick > remainingCandidateCountAfterPick) {
                break;
            }

            const remainingSlotsAfterPick = maxUnitCount - selectedCandidates.length - 1;
            const costBoundsIndex = buildCostBoundsIndex(remainingCandidates);

            const feasibleCandidates = remainingCandidates.filter((candidate) => {
                const nextTotal = totalCost + candidate.cost;
                if (nextTotal > budgetRange.max) {
                    return false;
                }

                const minimumRemainingTotal = getExcludedMinimumMetricTotal(
                    costBoundsIndex,
                    candidate,
                    requiredAfterPick,
                );
                if (nextTotal + minimumRemainingTotal > budgetRange.max) {
                    return false;
                }

                const maximumRemainingTotal = getExcludedMaximumMetricTotal(
                    costBoundsIndex,
                    candidate,
                    remainingSlotsAfterPick,
                );
                return nextTotal + maximumRemainingTotal >= budgetRange.min;
            });

            if (feasibleCandidates.length === 0) {
                break;
            }

            const nextPick = this.pickNextCandidate(
                feasibleCandidates,
                rulesetProfile,
                totalCost,
                budgetRange,
                selectedCandidates.length,
                preferredSelectionUnitCount,
            );
            const nextCandidate = nextPick.candidate;
            selectedCandidates.push(nextCandidate);
            totalCost += nextCandidate.cost;
            remainingCandidates.splice(remainingCandidates.indexOf(nextCandidate), 1);

            selectionSteps.push({
                unit: nextCandidate.unit,
                rolledSource: nextPick.rolledSource,
                source: nextPick.source,
                usedFallbackSource: nextPick.usedFallbackSource,
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
        const selectedEchelon = this.pickPreferredEchelon(
            rulesetContext.chain,
            baseMatchContext,
            minUnitCount,
            maxUnitCount,
        );
        const forceNodeSelection = this.findPreferredForceNode(rulesetContext.chain, {
            ...baseMatchContext,
            echelon: selectedEchelon,
        });
        const forceNode = forceNodeSelection.forceNode;
        const resolvedSelectedEchelon = selectedEchelon
            ?? forceNodeSelection.matchContext.echelon
            ?? getRulesetEchelonCode(forceNode?.echelon);
        const profile: ForceGenerationRulesetProfile = {
            selectedEchelon: resolvedSelectedEchelon,
            preferredOrgType: undefined,
            preferredUnitCount: undefined,
            preferredUnitTypes: new Set<string>(),
            preferredWeightClasses: new Set<string>(),
            preferredRoles: new Set<string>(),
            preferredMotives: new Set<string>(),
            templates: [],
            explanationNotes: [],
        };

        const orgDefinition = context.forceFaction ? resolveOrgDefinitionSpec(context.forceFaction, context.forceEra) : null;
    profile.preferredOrgType = getPreferredOrgTypeForEchelon(resolvedSelectedEchelon);
    profile.preferredUnitCount = getPreferredUnitCountForEchelon(resolvedSelectedEchelon, orgDefinition);
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

    private findPreferredForceNode(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
    ): ForceGenerationForceNodeSelection {
        const exactMatch = this.pickMatchingForceNode(rulesetChain, matchContext, (when, nextContext) => {
            return this.matchesRulesetWhen(when, nextContext);
        });
        if (exactMatch) {
            return {
                forceNode: exactMatch,
                matchContext: this.deriveForceNodeMatchContext(matchContext, exactMatch),
            };
        }

        const structuralMatch = this.pickMatchingForceNode(rulesetChain, matchContext, (when, nextContext) => {
            return this.matchesRulesetWhenForForceSelection(when, nextContext);
        });
        if (structuralMatch) {
            return {
                forceNode: structuralMatch,
                matchContext: this.deriveForceNodeMatchContext(matchContext, structuralMatch),
            };
        }

        if (!matchContext.echelon) {
            return { matchContext };
        }

        const fallbackContext = { ...matchContext, echelon: undefined };
        const fallbackExactMatch = this.pickMatchingForceNode(rulesetChain, fallbackContext, (when, nextContext) => {
            return this.matchesRulesetWhen(when, nextContext);
        });
        if (fallbackExactMatch) {
            return {
                forceNode: fallbackExactMatch,
                matchContext: this.deriveForceNodeMatchContext(fallbackContext, fallbackExactMatch),
            };
        }

        const fallbackStructuralMatch = this.pickMatchingForceNode(rulesetChain, fallbackContext, (when, nextContext) => {
            return this.matchesRulesetWhenForForceSelection(when, nextContext);
        });
        if (fallbackStructuralMatch) {
            return {
                forceNode: fallbackStructuralMatch,
                matchContext: this.deriveForceNodeMatchContext(fallbackContext, fallbackStructuralMatch),
            };
        }

        return { matchContext };
    }

    private pickMatchingForceNode(
        rulesetChain: readonly MegaMekRulesetRecord[],
        matchContext: RulesetMatchContext,
        matcher: (when: MegaMekRulesetWhen | undefined, matchContext: RulesetMatchContext) => boolean,
    ): MegaMekRulesetForceNode | undefined {
        for (const ruleset of rulesetChain) {
            const indexedForceNodes = matchContext.echelon
                ? (ruleset.indexes.forceIndexesByEchelon[matchContext.echelon] ?? [])
                    .map((index) => ruleset.forces[index])
                    .filter((forceNode): forceNode is MegaMekRulesetForceNode => forceNode !== undefined)
                : ruleset.forces;

            const forceNodes = indexedForceNodes.length > 0 ? indexedForceNodes : ruleset.forces;
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