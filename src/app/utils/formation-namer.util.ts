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
import { FormationTypeDefinition, LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import { ForceNamerUtil } from './force-namer.util';
import { ForceType, getForceType } from './force-type.util';

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
    public static getAvailableFormations(
        groupUnits: ForceUnit[],
        allUnits: ForceUnit[],
        faction: Faction | null,
        gameSystem: GameSystem
    ): string[] | null {
        const factionName = faction?.name ?? 'Mercenary';
        const majorityTechBase = ForceNamerUtil.getTechBase(allUnits);
        const identified = this.identifyLanceTypes(groupUnits, majorityTechBase, factionName, gameSystem);
        if (identified.length === 0) return null;

        const isComStarOrWoB = factionName.includes('ComStar') || factionName.includes('Word of Blake');
        const techBase = isComStarOrWoB ? '' : majorityTechBase;
        const forceType = getForceType(groupUnits, techBase, factionName);

        const composedNames: Set<string> = new Set();
        for (const lt of identified) {
            if (isComStarOrWoB) {
                composedNames.add(forceType + ' - ' + lt.name);
            } else {
                composedNames.add(lt.name + ' ' + forceType);
            }
        }
        return Array.from(composedNames);
    }

    /**
     * Returns the list of valid formation definitions for a group of units.
     */
    public static getAvailableFormationDefinitions(
        groupUnits: ForceUnit[],
        allUnits: ForceUnit[],
        faction: Faction | null,
        gameSystem: GameSystem
    ): FormationTypeDefinition[] {
        const factionName = faction?.name ?? 'Mercenary';
        const majorityTechBase = ForceNamerUtil.getTechBase(allUnits);
        return this.identifyLanceTypes(groupUnits, majorityTechBase, factionName, gameSystem);
    }

    /**
     * Composes the display name for a formation definition given the group context.
     */
    public static composeFormationDisplayName(
        definition: FormationTypeDefinition,
        groupUnits: ForceUnit[],
        allUnits: ForceUnit[],
        faction: Faction | null,
    ): string {
        const factionName = faction?.name ?? 'Mercenary';
        const isComStarOrWoB = factionName.includes('ComStar') || factionName.includes('Word of Blake');
        const techBase = isComStarOrWoB ? '' : ForceNamerUtil.getTechBase(allUnits);
        const forceType = getForceType(groupUnits, techBase, factionName);
        if (isComStarOrWoB) {
            return forceType + ' - ' + definition.name;
        }
        return definition.name + ' ' + forceType;
    }

    /**
     * Generate a formation name for a group of units within a force.
     */
    public static generateFormationName({ units, allUnits, faction, gameSystem }: FormationNameOptions): string {
        if (!units || units.length === 0) return 'Unnamed Formation';
        const factionName = faction?.name ?? 'Mercenary';
        let forceType: string;
        if (factionName.includes('ComStar') || factionName.includes('Word of Blake')) {
            forceType = getForceType(units, '', factionName);
            const bestLance = this.getBestLanceType(units, '', factionName, gameSystem);
            if (bestLance) {
                const formationType = bestLance.name as ForceType;
                forceType = forceType + ' - ' + formationType;
            }
        } else {
            const majorityTechBase = ForceNamerUtil.getTechBase(allUnits);
            forceType = getForceType(units, majorityTechBase, factionName);
            const bestLance = this.getBestLanceType(units, majorityTechBase, factionName, gameSystem);
            if (bestLance) {
                const formationType = bestLance.name as ForceType;
                forceType = formationType + ' ' + forceType;
            }
        }
        return `${forceType}`;
    }

    private static identifyLanceTypes(
        units: ForceUnit[], techBase: string, factionName: string, gameSystem: GameSystem
    ): FormationTypeDefinition[] {
        return LanceTypeIdentifierUtil.identifyLanceTypes(units, techBase, factionName, gameSystem);
    }

    private static getBestLanceType(
        units: ForceUnit[], techBase: string, factionName: string, gameSystem: GameSystem
    ): FormationTypeDefinition | null {
        return LanceTypeIdentifierUtil.getBestMatch(units, techBase, factionName, gameSystem);
    }
}
