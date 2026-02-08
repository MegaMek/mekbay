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

import { Unit } from '../models/units.model';
import { ForceUnit } from '../models/force-unit.model';
import { Faction, Factions } from '../models/factions.model';
import { Era } from '../models/eras.model';
import { FACTION_EXTINCT } from '../services/unit-search-filters.service';
import { LanceTypeDefinition, LanceTypeIdentifierUtil } from './lance-type-identifier.util';

/*
 * Author: Drake
 */
export type ForceType =
    | 'Squad'
    | 'Platoon'
    | 'Flight'
    | 'Squadron'
    | 'Wing'
    | 'Single'
    | 'Lance'
    | 'Company'
    | 'Battalion'
    | 'Regiment'
    | 'Brigade'
    | 'Point'
    | 'Star'
    | 'Nova'
    | 'Binary'
    | 'Supernova Binary'
    | 'Trinary'
    | 'Supernova Trinary'
    | 'Cluster'
    | 'Galaxy'
    | 'Level I'
    | 'Level II'
    | 'Level III'
    | 'Level IV'
    | 'Level V'
    | 'Force'
    | 'Mercenary';

type ForceTypeRange = { type: ForceType; min: number; max: number };

const INNER_SPHERE_FORCE_TYPES: ForceTypeRange[] = [
    { type: 'Lance', min: 1, max: 4 },
    { type: 'Company', min: 12, max: 16 }, // 3-4 lances
    { type: 'Battalion', min: 36, max: 64 }, // 3-4 companies
    { type: 'Regiment', min: 108, max: 256 }, // 3-4 battalions
    { type: 'Brigade', min: 324, max: 1536 }, // 3-6 regiments
];

const CLAN_FORCE_TYPES: ForceTypeRange[] = [
    { type: 'Point', min: 1, max: 1 },
    { type: 'Star', min: 5, max: 5 },
    { type: 'Binary', min: 10, max: 10 }, // 2 stars
    { type: 'Trinary', min: 15, max: 15 }, // 3 stars
    { type: 'Cluster', min: 20, max: 45 }, // 3-5 binaries/trinaries
    { type: 'Galaxy', min: 60, max: 225 }, // 3-5 clusters
];

const COMSTAR_FORCE_TYPES: ForceTypeRange[] = [
    { type: 'Level I', min: 1, max: 1 },
    { type: 'Level II', min: 6, max: 6 }, // Battle Armor
    { type: 'Level III', min: 6*6, max: 6*6 },
    { type: 'Level IV', min: 6*6*6, max: 6*6*6 },
    { type: 'Level V', min: 6*6*6*6, max: 6*6*6*6 },
];

function identifyLanceTypes(units: ForceUnit[], techBase: string, factionName: string): LanceTypeDefinition[] {
    return LanceTypeIdentifierUtil.identifyLanceTypes(units, techBase, factionName);
}

function getBestLanceType(units: ForceUnit[], techBase: string, factionName: string): LanceTypeDefinition | null {
    return LanceTypeIdentifierUtil.getBestMatch(units, techBase, factionName);
}

function getForceType(units: ForceUnit[], techBase: string, factionName: string): ForceType {
    let configs: ForceTypeRange[] = [];
    if (factionName === 'ComStar' || factionName === 'Word of Blake') {
        configs = COMSTAR_FORCE_TYPES;
    } else if (techBase === 'Clan') {
        configs = CLAN_FORCE_TYPES;
    }
    if ((techBase === 'Inner Sphere') && configs.length === 0) {
        configs = INNER_SPHERE_FORCE_TYPES;
    }
    // Find the first matching force type by unit count
    for (const cfg of configs) {
        if (units.length >= cfg.min && units.length <= cfg.max) {
            return cfg.type;
        }
    }
    return 'Force';
}

interface ForceNameOptions {
    units: ForceUnit[];
    factions: Faction[];
    eras: Era[];
}

interface GroupNameOptions {
    units: ForceUnit[];
    allUnits: ForceUnit[];
    forceName: string;
}

const MIN_UNITS_PERCENTAGE = 0.7;

export class ForceNamerUtil {

    public static getAvailableFormations(groupUnits: ForceUnit[], allUnits: ForceUnit[], factionName: string): string[] | null {
        let majorityTechBase = this.getTechBase(allUnits);
        const identified = identifyLanceTypes(groupUnits, majorityTechBase, factionName);
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

    public static getAvailableFactions(units: ForceUnit[], factions: Faction[], eras: Era[]): Map<string, number> | null {
        if (!units?.length) return null;
        const referenceYear = units.reduce(
            (max, u) => Math.max(max, u.getUnit().year),
            Number.NEGATIVE_INFINITY
        );
        // All eras that include referenceYear or occur after it
        const erasInOrAfter = eras.filter(e => referenceYear <= (e.years.to ?? Number.POSITIVE_INFINITY));

        if (erasInOrAfter.length === 0) return null;
        const unitIds = units.map(u => u.getUnit().id);
        const totalUnits = units.length;

        const results: Map<string, number> = new Map();

        for (const faction of factions) {
            if (faction.id === FACTION_EXTINCT) continue;

            let highestPercentage = 0;
            for (const era of erasInOrAfter) {

                const eraUnitIds = faction.eras[era.id];
                if (!eraUnitIds) continue;

                let count = 0;
                for (const id of unitIds) {
                    if (eraUnitIds.has(id)) count++;
                }

                if (count > 0) {
                    highestPercentage = Math.max(highestPercentage, count / totalUnits);
                }
            }

            if (highestPercentage >= MIN_UNITS_PERCENTAGE) {
                results.set(faction.name, highestPercentage);
            }
        }
        return results;
    }

    private static pickFaction(units: ForceUnit[], factions: Faction[], eras: Era[]): string {
        const availableFactions = this.getAvailableFactions(units, factions, eras);
        if (!availableFactions) return 'Unknown Force';

        const entries = Array.from(availableFactions.entries());
        if (entries.length === 0) return 'Mercenary';

        
        // If only one faction, return it
        if (entries.length === 1) return entries[0][0];

        // Calculate total weight for weighted random selection
        const totalWeight = entries.reduce((sum, [, percentage]) => sum + percentage, 0);

        // Generate a random number between 0 and totalWeight
        const random = Math.random() * totalWeight;

        // Select faction based on weighted probability
        let cumulativeWeight = 0;
        for (const [name, percentage] of entries) {
            cumulativeWeight += percentage;
            if (random <= cumulativeWeight) {
                return name;
            }
        }

        // Fallback to the last faction (shouldn't reach here normally)
        return entries[entries.length - 1][0];
    }

    static getTechBase(units: ForceUnit[]): string {
        const techBaseCounts: Record<string, number> = {};
        for (const unit of units) {
            const techBase = unit.getUnit().techBase;
            if (techBase === 'Mixed') {
                // Count Mixed units for both Clan and Inner Sphere
                techBaseCounts['Clan'] = (techBaseCounts['Clan'] || 0) + 1;
                techBaseCounts['Inner Sphere'] = (techBaseCounts['Inner Sphere'] || 0) + 1;
            } else {
                techBaseCounts[techBase] = (techBaseCounts[techBase] || 0) + 1;
            }
        }
        // Find the majority tech base
        let majorityTechBase = 'Inner Sphere';
        let maxTechBaseCount = 0;
        for (const [tb, count] of Object.entries(techBaseCounts)) {
            if (count > maxTechBaseCount) {
                majorityTechBase = tb;
                maxTechBaseCount = count;
            }
        }
        return majorityTechBase;
    }

    static generateForceName({ units, factions, eras }: ForceNameOptions): string {
        if (!units || units.length === 0) return 'Unnamed Force';
        const factionName = this.pickFaction(units, factions, eras);
        let forceType: string;
        if (factionName === 'ComStar' || factionName === 'Word of Blake') {
            forceType = getForceType(units, '', factionName);
        } else {
            // Find the majority tech base
            const majorityTechBase = this.getTechBase(units);
            forceType = getForceType(units, majorityTechBase, factionName);
        }
        return `${factionName} ${forceType}`;
    }

    static generateForceNameForFaction(units: ForceUnit[], factionName: string): string {
        if (!units || units.length === 0) return 'Unnamed Force';
        let forceType: string;
        if (factionName === 'ComStar' || factionName === 'Word of Blake') {
            forceType = getForceType(units, '', factionName);
        } else {
            const majorityTechBase = this.getTechBase(units);
            forceType = getForceType(units, majorityTechBase, factionName);
        }
        return `${factionName} ${forceType}`;
    }

    static generateFormationName({ units, allUnits, forceName }: GroupNameOptions): string {
        if (!units || units.length === 0) return 'Unnamed Formation';
        let forceType: string;
        if (forceName.includes('ComStar') || forceName.includes('Word of Blake')) {
            forceType = getForceType(units, '', forceName);
            const bestLance = getBestLanceType(units, '', forceName);
            if (bestLance) {
                const formationType = bestLance.name as ForceType;
                forceType = forceType + ' - ' + formationType;
            }
        } else {
            // Find the majority tech base
            const majorityTechBase = this.getTechBase(allUnits);
            forceType = getForceType(units, majorityTechBase, forceName);
            const bestLance = getBestLanceType(units, majorityTechBase, forceName);
            if (bestLance) {
                const formationType = bestLance.name as ForceType;
                forceType = formationType + ' ' + forceType;
            }
        }
        return `${forceType}`;
    }

}