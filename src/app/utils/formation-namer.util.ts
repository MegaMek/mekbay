/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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
import type { Faction } from '../models/factions.model';
import type { GameSystem } from '../models/common.model';
import type { FormationTypeDefinition, FormationMatch } from './formation-type.model';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import type { UnitGroup } from '../models/force.model';

/*
 * Author: Drake
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
     * Each result includes whether it was matched via the Nova rule.
     */
    public static getAvailableFormationDefinitions(group: UnitGroup): FormationMatch[] {
         const targetForce = group.force;
         if (!targetForce) return [];
        const factionName = targetForce.faction()?.name ?? 'Mercenary';
        const isNova = group.organizationalName()?.toLowerCase().includes('nova') ?? false;
        return LanceTypeIdentifierUtil.identifyFormations(group.units(), targetForce.techBase(), factionName, targetForce.gameSystem, isNova);
    }

    // ===== Utility methods =====

    /**
     * Composes the display name for a formation definition given the group context.
     * When `novaFiltered` is true, appends a `*` to indicate the Nova rule was applied.
     */
    public static composeFormationDisplayName(
        definition: FormationTypeDefinition,
        group: UnitGroup,
        novaFiltered: boolean = false,
    ): string {
        const organizationalName = group.organizationalName();
        const suffix = novaFiltered ? ' *' : '';
        if (organizationalName && definition.name.includes(organizationalName)) {
            return definition.name + suffix;
        }
        if (organizationalName?.includes('Level')) {
            return organizationalName + ' - ' + definition.name + suffix;
        }
        return definition.name + ' ' + organizationalName + suffix;
    }
}
