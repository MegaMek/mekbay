// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../../models/common.model';
import { type Faction } from '../../models/factions.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { type FormationTypeDefinition, type FormationMatch, getFormationNameMatchStrings, NO_FORMATION, NO_FORMATION_ID } from './formation-type.model';
import { getFormationDefinition, getFormationDefinitionSource, getFormationDefinitions } from './formation-definitions';
import type { FormationEvaluation } from './formation-requirement.model';
import { FormationSolver } from './formation-solver.util';
import { normalizeLooseText } from '../string.util';
import type { Era } from '../../models/eras.model';
import type { TechBase } from '../../models/tech.model';
import type { FormationUnitLike } from './formation-facts.util';
import { collectGroupUnits, compileGroupFacts } from '../org/org-facts.util';
import { groupMatchesChildRole } from '../org/org-role-match.util';
import { isClan, resolveOrgDefinition } from '../org/org-registry.util';
import type {
    GroupSizeResult,
    OrgFormationMatchingSpec,
    OrgRuleDefinition,
    OrgSizeResult,
} from '../org/org-types';
import { MULFACTION_MERCENARY } from '../../models/mulfactions.model';

/** Organization context, faction eligibility and automatic formation selection. */

interface FormationIdentificationOptions {
    readonly filteredUnits?: readonly FormationUnitLike[];
    readonly requirementsFilterCompositionName?: string;
    readonly requirementsFilterNotice?: string;
}

interface FormationForceLike {
    readonly gameSystem: GameSystem;
    faction(): Faction | null;
    era(): Era | null;
    techBase(): TechBase;
}

type FormationFactionReference = Faction | string | null | undefined;

export interface FormationGroupLike<TUnit extends FormationUnitLike = FormationUnitLike> {
    readonly force: FormationForceLike | null;
    readonly formationHistory: ReadonlySet<string>;
    units(): readonly TUnit[];
    formationUnits?(): readonly TUnit[];
    organizationalResult(): Pick<OrgSizeResult, 'groups'>;
}

export interface FormationRequirementsFilterContext {
    readonly filteredUnits?: readonly FormationUnitLike[];
    readonly requirementsFiltered: boolean;
    readonly requirementsFilterCompositionName?: string;
    readonly requirementsFilterNotice?: string;
}

export interface FormationAnalysis extends FormationMatch {
    readonly evaluation: FormationEvaluation;
    readonly units: readonly FormationUnitLike[];
}

export class FormationAnalyzer {
    private static readonly DEFAULT_FACTION: Faction = {
        id: MULFACTION_MERCENARY,
        name: 'Mercenary',
        group: 'Mercenary',
        img: '',
        eras: {},
    };

    private static groupUnits<TUnit extends FormationUnitLike>(group: FormationGroupLike<TUnit>): readonly TUnit[] {
        return group.formationUnits?.() ?? group.units();
    }

    private static hasFormationMatchingRule(
        rule: OrgRuleDefinition | undefined,
    ): rule is OrgRuleDefinition & { formationMatching: OrgFormationMatchingSpec } {
        return !!rule?.formationMatching;
    }

    private static collectIgnoredUnits(
        group: GroupSizeResult,
        formationMatching: OrgFormationMatchingSpec,
    ): Set<string> {
        const ignoredUnits = new Set<string>(
            (group.formationMatchingIgnoredUnits ?? []).map(unit => unit.uuid),
        );

        if (!formationMatching.ignoredChildRoles || formationMatching.ignoredChildRoles.length === 0) {
            return ignoredUnits;
        }

        for (const child of group.children ?? []) {
            const childFacts = compileGroupFacts(child);
            if (!formationMatching.ignoredChildRoles.some((role) => groupMatchesChildRole(childFacts, role))) {
                continue;
            }

            for (const unit of collectGroupUnits(child)) {
                ignoredUnits.add(unit.uuid);
            }
        }

        return ignoredUnits;
    }

    private static getRequirementsFilterCompositionName(group: GroupSizeResult): string {
        return group.foreignDisplayName ?? group.name;
    }

    private static getRequirementsFilterContext(group: FormationGroupLike): FormationIdentificationOptions {
        const targetForce = group.force;
        if (!targetForce) {
            return {};
        }

        const resolvedGroups = group.organizationalResult().groups;
        if (resolvedGroups.length !== 1) {
            return {};
        }

        const [resolvedGroup] = resolvedGroups;
        const hasChildren = !!resolvedGroup.children && resolvedGroup.children.length > 0;
        const hasExplicitIgnoredUnits = !!resolvedGroup.formationMatchingIgnoredUnits
            && resolvedGroup.formationMatchingIgnoredUnits.length > 0;
        if (!resolvedGroup.type || (!hasChildren && !hasExplicitIgnoredUnits)) {
            return {};
        }

        if ((resolvedGroup.leftoverUnits?.length ?? 0) > 0 || (resolvedGroup.leftoverUnitAllocations?.length ?? 0) > 0) {
            return {};
        }

        const resolvedFaction = targetForce.faction() ?? this.DEFAULT_FACTION;
        const orgDefinition = resolveOrgDefinition(resolvedFaction, targetForce.era());
        const matchedRule = orgDefinition.rules.find((candidate) => candidate.type === resolvedGroup.type);
        if (!this.hasFormationMatchingRule(matchedRule)) {
            return {};
        }

        const ignoredUnits = this.collectIgnoredUnits(resolvedGroup, matchedRule.formationMatching);
        if (ignoredUnits.size === 0) {
            return {};
        }

        const units = this.groupUnits(group);
        const filteredUnits = units.filter((unit) => {
            const entity = unit.getFormationEntity?.();
            return !ignoredUnits.has(entity ? entity.uuid() : unit.getFormationSummary!().uuid);
        });
        if (filteredUnits.length === 0 || filteredUnits.length >= units.length) {
            return {};
        }

        return {
            filteredUnits,
            requirementsFilterCompositionName: this.getRequirementsFilterCompositionName(resolvedGroup),
            requirementsFilterNotice: matchedRule.formationMatching.notice,
        };
    }

    public static getRequirementsFilterContextForGroup(group: FormationGroupLike): FormationRequirementsFilterContext {
        const context = this.getRequirementsFilterContext(group);
        return {
            filteredUnits: context.filteredUnits,
            requirementsFiltered: !!context.filteredUnits,
            requirementsFilterCompositionName: context.requirementsFilterCompositionName,
            requirementsFilterNotice: context.requirementsFilterNotice,
        };
    }

    public static getDefinitionById(id: string, gameSystem: GameSystem): FormationTypeDefinition | null {
        if (id === NO_FORMATION_ID) {
            return NO_FORMATION;
        }

        const definition = getFormationDefinition(id, gameSystem);
        if (!definition) {
            return null;
        }
        if (!FormationSolver.hasBlueprint(definition.id)) {
            return null;
        }
        return definition;
    }

    public static resolveDefinition(value: string, gameSystem: GameSystem): FormationTypeDefinition | null {
        const normalizedValue = value.trim().toLowerCase();
        if (!normalizedValue) {
            return null;
        }

        if (normalizedValue === NO_FORMATION_ID) {
            return NO_FORMATION;
        }

        const definitions = getFormationDefinitions(gameSystem)
            .filter((definition) => FormationSolver.hasBlueprint(definition.id));

        for (const definition of definitions) {
            if (definition.id.toLowerCase() === normalizedValue) {
                return definition;
            }
            if (getFormationNameMatchStrings(definition).some(name => name.toLowerCase() === normalizedValue)) {
                return definition;
            }
        }

        const looseValue = normalizeLooseText(value);
        if (!looseValue) {
            return null;
        }

        for (const definition of definitions) {
            if (normalizeLooseText(definition.id) === looseValue) {
                return definition;
            }
            if (getFormationNameMatchStrings(definition).some(name => normalizeLooseText(name) === looseValue)) {
                return definition;
            }
        }

        return null;
    }

    public static getFormationName(formationId: string | undefined): string | null {
        if (!formationId || formationId === NO_FORMATION_ID) {
            return null;
        }
        return getFormationDefinitionSource(formationId)?.name ?? null;
    }

    public static getFormationPriorityWeight(
        definition: FormationTypeDefinition,
        faction: FormationFactionReference,
    ): number {
        let weight = 1;
        if (definition.exclusiveFaction && this.isFormationAvailableForFaction(definition, faction)) {
            weight *= 5;
        } else if (definition.parent) {
            weight *= 3;
        } else if (definition.id !== 'support-lance' && definition.id !== 'command-lance' && definition.id !== 'battle-lance') {
            weight *= 2;
        }

        return weight;
    }

    private static getFactionName(faction: FormationFactionReference): string {
        return typeof faction === 'string'
            ? faction
            : faction?.name ?? '';
    }

    private static isExclusiveFactionMatch(
        faction: FormationFactionReference,
        exclusiveFactionName: string,
    ): boolean {
        const normalizedExclusiveFactionName = exclusiveFactionName.trim().toLocaleLowerCase();
        if (!normalizedExclusiveFactionName) {
            return false;
        }

        if (normalizedExclusiveFactionName === 'clan' && typeof faction !== 'string' && faction && isClan(faction)) {
            return true;
        }

        return this.getFactionName(faction).toLocaleLowerCase().includes(normalizedExclusiveFactionName);
    }

    public static isFormationAvailableForFaction(
        definition: FormationTypeDefinition,
        faction: FormationFactionReference,
    ): boolean {
        if (!definition.exclusiveFaction?.length) {
            return true;
        }

        return this.getFactionName(faction).trim().length > 0
            && definition.exclusiveFaction.some(exclusiveFactionName => this.isExclusiveFactionMatch(faction, exclusiveFactionName));
    }

    public static getFormationUnavailableReason(
        definition: FormationTypeDefinition,
        techBase: TechBase | undefined,
        faction: FormationFactionReference,
    ): string | undefined {
        if (!this.isFormationAvailableForFaction(definition, faction)) {
            return 'Formation is unavailable to this faction.';
        }
        if (techBase !== undefined && definition.techBase && definition.techBase !== 'Special' && definition.techBase !== techBase) {
            return `Formation requires ${definition.techBase} technology.`;
        }
        return undefined;
    }

    /** One snapshot per roster, shared by diagnostics and automatic selection. */
    private static analyzeDefinitions(
        definitions: readonly FormationTypeDefinition[],
        units: readonly FormationUnitLike[],
        techBase: TechBase,
        faction: FormationFactionReference,
        gameSystem: GameSystem,
        options: FormationIdentificationOptions = {},
    ): FormationAnalysis[] {
        const facts = FormationSolver.compileFacts(units, gameSystem);
        const filteredUnits = options.filteredUnits?.length && options.filteredUnits.length < units.length
            ? options.filteredUnits
            : undefined;
        const filteredFacts = filteredUnits && FormationSolver.compileFacts(filteredUnits, gameSystem);
        return definitions.flatMap<FormationAnalysis>(definition => {
            const bounds = {
                unavailableReason: this.getFormationUnavailableReason(definition, techBase, faction),
            };
            const evaluation = FormationSolver.evaluateFacts(definition, facts, gameSystem, bounds);
            const filtered = filteredFacts && FormationSolver.evaluateFacts(definition, filteredFacts, gameSystem, bounds);
            if (filtered && (filtered.valid || !evaluation?.valid)) {
                return [{
                    definition,
                    units: filteredUnits!,
                    evaluation: filtered,
                    requirementsFiltered: true,
                    requirementsFilterCompositionName: options.requirementsFilterCompositionName,
                    requirementsFilterNotice: options.requirementsFilterNotice,
                }];
            }
            return evaluation ? [{ definition, units, evaluation, requirementsFiltered: false }] : [];
        });
    }

    public static analyzeFormationsForGroup(group: FormationGroupLike): FormationAnalysis[] {
        if (!group.force) return [];
        const force = group.force;
        return this.analyzeDefinitions(
            getFormationDefinitions(force.gameSystem),
            this.groupUnits(group),
            force.techBase(),
            force.faction(),
            force.gameSystem,
            this.getRequirementsFilterContext(group),
        );
    }

    public static analyzeFormationForGroup(
        definition: FormationTypeDefinition,
        group: FormationGroupLike,
    ): FormationAnalysis | null {
        if (!group.force) return null;
        const force = group.force;
        return this.analyzeDefinitions(
            [definition],
            this.groupUnits(group),
            force.techBase(),
            force.faction(),
            force.gameSystem,
            this.getRequirementsFilterContext(group),
        )[0] ?? null;
    }

    public static getBestMatch(
        units: readonly FormationUnitLike[],
        techBase: TechBase,
        faction: FormationFactionReference,
        gameSystem: GameSystem,
        preferredIds?: ReadonlySet<string>,
        options: FormationIdentificationOptions = {},
    ): FormationMatch | null {
        const matches = this.analyzeDefinitions(getFormationDefinitions(gameSystem), units, techBase, faction, gameSystem, options)
            .filter(match => match.evaluation.valid);

        let bestMatches: FormationMatch[] = [];
        let bestWeight = -1;

        for (const match of matches) {
            const weight = this.getFormationPriorityWeight(match.definition, faction);

            if (weight > bestWeight) {
                bestWeight = weight;
                bestMatches = [match];
            } else if (weight === bestWeight) {
                bestMatches.push(match);
            }
        }

        if (bestMatches.length === 0) {
            return null;
        }

        if (preferredIds && preferredIds.size > 0) {
            const preferredMatch = bestMatches.find((match) => preferredIds.has(match.definition.id));
            if (preferredMatch) {
                return preferredMatch;
            }
        }

        return bestMatches[Math.floor(Math.random() * bestMatches.length)];
    }

    public static getBestMatchForGroup(group: FormationGroupLike): FormationMatch | null {
        const targetForce = group.force;
        if (!targetForce) {
            return null;
        }

        const faction = targetForce.faction() ?? 'Mercenary';
        return this.getBestMatch(
            this.groupUnits(group),
            targetForce.techBase(),
            faction,
            targetForce.gameSystem,
            group.formationHistory,
            this.getRequirementsFilterContext(group),
        );
    }
}
