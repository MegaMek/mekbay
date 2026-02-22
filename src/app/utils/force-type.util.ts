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

function getClanPoints(comp: ForceComposition): number {
    return comp.BM + 
           (comp.BA_troopers / 5) + 
           (comp.CI_troopers / 25) + 
           (comp.PM / 5) + 
           (comp.CV / 2) + 
           (comp.AF / 2) + 
           comp.other;
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

function getISPoints(comp: ForceComposition): number {
    return comp.BM + 
           (comp.BA_troopers / 4) + 
           (comp.CI_troopers / 28) + 
           comp.PM + 
           comp.CV + 
           comp.AF +
           comp.other;
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

function getComStarPoints(comp: ForceComposition): number {
    return comp.BM + 
           (comp.BA_troopers / 6) + 
           (comp.CI_troopers / 36) + 
           comp.PM + 
           comp.CV + 
           comp.AF + 
           comp.other;
}

const COMSTAR_RULES: ForceTypeRule[] = [
    { type: 'Level I', minPts: 1, maxPts: 1, commandRank: 'Acolyte', customMatch: (comp) => {
        if (comp.BM === 0 && comp.CV === 0 && comp.AF === 0 && comp.PM === 0 && comp.other === 0) {
            if (comp.CI_troopers > 0 && comp.BA_troopers === 0) {
                if (comp.CI_troopers >= 30 && comp.CI_troopers <= 36) return 0;
                if (comp.CI_troopers < 30) return (30 - comp.CI_troopers) / 36;
                return (comp.CI_troopers - 36) / 36;
            }
            if (comp.BA_troopers > 0 && comp.CI_troopers === 0) {
                return Math.abs(comp.BA_troopers - 6) / 6;
            }
        }
        return -1;
    }},
    { type: 'Level II', minPts: 6, maxPts: 6, commandRank: 'Adept' },
    { type: 'Level III', minPts: 36, maxPts: 36, commandRank: 'Adept (Demi-Precentor)' },
    { type: 'Level IV', minPts: 216, maxPts: 216, commandRank: 'Precentor' },
    { type: 'Level V', minPts: 1296, maxPts: 1296, commandRank: 'Precentor' }
];

function evaluateForce(comp: ForceComposition, rules: ForceTypeRule[], getPoints: (comp: ForceComposition) => number): string {
    const pts = getPoints(comp);
    
    if (pts === 0) return 'Force';

    let bestType = 'Force';
    let minDistance = Infinity;
    let modifier = '';

    for (const rule of rules) {
        let dist = -1;
        if (rule.customMatch) {
            dist = rule.customMatch(comp);
        }
        
        if (dist === -1) {
            if (pts >= rule.minPts && pts <= rule.maxPts) {
                dist = 0;
            } else if (pts < rule.minPts) {
                dist = rule.minPts - pts;
            } else {
                dist = pts - rule.maxPts;
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
                // For custom matches, we need to determine if it's understrength or reinforced
                // based on the points relative to the rule's min/max points
                if (pts < rule.minPts) modifier = 'Understrength ';
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
            
            if (rule.minPts === pts * 2) {
                return 'Demi-' + rule.type;
            }
        }
    }

    const maxAllowedDistance = Math.max(2, pts * 0.2);
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
        return evaluateForce(comp, COMSTAR_RULES, getComStarPoints);
    } else if (factionName.includes('Clan') || techBase === 'Clan') {
        return evaluateForce(comp, CLAN_RULES, getClanPoints);
    } else {
        return evaluateForce(comp, IS_RULES, getISPoints);
    }
}
