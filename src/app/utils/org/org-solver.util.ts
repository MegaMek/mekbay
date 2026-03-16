import type { FactionAffinity } from '../../models/factions.model';
import type { Unit } from '../../models/units.model';
import {
    compileUnitFacts,
    compileGroupFacts,
    compileGroupFactsList,
    compileUnitFactsList,
    DEFAULT_ORG_RULE_REGISTRY,
    getCIMoveClass,
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
    type OrgBucketName,
    type OrgBucketValue,
    type OrgCIFormationEntry,
    type OrgCIFormationRule,
    type OrgChildRoleSpec,
    type OrgComposedCountAlternativeSpec,
    type OrgComposedCountRule,
    type OrgComposedPatternRule,
    type OrgDefinitionSpec,
    type OrgLeafCountRule,
    type OrgLeafPatternRule,
    type OrgPatternBucketMatcher,
    type OrgPatternBucketPrefixMatcher,
    type OrgPatternReferenceName,
    type OrgPatternScoreTerm,
    type OrgPatternSpec,
    type OrgRuleDefinition,
    type OrgRuleRegistry,
    type OrgSizeResult,
    type OrgTypeModifier,
    type UnitFacts,
} from './org-types';

export { EMPTY_RESULT } from './org-types';

const SOLVER_TIME_BUDGET_MS = 750;
const MAX_PATTERN_ENUMERATION_VISITS = 50_000;
const MAX_COMPOSITION_SEARCH_VISITS = 50_000;
const MAX_PATTERN_GREEDY_ITERATIONS = 2_000;
const MAX_COMPOSED_GROUPS_PER_CONFIG = 2_000;
const MAX_PROMOTION_LOOP_ITERATIONS = 64;

type ModifierBand = 'sub-regular' | 'regular' | 'super-regular';

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

interface RuleModifierDescriptor {
    readonly stepsAscending: readonly ModifierStep[];
    readonly stepsDescending: readonly ModifierStep[];
    readonly regularStep: ModifierStep;
    readonly subRegularStepsDescending: readonly ModifierStep[];
    readonly superRegularStepsDescending: readonly ModifierStep[];
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
    readonly childRoles: readonly OrgChildRoleSpec[];
    readonly modifierDescriptor: RuleModifierDescriptor;
    readonly childMatchBucketBy?: OrgBucketName;
}

interface ConcreteCompositionCandidate {
    readonly groups: readonly GroupFacts[];
    readonly compositionIndex: number;
    readonly modifierStep: ModifierStep;
}

interface ResolveContext {
    readonly definition: OrgDefinitionSpec;
    readonly ciFormationRules: readonly OrgCIFormationRule[];
    readonly leafCountRules: readonly OrgLeafCountRule[];
    readonly leafPatternRules: readonly OrgLeafPatternRule[];
    readonly composedCountRules: readonly OrgComposedCountRule[];
}

interface FinalStateScore {
    readonly isWhole: boolean;
    readonly highestTier: number;
    readonly totalPriority: number;
    readonly topLevelGroupCount: number;
    readonly highestTierGroupCount: number;
    readonly leftoverCount: number;
}

interface ResolvedState {
    readonly groups: readonly GroupSizeResult[];
    readonly leftoverUnits: readonly UnitFacts[];
    readonly leftoverUnitAllocations: readonly GroupUnitAllocation[];
}

interface CIFragmentToken {
    readonly moveClass: NonNullable<ReturnType<typeof getCIMoveClass>>;
    readonly allocations: readonly GroupUnitAllocation[];
}

function createSolverGuard(): SolverGuard {
    return {
        deadline: Date.now() + SOLVER_TIME_BUDGET_MS,
        patternVisits: 0,
        compositionVisits: 0,
        timedOut: false,
    };
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
    bucketBy: OrgBucketName | undefined,
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
    bucketBy: OrgBucketName | undefined,
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
    bucketBy: OrgBucketName | undefined,
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

function getNumericTargetValue(target: number | { min: number; max: number }): number | null {
    return typeof target === 'number' ? target : null;
}

function getInfantrySplitSizesForPattern(rule: OrgLeafPatternRule, pattern: OrgPatternSpec, facts: UnitFacts): number[] {
    const splitSizes = new Set<number>();
    const unitType = facts.unit.as.TP;

    if (rule.bucketBy === 'ciMoveClassTroopers') {
        const moveClassPrefix = DEFAULT_ORG_RULE_REGISTRY.unitBuckets.ciMoveClass?.(facts);
        if (moveClassPrefix && moveClassPrefix !== 'not-ci') {
            Object.entries(pattern.demands ?? {}).forEach(([key, count]) => {
                if (count === 1 && key.startsWith(`${moveClassPrefix}:`)) {
                    const troopers = Number(key.slice(key.lastIndexOf(':') + 1));
                    if (Number.isFinite(troopers) && troopers > 0) {
                        splitSizes.add(troopers);
                    }
                }
            });
        }
    }

    if (rule.bucketBy === 'infantryTroopers') {
        Object.entries(pattern.demands ?? {}).forEach(([key, count]) => {
            if (count !== 1) {
                return;
            }
            if ((unitType === 'BA' && key.startsWith('BA:')) || (unitType === 'CI' && key.startsWith('CI:'))) {
                const troopers = Number(key.slice(key.lastIndexOf(':') + 1));
                if (Number.isFinite(troopers) && troopers > 0) {
                    splitSizes.add(troopers);
                }
            }
        });

        for (const scoreTerm of pattern.matchMode === 'score' ? pattern.scoreTerms : []) {
            if (scoreTerm.kind !== 'numeric-target' && scoreTerm.kind !== 'target') {
                continue;
            }
            const matcher = pattern.bucketGroups?.[scoreTerm.ref];
            if (!matcher || !('prefix' in matcher)) {
                continue;
            }
            if ((unitType === 'BA' && matcher.prefix !== 'BA:') || (unitType === 'CI' && matcher.prefix !== 'CI:')) {
                continue;
            }
            const numericTarget = getNumericTargetValue(scoreTerm.target);
            if (numericTarget && numericTarget > 0) {
                splitSizes.add(numericTarget);
            }
        }
    }

    return [...splitSizes];
}

function getInfantrySplitSizeForRule(rule: OrgLeafPatternRule, facts: UnitFacts): number | null {
    if (!facts.scalars.isBA && !facts.scalars.isCI) {
        return null;
    }

    const splitSizes = new Set<number>();
    for (const pattern of rule.patterns) {
        getInfantrySplitSizesForPattern(rule, pattern, facts).forEach((size) => splitSizes.add(size));
    }

    if (splitSizes.size !== 1) {
        return null;
    }

    return [...splitSizes][0] ?? null;
}

function cloneInfantryUnit(unit: Unit, troopers: number): Unit {
    return {
        ...unit,
        internal: troopers,
        source: [...unit.source],
        comp: [...unit.comp],
        quirks: [...unit.quirks],
        features: [...unit.features],
        sheets: [...unit.sheets],
        as: {
            ...unit.as,
            MVm: { ...unit.as.MVm },
            specials: [...unit.as.specials],
            dmg: { ...unit.as.dmg },
        },
        _nameTags: [...unit._nameTags],
        _chassisTags: [...unit._chassisTags],
    };
}

function expandInfantryUnitsForLeafPattern(rule: OrgLeafPatternRule, eligibleUnits: readonly UnitFacts[]): UnitFacts[] {
    const expanded: UnitFacts[] = [];

    for (const facts of eligibleUnits) {
        const splitSize = getInfantrySplitSizeForRule(rule, facts);
        if (!splitSize || facts.scalars.troopers <= splitSize) {
            expanded.push(facts);
            continue;
        }

        if (facts.scalars.troopers % splitSize !== 0) {
            expanded.push(facts);
            continue;
        }

        const fullCopies = facts.scalars.troopers / splitSize;

        for (let copyIndex = 0; copyIndex < fullCopies; copyIndex += 1) {
            expanded.push(compileUnitFacts(cloneInfantryUnit(facts.unit, splitSize), copyIndex));
        }
    }

    return expanded;
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
        units: units.map((facts) => facts.unit),
        tag: rule.tag,
        priority: rule.priority,
    };
}

function createComposedGroup(
    rule: OrgComposedCountRule,
    modifierStep: ModifierStep,
    children: readonly GroupSizeResult[],
): GroupSizeResult {
    return {
        name: makeGroupName(rule.type, modifierStep.modifierKey),
        type: rule.type,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        children: [...children],
        tag: rule.tag,
        priority: rule.priority,
    };
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

function normalizeCIFormationGroups(
    pool: readonly GroupSizeResult[],
    context: ResolveContext,
): GroupSizeResult[] {
    let nextPool = [...pool];

    for (const rule of context.ciFormationRules) {
        const entryByMoveClass = new Map(rule.entries.map((entry) => [entry.moveClass, entry]));
        const groupFacts = compileGroupFactsList(nextPool);
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
        const consumedGroups = new Set<GroupSizeResult>();
        const tokensByMoveClass = new Map<NonNullable<ReturnType<typeof getCIMoveClass>>, CIFragmentToken[]>();

        for (const facts of candidates) {
            const tokens = getCIFragmentTokensFromGroup(rule, facts.group, entryByMoveClass);
            if (!tokens) {
                continue;
            }
            consumedGroups.add(facts.group);
            for (const token of tokens) {
                const existing = tokensByMoveClass.get(token.moveClass);
                if (existing) {
                    existing.push(token);
                } else {
                    tokensByMoveClass.set(token.moveClass, [token]);
                }
            }
        }

        if (consumedGroups.size === 0) {
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
            ...nextPool.filter((group) => !consumedGroups.has(group)),
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

function cloneBucketCounts(source: ReadonlyMap<string, number>): Map<string, number> {
    return new Map(source.entries());
}

function subtractAllocation(
    bucketCounts: Map<string, number>,
    allocation: ReadonlyMap<string, number>,
): void {
    for (const [bucketValue, count] of allocation.entries()) {
        const nextValue = (bucketCounts.get(bucketValue) ?? 0) - count;
        if (nextValue <= 0) {
            bucketCounts.delete(bucketValue);
        } else {
            bucketCounts.set(bucketValue, nextValue);
        }
    }
}

function materializePatternGreedy(
    pattern: OrgPatternSpec,
    bucketUnits: ReadonlyMap<string, readonly UnitFacts[]>,
    guard: SolverGuard,
): ConcretePatternCandidate[] {
    const bucketCounts = new Map<string, number>();
    for (const [bucketValue, units] of bucketUnits.entries()) {
        bucketCounts.set(bucketValue, units.length);
    }

    const workingUnits = new Map<string, UnitFacts[]>();
    for (const [bucketValue, units] of bucketUnits.entries()) {
        workingUnits.set(bucketValue, [...units]);
    }

    const candidates: ConcretePatternCandidate[] = [];
    let iterations = 0;
    while (iterations < MAX_PATTERN_GREEDY_ITERATIONS && !shouldAbortSearch(guard)) {
        iterations += 1;
        const next = enumeratePatternCandidates(bucketCounts, pattern, guard)[0];
        if (!next) {
            break;
        }
        const selectedUnits: UnitFacts[] = [];
        for (const [bucketValue, count] of next.allocation.entries()) {
            const units = workingUnits.get(bucketValue) ?? [];
            selectedUnits.push(...units.splice(0, count));
        }
        if (selectedUnits.length === 0) {
            break;
        }
        subtractAllocation(bucketCounts, next.allocation);
        candidates.push({
            allocation: next.allocation,
            score: next.score,
            units: selectedUnits,
        });
    }

    return candidates;
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
    const eligibleUnits = expandInfantryUnitsForLeafPattern(
        rule,
        unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry)),
    );
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
    const eligibleUnits = expandInfantryUnitsForLeafPattern(
        rule,
        unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry)),
    );
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
        let remaining = [...bucketUnits];
        for (const step of descriptor.stepsDescending) {
            while (remaining.length >= step.count) {
                const selected = remaining.slice(0, step.count);
                remaining = remaining.slice(step.count);
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
            childRoles: rule.childRoles,
            modifierDescriptor: getRuleModifierDescriptor(rule),
            childMatchBucketBy: rule.childMatchBucketBy,
        },
    ];

    rule.alternativeCompositions?.forEach((alternative, alternativeIndex) => {
        configs.push({
            index: alternativeIndex + 1,
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

function findConcreteComposition(
    groups: readonly GroupFacts[],
    childRoles: readonly OrgChildRoleSpec[],
    targetCount: number,
    guard: SolverGuard,
): GroupFacts[] | null {
    const sortedGroups = [...groups].sort((left, right) => left.tier - right.tier);
    const selected: GroupFacts[] = [];

    function visit(index: number): boolean {
        guard.compositionVisits += 1;
        if (guard.compositionVisits > MAX_COMPOSITION_SEARCH_VISITS || shouldAbortSearch(guard)) {
            return false;
        }
        if (selected.length === targetCount) {
            return canAssignGroupsToRoles(selected, childRoles, guard);
        }
        if (index >= sortedGroups.length) {
            return false;
        }
        const remainingSlots = targetCount - selected.length;
        const remainingGroups = sortedGroups.length - index;
        if (remainingGroups < remainingSlots) {
            return false;
        }

        selected.push(sortedGroups[index]);
        if (visit(index + 1)) {
            return true;
        }
        selected.pop();
        return visit(index + 1);
    }

    return visit(0) ? [...selected] : null;
}

function materializeComposedConfig(
    groups: readonly GroupFacts[],
    config: CompositionConfig,
    registry: OrgRuleRegistry,
    guard: SolverGuard,
    allowedModifierKeys?: ReadonlySet<string>,
): ConcreteCompositionCandidate[] {
    const candidates: ConcreteCompositionCandidate[] = [];
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

    for (const bucketGroups of remainingByBucket.values()) {
        let working = [...bucketGroups];
        for (const step of config.modifierDescriptor.stepsDescending) {
            if (allowedModifierKeys && !allowedModifierKeys.has(step.modifierKey)) {
                continue;
            }
            let producedGroups = 0;
            while (working.length >= step.count && producedGroups < MAX_COMPOSED_GROUPS_PER_CONFIG && !shouldAbortSearch(guard)) {
                const selection = findConcreteComposition(working, config.childRoles, step.count, guard);
                if (!selection) {
                    break;
                }
                producedGroups += 1;
                candidates.push({
                    groups: selection,
                    compositionIndex: config.index,
                    modifierStep: step,
                });
                const selectedIds = new Set(selection.map((group) => group.group));
                working = working.filter((group) => !selectedIds.has(group.group));
            }
        }
    }

    return candidates;
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
        candidates: materializeComposedConfig(groupFacts, config, registry, guard, allowedModifierKeys),
    }));
    const best = evaluations.sort((left, right) => {
        if (left.candidates.length !== right.candidates.length) {
            return right.candidates.length - left.candidates.length;
        }
        const leftUsed = left.candidates.reduce((sum, candidate) => sum + candidate.groups.length, 0);
        const rightUsed = right.candidates.reduce((sum, candidate) => sum + candidate.groups.length, 0);
        return rightUsed - leftUsed;
    })[0];

    if (!best) {
        return { groups: [], leftoverGroupFacts: [...groupFacts] };
    }

    const groups = best.candidates.map((candidate) =>
        createComposedGroup(rule, candidate.modifierStep, candidate.groups.map((group) => group.group)),
    );
    const usedGroupObjects = new Set(best.candidates.flatMap((candidate) => candidate.groups.map((group) => group.group)));

    return {
        groups,
        leftoverGroupFacts: groupFacts.filter((group) => !usedGroupObjects.has(group.group)),
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
        candidates: materializeComposedConfig(groupFacts, config, registry, guard),
    }));
    const best = evaluations.sort((left, right) => {
        if (left.candidates.length !== right.candidates.length) {
            return right.candidates.length - left.candidates.length;
        }
        const leftUsed = left.candidates.reduce((sum, candidate) => sum + candidate.groups.length, 0);
        const rightUsed = right.candidates.reduce((sum, candidate) => sum + candidate.groups.length, 0);
        return rightUsed - leftUsed;
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
    const usedGroups = best ? best.candidates.reduce((sum, candidate) => sum + candidate.groups.length, 0) : 0;

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

export function evaluateOrgDefinition(
    definition: OrgDefinitionSpec,
    units: readonly Unit[],
    groups: readonly GroupSizeResult[] = [],
): OrgDefinitionEvaluationResult {
    const unitFacts = compileUnitFactsList(units);
    const groupFacts = compileGroupFactsList(groups);
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
                ruleEvaluations.set(rule, { acceptedGroups: groupFacts, emitted: [], leftoverCount: groupFacts.length });
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
    factionName: string,
    factionAffinity: FactionAffinity,
    units: readonly Unit[],
    groups: readonly GroupSizeResult[] = [],
): OrgDefinitionEvaluationResult {
    return evaluateOrgDefinition(resolveOrgDefinitionSpec(factionName, factionAffinity), units, groups);
}

function compareGroupScore(left: GroupSizeResult, right: GroupSizeResult): number {
    if (left.tier !== right.tier) {
        return right.tier - left.tier;
    }
    return (right.priority ?? 0) - (left.priority ?? 0);
}

function getResolveContext(definition: OrgDefinitionSpec): ResolveContext {
    return {
        definition,
        ciFormationRules: definition.rules.filter((rule): rule is OrgCIFormationRule => rule.kind === 'ci-formation')
            .sort((left, right) => right.tier - left.tier || getRulePriority(right) - getRulePriority(left)),
        leafCountRules: definition.rules.filter((rule): rule is OrgLeafCountRule => rule.kind === 'leaf-count')
            .sort((left, right) => right.tier - left.tier || getRulePriority(right) - getRulePriority(left)),
        leafPatternRules: definition.rules.filter((rule): rule is OrgLeafPatternRule => rule.kind === 'leaf-pattern')
            .sort((left, right) => right.tier - left.tier || getRulePriority(right) - getRulePriority(left)),
        composedCountRules: definition.rules.filter((rule): rule is OrgComposedCountRule => rule.kind === 'composed-count')
            .sort((left, right) => left.tier - right.tier || getRulePriority(right) - getRulePriority(left)),
    };
}

function resolveWholeLeafCandidate(
    unitFacts: readonly UnitFacts[],
    context: ResolveContext,
): GroupSizeResult | null {
    const registry = context.definition.registry;
    let best: GroupSizeResult | null = null;

    for (const rule of context.ciFormationRules) {
        const materialized = materializeCIFormationRule(rule, unitFacts, registry);
        if (materialized.groups.length === 1 && materialized.leftoverUnitFacts.length === 0 && materialized.leftoverUnitAllocations.length === 0) {
            const candidate = materialized.groups[0];
            if (!best || compareGroupScore(candidate, best) < 0) {
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
            const materialized = materializeLeafCountRule(rule, unitFacts, registry);
            if (materialized.groups.length === 1 && materialized.leftoverUnitFacts.length === 0) {
                const candidate = materialized.groups[0];
                if (!best || compareGroupScore(candidate, best) < 0) {
                    best = candidate;
                }
            }
            continue;
        }

        const materialized = materializeLeafPatternRule(rule, unitFacts, registry);
        if (materialized.groups.length === 1 && materialized.leftoverUnitFacts.length === 0) {
            const candidate = materialized.groups[0];
            if (!best || compareGroupScore(candidate, best) < 0) {
                best = candidate;
            }
        }
    }

    return best;
}

function removeUsedUnitFacts(
    available: readonly UnitFacts[],
    groups: readonly GroupSizeResult[],
): UnitFacts[] {
    const usedUnits = new Set(groups.flatMap((group) => (group.units ?? []).map((unit) => unit)));
    return available.filter((facts) => !usedUnits.has(facts.unit));
}

function materializeLeafRulesByStage(
    unitFacts: readonly UnitFacts[],
    context: ResolveContext,
    stage: 'regular' | 'sub-regular' | 'all',
): { groups: GroupSizeResult[]; leftover: UnitFacts[]; leftoverUnitAllocations: GroupUnitAllocation[] } {
    const registry = context.definition.registry;
    let remaining = [...unitFacts];
    const groups: GroupSizeResult[] = [];
    const leftoverUnitAllocations: GroupUnitAllocation[] = [];

    if (stage !== 'sub-regular') {
        for (const rule of context.ciFormationRules) {
            const materialized = materializeCIFormationRule(rule, remaining, registry);
            groups.push(...materialized.groups);
            remaining = [...materialized.leftoverUnitFacts];
            leftoverUnitAllocations.push(...materialized.leftoverUnitAllocations);
        }
    }

    const leafRules: Array<OrgLeafCountRule | OrgLeafPatternRule> = [
        ...context.leafPatternRules,
        ...context.leafCountRules,
    ];

    for (const rule of leafRules) {
        if (rule.kind === 'leaf-pattern') {
            if (stage !== 'regular' && stage !== 'all') {
                continue;
            }
            const materialized = materializeLeafPatternRule(rule, remaining, registry);
            groups.push(...materialized.groups);
            remaining = [...materialized.leftoverUnitFacts];
            continue;
        }

        if (stage === 'regular' && (rule.priority ?? 0) < 0) {
			continue;
		}

        const descriptor = getRuleModifierDescriptor(rule);
        const targetSteps = stage === 'regular'
            ? [descriptor.regularStep]
            : stage === 'sub-regular'
                ? descriptor.subRegularStepsDescending
                : descriptor.stepsDescending;
        if (targetSteps.length === 0) {
            continue;
        }

        const eligibleUnits = remaining.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
        const ineligibleUnits = remaining.filter((facts) => !matchesUnitSelectors(facts, rule.unitSelector, registry));
        const usedIds = new Set<number>();
        const nextGroups: GroupSizeResult[] = [];

        for (const bucketUnits of groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry).values()) {
            let working = [...bucketUnits];
            for (const step of targetSteps) {
                while (working.length >= step.count) {
                    const selected = working.slice(0, step.count);
                    working = working.slice(step.count);
                    selected.forEach((facts) => usedIds.add(facts.factId));
                    nextGroups.push(createLeafGroup(rule, step, selected));
                }
            }
        }

        groups.push(...nextGroups);
        remaining = [
            ...ineligibleUnits,
            ...eligibleUnits.filter((facts) => !usedIds.has(facts.factId)),
        ];
    }

    return { groups, leftover: remaining, leftoverUnitAllocations };
}

function materializeComposedRulesByStage(
    groupFacts: readonly GroupFacts[],
    context: ResolveContext,
    stage: 'regular' | 'sub-regular' | 'all',
): { groups: GroupSizeResult[]; leftoverFacts: GroupFacts[] } {
    let remainingFacts = groupFacts.filter((facts) => !isBlockedSubRegularPromotionChild(facts.group, context));
    const groups: GroupSizeResult[] = [];

    for (const rule of context.composedCountRules) {
        const allowedModifierKeys = stage === 'all'
            ? undefined
            : new Set((stage === 'regular'
                ? [getRuleModifierDescriptor(rule).regularStep]
                : getRuleModifierDescriptor(rule).subRegularStepsDescending).map((step) => step.modifierKey));
        const materialized = materializeComposedCountRuleInternal(rule, remainingFacts, context.definition.registry, allowedModifierKeys);
        if (stage !== 'all') {
            if (materialized.groups.length > 0) {
                groups.push(...materialized.groups);
                const usedObjects = new Set(materialized.groups.flatMap((group) => group.children ?? []));
                remainingFacts = remainingFacts.filter((facts) => !usedObjects.has(facts.group));
                continue;
            }
            continue;
        }

        if (materialized.groups.length > 0) {
            groups.push(...materialized.groups);
            remainingFacts = [...materialized.leftoverGroupFacts];
        }
    }

    return { groups, leftoverFacts: remainingFacts };
}

function isBlockedSubRegularPromotionChild(
    group: GroupSizeResult,
    context: ResolveContext,
): boolean {
    if (!group.type) {
        return false;
    }

    const rule = context.composedCountRules.find((candidate) =>
        candidate.type === group.type && candidate.requireRegularForPromotion,
    ) ?? context.ciFormationRules.find((candidate) =>
        candidate.type === group.type && candidate.requireRegularForPromotion,
    );
    if (!rule) {
        return false;
    }

    const descriptor = getRuleModifierDescriptor(rule);
    const step = descriptor.stepsAscending.find((candidate) => candidate.modifierKey === group.modifierKey);
    return step?.relativeBand === 'sub-regular';
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
    return context.composedCountRules.find((rule) => rule.type === type);
}

function getAnyRuleByType(
    context: ResolveContext,
    type: GroupSizeResult['type'],
): OrgLeafCountRule | OrgLeafPatternRule | OrgCIFormationRule | OrgComposedCountRule | undefined {
    if (!type) {
        return undefined;
    }

    return context.ciFormationRules.find((rule) => rule.type === type || rule.fragmentType === type)
        ?? context.leafCountRules.find((rule) => rule.type === type)
        ?? context.leafPatternRules.find((rule) => rule.type === type)
        ?? context.composedCountRules.find((rule) => rule.type === type);
}

function getModifierBandForGroup(group: GroupSizeResult, context: ResolveContext): ModifierBand {
    const rule = getAnyRuleByType(context, group.type);
    if (!rule) {
        return group.modifierKey === '' ? 'regular' : 'sub-regular';
    }
    const descriptor = getRuleModifierDescriptor(rule);
    return descriptor.stepsAscending.find((step) => step.modifierKey === group.modifierKey)?.relativeBand ?? 'regular';
}

function scoreResolvedState(state: ResolvedState, context: ResolveContext): FinalStateScore {
    const topLevelGroupCount = state.groups.length;
    const leftoverCount = state.leftoverUnits.length + state.leftoverUnitAllocations.length;
    const highestTier = state.groups.length > 0 ? Math.max(...state.groups.map((group) => group.tier)) : 0;
    const highestTierGroupCount = state.groups.filter((group) => group.tier === highestTier).length;
    const totalPriority = state.groups.reduce((sum, group) => sum + (group.priority ?? 0), 0);
    const isWhole = topLevelGroupCount === 1
        && leftoverCount === 0
        && getModifierBandForGroup(state.groups[0], context) !== 'sub-regular';

    return {
        isWhole,
        highestTier,
        totalPriority,
        topLevelGroupCount,
        highestTierGroupCount,
        leftoverCount,
    };
}

function compareResolvedState(left: ResolvedState, right: ResolvedState, context: ResolveContext): number {
    const leftScore = scoreResolvedState(left, context);
    const rightScore = scoreResolvedState(right, context);

    if (leftScore.isWhole !== rightScore.isWhole) {
        return leftScore.isWhole ? -1 : 1;
    }
    if (leftScore.highestTier !== rightScore.highestTier) {
        return rightScore.highestTier - leftScore.highestTier;
    }
    if (leftScore.totalPriority !== rightScore.totalPriority) {
        return rightScore.totalPriority - leftScore.totalPriority;
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

    return 0;
}

function materializeResolvedState(state: ResolvedState): GroupSizeResult[] {
    return attachLeftoverUnits(normalizeTopLevelGroups(state.groups), state.leftoverUnits, state.leftoverUnitAllocations);
}

function pickBestResolvedState(
    states: readonly ResolvedState[],
    context: ResolveContext,
): ResolvedState {
    let best = states[0] ?? { groups: [], leftoverUnits: [], leftoverUnitAllocations: [] };

    for (const candidate of states.slice(1)) {
        if (compareResolvedState(candidate, best, context) < 0) {
            best = candidate;
        }
    }

    return best;
}

function getRuleTierByType(context: ResolveContext, type: GroupSizeResult['type']): number | null {
    if (!type) {
        return null;
    }

    const rule = context.definition.rules.find((candidate) => candidate.type === type);
    return rule?.tier ?? null;
}

function getMinimumChildTierForRule(rule: OrgComposedCountRule, context: ResolveContext): number {
    const childTiers = rule.childRoles
        .flatMap((role) => role.matches)
        .map((type) => getRuleTierByType(context, type))
        .filter((tier): tier is number => tier !== null);

    return childTiers.length > 0 ? Math.min(...childTiers) : rule.tier;
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

function getEligibleChildFacts(
    parent: GroupSizeResult,
    rule: OrgComposedCountRule,
    candidateFacts: readonly GroupFacts[],
    context: ResolveContext,
): GroupFacts[] {
    return candidateFacts.filter((facts) =>
        !isBlockedSubRegularPromotionChild(facts.group, context)
        && facts.tier < parent.tier
        && rule.childRoles.some((role) => groupMatchesRole(facts, role)),
    );
}

function isSingleBucketMatch(
    groups: readonly GroupFacts[],
    bucketBy: OrgBucketName | undefined,
    registry: OrgRuleRegistry,
): boolean {
    if (!bucketBy || groups.length <= 1) {
        return true;
    }

    const bucketValues = new Set(groups.map((group) => getGroupBucketValue(bucketBy, group, registry)));
    return bucketValues.size === 1;
}

function resolveWholeComposedCandidate(
    groups: readonly GroupSizeResult[],
    context: ResolveContext,
    guard: SolverGuard,
): GroupSizeResult | null {
    if (groups.length === 0) {
        return null;
    }

    if (groups.some((group) => isBlockedSubRegularPromotionChild(group, context))) {
        return null;
    }

    const compiledGroups = compileGroupFactsList(groups);
    const registry = context.definition.registry;
    let best: GroupSizeResult | null = null;

    for (const rule of context.composedCountRules) {
        const configs = buildCompositionConfigs(rule);
        for (const config of configs) {
            if (shouldAbortSearch(guard)) {
                return best;
            }
            if (!isSingleBucketMatch(compiledGroups, config.childMatchBucketBy, registry)) {
                continue;
            }
            if (!canAssignGroupsToRoles(compiledGroups, config.childRoles, guard)) {
                continue;
            }

            for (const step of config.modifierDescriptor.stepsDescending) {
                if (step.count !== groups.length || step.relativeBand === 'sub-regular') {
                    continue;
                }
                const candidate = createComposedGroup(rule, step, groups);
                if (!best || compareGroupScore(candidate, best) < 0) {
                    best = candidate;
                }
            }
        }
    }

    return best;
}

function canRepairSubRegularGroupForPromotion(
    group: GroupSizeResult,
    rule: OrgComposedCountRule,
): boolean {
    if (!rule.requireRegularForPromotion || group.type !== rule.type || !group.children || group.children.length === 0) {
        return false;
    }

    const descriptor = getRuleModifierDescriptor(rule);
    const step = descriptor.stepsAscending.find((candidate) => candidate.modifierKey === group.modifierKey);
    return step?.relativeBand === 'sub-regular';
}

function repairSubRegularGroupsForPromotion(
    groups: readonly GroupSizeResult[],
    context: ResolveContext,
): GroupSizeResult[] {
    let pool = [...groups];

    for (const rule of context.composedCountRules) {
        if (!rule.requireRegularForPromotion) {
            continue;
        }

        const candidates = pool.filter((group) => canRepairSubRegularGroupForPromotion(group, rule));
        if (candidates.length === 0) {
            continue;
        }

        const flattenedChildren = candidates.flatMap((group) => group.children ?? []);
        const repackaged = materializeComposedCountRule(rule, compileGroupFactsList(flattenedChildren), context.definition.registry);
        if (repackaged.groups.length === 0) {
            continue;
        }

        const candidateSet = new Set(candidates);
        pool = [
            ...pool.filter((group) => !candidateSet.has(group)),
            ...repackaged.groups,
        ];
    }

    return pool;
}

function runRegularPromotionLoop(
    initialPool: readonly GroupSizeResult[],
    context: ResolveContext,
    guard: SolverGuard,
): GroupSizeResult[] {
    let pool = [...initialPool];
    let previousSignature = '';
    let iteration = 0;

    while (iteration < MAX_PROMOTION_LOOP_ITERATIONS && !shouldAbortSearch(guard)) {
        iteration += 1;
        const signature = JSON.stringify(pool.map((group) => [group.type, group.modifierKey, group.children?.length ?? group.units?.length ?? 0]).sort());
        if (signature === previousSignature) {
            break;
        }
        previousSignature = signature;

        const regularPromotion = materializeComposedRulesByStage(compileGroupFactsList(pool), context, 'regular');
        if (regularPromotion.groups.length === 0) {
            continue;
        }

        const usedChildren = new Set(regularPromotion.groups.flatMap((group) => group.children ?? []));
        pool = [
            ...pool.filter((group) => !usedChildren.has(group)),
            ...regularPromotion.groups,
        ];
    }

    return pool;
}

function runLeftoverImprovementLoop(
    initialPool: readonly GroupSizeResult[],
    context: ResolveContext,
    guard: SolverGuard,
): GroupSizeResult[] {
    let pool = [...initialPool];
    let previousSignature = '';
    let iteration = 0;

    while (iteration < MAX_PROMOTION_LOOP_ITERATIONS && !shouldAbortSearch(guard)) {
        iteration += 1;
        const signature = JSON.stringify(pool.map((group) => [group.type, group.modifierKey, group.children?.length ?? group.units?.length ?? 0]).sort());
        if (signature === previousSignature) {
            break;
        }
        previousSignature = signature;

        const assimilated = assimilateLeftoversIntoParents(pool, context, guard);
        pool = runRegularPromotionLoop(assimilated, context, guard);

        const subRegularPromotion = materializeComposedRulesByStage(compileGroupFactsList(pool), context, 'sub-regular');
        if (subRegularPromotion.groups.length > 0) {
            const usedChildren = new Set(subRegularPromotion.groups.flatMap((group) => group.children ?? []));
            pool = [
                ...pool.filter((group) => !usedChildren.has(group)),
                ...subRegularPromotion.groups,
            ];
        }

        pool = runRegularPromotionLoop(pool, context, guard);
    }

    return pool;
}

function preAssimilateUnderRegularGroups(
    groups: readonly GroupSizeResult[],
    context: ResolveContext,
    guard: SolverGuard,
): GroupSizeResult[] {
    let pool = [...groups];
    const ruleByType = new Map(context.composedCountRules.map((rule) => [rule.type, rule]));
    const underRegularGroups = [...pool]
        .filter((group) => {
            const rule = group.type ? ruleByType.get(group.type) : undefined;
            if (!rule) {
                return false;
            }
            return group.modifierKey !== '' && getRuleModifierDescriptor(rule).subRegularStepsDescending.some((step) => step.modifierKey === group.modifierKey);
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

    for (const group of underRegularGroups) {
        const rule = group.type ? ruleByType.get(group.type) : undefined;
        if (!rule) {
            continue;
        }
        const descriptor = getRuleModifierDescriptor(rule);
        const currentStep = descriptor.stepsAscending.find((step) => step.modifierKey === group.modifierKey);
        if (!currentStep) {
            continue;
        }
        const currentCount = getCurrentStructuralCount(group, descriptor);
        const needed = descriptor.regularStep.count - currentCount;
        if (needed <= 0) {
            continue;
        }

        const remainingFacts = compileGroupFactsList(pool.filter((candidate) => candidate !== group));
        const roleMatches = getEligibleChildFacts(group, rule, remainingFacts, context);
        const addition = findConcreteComposition(roleMatches, rule.childRoles, needed, guard);
        if (!addition) {
            continue;
        }

        const additionGroups = addition.map((facts) => facts.group);
        pool = pool.filter((candidate) => candidate !== group && !additionGroups.includes(candidate));
        pool.push({
            ...group,
            name: makeGroupName(group.type, descriptor.regularStep.modifierKey),
            modifierKey: descriptor.regularStep.modifierKey,
            tier: descriptor.regularStep.tier,
            children: [...(group.children ?? []), ...additionGroups],
        });
    }

    return pool;
}

function assimilateLeftoversIntoParents(
    groups: readonly GroupSizeResult[],
    context: ResolveContext,
    guard: SolverGuard,
): GroupSizeResult[] {
    let pool = [...groups];
    const ruleByType = new Map(context.composedCountRules.map((rule) => [rule.type, rule]));
    const sortedParents = [...pool]
        .filter((group) => group.type !== null && ruleByType.has(group.type))
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

    for (const parent of sortedParents) {
        const rule = parent.type ? ruleByType.get(parent.type) : undefined;
        if (!rule) {
            continue;
        }
        const descriptor = getRuleModifierDescriptor(rule);
        const currentStep = descriptor.stepsAscending.find((step) => step.modifierKey === parent.modifierKey) ?? descriptor.regularStep;
        const nextSteps = descriptor.stepsAscending.filter((step) => step.count > currentStep.count);
        if (nextSteps.length === 0) {
            continue;
        }

        const availableFacts = compileGroupFactsList(pool.filter((candidate) => candidate !== parent));
        const matchingFacts = getEligibleChildFacts(parent, rule, availableFacts, context);

        let upgradedParent = parent;
        let usedGroups: GroupSizeResult[] = [];
        let currentCount = getCurrentStructuralCount(parent, descriptor);
        for (const targetStep of nextSteps) {
            const needed = targetStep.count - currentCount;
            if (needed <= 0) {
                upgradedParent = {
                    ...upgradedParent,
                    name: makeGroupName(rule.type, targetStep.modifierKey),
                    modifierKey: targetStep.modifierKey,
                    tier: targetStep.tier,
                };
                currentCount = Math.max(currentCount, targetStep.count);
                continue;
            }
            const selection = findConcreteComposition(
                matchingFacts.filter((facts) => !usedGroups.includes(facts.group)),
                rule.childRoles,
                needed,
                guard,
            );
            if (!selection) {
                break;
            }
            const addition = selection.map((facts) => facts.group);
            usedGroups = [...usedGroups, ...addition];
            currentCount += addition.length;
            upgradedParent = {
                ...upgradedParent,
                name: makeGroupName(rule.type, targetStep.modifierKey),
                modifierKey: targetStep.modifierKey,
                tier: targetStep.tier,
                children: [...(upgradedParent.children ?? []), ...addition],
            };
            break;
        }

        if (usedGroups.length > 0 || upgradedParent !== parent) {
            pool = pool.filter((candidate) => candidate !== parent && !usedGroups.includes(candidate));
            pool.push(upgradedParent);
        }
    }

    return pool;
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

function isNativeGroupForDefinition(group: GroupSizeResult, definition: OrgDefinitionSpec): boolean {
    const knownTypes = new Set(definition.rules.map((rule) => rule.type));

    return (group.type !== null && knownTypes.has(group.type))
        || (group.countsAsType !== null && knownTypes.has(group.countsAsType));
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
        tag: rule.tag,
        priority: rule.priority,
    };
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
        getRuleModifierDescriptor(rule).stepsAscending.map((step) => ({ rule, step })),
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
        if (isNativeGroupForDefinition(group, definition)) {
            normalized.push(group);
            continue;
        }

        const foreignDisplayName = group.foreignDisplayName ?? group.name;

        const descendantUnits = collectAllGroupUnits(group);
        if (descendantUnits.length > 0) {
            normalized.push(...applyForeignDisplayName(resolveWithDefinition(definition, descendantUnits, []), foreignDisplayName));
            continue;
        }

        normalized.push(...applyForeignDisplayName(crossgradeTierOnlyForeignGroup(group, context), foreignDisplayName));
    }

    return normalized;
}

function resolveWithDefinition(
    definition: OrgDefinitionSpec,
    units: readonly Unit[],
    groups: readonly GroupSizeResult[],
): GroupSizeResult[] {
    const context = getResolveContext(definition);
    const guard = createSolverGuard();
    const compiledUnits = compileUnitFactsList(units);
    const wholeLeaf = groups.length === 0 ? resolveWholeLeafCandidate(compiledUnits, context) : null;

    const regularLeafResult = materializeLeafRulesByStage(compiledUnits, context, 'regular');
    let pool = [
        ...groups,
        ...regularLeafResult.groups,
    ];
    const leftoverUnits = [...regularLeafResult.leftover];
    const leftoverUnitAllocations = [...regularLeafResult.leftoverUnitAllocations];

    pool = normalizeCIFormationGroups(pool, context);

    pool = repairSubRegularGroupsForPromotion(pool, context);

    pool = preAssimilateUnderRegularGroups(pool, context, guard);

    const wholeComposedFromInitial = resolveWholeComposedCandidate(pool, context, createSolverGuard());
    const initialImprovedPool = runLeftoverImprovementLoop(pool, context, createSolverGuard());

    const regularPool = runRegularPromotionLoop(pool, context, createSolverGuard());
    const candidateStates: ResolvedState[] = [
        { groups: regularPool, leftoverUnits, leftoverUnitAllocations },
        { groups: runLeftoverImprovementLoop(regularPool, context, createSolverGuard()), leftoverUnits, leftoverUnitAllocations },
        { groups: initialImprovedPool, leftoverUnits, leftoverUnitAllocations },
    ];

    if (wholeComposedFromInitial) {
        candidateStates.push({ groups: [wholeComposedFromInitial], leftoverUnits: [], leftoverUnitAllocations: [] });
    }

    if (leftoverUnits.length > 0) {
        const subRegularLeafResult = materializeLeafRulesByStage(leftoverUnits, context, 'sub-regular');
        const fallbackRegularPool = runRegularPromotionLoop([
            ...regularPool,
            ...subRegularLeafResult.groups,
        ], context, guard);
        candidateStates.push({
            groups: runLeftoverImprovementLoop(fallbackRegularPool, context, guard),
            leftoverUnits: subRegularLeafResult.leftover,
            leftoverUnitAllocations: [...leftoverUnitAllocations, ...subRegularLeafResult.leftoverUnitAllocations],
        });
    }

    if (wholeLeaf) {
        candidateStates.push({ groups: [wholeLeaf], leftoverUnits: [], leftoverUnitAllocations: [] });
    }

    const wholeComposed = resolveWholeComposedCandidate(regularPool, context, createSolverGuard());
    if (wholeComposed) {
        candidateStates.push({ groups: [wholeComposed], leftoverUnits: [], leftoverUnitAllocations: [] });
    }

    const bestState = pickBestResolvedState(candidateStates, context);

    return materializeResolvedState(bestState);
}

export function resolveFromUnits(
    units: readonly Unit[],
    factionName: string,
    factionAffinity: FactionAffinity,
    _hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
    const definition = resolveOrgDefinitionSpec(factionName, factionAffinity);
    return resolveWithDefinition(definition, units, []);
}

export function resolveFromGroups(
    factionName: string,
    factionAffinity: FactionAffinity,
    groupResults: readonly GroupSizeResult[],
    _hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
    const definition = resolveOrgDefinitionSpec(factionName, factionAffinity);
    return resolveWithDefinition(definition, [], preprocessGroupsForDefinition(definition, groupResults));
}
