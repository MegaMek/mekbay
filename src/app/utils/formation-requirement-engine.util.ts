import { GameSystem } from '../models/common.model';
import type { FormationTypeDefinition } from './formation-type.model';
import { getFormationBlueprint } from './formation-blueprints';
import type { FormationCandidatePredicateFilter, FormationConditionalForbiddenPredicate, FormationConstraint, FormationConstraintEvaluation, FormationDeficit, FormationEvaluation, FormationPredicateId, FormationRequirementBlueprint, FormationSearchDecision } from './formation-requirement.model';
import { evaluateFormationPredicate, getFormationFactValue } from './formation-predicates.util';
import { compileFormationUnitFacts, type FormationUnitFacts, type FormationUnitLike } from './formation-unit-facts.util';

export class FormationRequirementEngine {
    public static hasBlueprint(formationId: string): boolean {
        return getFormationBlueprint(formationId) !== null;
    }

    public static getBaseCandidatePredicateFilter(
        definition: Pick<FormationTypeDefinition, 'id'>,
    ): FormationCandidatePredicateFilter {
        const blueprint = getFormationBlueprint(definition.id);
        if (!blueprint) {
            return this.createCandidatePredicateFilter();
        }

        const filter = this.createMutableCandidatePredicateFilter();
        this.collectBaseCandidatePredicateFilter(blueprint.constraints, filter, true);
        return this.createCandidatePredicateFilter(filter);
    }

    public static getSearchCandidatePredicateFilter(
        definition: Pick<FormationTypeDefinition, 'id'>,
        units: readonly FormationUnitLike[],
        gameSystem: GameSystem,
    ): FormationCandidatePredicateFilter {
        const blueprint = getFormationBlueprint(definition.id);
        if (!blueprint) {
            return this.createCandidatePredicateFilter();
        }

        const facts = units.map(unit => compileFormationUnitFacts(unit));
        const filter = this.createMutableCandidatePredicateFilter();
        this.collectBaseCandidatePredicateFilter(blueprint.constraints, filter, true);
        for (const constraint of blueprint.constraints) {
            this.collectSearchCandidatePredicateFilter(constraint, facts, gameSystem, filter);
        }
        return this.createCandidatePredicateFilter(filter);
    }

    public static evaluateDefinition(
        definition: FormationTypeDefinition,
        units: readonly FormationUnitLike[],
        gameSystem: GameSystem,
    ): FormationEvaluation | null {
        const blueprint = getFormationBlueprint(definition.id);
        if (!blueprint) {
            return null;
        }

        return this.evaluateBlueprint(blueprint, definition, units, gameSystem);
    }

    public static evaluateBlueprint(
        blueprint: FormationRequirementBlueprint,
        definition: Pick<FormationTypeDefinition, 'id' | 'idealRole' | 'minUnits' | 'maxUnits'>,
        units: readonly FormationUnitLike[],
        gameSystem: GameSystem,
    ): FormationEvaluation {
        const unitCountEvaluation = this.evaluateUnitCount(definition, units.length);
        if (unitCountEvaluation) {
            return this.createEvaluation(definition.id, units.length, false, [unitCountEvaluation]);
        }

        if (definition.idealRole && units.every((unit) => unit.getUnit().role === definition.idealRole)) {
            return {
                formationId: definition.id,
                valid: true,
                unitCount: units.length,
                shortCircuitedByIdealRole: true,
                constraints: [],
                failedConstraintIds: [],
            };
        }

        const facts = units.map(unit => compileFormationUnitFacts(unit));
        const constraintEvaluations = blueprint.constraints.map(constraint => (
            this.evaluateConstraint(constraint, facts, gameSystem)
        ));

        return this.createEvaluation(definition.id, units.length, false, constraintEvaluations);
    }

    public static evaluateSearchCandidate(
        definition: FormationTypeDefinition,
        currentUnits: readonly FormationUnitLike[],
        candidateUnit: FormationUnitLike,
        gameSystem: GameSystem,
        options: { minUnits?: number; maxUnits?: number } = {},
    ): FormationSearchDecision {
        if (options.maxUnits !== undefined && currentUnits.length + 1 > options.maxUnits) {
            return {
                allowed: false,
                fillsDeficit: false,
                preservesValidFormation: false,
                violatesHardConstraint: true,
                remainingDeficits: [],
                reasons: [`Adding this unit would exceed ${options.maxUnits} units.`],
            };
        }

        const currentEvaluation = this.evaluateDefinitionForSearch(definition, currentUnits, gameSystem);
        const nextEvaluation = this.evaluateDefinitionForSearch(definition, [...currentUnits, candidateUnit], gameSystem);
        if (!nextEvaluation) {
            return {
                allowed: true,
                fillsDeficit: false,
                preservesValidFormation: currentEvaluation?.valid ?? false,
                violatesHardConstraint: false,
                remainingDeficits: [],
                reasons: [],
            };
        }

        const currentDeficits = currentEvaluation ? this.getDeficits(currentEvaluation) : [];
        const nextDeficits = this.getDeficits(nextEvaluation);
        const currentFormationDeficits = this.getFormationDeficits(currentDeficits);
        const nextFormationDeficits = this.getFormationDeficits(nextDeficits);
        const currentDeficitScore = this.getDeficitScore(currentDeficits);
        const nextDeficitScore = this.getDeficitScore(nextDeficits);
        const violatesHardConstraint = this.hasHardConstraintViolation(nextEvaluation);
        const preservesValidFormation = currentEvaluation?.valid === true && nextEvaluation.valid;
        const fillsAnyDeficit = currentEvaluation?.valid !== true && nextDeficitScore < currentDeficitScore;
        const fillsFormationDeficit = currentEvaluation?.valid !== true && this.getDeficitScore(nextFormationDeficits) < this.getDeficitScore(currentFormationDeficits);
        const keepsFormationDeficitsSatisfied = currentFormationDeficits.length === 0 && nextFormationDeficits.length === 0;
        const growsTowardMinimumWithoutLosingGround = currentEvaluation?.valid !== true
            && this.hasUnitCountMinimumDeficit(currentDeficits)
            && nextDeficitScore <= currentDeficitScore;
        const growsTowardRequestedMinimumFromValidPartial = currentEvaluation?.valid === true
            && options.minUnits !== undefined
            && currentUnits.length < options.minUnits
            && !violatesHardConstraint;
        const fillsDeficit = nextEvaluation.valid || fillsFormationDeficit || (fillsAnyDeficit && keepsFormationDeficitsSatisfied);
        const allowed = nextEvaluation.valid
            || (!violatesHardConstraint && (fillsAnyDeficit || growsTowardMinimumWithoutLosingGround || growsTowardRequestedMinimumFromValidPartial));

        return {
            allowed,
            fillsDeficit,
            preservesValidFormation,
            violatesHardConstraint,
            remainingDeficits: nextDeficits,
            reasons: nextEvaluation.constraints
                .filter(constraint => !constraint.satisfied)
                .map(constraint => constraint.reason ?? constraint.label),
        };
    }

    public static getDeficits(evaluation: FormationEvaluation): readonly FormationDeficit[] {
        return this.collectDeficits(evaluation.constraints);
    }

    public static hasHardConstraintViolations(evaluation: FormationEvaluation): boolean {
        return this.hasHardConstraintViolation(evaluation);
    }

    private static evaluateDefinitionForSearch(
        definition: FormationTypeDefinition,
        units: readonly FormationUnitLike[],
        gameSystem: GameSystem,
    ): FormationEvaluation | null {
        const blueprint = getFormationBlueprint(definition.id);
        if (!blueprint) {
            return null;
        }

        const unitCountEvaluation = this.evaluateUnitCount(definition, units.length);
        if (definition.idealRole && units.every((unit) => unit.getUnit().role === definition.idealRole)) {
            return this.createEvaluation(definition.id, units.length, true, unitCountEvaluation ? [unitCountEvaluation] : []);
        }

        const facts = units.map(unit => compileFormationUnitFacts(unit));
        const constraintEvaluations = blueprint.constraints.map(constraint => (
            this.evaluateConstraint(constraint, facts, gameSystem)
        ));

        return this.createEvaluation(
            definition.id,
            units.length,
            false,
            unitCountEvaluation ? [unitCountEvaluation, ...constraintEvaluations] : constraintEvaluations,
        );
    }

    private static evaluateUnitCount(
        definition: Pick<FormationTypeDefinition, 'id' | 'minUnits' | 'maxUnits'>,
        unitCount: number,
    ): FormationConstraintEvaluation | null {
        if (definition.minUnits && unitCount < definition.minUnits) {
            return {
                constraintId: 'unit-count-min',
                label: 'Minimum unit count',
                satisfied: false,
                actual: unitCount,
                required: definition.minUnits,
                reason: `Needs at least ${definition.minUnits} units.`,
            };
        }

        if (definition.maxUnits && unitCount > definition.maxUnits) {
            return {
                constraintId: 'unit-count-max',
                label: 'Maximum unit count',
                satisfied: false,
                actual: unitCount,
                required: definition.maxUnits,
                reason: `Allows at most ${definition.maxUnits} units.`,
            };
        }

        return null;
    }

    private static getDeficitScore(deficits: readonly FormationDeficit[]): number {
        return deficits.reduce((sum, deficit) => sum + deficit.needed, 0);
    }

    private static getFormationDeficits(deficits: readonly FormationDeficit[]): readonly FormationDeficit[] {
        return deficits.filter(deficit => !this.isUnitCountConstraint(deficit.constraintId));
    }

    private static isUnitCountConstraint(constraintId: string): boolean {
        return constraintId === 'unit-count-min' || constraintId === 'unit-count-max';
    }

    private static hasUnitCountMinimumDeficit(deficits: readonly FormationDeficit[]): boolean {
        return deficits.some(deficit => deficit.constraintId === 'unit-count-min' && deficit.needed > 0);
    }

    private static hasHardConstraintViolation(evaluation: FormationEvaluation): boolean {
        return this.hasHardConstraintViolationInConstraints(evaluation.constraints);
    }

    private static hasHardConstraintViolationInConstraints(constraints: readonly FormationConstraintEvaluation[]): boolean {
        return constraints.some(constraint => {
            if (constraint.satisfied) {
                return false;
            }
            if (constraint.childEvaluations?.length) {
                if (constraint.kind === 'any-of') {
                    return constraint.childEvaluations.every(childConstraint => this.hasHardConstraintViolationInConstraints([childConstraint]));
                }
                return this.hasHardConstraintViolationInConstraints(constraint.childEvaluations);
            }
            if (constraint.constraintId.endsWith('-max') || constraint.label.startsWith('No ') || constraint.label.startsWith('At most ')) {
                return true;
            }
            if (constraint.label.startsWith('All ')) {
                return true;
            }
            if (constraint.constraintId.includes('same-')) {
                return true;
            }
            if (constraint.required !== undefined && constraint.actual !== undefined && constraint.actual > constraint.required) {
                return true;
            }
            return constraint.reason?.includes('Allows at most') === true
                || constraint.reason?.includes('All ') === true
                || constraint.reason?.includes('No ') === true
                || constraint.reason?.includes('At most ') === true;
        });
    }

    private static createEvaluation(
        formationId: string,
        unitCount: number,
        shortCircuitedByIdealRole: boolean,
        constraints: readonly FormationConstraintEvaluation[],
    ): FormationEvaluation {
        const failedConstraintIds = constraints
            .filter(constraint => !constraint.satisfied)
            .map(constraint => constraint.constraintId);

        return {
            formationId,
            valid: failedConstraintIds.length === 0,
            unitCount,
            shortCircuitedByIdealRole,
            constraints,
            failedConstraintIds,
        };
    }

    private static createMutableCandidatePredicateFilter(): {
        requiredPredicates: Set<FormationPredicateId>;
        helpfulPredicates: Set<FormationPredicateId>;
        forbiddenPredicates: Set<FormationPredicateId>;
        conditionalForbiddenPredicates: FormationConditionalForbiddenPredicate[];
    } {
        return {
            requiredPredicates: new Set<FormationPredicateId>(),
            helpfulPredicates: new Set<FormationPredicateId>(),
            forbiddenPredicates: new Set<FormationPredicateId>(),
            conditionalForbiddenPredicates: [],
        };
    }

    private static createCandidatePredicateFilter(filter = this.createMutableCandidatePredicateFilter()): FormationCandidatePredicateFilter {
        const conditionalSeen = new Set<string>();
        const conditionalForbiddenPredicates = filter.conditionalForbiddenPredicates.filter((entry) => {
            const key = `${entry.when}\0${entry.predicate}`;
            if (conditionalSeen.has(key)) {
                return false;
            }
            conditionalSeen.add(key);
            return true;
        });

        return {
            requiredPredicates: [...filter.requiredPredicates],
            helpfulPredicates: [...filter.helpfulPredicates].filter(predicate => !filter.forbiddenPredicates.has(predicate)),
            forbiddenPredicates: [...filter.forbiddenPredicates],
            conditionalForbiddenPredicates,
        };
    }

    private static collectBaseCandidatePredicateFilter(
        constraints: readonly FormationConstraint[],
        filter: ReturnType<typeof FormationRequirementEngine.createMutableCandidatePredicateFilter>,
        globallyRequired: boolean,
    ): void {
        for (const constraint of constraints) {
            if (constraint.kind === 'all' && globallyRequired) {
                filter.requiredPredicates.add(constraint.predicate);
                continue;
            }
            if ((constraint.kind === 'count-max' || constraint.kind === 'count-exact') && globallyRequired && constraint.count === 0) {
                filter.forbiddenPredicates.add(constraint.predicate);
                continue;
            }
            if (constraint.kind === 'all-of') {
                this.collectBaseCandidatePredicateFilter(constraint.constraints, filter, globallyRequired);
                continue;
            }
            if (constraint.kind === 'conditional') {
                for (const childConstraint of constraint.constraints) {
                    if ((childConstraint.kind === 'count-max' || childConstraint.kind === 'count-exact') && childConstraint.count === 0) {
                        filter.conditionalForbiddenPredicates.push({ when: constraint.when, predicate: childConstraint.predicate });
                    }
                }
            }
        }
    }

    private static collectSearchCandidatePredicateFilter(
        constraint: FormationConstraint,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
        filter: ReturnType<typeof FormationRequirementEngine.createMutableCandidatePredicateFilter>,
    ): boolean {
        switch (constraint.kind) {
            case 'all':
                return this.countMatchingFacts(facts, constraint.predicate, gameSystem) === facts.length;
            case 'count-min': {
                const matchingCount = this.countMatchingFacts(facts, constraint.predicate, gameSystem);
                if (matchingCount < constraint.count) {
                    filter.helpfulPredicates.add(constraint.predicate);
                }
                return matchingCount >= constraint.count;
            }
            case 'count-exact': {
                const matchingCount = this.countMatchingFacts(facts, constraint.predicate, gameSystem);
                if (matchingCount < constraint.count) {
                    filter.helpfulPredicates.add(constraint.predicate);
                } else {
                    filter.forbiddenPredicates.add(constraint.predicate);
                }
                return matchingCount === constraint.count;
            }
            case 'count-max': {
                const matchingCount = this.countMatchingFacts(facts, constraint.predicate, gameSystem);
                if (matchingCount >= constraint.count) {
                    filter.forbiddenPredicates.add(constraint.predicate);
                }
                return matchingCount <= constraint.count;
            }
            case 'percent-min': {
                const matchingCount = this.countMatchingFacts(facts, constraint.predicate, gameSystem);
                const required = this.getPercentRequiredCount(constraint, facts.length);
                if (matchingCount < required) {
                    filter.helpfulPredicates.add(constraint.predicate);
                }
                return matchingCount >= required;
            }
            case 'matched-pairs-min': {
                const matchingPairs = this.countMatchedPairs(facts, constraint.predicate, gameSystem);
                if (matchingPairs < constraint.count) {
                    filter.helpfulPredicates.add(constraint.predicate);
                }
                return matchingPairs >= constraint.count;
            }
            case 'same-value':
                return this.evaluateSameValueConstraint(constraint, facts, gameSystem).satisfied;
            case 'conditional': {
                const applies = facts.some(unitFacts => evaluateFormationPredicate(constraint.when, unitFacts, gameSystem));
                if (!applies) {
                    return true;
                }
                return this.collectAllChildSearchCandidatePredicateFilters(constraint.constraints, facts, gameSystem, filter);
            }
            case 'all-of':
                return this.collectAllChildSearchCandidatePredicateFilters(constraint.constraints, facts, gameSystem, filter);
            case 'any-of': {
                const childFilters = constraint.constraints.map((childConstraint) => {
                    const childFilter = this.createMutableCandidatePredicateFilter();
                    const satisfied = this.collectSearchCandidatePredicateFilter(childConstraint, facts, gameSystem, childFilter);
                    return { childFilter, satisfied };
                });
                const satisfiedChildFilters = childFilters.filter(entry => entry.satisfied);
                if (satisfiedChildFilters.length > 0) {
                    for (const entry of satisfiedChildFilters) {
                        this.mergeCandidatePredicateFilters(filter, entry.childFilter, { includeHelpful: false, includeForbidden: true });
                    }
                    return true;
                }
                for (const entry of childFilters) {
                    this.mergeCandidatePredicateFilters(filter, entry.childFilter, { includeHelpful: true, includeForbidden: false });
                }
                return false;
            }
        }
    }

    private static collectAllChildSearchCandidatePredicateFilters(
        constraints: readonly FormationConstraint[],
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
        filter: ReturnType<typeof FormationRequirementEngine.createMutableCandidatePredicateFilter>,
    ): boolean {
        let satisfied = true;
        for (const childConstraint of constraints) {
            if (!this.collectSearchCandidatePredicateFilter(childConstraint, facts, gameSystem, filter)) {
                satisfied = false;
            }
        }
        return satisfied;
    }

    private static mergeCandidatePredicateFilters(
        target: ReturnType<typeof FormationRequirementEngine.createMutableCandidatePredicateFilter>,
        source: ReturnType<typeof FormationRequirementEngine.createMutableCandidatePredicateFilter>,
        options: { includeHelpful: boolean; includeForbidden: boolean },
    ): void {
        for (const predicate of source.requiredPredicates) {
            target.requiredPredicates.add(predicate);
        }
        if (options.includeHelpful) {
            for (const predicate of source.helpfulPredicates) {
                target.helpfulPredicates.add(predicate);
            }
        }
        if (options.includeForbidden) {
            for (const predicate of source.forbiddenPredicates) {
                target.forbiddenPredicates.add(predicate);
            }
        }
        target.conditionalForbiddenPredicates.push(...source.conditionalForbiddenPredicates);
    }

    private static collectDeficits(constraints: readonly FormationConstraintEvaluation[]): readonly FormationDeficit[] {
        return constraints.flatMap((constraint): FormationDeficit[] => {
            if (constraint.satisfied) {
                return [];
            }

            if (constraint.childEvaluations?.length) {
                if (constraint.kind === 'any-of') {
                    return this.getLowestDeficitAlternative(constraint.childEvaluations);
                }

                const childDeficits = this.collectDeficits(constraint.childEvaluations);
                if (childDeficits.length > 0) {
                    return [...childDeficits];
                }
            }

            if (constraint.required === undefined || constraint.actual === undefined || constraint.required <= constraint.actual) {
                return [];
            }

            return [{
                constraintId: constraint.constraintId,
                label: constraint.label,
                needed: Math.max(0, constraint.required - constraint.actual),
                predicate: constraint.predicate,
            }];
        });
    }

    private static getLowestDeficitAlternative(
        childEvaluations: readonly FormationConstraintEvaluation[],
    ): FormationDeficit[] {
        let bestDeficits: FormationDeficit[] | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const childEvaluation of childEvaluations) {
            const deficits = this.collectDeficits([childEvaluation]) as FormationDeficit[];
            const score = this.getDeficitScore(deficits);
            if (score < bestScore) {
                bestScore = score;
                bestDeficits = deficits;
            }
        }
        return bestDeficits ?? [];
    }

    private static countMatchingFacts(
        facts: readonly FormationUnitFacts[],
        predicate: FormationPredicateId,
        gameSystem: GameSystem,
    ): number {
        return facts.filter(unitFacts => evaluateFormationPredicate(predicate, unitFacts, gameSystem)).length;
    }

    private static getPercentRequiredCount(
        constraint: Extract<FormationConstraint, { kind: 'percent-min' }>,
        unitCount: number,
    ): number {
        return constraint.rounding === 'strict-majority'
            ? Math.floor(unitCount / 2) + 1
            : Math.ceil(unitCount * constraint.ratio);
    }

    private static countMatchedPairs(
        facts: readonly FormationUnitFacts[],
        predicate: FormationPredicateId,
        gameSystem: GameSystem,
    ): number {
        const pairCounts = new Map<string, number>();
        for (const unitFacts of facts) {
            if (!evaluateFormationPredicate(predicate, unitFacts, gameSystem)) {
                continue;
            }
            pairCounts.set(unitFacts.name, (pairCounts.get(unitFacts.name) ?? 0) + 1);
        }
        return [...pairCounts.values()].filter(count => count >= 2).length;
    }

    private static evaluateConstraint(
        constraint: FormationConstraint,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
    ): FormationConstraintEvaluation {
        switch (constraint.kind) {
            case 'all':
                return this.evaluateAllConstraint(constraint, facts, gameSystem);
            case 'all-of':
            case 'any-of':
                return this.evaluateCompoundConstraint(constraint, facts, gameSystem);
            case 'conditional':
                return this.evaluateConditionalConstraint(constraint, facts, gameSystem);
            case 'count-min':
            case 'count-max':
            case 'count-exact':
                return this.evaluateCountConstraint(constraint, facts, gameSystem);
            case 'matched-pairs-min':
                return this.evaluateMatchedPairsConstraint(constraint, facts, gameSystem);
            case 'percent-min':
                return this.evaluatePercentConstraint(constraint, facts, gameSystem);
            case 'same-value':
                return this.evaluateSameValueConstraint(constraint, facts, gameSystem);
        }
    }

    private static evaluateAllConstraint(
        constraint: Extract<FormationConstraint, { kind: 'all' }>,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
    ): FormationConstraintEvaluation {
        const matchingCount = facts.filter(unitFacts => evaluateFormationPredicate(constraint.predicate, unitFacts, gameSystem)).length;
        const satisfied = matchingCount === facts.length;

        return {
            constraintId: constraint.id,
            kind: constraint.kind,
            label: constraint.label,
            satisfied,
            predicate: constraint.predicate,
            actual: matchingCount,
            required: facts.length,
        };
    }

    private static evaluateCompoundConstraint(
        constraint: Extract<FormationConstraint, { kind: 'all-of' | 'any-of' }>,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
    ): FormationConstraintEvaluation {
        const childEvaluations = constraint.constraints.map(childConstraint => (
            this.evaluateConstraint(childConstraint, facts, gameSystem)
        ));
        const satisfied = constraint.kind === 'all-of'
            ? childEvaluations.every(evaluation => evaluation.satisfied)
            : childEvaluations.some(evaluation => evaluation.satisfied);

        return {
            constraintId: constraint.id,
            kind: constraint.kind,
            label: constraint.label,
            satisfied,
            actual: childEvaluations.filter(evaluation => evaluation.satisfied).length,
            required: constraint.kind === 'all-of' ? childEvaluations.length : 1,
            reason: satisfied
                ? undefined
                : childEvaluations
                    .filter(evaluation => !evaluation.satisfied)
                    .map(evaluation => evaluation.reason ?? evaluation.label)
                    .join('; '),
            childEvaluations,
        };
    }

    private static evaluateConditionalConstraint(
        constraint: Extract<FormationConstraint, { kind: 'conditional' }>,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
    ): FormationConstraintEvaluation {
        const applies = facts.some(unitFacts => evaluateFormationPredicate(constraint.when, unitFacts, gameSystem));
        if (!applies) {
            return {
                constraintId: constraint.id,
                kind: constraint.kind,
                label: constraint.label,
                satisfied: true,
                actual: 0,
                required: 0,
            };
        }

        const evaluation = this.evaluateCompoundConstraint(
            {
                id: constraint.id,
                kind: 'all-of',
                label: constraint.label,
                constraints: constraint.constraints,
            },
            facts,
            gameSystem,
        );
        return { ...evaluation, kind: constraint.kind };
    }

    private static evaluateCountConstraint(
        constraint: Extract<FormationConstraint, { kind: 'count-min' | 'count-max' | 'count-exact' }>,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
    ): FormationConstraintEvaluation {
        const matchingCount = facts.filter(unitFacts => evaluateFormationPredicate(constraint.predicate, unitFacts, gameSystem)).length;
        const satisfied = constraint.kind === 'count-min'
            ? matchingCount >= constraint.count
            : constraint.kind === 'count-max'
                ? matchingCount <= constraint.count
                : matchingCount === constraint.count;

        return {
            constraintId: constraint.id,
            kind: constraint.kind,
            label: constraint.label,
            satisfied,
            predicate: constraint.predicate,
            actual: matchingCount,
            required: constraint.count,
        };
    }

    private static evaluateMatchedPairsConstraint(
        constraint: Extract<FormationConstraint, { kind: 'matched-pairs-min' }>,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
    ): FormationConstraintEvaluation {
        if (constraint.onlyWhenAll && !facts.every(unitFacts => evaluateFormationPredicate(constraint.onlyWhenAll!, unitFacts, gameSystem))) {
            return {
                constraintId: constraint.id,
                label: constraint.label,
                satisfied: true,
                actual: 0,
                required: 0,
            };
        }

        const pairCounts = new Map<string, number>();
        for (const unitFacts of facts) {
            if (!evaluateFormationPredicate(constraint.predicate, unitFacts, gameSystem)) {
                continue;
            }

            pairCounts.set(unitFacts.name, (pairCounts.get(unitFacts.name) ?? 0) + 1);
        }

        let matchedPairs = 0;
        for (const count of pairCounts.values()) {
            if (count >= 2) matchedPairs++;
        }

        return {
            constraintId: constraint.id,
            kind: constraint.kind,
            label: constraint.label,
            satisfied: matchedPairs >= constraint.count,
            predicate: constraint.predicate,
            actual: matchedPairs,
            required: constraint.count,
        };
    }

    private static evaluatePercentConstraint(
        constraint: Extract<FormationConstraint, { kind: 'percent-min' }>,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
    ): FormationConstraintEvaluation {
        const matchingCount = facts.filter(unitFacts => evaluateFormationPredicate(constraint.predicate, unitFacts, gameSystem)).length;
        const required = constraint.rounding === 'strict-majority'
            ? Math.floor(facts.length / 2) + 1
            : Math.ceil(facts.length * constraint.ratio);
        const satisfied = constraint.rounding === 'strict-majority'
            ? matchingCount * 2 > facts.length
            : matchingCount >= required;

        return {
            constraintId: constraint.id,
            kind: constraint.kind,
            label: constraint.label,
            satisfied,
            predicate: constraint.predicate,
            actual: matchingCount,
            required,
        };
    }

    private static evaluateSameValueConstraint(
        constraint: Extract<FormationConstraint, { kind: 'same-value' }>,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
    ): FormationConstraintEvaluation {
        const factKey = constraint.factByGameSystem[gameSystem];
        if (!factKey) {
            return {
                constraintId: constraint.id,
                kind: constraint.kind,
                label: constraint.label,
                satisfied: false,
                reason: `No fact mapping for ${gameSystem}.`,
            };
        }

        const firstValue = facts.length > 0 ? getFormationFactValue(factKey, facts[0]) : undefined;
        const allSame = facts.every(unitFacts => getFormationFactValue(factKey, unitFacts) === firstValue);

        return {
            constraintId: constraint.id,
            kind: constraint.kind,
            label: constraint.label,
            satisfied: allSame,
            actual: allSame ? 1 : 0,
            required: 1,
        };
    }
}
