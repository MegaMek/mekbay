// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ForceUnit } from '../models/force-unit.model';
import type { Faction } from '../models/factions.model';
import type { GameSystem } from '../models/common.model';
import type { FormationTypeDefinition, FormationMatch } from './formation-type.model';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import type { UnitGroup } from '../models/force.model';

/*
 *
 * Formation (group-level) naming utilities.
 */

export interface FormationNameOptions {
    units: ForceUnit[];
    allUnits: ForceUnit[];
    faction: Faction | null;
    gameSystem: GameSystem;
}
export class FormationNamerUtil {

    /**
     * Returns the list of valid formation definitions for a group of units.
     * Each result includes whether organization-level filtering was needed.
     */
    public static getAvailableFormationDefinitions(group: UnitGroup): FormationMatch[] {
        return LanceTypeIdentifierUtil.identifyFormationsForGroup(group);
    }

    // ===== Utility methods =====

    /**
     * Composes the display name for a formation definition given the group context.
     * When `requirementsFiltered` is true, appends a `*` to indicate that
     * organization-level units were ignored while checking requirements.
     */
    public static composeFormationDisplayName(
        definition: FormationTypeDefinition,
        group: UnitGroup,
        requirementsFiltered: boolean = false,
    ): string {
        const organizationalName = group.organizationalName();
        const suffix = requirementsFiltered ? ' *' : '';
        if (organizationalName && definition.name.includes(organizationalName)) {
            return definition.name + suffix;
        }
        if (organizationalName?.includes('Level')) {
            return organizationalName + ' - ' + definition.name + suffix;
        }
        return definition.name + ' ' + organizationalName + suffix;
    }
}
