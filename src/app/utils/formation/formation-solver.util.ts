// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GameSystem } from '../../models/common.model';
import type { FormationTypeDefinition } from './formation-type.model';
import { getFormationBlueprint, hasFormationBlueprint } from './formation-definitions';
import type {
    FormationConstraint,
    FormationConstraintEvaluation,
    FormationDeficit,
    FormationEvaluation,
    FormationRequirementBlueprint,
    FormationSearchDecision,
} from './formation-requirement.model';
import { evaluateFormationPredicate, getFormationFactValue } from './formation-predicates.util';
import {
    compileFormationUnitFacts,
    type FormationUnitFacts,
    type FormationUnitLike,
} from './formation-facts.util';

type Definition = Pick<FormationTypeDefinition, 'id' | 'idealRole' | 'minUnits' | 'maxUnits'>;
export interface FormationEvaluationOptions {
    readonly minUnits?: number;
    readonly maxUnits?: number;
    readonly unavailableReason?: string;
}
export interface PreparedFormationSearch {
    readonly current: FormationEvaluation;
    evaluateCandidate(unit: FormationUnitLike): FormationSearchDecision;
    evaluateCandidateFacts(facts: FormationUnitFacts): FormationSearchDecision;
}

export interface FormationCompletion {
    readonly status: 'complete' | 'impossible' | 'limit';
    /** Indices into the supplied candidate pool; repeated indices denote copies. */
    readonly candidateIndexes: readonly number[];
    readonly examinedCandidates: number;
}

/** One operation owns its snapshot. No persistent cache of mutable crews/entities. */
export class FormationSolver {
    public static hasBlueprint(id: string): boolean {
        return hasFormationBlueprint(id);
    }

    public static compileFacts(
        units: readonly FormationUnitLike[],
        gameSystem: GameSystem,
    ): readonly FormationUnitFacts[] {
        return units.map((unit) => compileFormationUnitFacts(unit, gameSystem));
    }

    public static evaluateDefinition(
        definition: Definition,
        units: readonly FormationUnitLike[],
        gameSystem: GameSystem,
        bounds: FormationEvaluationOptions = {},
    ): FormationEvaluation | null {
        return this.evaluateFacts(definition, this.compileFacts(units, gameSystem), gameSystem, bounds);
    }

    public static evaluateFacts(
        definition: Definition,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
        bounds: FormationEvaluationOptions = {},
    ): FormationEvaluation | null {
        const blueprint = getFormationBlueprint(definition.id, gameSystem);
        return blueprint
            ? this.evaluatePrepared(this.requirements(blueprint, definition), definition, facts, gameSystem, bounds)
            : null;
    }

    public static evaluateBlueprint(
        blueprint: FormationRequirementBlueprint,
        definition: Definition,
        units: readonly FormationUnitLike[],
        gameSystem: GameSystem,
        bounds: FormationEvaluationOptions = {},
    ): FormationEvaluation {
        return this.evaluatePrepared(
            this.requirements(blueprint, definition),
            definition,
            this.compileFacts(units, gameSystem),
            gameSystem,
            bounds,
        );
    }

    public static prepareSearch(
        definition: Definition,
        units: readonly FormationUnitLike[],
        gameSystem: GameSystem,
        bounds: FormationEvaluationOptions = {},
    ): PreparedFormationSearch {
        return this.prepareSearchFacts(definition, this.compileFacts(units, gameSystem), gameSystem, bounds);
    }

    private static prepareSearchFacts(
        definition: Definition,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
        bounds: FormationEvaluationOptions,
    ): PreparedFormationSearch {
        const blueprint = getFormationBlueprint(definition.id, gameSystem);
        if (!blueprint) throw new Error(`Unknown formation '${definition.id}'.`);
        const constraints = this.requirements(blueprint, definition);
        const current = this.evaluatePrepared(constraints, definition, facts, gameSystem, bounds);
        const evaluateCandidateFacts = (candidate: FormationUnitFacts): FormationSearchDecision => {
            const next = this.evaluatePrepared(constraints, definition, [...facts, candidate], gameSystem, bounds);
            return {
                allowed: next.status !== 'invalid',
                fillsDeficit: next.valid || this.contributes(current.constraints, next.constraints),
                preservesValidFormation: current.valid && next.valid,
                violatesHardConstraint: next.status === 'invalid',
                remainingDeficits: this.getDeficits(next),
                reasons: next.constraints.filter((c) => !c.satisfied).map((c) => c.reason ?? c.label),
            };
        };
        return {
            current,
            evaluateCandidate: (unit) => evaluateCandidateFacts(compileFormationUnitFacts(unit, gameSystem)),
            evaluateCandidateFacts,
        };
    }

    /** Bounded composition search. Budget, availability and crew planning remain caller policies. */
    public static findCompletion(
        definition: Definition,
        units: readonly FormationUnitLike[],
        candidates: readonly FormationUnitLike[],
        gameSystem: GameSystem,
        options: FormationEvaluationOptions & {
            readonly maxUnits: number;
            readonly maxNodes?: number;
            readonly allowRepeatedCandidates?: boolean;
        },
    ): FormationCompletion {
        const facts = this.compileFacts(units, gameSystem);
        // Compile candidates lazily: a work-limited search must not project the whole catalog first.
        const candidateFacts = new Map<number, FormationUnitFacts>();
        const used = new Set<number>();
        let examinedCandidates = 0,
            limited = false;
        const visit = (currentFacts: readonly FormationUnitFacts[]): number[] | null => {
            const search = this.prepareSearchFacts(definition, currentFacts, gameSystem, options);
            if (search.current.valid) return [];
            if (search.current.status === 'invalid' || currentFacts.length >= options.maxUnits) return null;
            for (let index = 0; index < candidates.length; index++) {
                if (!options.allowRepeatedCandidates && used.has(index)) continue;
                if (examinedCandidates >= (options.maxNodes ?? 256)) {
                    limited = true;
                    return null;
                }
                examinedCandidates++;
                let candidate = candidateFacts.get(index);
                if (!candidate) {
                    candidate = compileFormationUnitFacts(candidates[index], gameSystem);
                    candidateFacts.set(index, candidate);
                }
                if (!search.evaluateCandidateFacts(candidate).allowed) continue;
                used.add(index);
                const suffix = visit([...currentFacts, candidate]);
                used.delete(index);
                if (suffix) return [index, ...suffix];
                if (limited) return null;
            }
            return null;
        };
        const completion = visit(facts);
        return {
            status: completion ? 'complete' : limited ? 'limit' : 'impossible',
            candidateIndexes: completion ?? [],
            examinedCandidates,
        };
    }

    public static evaluateSearchCandidate(
        definition: Definition,
        units: readonly FormationUnitLike[],
        candidate: FormationUnitLike,
        gameSystem: GameSystem,
        bounds: FormationEvaluationOptions = {},
    ): FormationSearchDecision {
        return this.prepareSearch(definition, units, gameSystem, bounds).evaluateCandidate(candidate);
    }

    public static getDeficits(evaluation: FormationEvaluation): readonly FormationDeficit[] {
        return this.collectDeficits(evaluation.constraints);
    }

    private static requirements(
        blueprint: FormationRequirementBlueprint,
        definition: Definition,
    ): readonly FormationConstraint[] {
        return definition.idealRole
            ? [
                  {
                      id: 'qualification',
                      kind: 'any-of',
                      label: 'Ideal role or formation requirements',
                      constraints: [
                          {
                              id: 'ideal-role',
                              kind: 'all-role',
                              role: definition.idealRole,
                              label: `All ${definition.idealRole} units`,
                          },
                          {
                              id: 'composition',
                              kind: 'all-of',
                              label: 'Formation requirements',
                              constraints: blueprint.constraints,
                          },
                      ],
                  },
              ]
            : blueprint.constraints;
    }

    private static evaluatePrepared(
        constraints: readonly FormationConstraint[],
        definition: Definition,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
        bounds: FormationEvaluationOptions,
    ): FormationEvaluation {
        const min = Math.max(definition.minUnits ?? 0, bounds.minUnits ?? 0);
        const max = Math.min(definition.maxUnits ?? Infinity, bounds.maxUnits ?? Infinity);
        const slots = Math.max(0, max - facts.length);
        const evaluations = constraints.map((c) => this.evaluateConstraint(c, facts, gameSystem, slots, min));
        if (bounds.unavailableReason)
            evaluations.unshift({
                constraintId: 'eligibility',
                kind: 'eligibility',
                label: bounds.unavailableReason,
                satisfied: false,
                minimumAdditions: Infinity,
                blocked: true,
            });
        if (facts.length < min)
            evaluations.unshift({
                constraintId: 'unit-count-min',
                kind: 'unit-count-min',
                label: 'Minimum unit count',
                satisfied: false,
                actual: facts.length,
                required: min,
                minimumAdditions: min - facts.length,
                blocked: min > max,
                reason: `Needs at least ${min} units.`,
            });
        if (facts.length > max)
            evaluations.unshift({
                constraintId: 'unit-count-max',
                kind: 'unit-count-max',
                label: 'Maximum unit count',
                satisfied: false,
                actual: facts.length,
                required: max,
                minimumAdditions: Infinity,
                blocked: true,
                reason: `Allows at most ${max} units.`,
            });
        const valid = evaluations.every((c) => c.satisfied);
        return {
            formationId: definition.id,
            valid,
            unitCount: facts.length,
            status: valid ? 'valid' : evaluations.some((c) => c.blocked) ? 'invalid' : 'partial',
            qualifiedByIdealRole:
                facts.length > 0 &&
                evaluations.some((c) => c.constraintId === 'qualification' && c.childEvaluations?.[0].satisfied),
            constraints: evaluations,
            failedConstraintIds: evaluations.filter((c) => !c.satisfied).map((c) => c.constraintId),
            minimumAdditions: Math.max(0, ...evaluations.map((c) => c.minimumAdditions)),
        };
    }

    private static evaluateConstraint(
        constraint: FormationConstraint,
        facts: readonly FormationUnitFacts[],
        gameSystem: GameSystem,
        slots: number,
        minimumSize: number,
    ): FormationConstraintEvaluation {
        const base = { constraintId: constraint.id, kind: constraint.kind, label: constraint.label };
        if ('constraints' in constraint) {
            if (
                constraint.kind === 'conditional' &&
                !facts.some((f) => evaluateFormationPredicate(constraint.when, f, gameSystem))
            ) {
                return { ...base, satisfied: true, minimumAdditions: 0, blocked: false };
            }
            const children = constraint.constraints.map((c) =>
                this.evaluateConstraint(c, facts, gameSystem, slots, minimumSize),
            );
            const any = constraint.kind === 'any-of';
            const satisfied = any ? children.some((c) => c.satisfied) : children.every((c) => c.satisfied);
            return {
                ...base,
                satisfied,
                childEvaluations: children,
                actual: children.filter((c) => c.satisfied).length,
                required: any ? 1 : children.length,
                blocked: any ? children.every((c) => c.blocked) : children.some((c) => c.blocked),
                minimumAdditions: any
                    ? Math.min(...children.map((c) => c.minimumAdditions))
                    : Math.max(0, ...children.map((c) => c.minimumAdditions)),
                reason: satisfied
                    ? undefined
                    : children
                          .filter((c) => !c.satisfied)
                          .map((c) => c.reason ?? c.label)
                          .join(any ? ' OR ' : '; '),
            };
        }
        if (constraint.kind === 'same-value') {
            const key = constraint.factByGameSystem[gameSystem];
            const groups = new Map<string | number | undefined, number[]>();
            facts.forEach((f, index) => {
                const value = key ? getFormationFactValue(key, f) : undefined;
                const group = groups.get(value) ?? [];
                group.push(index);
                groups.set(value, group);
            });
            const satisfied = !!key && groups.size <= 1;
            return {
                ...base,
                satisfied,
                actual: satisfied ? 1 : 0,
                required: 1,
                minimumAdditions: satisfied ? 0 : Infinity,
                blocked: !satisfied,
                // Equality does not privilege the first unit or arbitrarily choose a majority.
                valueGroups: [...groups].map(([value, unitIndexes]) => ({ value, unitIndexes })),
                mismatchingUnitIndexes: satisfied ? [] : facts.map((_, i) => i),
            };
        }
        if (
            constraint.kind === 'matched-pairs-min' &&
            constraint.onlyWhenAll &&
            !facts.every((f) => evaluateFormationPredicate(constraint.onlyWhenAll!, f, gameSystem))
        ) {
            return { ...base, satisfied: true, actual: 0, required: 0, minimumAdditions: 0, blocked: false };
        }
        const matching: number[] = [],
            nonMatching: number[] = [];
        facts.forEach((f, i) => {
            const matches =
                constraint.kind === 'all-role'
                    ? f.role === constraint.role
                    : evaluateFormationPredicate(constraint.predicate, f, gameSystem);
            (matches ? matching : nonMatching).push(i);
        });
        const evidence = {
            ...base,
            matchingUnitIndexes: matching,
            nonMatchingUnitIndexes: nonMatching,
            ...(constraint.kind === 'all-role' ? {} : { predicate: constraint.predicate }),
        };
        let actual = matching.length,
            required = 0,
            minimumAdditions = 0;
        let mismatchingUnitIndexes: readonly number[] = [];
        let valueGroups: FormationConstraintEvaluation['valueGroups'];
        switch (constraint.kind) {
            case 'all':
            case 'all-role':
                required = facts.length;
                minimumAdditions = nonMatching.length ? Infinity : 0;
                mismatchingUnitIndexes = nonMatching;
                break;
            case 'count-min':
            case 'count-max':
            case 'count-exact':
                required = constraint.count;
                if (constraint.kind !== 'count-min' && actual > required) {
                    minimumAdditions = Infinity;
                    mismatchingUnitIndexes = matching;
                } else if (constraint.kind !== 'count-max') minimumAdditions = Math.max(0, required - actual);
                break;
            case 'percent-min': {
                required = this.percentRequired(constraint, facts.length);
                const start = Math.max(0, minimumSize - facts.length);
                if (constraint.ratio >= 1 && constraint.rounding !== 'strict-majority') {
                    minimumAdditions = nonMatching.length > 0 ? Infinity : start;
                } else {
                    const upper =
                        constraint.rounding === 'strict-majority'
                            ? Math.max(start, facts.length - 2 * actual + 1)
                            : Math.max(
                                  start,
                                  Math.ceil((facts.length * constraint.ratio - actual) / (1 - constraint.ratio)),
                              );
                    minimumAdditions = upper;
                    while (
                        minimumAdditions > start &&
                        actual + minimumAdditions - 1 >=
                            this.percentRequired(constraint, facts.length + minimumAdditions - 1)
                    )
                        minimumAdditions--;
                }
                break;
            }
            case 'matched-pairs-min': {
                const groups = new Map<string, number[]>();
                for (const index of matching) {
                    const group = groups.get(facts[index].uuid) ?? [];
                    group.push(index);
                    groups.set(facts[index].uuid, group);
                }
                valueGroups = [...groups].map(([value, unitIndexes]) => ({ value, unitIndexes }));
                // Preserve the current rule: distinct paired models, not unit-instance identity.
                actual = valueGroups.filter((group) => group.unitIndexes.length >= 2).length;
                required = constraint.count;
                const missing = Math.max(0, required - actual);
                minimumAdditions =
                    missing * 2 -
                    Math.min(missing, valueGroups.filter((group) => group.unitIndexes.length === 1).length);
                if (constraint.onlyWhenAll && missing > 0) minimumAdditions = Math.min(minimumAdditions, 1);
                break;
            }
        }
        const satisfied =
            constraint.kind === 'count-max'
                ? actual <= required
                : constraint.kind === 'count-exact'
                  ? actual === required
                  : actual >= required;
        return {
            ...evidence,
            actual,
            required,
            satisfied,
            minimumAdditions,
            blocked: !Number.isFinite(minimumAdditions) || minimumAdditions > slots,
            mismatchingUnitIndexes,
            ...(valueGroups ? { valueGroups } : {}),
        };
    }

    private static percentRequired(
        constraint: Extract<FormationConstraint, { kind: 'percent-min' }>,
        count: number,
    ): number {
        return constraint.rounding === 'normal'
            ? Math.round(count * constraint.ratio)
            : constraint.rounding === 'strict-majority'
              ? Math.floor(count / 2) + 1
              : Math.ceil(count * constraint.ratio);
    }

    private static contributes(
        current: readonly FormationConstraintEvaluation[],
        next: readonly FormationConstraintEvaluation[],
    ): boolean {
        return current.some((c) => {
            const n = next.find((e) => e.constraintId === c.constraintId);
            if (!n || n.blocked || c.kind === 'unit-count-min' || c.kind === 'unit-count-max') return false;
            if (c.childEvaluations && n.childEvaluations)
                return this.contributes(c.childEvaluations, n.childEvaluations);
            if (c.satisfied) return false;
            return n.satisfied || (n.matchingUnitIndexes?.length ?? 0) > (c.matchingUnitIndexes?.length ?? 0);
        });
    }

    private static collectDeficits(constraints: readonly FormationConstraintEvaluation[]): FormationDeficit[] {
        return constraints.flatMap((c) => {
            if (c.satisfied) return [];
            if (c.childEvaluations) {
                const children =
                    c.kind === 'any-of'
                        ? [...c.childEvaluations]
                              .filter((child) => !child.blocked)
                              .sort((a, b) => a.minimumAdditions - b.minimumAdditions)
                              .slice(0, 1)
                        : c.childEvaluations;
                return this.collectDeficits(children);
            }
            const needed = (c.required ?? 0) - (c.actual ?? 0);
            return needed > 0 ? [{ constraintId: c.constraintId, label: c.label, needed, predicate: c.predicate }] : [];
        });
    }
}
