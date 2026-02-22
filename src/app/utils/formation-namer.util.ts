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

import { ForceUnit } from '../models/force-unit.model';
import { Faction } from '../models/factions.model';
import { GameSystem } from '../models/common.model';
import { FormationTypeDefinition } from './formation-type.model';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import { getForceSizeName } from './force-type.util';
import { Force, UnitGroup } from '../models/force.model';

/*
 * Author: Drake
 *
 * Formation (group-level) naming utilities.
 * Extracted from force-namer.util.ts for separate evolution.
 */

export interface FormationNameOptions {
    units: ForceUnit[];
    allUnits: ForceUnit[];
    faction: Faction | null;
    gameSystem: GameSystem;
}
export class FormationNamerUtil {

    /**
     * Returns the list of available formation names for a group of units.
     */
    public static getAvailableFormations(group: UnitGroup): string[] | null {
        const force = group.force;
        if (!force) return null;
        const factionName = force.faction()?.name ?? 'Mercenary';
        const majorityTechBase = force.techBase();
        const identified = LanceTypeIdentifierUtil.identifyLanceTypes(group.units(), majorityTechBase, factionName, force.gameSystem);
        if (identified.length === 0) return null;

        const isComStarOrWoB = factionName.includes('ComStar') || factionName.includes('Word of Blake');
        const formationSizeName = group.sizeName();

        const composedNames: Set<string> = new Set();
        for (const lt of identified) {
            if (isComStarOrWoB) {
                composedNames.add(formationSizeName + ' - ' + lt.name);
            } else {
                composedNames.add(lt.name + ' ' + formationSizeName);
            }
        }
        return Array.from(composedNames);
    }

    /**
     * Returns the list of valid formation definitions for a group of units.
     */
    public static getAvailableFormationDefinitions(group: UnitGroup): FormationTypeDefinition[] {
         const targetForce = group.force;
         if (!targetForce) return [];
        const factionName = targetForce.faction()?.name ?? 'Mercenary';
        return LanceTypeIdentifierUtil.identifyLanceTypes(group.units(), targetForce.techBase(), factionName, targetForce.gameSystem);
    }

    public static getFormationSizeName(group: UnitGroup): string {
        const force = group.force;
        const factionName = force.faction()?.name ?? 'Mercenary';
        const isComStarOrWoB = factionName.includes('ComStar') || factionName.includes('Word of Blake');
        const techBase = isComStarOrWoB ? '' : force.techBase();
        return getForceSizeName(group.units(), techBase, factionName);
    }

    public static getForceSizeName(force: Force): string {
        const factionName = force.faction()?.name ?? 'Mercenary';
        const isComStarOrWoB = factionName.includes('ComStar') || factionName.includes('Word of Blake');
        const techBase = isComStarOrWoB ? '' : force.techBase();
        return getForceSizeName(force.units(), techBase, factionName);
    }

    /**
     * Composes the display name for a formation definition given the group context.
     */
    public static composeFormationDisplayName(
        definition: FormationTypeDefinition,
        group: UnitGroup,
    ): string {
        const sizeName = group.sizeName();
        if (sizeName && definition.name.includes(sizeName)) {
            return definition.name;
        }
        if (sizeName?.includes('Level')) {
            return sizeName + ' - ' + definition.name;
        }
        return definition.name + ' ' + sizeName;
    }
}
