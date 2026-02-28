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

import { min } from '@angular/forms/signals';
import { ForceUnit } from '../models/force-unit.model';

/*
 * Author: Drake
 *
 * Force type identification: shared between force size naming and group size naming.
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
    | 'Un'
    | 'Trey'
    | 'Sept'
    | 'Force'
    | 'Mercenary';

interface ForceComposition {
    BM: number;
    BA_troopers: number;
    CI_troopers: number;
    PM: number;
    CV: number;
    AF: number;
    other: number;
    totalUnits: number;
}

function getForceComposition(units: ForceUnit[]): ForceComposition {
    const comp: ForceComposition = {
        BM: 0,
        BA_troopers: 0,
        CI_troopers: 0,
        PM: 0,
        CV: 0,
        AF: 0,
        other: 0,
        totalUnits: units.length
    };

    for (const fu of units) {
        const u = fu.getUnit();
        if (u.type === 'Mek') comp.BM++;
        else if (u.type === 'Infantry') {
            if (u.subtype === 'Battle Armor') comp.BA_troopers += (u.internal || 0);
            else comp.CI_troopers += (u.internal || 0);
        }
        else if (u.type === 'ProtoMek') comp.PM++;
        else if (u.type === 'Tank' || u.type === 'VTOL' || u.type === 'Naval') comp.CV++;
        else if (u.type === 'Aero') comp.AF++;
        else comp.other++;
    }
    return comp;
}

type ForceTypeRule = {
    type: ForceType;
    minPts: number;
    maxPts: number;
    commandRank?: string;
    strict?: boolean;
    customMatch?: (comp: ForceComposition) => number;
};

/**
 * A point range accounts for variable-size base units (e.g. ComStar Level I
 * of CI infantry = 30-36 troopers). Instead of a single divisor that under-
 * or over-counts, we track the minimum and maximum possible point values.
 *
 * When min === max the range is degenerate (exact), which is the default for
 * unit types with fixed sizes (mechs, vehicles, aero, etc.).
 */
interface PointRange {
    min: number;
    max: number;
}

function getClanPointRange(comp: ForceComposition): PointRange {
    // Clan Points are exact: 5 BA per Point, 25 CI per Point
    const pts = comp.BM + 
           (comp.BA_troopers / 5) + 
           (comp.CI_troopers / 25) + 
           (comp.PM / 5) + 
           (comp.CV / 2) + 
           (comp.AF / 2) + 
           comp.other;
    return { min: pts, max: pts };
}

const CLAN_RULES: ForceTypeRule[] = [
    { type: 'Nova', minPts: 10, maxPts: 10, commandRank: 'Nova Commander', strict: true, customMatch: (comp) => {
        const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
        if (comp.BM === 0 || infPoints === 0) return Infinity;
        const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
        return Math.abs(comp.BM - 5) + Math.abs(infPoints - 5) + otherPoints;
    }},
    { type: 'Supernova Binary', minPts: 20, maxPts: 20, commandRank: 'Nova Captain', strict: true, customMatch: (comp) => {
        const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
        if (comp.BM === 0 || infPoints === 0) return Infinity;
        const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
        return Math.abs(comp.BM - 10) + Math.abs(infPoints - 10) + otherPoints;
    }},
    { type: 'Supernova Trinary', minPts: 30, maxPts: 30, commandRank: 'Nova Captain', strict: true, customMatch: (comp) => {
        const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
        if (comp.BM === 0 || infPoints === 0) return Infinity;
        const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
        return Math.abs(comp.BM - 15) + Math.abs(infPoints - 15) + otherPoints;
    }},
    { type: 'Point', minPts: 1, maxPts: 1, commandRank: 'Point Commander' },
    { type: 'Star', minPts: 5, maxPts: 5, commandRank: 'Star Commander' },
    { type: 'Binary', minPts: 10, maxPts: 10, commandRank: 'Star Captain' },
    { type: 'Trinary', minPts: 15, maxPts: 15, commandRank: 'Star Captain' },
    { type: 'Cluster', minPts: 30, maxPts: 75, commandRank: 'Star Colonel' },
    { type: 'Galaxy', minPts: 90, maxPts: 375, commandRank: 'Galaxy Commander' }
];

function getISPointRange(comp: ForceComposition): PointRange {
    let minPts = comp.BM + 
           (comp.BA_troopers / 4) + 
           comp.PM + 
           comp.CV + 
           comp.AF +
           comp.other;
    let maxPts = minPts;
    minPts += comp.CI_troopers / 21;
    maxPts += comp.CI_troopers / 28;
    return { min: minPts, max: maxPts };
}

function isPureAero(comp: ForceComposition): boolean {
    return comp.AF > 0 && comp.BM === 0 && comp.CV === 0 && comp.BA_troopers === 0 && comp.CI_troopers === 0 && comp.PM === 0 && comp.other === 0;
}

const IS_RULES: ForceTypeRule[] = [
    { type: 'Flight', minPts: 2, maxPts: 2, commandRank: 'Lieutenant', customMatch: (comp) => {
        if (!isPureAero(comp)) return Infinity;
        return Math.abs(comp.AF - 2);
    }},
    { type: 'Squadron', minPts: 6, maxPts: 6, commandRank: 'Captain', customMatch: (comp) => {
        if (!isPureAero(comp)) return Infinity;
        return Math.abs(comp.AF - 6);
    }},
    { type: 'Wing', minPts: 18, maxPts: 24, commandRank: 'Major', customMatch: (comp) => {
        if (!isPureAero(comp)) return Infinity;
        if (comp.AF >= 18 && comp.AF <= 24) return 0;
        if (comp.AF < 18) return 18 - comp.AF;
        return comp.AF - 24;
    }},
    { type: 'Squad', minPts: 1, maxPts: 1, commandRank: 'Sergeant', customMatch: (comp) => {
        if (comp.BM > 0 || comp.CV > 0 || comp.AF > 0 || comp.PM > 0 || comp.other > 0) return Infinity;
        if (comp.BA_troopers > 0 && comp.CI_troopers === 0) return Math.abs(comp.BA_troopers - 4) / 4;
        if (comp.CI_troopers > 0 && comp.BA_troopers === 0) {
            if (comp.CI_troopers >= 2 && comp.CI_troopers <= 8) return 0;
            if (comp.CI_troopers < 2) return (2 - comp.CI_troopers) / 7;
            return (comp.CI_troopers - 8) / 7;
        }
        return Infinity;
    }},
    { type: 'Platoon', minPts: 3, maxPts: 4, commandRank: 'Sergeant', customMatch: (comp) => {
        if (comp.BM > 0 || comp.CV > 0 || comp.AF > 0 || comp.PM > 0 || comp.other > 0) return Infinity;
        if (comp.CI_troopers > 0 && comp.BA_troopers === 0) {
            if (comp.CI_troopers >= 6 && comp.CI_troopers <= 32) return 0;
            if (comp.CI_troopers < 6) return (6 - comp.CI_troopers) / 28;
            return (comp.CI_troopers - 32) / 28;
        }
        return Infinity;
    }},
    { type: 'Lance', minPts: 4, maxPts: 4, commandRank: 'Lieutenant', customMatch: (comp) => isPureAero(comp) ? Infinity : -1 },
    { type: 'Company', minPts: 12, maxPts: 16, commandRank: 'Captain', customMatch: (comp) => isPureAero(comp) ? Infinity : -1 },
    { type: 'Battalion', minPts: 36, maxPts: 64, commandRank: 'Major', customMatch: (comp) => isPureAero(comp) ? Infinity : -1 },
    { type: 'Regiment', minPts: 108, maxPts: 256, commandRank: 'Colonel', customMatch: (comp) => isPureAero(comp) ? Infinity : -1 },
    { type: 'Brigade', minPts: 324, maxPts: 1536, commandRank: 'General', customMatch: (comp) => isPureAero(comp) ? Infinity : -1 }
];

function getComStarPointRange(comp: ForceComposition): PointRange {
    // ComStar/WoB Level I = 1 mech/vehicle/aero/proto, or 30-36 CI, or 6 BA
    const fixed = comp.BM + comp.PM + comp.CV + comp.AF + comp.other;
    let minPts = fixed;
    let maxPts = fixed;

    if (comp.CI_troopers > 0) {
        // Level I of CI infantry = 30-36 troopers
        // Dividing by the max (36) gives the minimum possible Level I count,
        // dividing by the min (30) gives the maximum possible Level I count.
        // This ensures 180 troopers (6x30) through 216 (6x36) all qualify as Level II.
        minPts += comp.CI_troopers / 36;
        maxPts += comp.CI_troopers / 30;
    }
    if (comp.BA_troopers > 0) {
        // Level I of BA = 6 troopers (exact, no range)
        const ba = comp.BA_troopers / 6;
        minPts += ba;
        maxPts += ba;
    }

    return { min: minPts, max: maxPts };
}

const COMSTAR_RULES: ForceTypeRule[] = [
    { type: 'Level I', minPts: 1, maxPts: 1, commandRank: 'Acolyte'},
    { type: 'Level II', minPts: 6, maxPts: 6, commandRank: 'Adept' },
    { type: 'Level III', minPts: 36, maxPts: 36, commandRank: 'Adept (Demi-Precentor)' },
    { type: 'Level IV', minPts: 216, maxPts: 216, commandRank: 'Precentor' },
    { type: 'Level V', minPts: 1296, maxPts: 1296, commandRank: 'Precentor' }
];

function getSocietyPointRange(comp: ForceComposition): PointRange {
    const pts = comp.BM + 
           (comp.BA_troopers / 9) + 
           (comp.CI_troopers / 75) + 
           (comp.PM / 3) + 
           (comp.CV / 7) + 
           (comp.AF / 3) + 
           comp.other;
    return { min: pts, max: pts };
}

const SOCIETY_RULES: ForceTypeRule[] = [
    { type: 'Un', minPts: 1, maxPts: 1 },
    { type: 'Trey', minPts: 3, maxPts: 3 },
    { type: 'Sept', minPts: 7, maxPts: 7 }
];

function evaluateForce(comp: ForceComposition, rules: ForceTypeRule[], getPointRange: (comp: ForceComposition) => PointRange): string {
    const range = getPointRange(comp);
    const midPts = (range.min + range.max) / 2;

    if (range.max === 0) return 'Force';

    let bestType = 'Force';
    let minDistance = Infinity;
    let modifier = '';

    for (const rule of rules) {
        let dist = -1;
        if (rule.customMatch) {
            dist = rule.customMatch(comp);
        }

        if (dist === -1) {
            // Check overlap between point range [range.min, range.max] and rule [rule.minPts, rule.maxPts]
            if (range.max >= rule.minPts && range.min <= rule.maxPts) {
                dist = 0; // Ranges overlap — exact match
            } else if (range.max < rule.minPts) {
                dist = rule.minPts - range.max; // Force is below the rule
            } else {
                dist = range.min - rule.maxPts; // Force is above the rule
            }
        }

        // Strict rules only match on an exact fit (dist === 0)
        if (rule.strict && dist !== 0) continue;

        if (dist !== Infinity && dist < minDistance) {
            minDistance = dist;
            bestType = rule.type;
            if (dist === 0) {
                modifier = '';
            } else {
                // Determine if understrength or reinforced based on midpoint
                if (midPts < rule.minPts) modifier = 'Understrength ';
                else modifier = 'Reinforced ';
            }
        }
    }

    if (minDistance > 0 && minDistance !== Infinity) {
        for (const rule of rules) {
            // Strict rules cannot have Demi- modifier
            if (rule.strict) continue;

            // If the rule has a custom match, we shouldn't blindly apply Demi- based on points
            // For example, a pure Aero force shouldn't become a Demi-Company
            if (rule.customMatch) {
                const dist = rule.customMatch(comp);
                if (dist === Infinity) continue;
            }

            // Check if doubling the point range overlaps with the rule
            const doubleMin = range.min * 2;
            const doubleMax = range.max * 2;
            if (doubleMax >= rule.minPts && doubleMin <= rule.maxPts) {
                return 'Demi-' + rule.type;
            }
        }
    }

    const maxAllowedDistance = Math.max(2, midPts * 0.2);
    if (minDistance <= maxAllowedDistance) {
        return modifier + bestType;
    }

    return 'Force';
}

/**
 * Determine the force organizational type (Lance, Company, Star, etc.)
 * based on the number of units, their composition, average tech base, and faction.
 */
export function getForceSizeName(units: ForceUnit[], techBase: string, factionName: string): string {
    if (units.length === 0) return 'Force';

    const comp = getForceComposition(units);

    if (factionName === 'ComStar' || factionName === 'Word of Blake') {
        return evaluateForce(comp, COMSTAR_RULES, getComStarPointRange);
    } else if (factionName === 'Society') {
        return evaluateForce(comp, SOCIETY_RULES, getSocietyPointRange);
    } else if (factionName.includes('Clan') || techBase === 'Clan') {
        return evaluateForce(comp, CLAN_RULES, getClanPointRange);
    } else {
        return evaluateForce(comp, IS_RULES, getISPointRange);
    }
}
