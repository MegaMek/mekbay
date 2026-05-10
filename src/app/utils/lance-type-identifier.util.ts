/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import type { ForceUnit } from '../models/force-unit.model';
import { GameSystem } from '../models/common.model';
import { type Faction } from '../models/factions.model';
import type { Unit } from '../models/units.model';
import { type FormationTypeDefinition, type FormationMatch, getFormationNameMatchStrings, NO_FORMATION, NO_FORMATION_ID } from './formation-type.model';
import { getFormationDefinition, getFormationDefinitions } from './formation-blueprints';
import { FormationRequirementEngine } from './formation-requirement-engine.util';
import { normalizeLooseText } from './string.util';
import type { UnitGroup } from '../models/force.model';
import { collectGroupUnits, compileGroupFacts } from './org/org-facts.util';
import { groupMatchesChildRole } from './org/org-role-match.util';
import { resolveOrgDefinition } from './org/org-registry.util';
import type {
    GroupSizeResult,
    OrgFormationMatchingSpec,
    OrgRuleDefinition,
} from './org/org-types';
import { MULFACTION_MERCENARY } from '../models/mulfactions.model';

/*
 * Author: Drake
 *
 * Unified formation identifier.
 * Uses migrated requirement blueprints for per-system validation.
 */

interface FormationIdentificationOptions {
    readonly filteredUnits?: ForceUnit[];
    readonly requirementsFilterCompositionName?: string;
    readonly requirementsFilterNotice?: string;
}

export interface FormationRequirementsFilterContext {
    readonly filteredUnits?: ForceUnit[];
    readonly requirementsFiltered: boolean;
    readonly requirementsFilterCompositionName?: string;
    readonly requirementsFilterNotice?: string;
}

export class LanceTypeIdentifierUtil {
    private static readonly DEFAULT_FACTION: Faction = {
        id: MULFACTION_MERCENARY,
        name: 'Mercenary',
        group: 'Mercenary',
        img: '',
        eras: {},
    };

    private static validateDefinition(
        definition: FormationTypeDefinition,
        units: ForceUnit[],
        gameSystem: GameSystem,
    ): boolean {
        try {
            const engineEvaluation = FormationRequirementEngine.evaluateDefinition(definition, units, gameSystem);
            if (engineEvaluation) {
                return engineEvaluation.valid;
            }
            console.error(`Formation requirement blueprint '${definition.id}' not found`);
            return false;
        } catch (error) {
            console.error(`Error validating lance type ${definition.id}:`, error);
            return false;
        }
    }

    private static hasFormationMatchingRule(
        rule: OrgRuleDefinition | undefined,
    ): rule is OrgRuleDefinition & { formationMatching: OrgFormationMatchingSpec } {
        return !!rule?.formationMatching;
    }

    private static collectIgnoredUnits(
        group: GroupSizeResult,
        formationMatching: OrgFormationMatchingSpec,
    ): Set<Unit> {
        const ignoredUnits = new Set<Unit>(group.formationMatchingIgnoredUnits ?? []);

        if (!formationMatching.ignoredChildRoles || formationMatching.ignoredChildRoles.length === 0) {
            return ignoredUnits;
        }

        for (const child of group.children ?? []) {
            const childFacts = compileGroupFacts(child);
            if (!formationMatching.ignoredChildRoles.some((role) => groupMatchesChildRole(childFacts, role))) {
                continue;
            }

            for (const unit of collectGroupUnits(child)) {
                ignoredUnits.add(unit);
            }
        }

        return ignoredUnits;
    }

    private static getRequirementsFilterCompositionName(group: GroupSizeResult): string {
        return group.foreignDisplayName ?? group.name;
    }

    private static getRequirementsFilterContext(group: UnitGroup<ForceUnit>): FormationIdentificationOptions {
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

        const filteredUnits = group.units().filter((unit) => !ignoredUnits.has(unit.getUnit()));
        if (filteredUnits.length === 0 || filteredUnits.length >= group.units().length) {
            return {};
        }

        return {
            filteredUnits,
            requirementsFilterCompositionName: this.getRequirementsFilterCompositionName(resolvedGroup),
            requirementsFilterNotice: matchedRule.formationMatching.notice,
        };
    }

    public static getRequirementsFilterContextForGroup(group: UnitGroup<ForceUnit>): FormationRequirementsFilterContext {
        const context = this.getRequirementsFilterContext(group);
        return {
            filteredUnits: context.filteredUnits,
            requirementsFiltered: !!context.filteredUnits,
            requirementsFilterCompositionName: context.requirementsFilterCompositionName,
            requirementsFilterNotice: context.requirementsFilterNotice,
        };
    }

    public static isValid(
        definition: FormationTypeDefinition,
        units: ForceUnit[],
        gameSystem: GameSystem,
    ): boolean {
        return this.validateDefinition(definition, units, gameSystem);
    }

    public static getDefinitionById(id: string, gameSystem?: GameSystem): FormationTypeDefinition | null {
        if (id === NO_FORMATION_ID) {
            return NO_FORMATION;
        }

        const definition = getFormationDefinition(id);
        if (!definition) {
            return null;
        }
        if (gameSystem !== undefined && !FormationRequirementEngine.hasBlueprint(definition.id)) {
            return null;
        }
        return definition;
    }

    public static resolveDefinition(value: string, gameSystem?: GameSystem): FormationTypeDefinition | null {
        const normalizedValue = value.trim().toLowerCase();
        if (!normalizedValue) {
            return null;
        }

        if (normalizedValue === NO_FORMATION_ID) {
            return NO_FORMATION;
        }

        const definitions = getFormationDefinitions().filter((definition) => (
            gameSystem === undefined || FormationRequirementEngine.hasBlueprint(definition.id)
        ));

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
        return getFormationDefinition(formationId)?.name ?? null;
    }

    public static getFormationPriorityWeight(
        definition: FormationTypeDefinition,
        factionName: string,
    ): number {
        let weight = 1;
        if (definition.exclusiveFaction && this.isFormationAvailableForFaction(definition, factionName)) {
            weight *= 5;
        } else if (definition.parent) {
            weight *= 3;
        } else if (definition.id !== 'support-lance' && definition.id !== 'command-lance' && definition.id !== 'battle-lance') {
            weight *= 2;
        }

        return weight;
    }

    public static isFormationAvailableForFaction(
        definition: FormationTypeDefinition,
        factionName: string | null | undefined,
    ): boolean {
        if (!definition.exclusiveFaction?.length) {
            return true;
        }

        const normalizedFactionName = factionName?.trim() ?? '';
        return normalizedFactionName.length > 0
            && definition.exclusiveFaction.some(faction => normalizedFactionName.includes(faction));
    }

    public static identifyLanceTypes(
        units: ForceUnit[],
        techBase: string,
        factionName: string,
        gameSystem: GameSystem,
    ): FormationTypeDefinition[] {
        const matches: FormationTypeDefinition[] = [];

        for (const definition of getFormationDefinitions()) {
            try {
                if (!FormationRequirementEngine.hasBlueprint(definition.id)) {
                    continue;
                }

                if (!this.isFormationAvailableForFaction(definition, factionName)) {
                    continue;
                }

                if (techBase && definition.techBase
                    && definition.techBase !== 'Special'
                    && techBase !== 'Mixed'
                    && definition.techBase !== techBase) {
                    continue;
                }

                if (this.validateDefinition(definition, units, gameSystem)) {
                    matches.push(definition);
                }
            } catch (error) {
                console.error(`Error validating lance type ${definition.id}:`, error);
            }
        }

        return matches;
    }

    public static identifyFormations(
        units: ForceUnit[],
        techBase: string,
        factionName: string,
        gameSystem: GameSystem,
        options: FormationIdentificationOptions = {},
    ): FormationMatch[] {
        const standardMatches = this.identifyLanceTypes(units, techBase, factionName, gameSystem);
        const results: FormationMatch[] = standardMatches.map((definition) => ({
            definition,
            requirementsFiltered: false,
        }));
        const resultById = new Map(results.map((match) => [match.definition.id, match]));

        const filteredUnits = options.filteredUnits;
        if (filteredUnits && filteredUnits.length > 0 && filteredUnits.length < units.length) {
            const filteredMatches = this.identifyLanceTypes(filteredUnits, techBase, factionName, gameSystem);
            for (const definition of filteredMatches) {
                const existingMatch = resultById.get(definition.id);
                if (existingMatch) {
                    existingMatch.requirementsFiltered = true;
                    existingMatch.requirementsFilterCompositionName = options.requirementsFilterCompositionName;
                    existingMatch.requirementsFilterNotice = options.requirementsFilterNotice;
                    continue;
                }

                const filteredMatch: FormationMatch = {
                    definition,
                    requirementsFiltered: true,
                    requirementsFilterCompositionName: options.requirementsFilterCompositionName,
                    requirementsFilterNotice: options.requirementsFilterNotice,
                };
                results.push(filteredMatch);
                resultById.set(definition.id, filteredMatch);
            }
        }

        return results;
    }

    public static identifyFormationsForGroup(group: UnitGroup<ForceUnit>): FormationMatch[] {
        const targetForce = group.force;
        if (!targetForce) {
            return [];
        }

        const factionName = targetForce.faction()?.name ?? 'Mercenary';
        return this.identifyFormations(
            group.units(),
            targetForce.techBase(),
            factionName,
            targetForce.gameSystem,
            this.getRequirementsFilterContext(group),
        );
    }

    public static isFormationValidForGroup(
        definition: FormationTypeDefinition,
        group: UnitGroup<ForceUnit>,
    ): FormationMatch | null {
        const targetForce = group.force;
        if (!targetForce) {
            return null;
        }

        const units = group.units();
        const gameSystem = targetForce.gameSystem;

        const filterContext = this.getRequirementsFilterContext(group);
        if (filterContext.filteredUnits && this.isValid(definition, filterContext.filteredUnits, gameSystem)) {
            return {
                definition,
                requirementsFiltered: true,
                requirementsFilterCompositionName: filterContext.requirementsFilterCompositionName,
                requirementsFilterNotice: filterContext.requirementsFilterNotice,
            };
        }

        if (this.isValid(definition, units, gameSystem)) {
            return {
                definition,
                requirementsFiltered: false,
            };
        }

        return null;
    }

    public static getBestMatch(
        units: ForceUnit[],
        techBase: string,
        factionName: string,
        gameSystem: GameSystem,
        preferredIds?: Set<string>,
        options: FormationIdentificationOptions = {},
    ): FormationMatch | null {
        const matches = this.identifyFormations(units, techBase, factionName, gameSystem, options);
        if (matches.length === 0) {
            return null;
        }

        let bestMatches: FormationMatch[] = [];
        let bestWeight = -1;

        for (const match of matches) {
            const weight = this.getFormationPriorityWeight(match.definition, factionName);

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

    public static getBestMatchForGroup(group: UnitGroup<ForceUnit>): FormationMatch | null {
        const targetForce = group.force;
        if (!targetForce) {
            return null;
        }

        const factionName = targetForce.faction()?.name ?? 'Mercenary';
        return this.getBestMatch(
            group.units(),
            targetForce.techBase(),
            factionName,
            targetForce.gameSystem,
            group.formationHistory,
            this.getRequirementsFilterContext(group),
        );
    }
}
