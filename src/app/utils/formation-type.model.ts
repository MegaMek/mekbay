// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem, Rulebook, RulesReference } from '../models/common.model';
import type { ForceUnit } from '../models/force-unit.model';

export interface FormationWideAbility {
    readonly id: string;
    readonly name: string;
    readonly summary: string[];
    readonly rulesRef?: RulesReference[];
}

export type FormationSharedPoolLevel =
    | {
        readonly kind: 'fixed';
        readonly value: number;
    }
    | {
        readonly kind: 'unit-count-plus';
        readonly offset: number;
    };

export interface FormationSharedPool {
    /** Ability level granted by the pool, when the source rules define one. */
    readonly level?: FormationSharedPoolLevel;
    /** Total uses available to the whole formation during one scenario. */
    readonly totalUsesPerScenario?: number;
    /** Maximum uses one unit may receive from the pool during one scenario. */
    readonly maxUsesPerUnitPerScenario?: number;
    /** Whether a unit may combine this pool with its individually purchased ability. */
    readonly stacksWithIndividualAbility?: boolean;
}

/**
 * Shared metadata for formation effect groups.
 */
interface FormationEffectGroupBase {
    /** SPA ids from PILOT_ABILITIES that may be granted by this effect. */
    abilityIds?: string[];
    /** SCA ids from COMMAND_ABILITIES whose effects are applied by this group. */
    commandAbilityIds?: string[];
    /** Whether assignments rotate per turn (`true`) or are fixed at setup (`false`/omitted). */
    perTurn?: boolean;
    /** Number of units or pairs for `fixed` / `fixed-pairs` distributions. */
    count?: number;
    /** Human-readable condition for `conditional` distribution. */
    condition?: string;
    /** Role name for `role-filtered` distribution. */
    roleFilter?: string;
    /** Maximum abilities from this group a single unit can receive (default 1). */
    maxPerUnit?: number;
    /** Whether the formation commander is excluded from this effect group's recipients. */
    excludeCommander?: boolean;
}

/**
 * Describes how assignable SPAs and SCAs are distributed to units in a formation.
 */
export interface FormationAssignmentEffectGroup extends FormationEffectGroupBase {
    /**
     * How abilities are selected from the list:
     * - `choose-one`: One ability is chosen for all recipients (e.g. Recon Lance picks one SPA for everyone).
     * - `choose-each`: Each recipient picks independently from the list (e.g. Command Lance).
     * - `all`: All listed abilities are granted (used when only one ability in list, or all apply).
     */
    selection: 'choose-one' | 'choose-each' | 'all';
    /**
     * How recipients are determined:
     * - `all`:               Every unit in the formation.
     * - `half-round-down`:   Up to half the units (rounded down).
     * - `half-round-up`:     Up to half the units (rounded up).
     * - `percent-75`:        75% of the units (rounded normally).
     * - `up-to-50-percent`:  Up to 50% of the units.
     * - `fixed`:             A fixed number of units (see `count`).
     * - `fixed-pairs`:       A fixed number of identical pairs (see `count`).
     * - `conditional`:       Units matching a specific condition (see `condition`).
     * - `remainder`:         Units not covered by another effect group.
     * - `role-filtered`:     All units matching a specific role (see `roleFilter`).
     * - `commander`:         The designated commander unit only.
     */
    distribution: 'all' | 'half-round-down' | 'half-round-up' | 'percent-75'
        | 'up-to-50-percent' | 'fixed' | 'fixed-pairs' | 'conditional'
        | 'remainder' | 'role-filtered' | 'commander';
}

/** Describes a formation-level resource pool that is not assigned to units. */
export interface FormationSharedPoolEffectGroup extends FormationEffectGroupBase {
    selection: 'all';
    distribution: 'shared-pool';
    sharedPool: FormationSharedPool;
}

/**
 * Describes a formation-wide ability that is not assigned to individual units.
 */
export interface FormationWideEffectGroup extends FormationEffectGroupBase {
    formationWideAbilities: FormationWideAbility[];
    distribution: 'formation-wide';
}

export type FormationEffectGroup = FormationAssignmentEffectGroup | FormationSharedPoolEffectGroup | FormationWideEffectGroup;

export type FormationGameSystemText = string | ((gameSystem: GameSystem) => string);


export interface FormationTypeDefinition {
    id: string;
    parent?: string;
    name: string;
    /** Alternative formation names that should count as a whole-phrase match in custom group names. */
    nameAliases?: string[];
    description: string;
    /** Human-readable formation bonus text, optionally specialized per game system. */
    effectDescription?: FormationGameSystemText;
    /** Whether this formation explicitly inherits parent effect groups and parent requirement display. Defaults to false. */
    inheritParentEffects?: boolean;
    /** Structured SPA distribution rules for this formation's bonus ability. */
    effectGroups?: FormationEffectGroup[];
    validator?: (units: ForceUnit[], gameSystem: GameSystem) => boolean;
    /**
     * Returns a human-readable description of what units/roles/weight classes
     * are needed to qualify for this formation.
     */
    requirements?: (gameSystem: GameSystem) => string;
    idealRole?: string;
    techBase?: 'Inner Sphere' | 'Clan' | 'Special';
    minUnits: number;
    maxUnits?: number;
    exclusiveFaction?: string[];
    /** Multiple rulebook references (e.g. CO p.62, AS:CE p.117). */
    rulesRef?: RulesReference[];
}

/**
 * Well-known ID for the "No Formation" sentinel.
 * When a group's formation is set to this value the user has explicitly
 * opted out of any formation; `assignFormationIfNeeded` will leave it
 * untouched.
 *
 * A `null` formation now means "Automatic": the system will pick the
 * best matching formation automatically.
 */
export const NO_FORMATION_ID = '-';

/**
 * Sentinel `FormationTypeDefinition` representing an explicit
 * "No Formation" choice.  Use {@link isNoFormation} to test for it.
 */
export const NO_FORMATION: FormationTypeDefinition = {
    id: NO_FORMATION_ID,
    name: 'No Formation',
    minUnits: 0,
    description: 'Explicitly opt out of any formation assignment.',
};

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFormationNameMatchText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

export function getFormationNameMatchStrings(definition: FormationTypeDefinition): string[] {
    return [...new Set([
        definition.name,
        ...(definition.nameAliases ?? []),
    ].map(normalizeFormationNameMatchText).filter(Boolean))];
}

export function getFormationDropdownDisplayName(definition: FormationTypeDefinition): string {
    return definition.id.endsWith('-squadron')
        ? `${definition.name} [Aero]`
        : definition.name;
}

export function formationNameMatchesGroupName(definition: FormationTypeDefinition, groupName: string): boolean {
    const normalizedGroupName = normalizeFormationNameMatchText(groupName);
    if (!normalizedGroupName) return false;

    return getFormationNameMatchStrings(definition).some((matchString) => {
        const matcher = new RegExp(
            `(^|[^A-Za-z0-9])${escapeRegExp(matchString)}(?=$|[^A-Za-z0-9])`,
            'i',
        );
        return matcher.test(normalizedGroupName);
    });
}

/** Returns `true` when the given definition is the "No Formation" sentinel. */
export function isNoFormation(def: FormationTypeDefinition | null | undefined): boolean {
    return def?.id === NO_FORMATION_ID;
}

/** Returns `true` when this formation explicitly opts into inheriting parent effects. */
export function formationInheritsParentEffects(def: FormationTypeDefinition | null | undefined): boolean {
    return def?.inheritParentEffects === true;
}

export function resolveFormationGameSystemText(
    text: FormationGameSystemText | null | undefined,
    gameSystem: GameSystem,
): string | null {
    if (!text) return null;
    const resolvedText = typeof text === 'function' ? text(gameSystem) : text;
    return resolvedText || null;
}

/**
 * A formation definition paired with context about how it was matched.
 */
export interface FormationMatch {
    definition: FormationTypeDefinition;
    /**
     * `true` when this formation matched only after ignoring configured child
     * groups from the resolved organization while checking requirements.
     */
    requirementsFiltered: boolean;
    requirementsFilterCompositionName?: string;
    requirementsFilterNotice?: string;
}
