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

/**
 * Named modifier for a force size level. Each modifier has a display name
 * ('' for regular/default) and a nominal point value.
 */
type ForceModifier = {
    name: string;   // '' for regular, 'Short', 'Under-Strength', 'Reinforced', etc.
    pts: number;    // nominal point value for this modifier level
};

type ForceTypeRule = {
    type: ForceType;
    modifiers: ForceModifier[];  // sorted ascending by pts
    commandRank?: string;
    strict?: boolean;
    filter?: (comp: ForceComposition) => boolean;
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
    { type: 'Nova', modifiers: [{ name: '', pts: 10 }], commandRank: 'Nova Commander', strict: true,
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 5) + Math.abs(infPoints - 5) + otherPoints;
    }},
    { type: 'Supernova Binary', modifiers: [{ name: '', pts: 20 }], commandRank: 'Nova Captain', strict: true,
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 10) + Math.abs(infPoints - 10) + otherPoints;
    }},
    { type: 'Supernova Trinary', modifiers: [{ name: '', pts: 30 }], commandRank: 'Nova Captain', strict: true,
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 15) + Math.abs(infPoints - 15) + otherPoints;
    }},
    { type: 'Point', modifiers: [{ name: '', pts: 1 }], commandRank: 'Point Commander' },
    { type: 'Star', modifiers: [
        { name: 'Half', pts: 2 },
        { name: 'Short', pts: 3 },
        { name: 'Under-Strength', pts: 4 },
        { name: '', pts: 5 },
        { name: 'Reinforced', pts: 6 },
        { name: 'Fortified', pts: 7 },
    ], commandRank: 'Star Commander' },
    { type: 'Binary', modifiers: [{ name: '', pts: 10 }], commandRank: 'Star Captain' },
    { type: 'Trinary', modifiers: [{ name: '', pts: 15 }], commandRank: 'Star Captain' },
    { type: 'Cluster', modifiers: [
        { name: 'Under-Strength', pts: 30 },
        { name: '', pts: 45 },
        { name: 'Reinforced', pts: 60 },
        { name: 'Strong', pts: 75 },
    ], commandRank: 'Star Colonel' },
    { type: 'Galaxy', modifiers: [
        { name: 'Under-Strength', pts: 90 },
        { name: '', pts: 135 },
        { name: 'Reinforced', pts: 180 },
        { name: 'Strong', pts: 225 },
    ], commandRank: 'Galaxy Commander' },
];

function getISPointRange(comp: ForceComposition): PointRange {
    const fixed = comp.BM +
           (comp.BA_troopers / 4) +
           comp.PM +
           comp.CV +
           comp.AF +
           comp.other;
    // IS infantry platoon = 21-28 troopers per point
    // Dividing by 28 = minimum pts; dividing by 21 = maximum pts
    return {
        min: fixed + comp.CI_troopers / 28,
        max: fixed + comp.CI_troopers / 21,
    };
}

function isPureAero(comp: ForceComposition): boolean {
    return comp.AF > 0 && comp.BM === 0 && comp.CV === 0 && comp.BA_troopers === 0 && comp.CI_troopers === 0 && comp.PM === 0 && comp.other === 0;
}

function isPureInfantry(comp: ForceComposition): boolean {
    return comp.BM === 0 && comp.CV === 0 && comp.AF === 0 && comp.PM === 0 && comp.other === 0 &&
           (comp.BA_troopers > 0 || comp.CI_troopers > 0);
}

const IS_RULES: ForceTypeRule[] = [
    { type: 'Flight', modifiers: [{ name: '', pts: 2 }], commandRank: 'Lieutenant',
        filter: (comp) => isPureAero(comp) },
    { type: 'Squadron', modifiers: [{ name: '', pts: 6 }], commandRank: 'Captain',
        filter: (comp) => isPureAero(comp) },
    { type: 'Wing', modifiers: [
        { name: 'Under-Strength', pts: 18 },
        { name: '', pts: 21 },
        { name: 'Reinforced', pts: 24 },
    ], commandRank: 'Major',
        filter: (comp) => isPureAero(comp) },
    { type: 'Squad', modifiers: [{ name: '', pts: 1 }], commandRank: 'Sergeant',
        filter: (comp) => isPureInfantry(comp),
        customMatch: (comp) => {
            if (comp.BA_troopers > 0 && comp.CI_troopers === 0) return Math.abs(comp.BA_troopers - 4) / 4;
            if (comp.CI_troopers > 0 && comp.BA_troopers === 0) {
                if (comp.CI_troopers >= 2 && comp.CI_troopers <= 8) return 0;
                if (comp.CI_troopers < 2) return (2 - comp.CI_troopers) / 7;
                return (comp.CI_troopers - 8) / 7;
            }
            return Infinity;
    }},
    { type: 'Platoon', modifiers: [{ name: '', pts: 1 }], commandRank: 'Sergeant',
        filter: (comp) => isPureInfantry(comp) && comp.CI_troopers > 0 && comp.BA_troopers === 0,
        customMatch: (comp) => {
            if (comp.CI_troopers >= 6 && comp.CI_troopers <= 32) return 0;
            if (comp.CI_troopers < 6) return (6 - comp.CI_troopers) / 28;
            return (comp.CI_troopers - 32) / 28;
    }},
    { type: 'Lance', modifiers: [
        { name: 'Short', pts: 2 },
        { name: 'Under-Strength', pts: 3 },
        { name: '', pts: 4 },
        { name: 'Reinforced', pts: 5 },
        { name: 'Fortified', pts: 6 },
    ], commandRank: 'Lieutenant', filter: (comp) => !isPureAero(comp) },
    { type: 'Company', modifiers: [
        { name: 'Under-Strength', pts: 8 },
        { name: '', pts: 12 },
        { name: 'Reinforced', pts: 16 },
    ], commandRank: 'Captain', filter: (comp) => !isPureAero(comp) },
    { type: 'Battalion', modifiers: [
        { name: 'Under-Strength', pts: 24 },
        { name: '', pts: 36 },
        { name: 'Reinforced', pts: 48 },
    ], commandRank: 'Major', filter: (comp) => !isPureAero(comp) },
    { type: 'Regiment', modifiers: [
        { name: 'Under-Strength', pts: 72 },
        { name: '', pts: 108 },
        { name: 'Reinforced', pts: 144 },
        { name: 'Strong', pts: 180 },
    ], commandRank: 'Colonel', filter: (comp) => !isPureAero(comp) },
    { type: 'Brigade', modifiers: [
        { name: 'Under-Strength', pts: 216 },
        { name: '', pts: 324 },
        { name: 'Reinforced', pts: 432 },
    ], commandRank: 'General', filter: (comp) => !isPureAero(comp) },
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
    { type: 'Level I', modifiers: [{ name: '', pts: 1 }], commandRank: 'Acolyte' },
    { type: 'Level II', modifiers: [
        { name: 'Thin', pts: 2 },
        { name: 'Half', pts: 3 },
        { name: 'Short', pts: 4 },
        { name: 'Under-Strength', pts: 5 },
        { name: '', pts: 6 },
        { name: 'Reinforced', pts: 7 },
        { name: 'Fortified', pts: 8 },
        { name: 'Heavy', pts: 9 },
    ], commandRank: 'Adept' },
    { type: 'Level III', modifiers: [
        { name: 'Under-Strength', pts: 30 },
        { name: '', pts: 36 },
        { name: 'Reinforced', pts: 42 },
    ], commandRank: 'Adept (Demi-Precentor)' },
    { type: 'Level IV', modifiers: [
        { name: 'Under-Strength', pts: 180 },
        { name: '', pts: 216 },
        { name: 'Reinforced', pts: 252 },
    ], commandRank: 'Precentor' },
    { type: 'Level V', modifiers: [
        { name: 'Under-Strength', pts: 1080 },
        { name: '', pts: 1296 },
        { name: 'Reinforced', pts: 1512 },
    ], commandRank: 'Precentor' },
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
    { type: 'Un', modifiers: [{ name: '', pts: 1 }] },
    { type: 'Trey', modifiers: [{ name: '', pts: 3 }] },
    { type: 'Sept', modifiers: [{ name: '', pts: 7 }] },
];

/**
 * Distance from a point range to a single point.
 * Returns 0 if the point is within the range.
 */
function rangeDistToPoint(range: PointRange, point: number): number {
    if (point >= range.min && point <= range.max) return 0;
    if (point < range.min) return range.min - point;
    return point - range.max;
}

/**
 * Find the best modifier name for a given point range against a rule's modifiers.
 * Picks the modifier whose nominal pts is closest to (or within) the range.
 * For single-modifier rules with name='', generates 'Under-Strength' or
 * 'Reinforced' if the force range doesn't cover the nominal value.
 */
function getModifierName(range: PointRange, modifiers: ForceModifier[]): string {
    let closest = modifiers[0];
    let closestDist = rangeDistToPoint(range, modifiers[0].pts);
    for (let i = 1; i < modifiers.length; i++) {
        const d = rangeDistToPoint(range, modifiers[i].pts);
        if (d < closestDist) {
            closestDist = d;
            closest = modifiers[i];
        }
    }

    // If the closest modifier is the regular one ('') and the range doesn't
    // cover it, fall back to generic Under-Strength / Reinforced
    if (closestDist > 0 && closest.name === '') {
        const mid = (range.min + range.max) / 2;
        if (mid < closest.pts) return 'Under-Strength';
        return 'Reinforced';
    }

    return closest.name;
}

function evaluateForce(
    comp: ForceComposition,
    rules: ForceTypeRule[],
    getPointRange: (comp: ForceComposition) => PointRange
): string {
    const range = getPointRange(comp);
    const midPts = (range.min + range.max) / 2;

    if (range.max === 0) return 'Force';

    let bestType = 'Force';
    let bestDist = Infinity;
    let bestModName = '';

    for (const rule of rules) {
        // Composition filter — skip rules that don't apply to this force type
        if (rule.filter && !rule.filter(comp)) continue;

        let dist = -1;
        if (rule.customMatch) {
            const customDist = rule.customMatch(comp);
            if (customDist === Infinity) continue;
            if (customDist >= 0) {
                if (rule.strict && customDist !== 0) continue;
                if (customDist < bestDist) {
                    bestDist = customDist;
                    bestType = rule.type;
                    // Perfect custom match = regular; otherwise derive from modifier table
                    bestModName = customDist === 0
                        ? ''
                        : getModifierName(range, rule.modifiers);
                }
                continue;
            }
            // customDist === -1: fall through to range-based evaluation
        }

        // Rule range from first to last modifier nominal pts
        const ruleMin = rule.modifiers[0].pts;
        const ruleMax = rule.modifiers[rule.modifiers.length - 1].pts;

        // Check overlap between force point range and rule modifier range
        if (range.max >= ruleMin && range.min <= ruleMax) {
            dist = 0;
        } else if (range.max < ruleMin) {
            dist = ruleMin - range.max;
        } else {
            dist = range.min - ruleMax;
        }

        if (rule.strict && dist !== 0) continue;

        if (dist < bestDist) {
            bestDist = dist;
            bestType = rule.type;
            bestModName = getModifierName(range, rule.modifiers);
        }
    }

    const maxAllowedDistance = Math.max(2, midPts * 0.2);
    if (bestDist <= maxAllowedDistance) {
        return bestModName ? bestModName + ' ' + bestType : bestType;
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
