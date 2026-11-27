// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from '../../models/common.model';
import type { FormationUnitLike } from './formation-facts.util';

export type FormationPredicateId =
    | 'anti-air-equipment'
    | 'anvil-armor'
    | 'anvil-weapon'
    | 'artillery-equipment'
    | 'assault-armor'
    | 'assault-damage'
    | 'assault-role-juggernaut'
    | 'assault-role-sniper'
    | 'assault-size'
    | 'aerospace-fighter-bm-ba-unit'
    | 'aerospace-unit'
    | 'aerospace-superiority-role'
    | 'attack-or-dogfighter-role'
    | 'battle-armor-unit'
    | 'battle-role'
    | 'bm-or-mek-unit'
    | 'clan-force'
    | 'command-diverse-role'
    | 'command-heavy-role'
    | 'combat-vehicle'
    | 'direct-fire-damage'
    | 'dogfighter-role'
    | 'ew-equipment'
    | 'fast-assault-move'
    | 'fire-support-or-dogfighter-role'
    | 'fire-support-role'
    | 'fire-role'
    | 'fire-support-equipment'
    | 'heavy-bm-or-mek'
    | 'heavy-recon-move'
    | 'heavy-size'
    | 'hunter-role'
    | 'infantry-unit'
    | 'indirect-fire-equipment'
    | 'interceptor-role'
    | 'jump-or-infantry'
    | 'light-bm-or-mek'
    | 'light-fire-role'
    | 'light-size'
    | 'long-damage-2'
    | 'long-damage-positive'
    | 'long-damage-strong'
    | 'low-medium-damage'
    | 'medium-damage-2'
    | 'medium-damage-positive'
    | 'medium-heavy-size'
    | 'medium-size'
    | 'medium-plus-size'
    | 'phalanx-allowed-unit'
    | 'phalanx-ba-or-cv'
    | 'phalanx-bm-or-ba'
    | 'phalanx-bm-or-mek'
    | 'phalanx-cv'
    | 'probe-move'
    | 'pursuit-move'
    | 'recon-move'
    | 'ranger-size'
    | 'rifle-autocannon'
    | 'rifle-medium-heavy-size'
    | 'rifle-move'
    | 'scout-role'
    | 'scout-or-striker-role'
    | 'security-light-role'
    | 'security-heavy-role'
    | 'short-damage-2'
    | 'slow-urban-move'
    | 'strategic-aero'
    | 'strategic-skill-3'
    | 'striker-or-skirmisher-role'
    | 'striker-speed'
    | 'sweep-move'
    | 'transport-role'
    | 'transport-squadron-unit'
    | 'vtol-unit'
    | 'very-fast-move';

export type FormationFactKey = 'asSize' | 'cbtWeightClass' | 'chassis';

export type FormationConstraint =
    | FormationAllConstraint
    | FormationRoleConstraint
    | FormationCompoundConstraint
    | FormationConditionalConstraint
    | FormationCountConstraint
    | FormationMatchedPairsConstraint
    | FormationPercentConstraint
    | FormationSameValueConstraint;

export interface FormationRequirementBlueprint {
    readonly id: string;
    readonly constraints: readonly FormationConstraint[];
}

/** Authored requirement constraints, separated by game system. */
export interface FormationRequirementBlueprintSource {
    readonly id: string;
    readonly classic: readonly FormationConstraint[];
    readonly alphaStrike: readonly FormationConstraint[];
}

export interface FormationConstraintBase {
    readonly id: string;
    readonly label: string;
}

export interface FormationAllConstraint extends FormationConstraintBase {
    readonly kind: 'all';
    readonly predicate: FormationPredicateId;
}

export interface FormationCompoundConstraint extends FormationConstraintBase {
    readonly kind: 'all-of' | 'any-of';
    readonly constraints: readonly FormationConstraint[];
}

export interface FormationRoleConstraint extends FormationConstraintBase {
    readonly kind: 'all-role';
    readonly role: string;
}

export interface FormationConditionalConstraint extends FormationConstraintBase {
    readonly kind: 'conditional';
    readonly when: FormationPredicateId;
    readonly constraints: readonly FormationConstraint[];
}

export interface FormationCountConstraint extends FormationConstraintBase {
    readonly kind: 'count-min' | 'count-max' | 'count-exact';
    readonly predicate: FormationPredicateId;
    readonly count: number;
}

export interface FormationMatchedPairsConstraint extends FormationConstraintBase {
    readonly kind: 'matched-pairs-min';
    readonly predicate: FormationPredicateId;
    readonly count: number;
    readonly onlyWhenAll?: FormationPredicateId;
}

export interface FormationPercentConstraint extends FormationConstraintBase {
    readonly kind: 'percent-min';
    readonly predicate: FormationPredicateId;
    readonly ratio: number;
    readonly rounding: 'ceil' | 'normal' | 'strict-majority';
}

export interface FormationSameValueConstraint extends FormationConstraintBase {
    readonly kind: 'same-value';
    readonly factByGameSystem: Readonly<Partial<Record<GameSystem, FormationFactKey>>>;
}

export interface FormationConstraintEvaluation {
    readonly constraintId: string;
    readonly kind: FormationConstraint['kind'] | 'unit-count-min' | 'unit-count-max' | 'eligibility';
    readonly label: string;
    readonly satisfied: boolean;
    readonly predicate?: FormationPredicateId;
    readonly actual?: number;
    readonly required?: number;
    readonly reason?: string;
    readonly childEvaluations?: readonly FormationConstraintEvaluation[];
    /** Lower bound; future units may meet overlapping requirements. */
    readonly minimumAdditions: number;
    /** Proven impossible by adding units within the supplied size bounds. */
    readonly blocked: boolean;
    /** Roster indices keep duplicate models distinct for highlighting. */
    readonly matchingUnitIndexes?: readonly number[];
    readonly nonMatchingUnitIndexes?: readonly number[];
    /** Quotas alone do not blame noncontributing units. */
    readonly mismatchingUnitIndexes?: readonly number[];
    readonly valueGroups?: readonly { readonly value: string | number | undefined; readonly unitIndexes: readonly number[] }[];
}

export interface FormationEvaluation {
    readonly formationId: string;
    readonly valid: boolean;
    readonly unitCount: number;
    readonly qualifiedByIdealRole: boolean;
    readonly constraints: readonly FormationConstraintEvaluation[];
    readonly failedConstraintIds: readonly string[];
    /** Partial means not yet valid and not proven impossible by addition. */
    readonly status: 'valid' | 'partial' | 'invalid';
    readonly minimumAdditions: number;
}

export interface FormationDeficit {
    readonly constraintId: string;
    readonly label: string;
    readonly needed: number;
    readonly predicate?: FormationPredicateId;
}

export interface FormationSearchDecision {
    readonly allowed: boolean;
    readonly fillsDeficit: boolean;
    readonly preservesValidFormation: boolean;
    readonly violatesHardConstraint: boolean;
    readonly remainingDeficits: readonly FormationDeficit[];
    readonly reasons: readonly string[];
}

export interface FormationSearchTarget {
    readonly formationId: string;
    readonly existingUnits: readonly FormationUnitLike[];
    readonly gameSystem: GameSystem;
    readonly minUnits?: number;
    readonly maxUnits?: number;
}
