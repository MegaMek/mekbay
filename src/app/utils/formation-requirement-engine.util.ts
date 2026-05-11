import { GameSystem } from '../models/common.model';
import type { FormationTypeDefinition } from './formation-type.model';
import { getFormationBlueprint } from './formation-blueprints';
import type { FormationConstraint, FormationConstraintEvaluation, FormationDeficit, FormationEvaluation, FormationRequirementBlueprint, FormationSearchDecision } from './formation-requirement.model';
import { evaluateFormationPredicate, getFormationFactValue } from './formation-predicates.util';
import { compileFormationUnitFacts, type FormationUnitFacts, type FormationUnitLike } from './formation-unit-facts.util';

export class FormationRequirementEngine {
    public static hasBlueprint(formationId: string): boolean {
        return getFormationBlueprint(formationId) !== null;
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
        options: { maxUnits?: number } = {},
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
        const violatesHardConstraint = this.hasHardConstraintViolation(nextEvaluation);
        const preservesValidFormation = currentEvaluation?.valid === true && nextEvaluation.valid;
        const fillsAnyDeficit = currentEvaluation?.valid !== true && this.getDeficitScore(nextDeficits) < this.getDeficitScore(currentDeficits);
        const fillsFormationDeficit = currentEvaluation?.valid !== true && this.getDeficitScore(nextFormationDeficits) < this.getDeficitScore(currentFormationDeficits);
        const keepsFormationDeficitsSatisfied = currentFormationDeficits.length === 0 && nextFormationDeficits.length === 0;
        const fillsDeficit = nextEvaluation.valid || fillsFormationDeficit || (fillsAnyDeficit && keepsFormationDeficitsSatisfied);
        const allowed = nextEvaluation.valid || (!violatesHardConstraint && fillsAnyDeficit);

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
        return evaluation.constraints
            .filter(constraint => !constraint.satisfied && constraint.required !== undefined && constraint.actual !== undefined && constraint.required > constraint.actual)
            .map(constraint => ({
                constraintId: constraint.constraintId,
                label: constraint.label,
                needed: Math.max(0, (constraint.required ?? 0) - (constraint.actual ?? 0)),
            }));
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

    private static hasHardConstraintViolation(evaluation: FormationEvaluation): boolean {
        return evaluation.constraints.some(constraint => {
            if (constraint.satisfied) {
                return false;
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
            return constraint.reason?.includes('Allows at most') === true;
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
            label: constraint.label,
            satisfied,
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
                label: constraint.label,
                satisfied: true,
                actual: 0,
                required: 0,
            };
        }

        return this.evaluateCompoundConstraint(
            {
                id: constraint.id,
                kind: 'all-of',
                label: constraint.label,
                constraints: constraint.constraints,
            },
            facts,
            gameSystem,
        );
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
            label: constraint.label,
            satisfied,
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
            label: constraint.label,
            satisfied: matchedPairs >= constraint.count,
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
            label: constraint.label,
            satisfied,
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
                label: constraint.label,
                satisfied: false,
                reason: `No fact mapping for ${gameSystem}.`,
            };
        }

        const firstValue = facts.length > 0 ? getFormationFactValue(factKey, facts[0]) : undefined;
        const allSame = facts.every(unitFacts => getFormationFactValue(factKey, unitFacts) === firstValue);

        return {
            constraintId: constraint.id,
            label: constraint.label,
            satisfied: allSame,
            actual: allSame ? 1 : 0,
            required: 1,
        };
    }
}
