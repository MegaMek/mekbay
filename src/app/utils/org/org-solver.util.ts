import type { FactionAffinity } from '../../models/factions.model';
import type { Unit } from '../../models/units.model';
import {
    compileGroupFacts,
    compileGroupFactsList,
    compileUnitFactsList,
    DEFAULT_ORG_RULE_REGISTRY,
} from './org-facts.util';
import { resolveOrgDefinitionSpec } from './org-registry.util';
import {
    getDynamicTierForModifier,
} from './org-tier.util';
import {
    EMPTY_RESULT,
    type GroupFacts,
    type GroupSizeResult,
    type OrgBucketName,
    type OrgBucketValue,
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

interface RoleAvailability {
    readonly role: string;
    readonly min: number | undefined;
    readonly max: number | undefined;
    readonly count: number;
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
    readonly roleAvailability: readonly RoleAvailability[];
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
    readonly leafCountRules: readonly OrgLeafCountRule[];
    readonly leafPatternRules: readonly OrgLeafPatternRule[];
    readonly composedCountRules: readonly OrgComposedCountRule[];
}

interface FinalStateScore {
    readonly isWhole: boolean;
    readonly highestTier: number;
    readonly totalPriority: number;
    readonly topLevelGroupCount: number;
    readonly leftoverCount: number;
}

interface ResolvedState {
    readonly groups: readonly GroupSizeResult[];
    readonly leftoverUnits: readonly UnitFacts[];
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
            const value = getPatternRefTotal(term.ref, allocation, pattern, availableBucketValues);
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

export function evaluateLeafPatternRule(
    rule: OrgLeafPatternRule,
    unitFacts: readonly UnitFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): LeafPatternEvaluationResult {
    const eligibleUnits = unitFacts.filter((facts) => matchesUnitSelectors(facts, rule.unitSelector, registry));
    const unitsByBucket = groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry);
    const emitted: LeafPatternEmission[] = [];
    const usedUnitIds = new Set<string>();
    const descriptor = getRuleModifierDescriptor(rule);
    const guard = createSolverGuard();

    rule.patterns.forEach((pattern, patternIndex) => {
        if (shouldAbortSearch(guard)) {
            return;
        }
        const concrete = materializePatternGreedy(pattern, unitsByBucket, guard);
        if (concrete.length === 0) {
            return;
        }
        const copies = concrete.length;
        for (const candidate of concrete) {
            for (const unit of candidate.units) {
                usedUnitIds.add(unit.unitId);
            }
        }
        emitted.push({
            modifierKey: descriptor.regularStep.modifierKey,
            perGroupCount: pattern.copySize,
            copies,
            tier: descriptor.regularStep.tier,
            patternIndex,
            score: concrete.reduce((sum, candidate) => sum + candidate.score, 0) / copies,
            allocations: concrete.map((candidate) => candidate.allocation),
        });
    });

    return {
        eligibleUnits,
        emitted,
        leftoverCount: eligibleUnits.filter((facts) => !usedUnitIds.has(facts.unitId)).length,
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
    const selectedUnitIds = new Set<string>();
    const groups: GroupSizeResult[] = [];
    const guard = createSolverGuard();

    rule.patterns.forEach((pattern) => {
        if (shouldAbortSearch(guard)) {
            return;
        }
        const candidates = materializePatternGreedy(pattern, unitsByBucket, guard);
        for (const candidate of candidates) {
            groups.push(createLeafGroup(rule, descriptor.regularStep, candidate.units));
            for (const unit of candidate.units) {
                selectedUnitIds.add(unit.unitId);
            }
        }
    });

    const leftoverUnitFacts = [
        ...ineligibleUnits,
        ...eligibleUnits.filter((facts) => !selectedUnitIds.has(facts.unitId)),
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
    const usedUnitIds = new Set<string>();

    for (const bucketUnits of groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry).values()) {
        let remaining = [...bucketUnits];
        for (const step of descriptor.stepsDescending) {
            while (remaining.length >= step.count) {
                const selected = remaining.slice(0, step.count);
                remaining = remaining.slice(step.count);
                selected.forEach((facts) => usedUnitIds.add(facts.unitId));
                groups.push(createLeafGroup(rule, step, selected));
            }
        }
    }

    return {
        groups,
        leftoverUnitFacts: [
            ...ineligibleUnits,
            ...eligibleUnits.filter((facts) => !usedUnitIds.has(facts.unitId)),
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

function roleAvailabilityForGroups(
    groups: readonly GroupFacts[],
    childRoles: readonly OrgChildRoleSpec[],
): RoleAvailability[] {
    return childRoles.map((role) => ({
        role: role.role,
        min: role.min,
        max: role.max,
        count: groups.filter((group) => groupMatchesRole(group, role)).length,
    }));
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
        roleAvailability: roleAvailabilityForGroups(groupFacts, config.childRoles),
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
        roleAvailability: best?.roleAvailability ?? roleAvailabilityForGroups(groupFacts, rule.childRoles),
        emitted,
        leftoverCount: groupFacts.length - usedGroups,
    };
}

export function materializeComposedCountRule(
    rule: OrgComposedCountRule,
    groupFacts: readonly GroupFacts[],
    registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): MaterializedComposedGroupResult {
    const configs = buildCompositionConfigs(rule);
    const guard = createSolverGuard();
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
): { groups: GroupSizeResult[]; leftover: UnitFacts[] } {
    const registry = context.definition.registry;
    let remaining = [...unitFacts];
    const groups: GroupSizeResult[] = [];

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
        const usedIds = new Set<string>();
        const nextGroups: GroupSizeResult[] = [];

        for (const bucketUnits of groupUnitsByBucket(eligibleUnits, rule.bucketBy, registry).values()) {
            let working = [...bucketUnits];
            for (const step of targetSteps) {
                while (working.length >= step.count) {
                    const selected = working.slice(0, step.count);
                    working = working.slice(step.count);
                    selected.forEach((facts) => usedIds.add(facts.unitId));
                    nextGroups.push(createLeafGroup(rule, step, selected));
                }
            }
        }

        groups.push(...nextGroups);
        remaining = [
            ...ineligibleUnits,
            ...eligibleUnits.filter((facts) => !usedIds.has(facts.unitId)),
        ];
    }

    return { groups, leftover: remaining };
}

function materializeComposedRulesByStage(
    groupFacts: readonly GroupFacts[],
    context: ResolveContext,
    stage: 'regular' | 'sub-regular' | 'all',
): { groups: GroupSizeResult[]; leftoverFacts: GroupFacts[] } {
    let remainingFacts = [...groupFacts];
    const groups: GroupSizeResult[] = [];

    for (const rule of context.composedCountRules) {
        const materialized = materializeComposedCountRule(rule, remainingFacts, context.definition.registry);
        if (stage !== 'all') {
            const descriptor = getRuleModifierDescriptor(rule);
            const allowedModifierKeys = new Set((stage === 'regular' ? [descriptor.regularStep] : descriptor.subRegularStepsDescending).map((step) => step.modifierKey));
            const allowedGroups = materialized.groups.filter((group) => allowedModifierKeys.has(group.modifierKey));
            if (allowedGroups.length > 0) {
                groups.push(...allowedGroups);
                const allowedObjects = new Set(allowedGroups.flatMap((group) => group.children ?? []));
                remainingFacts = remainingFacts.filter((facts) => !allowedObjects.has(facts.group));
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

function attachLeftoverUnits(groups: GroupSizeResult[], leftoverUnits: readonly UnitFacts[]): GroupSizeResult[] {
    if (leftoverUnits.length === 0) {
        return groups;
    }
    if (groups.length === 0) {
        return [{
            ...EMPTY_RESULT,
            leftoverUnits: leftoverUnits.map((facts) => facts.unit),
        }];
    }
    const sorted = [...groups].sort(compareGroupScore);
    const [top, ...rest] = sorted;
    return [{
        ...top,
        leftoverUnits: leftoverUnits.map((facts) => facts.unit),
    }, ...rest];
}

function getRuleByType(context: ResolveContext, type: GroupSizeResult['type']): OrgComposedCountRule | undefined {
    if (!type) {
        return undefined;
    }
    return context.composedCountRules.find((rule) => rule.type === type);
}

function getModifierBandForGroup(group: GroupSizeResult, context: ResolveContext): ModifierBand {
    const rule = getRuleByType(context, group.type);
    if (!rule) {
        return group.modifierKey === '' ? 'regular' : 'sub-regular';
    }
    const descriptor = getRuleModifierDescriptor(rule);
    return descriptor.stepsAscending.find((step) => step.modifierKey === group.modifierKey)?.relativeBand ?? 'regular';
}

function scoreResolvedState(state: ResolvedState, context: ResolveContext): FinalStateScore {
    const topLevelGroupCount = state.groups.length;
    const leftoverCount = state.leftoverUnits.length;
    const highestTier = state.groups.length > 0 ? Math.max(...state.groups.map((group) => group.tier)) : 0;
    const totalPriority = state.groups.reduce((sum, group) => sum + (group.priority ?? 0), 0);
    const isWhole = topLevelGroupCount === 1
        && leftoverCount === 0
        && getModifierBandForGroup(state.groups[0], context) !== 'sub-regular';

    return {
        isWhole,
        highestTier,
        totalPriority,
        topLevelGroupCount,
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

    return 0;
}

function materializeResolvedState(state: ResolvedState): GroupSizeResult[] {
    return attachLeftoverUnits(normalizeTopLevelGroups(state.groups), state.leftoverUnits);
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
): GroupFacts[] {
    return candidateFacts.filter((facts) =>
        facts.tier < parent.tier && rule.childRoles.some((role) => groupMatchesRole(facts, role)),
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

        const subRegularPromotion = materializeComposedRulesByStage(compileGroupFactsList(pool), context, 'sub-regular');
        if (subRegularPromotion.groups.length > 0) {
            const usedChildren = new Set(subRegularPromotion.groups.flatMap((group) => group.children ?? []));
            pool = [
                ...pool.filter((group) => !usedChildren.has(group)),
                ...subRegularPromotion.groups,
            ];
        }

        const assimilated = assimilateLeftoversIntoParents(pool, context, guard);
        pool = runRegularPromotionLoop(assimilated, context, guard);
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
        const roleMatches = getEligibleChildFacts(group, rule, remainingFacts);
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
        const matchingFacts = getEligibleChildFacts(parent, rule, availableFacts);

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

    pool = preAssimilateUnderRegularGroups(pool, context, guard);

    const regularPool = runRegularPromotionLoop(pool, context, guard);
    const candidateStates: ResolvedState[] = [
        { groups: regularPool, leftoverUnits },
        { groups: runLeftoverImprovementLoop(regularPool, context, guard), leftoverUnits },
    ];

    if (leftoverUnits.length > 0) {
        const subRegularLeafResult = materializeLeafRulesByStage(leftoverUnits, context, 'sub-regular');
        const fallbackRegularPool = runRegularPromotionLoop([
            ...regularPool,
            ...subRegularLeafResult.groups,
        ], context, guard);
        candidateStates.push({
            groups: runLeftoverImprovementLoop(fallbackRegularPool, context, guard),
            leftoverUnits: subRegularLeafResult.leftover,
        });
    }

    if (wholeLeaf) {
        candidateStates.push({ groups: [wholeLeaf], leftoverUnits: [] });
    }

    const wholeComposed = resolveWholeComposedCandidate(regularPool, context, guard);
    if (wholeComposed) {
        candidateStates.push({ groups: [wholeComposed], leftoverUnits: [] });
    }

    const bestState = candidateStates.sort((left, right) => compareResolvedState(left, right, context))[0]
        ?? { groups: [], leftoverUnits };

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
    return resolveWithDefinition(definition, [], groupResults);
}
