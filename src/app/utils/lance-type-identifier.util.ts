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

import { ForceUnit } from '../models/force-unit.model';
import { GameSystem } from '../models/common.model';
import { FormationTypeDefinition, NO_FORMATION, NO_FORMATION_ID } from './formation-type.model';
import { FORMATION_DEFINITIONS } from './formation-definitions';
import { UnitGroup } from '../models/force.model';



/*
 * Author: Drake
 *
 * Unified formation identifier.
 * Uses a single definition list with per-system validators.
 */

export class LanceTypeIdentifierUtil {

    // ── Validation ───────────────────────────────────────────────────────

    private static validateDefinition(
        definition: FormationTypeDefinition,
        units: ForceUnit[],
        gameSystem: GameSystem
    ): boolean {
        // Validate parent chain first
        if (definition.parent) {
            const parentDefinition = FORMATION_DEFINITIONS.find(d => d.id === definition.parent);
            if (!parentDefinition) {
                console.error(`Parent definition '${definition.parent}' not found for '${definition.id}'`);
                return false;
            }
            if (!this.validateDefinition(parentDefinition, units, gameSystem)) {
                return false;
            }
        }

        try {
            if (definition.minUnits && units.length < definition.minUnits) {
                return false;
            }
            // If all units match the ideal role, skip the full validator
            if (definition.idealRole) {
                const allMatchIdeal = units.every(u => u.getUnit().role === definition.idealRole);
                if (allMatchIdeal) return true;
            }
            if (!definition.validator) return false;
            return definition.validator(units, gameSystem);
        } catch (error) {
            console.error(`Error validating lance type ${definition.id}:`, error);
            return false;
        }
    }

    // ── Public API ───────────────────────────────────────────────────────

    /**
     * Checks whether a formation definition is valid for the given units and game system.
     */
    public static isValid(
        definition: FormationTypeDefinition,
        units: ForceUnit[],
        gameSystem: GameSystem
    ): boolean {
        return this.validateDefinition(definition, units, gameSystem);
    }

    /**
     * Looks up a formation definition by its ID.
     */
    public static getDefinitionById(id: string, gameSystem?: GameSystem): FormationTypeDefinition | null {
        // Handle the "No Formation" sentinel
        if (id === NO_FORMATION_ID) return NO_FORMATION;
        const def = FORMATION_DEFINITIONS.find(d => d.id === id) ?? null;
        if (!def) return null;
        // If a game system is specified, only return if the definition has a validator for it
        if (gameSystem !== undefined) {
            if (!def.validator) return null;
        }
        return def;
    }

    /**
     * Returns the formation name for a given formation id, or null
     * if the id is undefined, empty, or not found.
     */
    public static getFormationName(formationId: string | undefined): string | null {
        if (!formationId || formationId === NO_FORMATION_ID) return null;
        return FORMATION_DEFINITIONS.find(d => d.id === formationId)?.name ?? null;
    }

    /**
     * Identifies all matching formation types for the given force units.
     */
    public static identifyLanceTypes(
        units: ForceUnit[],
        techBase: string,
        factionName: string,
        gameSystem: GameSystem
    ): FormationTypeDefinition[] {
        const matches: FormationTypeDefinition[] = [];

        for (const definition of FORMATION_DEFINITIONS) {
            try {
                // Skip if no validator for this game system
                if (!definition.validator) continue;

                // Skip faction-exclusive definitions if faction doesn't match
                if (definition.exclusiveFaction && !factionName.includes(definition.exclusiveFaction)) {
                    continue;
                }

                // Skip if tech base doesn't match
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

    /**
     * Gets the best matching formation type (most specific, highest weight).
     * Returns null when no formation matches.
     */
    public static getBestMatch(
        units: ForceUnit[],
        techBase: string,
        factionName: string,
        gameSystem: GameSystem,
        preferredIds?: Set<string>
    ): FormationTypeDefinition | null {
        const matches = this.identifyLanceTypes(units, techBase, factionName, gameSystem);
        if (matches.length === 0) return null;

        let bestMatches: FormationTypeDefinition[] = [];
        let bestWeight = -1;

        for (const match of matches) {
            let weight = 1;
            if (match.exclusiveFaction && factionName.includes(match.exclusiveFaction)) {
                weight *= 5;
            } else if (match.parent) {
                weight *= 3;
            } else if (match.id !== 'support-lance' && match.id !== 'command-lance' && match.id !== 'battle-lance') {
                weight *= 2;
            }
            
            if (weight > bestWeight) {
                bestWeight = weight;
                bestMatches = [match];
            } else if (weight === bestWeight) {
                bestMatches.push(match);
            }
        }

        if (bestMatches.length === 0) return null;

        // If we have preferred IDs from history, try to pick one of those first
        if (preferredIds && preferredIds.size > 0) {
            const preferredMatch = bestMatches.find(m => preferredIds.has(m.id));
            if (preferredMatch) {
                return preferredMatch;
            }
        }

        // Otherwise, pick a random one from the best matches
        return bestMatches[Math.floor(Math.random() * bestMatches.length)];
    }

    public static getBestMatchForGroup(group: UnitGroup<ForceUnit>): FormationTypeDefinition | null {
        const targetForce = group.force;
        if (!targetForce) return null;
        const factionName = targetForce.faction()?.name ?? 'Mercenary';
        const techBase = targetForce.techBase();
        const best = LanceTypeIdentifierUtil.getBestMatch(
            group.units(), techBase, factionName, targetForce.gameSystem, group.formationHistory
        );
        return best;
    }
}
