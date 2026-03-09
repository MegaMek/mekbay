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
import { Unit } from '../models/units.model';
import { compareUnitsByName } from './sort.util';

/*
 * Author: Drake
 *
 * Force org definitions: OrgType, OrgTypeRule, and all org definitions
 * (ClanOrg, ISOrg, ComStarOrg, SocietyOrg, MHOrg, WDOrg).
 *
 * Solver logic lives in org-solver.util.ts.
 */

export type OrgType =
    // Generic
    | 'Force'
    | 'Mercenary'

    // IS-specific types
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

    // Clan-specific types
    | 'Point'
    | 'Star'
    | 'Nova'
    | 'Binary'
    | 'Supernova Binary'
    | 'Trinary'
    | 'Supernova Trinary'
    | 'Cluster'
    | 'Galaxy'

    // ComStar/WoB-specific types
    | 'Level I'
    | 'Level II'
    | 'Level III'
    | 'Level IV'
    | 'Level V'
    | 'Level VI'

    // Society-specific types
    | 'Un'
    | 'Trey'
    | 'Sept'

    // MH-specific types
    | 'Contubernium'
    | 'Century'
    | 'Maniple'
    | 'Cohort'
    | 'Legion'

    // CC-specific types
    | 'Augmented Lance'
    | 'Augmented Company'
    | 'Augmented Battalion'
    | 'Augmented Regiment';

export interface ForceComposition {
    BM: number;
    BA_troopers: number;
    CI_mechanized_troopers: number;
    CI_troopers: number;
    PM: number;
    CV: number;
    AF: number;
    other: number;
}

export function getForceCompositionFromUnits(units: Unit[]): ForceComposition {
    const comp: ForceComposition = {
        BM: 0,
        BA_troopers: 0,
        CI_mechanized_troopers: 0,
        CI_troopers: 0,
        PM: 0,
        CV: 0,
        AF: 0,
        other: 0,
    };

    for (const u of units) {
        if (u.type === 'Mek') comp.BM++;
        else if (u.type === 'Infantry') {
            if (u.subtype === 'Battle Armor') comp.BA_troopers += (u.internal || 0);
            else if (u.subtype === 'Mechanized Conventional Infantry') comp.CI_mechanized_troopers += (u.internal || 0);
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
 * A point range accounts for variable-size base units (e.g. ComStar Level I
 * of CI infantry = 30-36 troopers). Instead of a single divisor that under-
 * or over-counts, we track the minimum and maximum possible point values.
 *
 * When min === max the range is degenerate (exact), which is the default for
 * unit types with fixed sizes (mechs, vehicles, aero, etc.).
 */
export interface PointRange {
    min: number;
    max: number;
}

/**
 * Distance from a point range to a single point.
 * Returns 0 if the point is within the range.
 */
export function rangeDistToPoint(range: PointRange, point: number): number {
    if (point >= range.min && point <= range.max) return 0;
    if (point < range.min) return range.min - point;
    return point - range.max;
}

//  GroupSizeResult 

/**
 * Result of a group-level size evaluation.
 * Carries the matched OrgType so force-level evaluation can
 * count groups by type without re-evaluating them.
 */
export interface GroupSizeResult {
    name: string;
    type: OrgType | null;
    /** Alias type for group-based counting (e.g. Nova also counts as Star). */
    countsAsType: OrgType | null;
    /** Hierarchy depth from the matched rule (0 = leaf). */
    tier: number;
}

//  OrgTypeRule 

/**
 * Describes a force organization type at one level of the hierarchy.
 *
 * `modifiers` maps a display prefix ('' for regular) to the sub-unit count.
 * Leaf rules (no composedOfAny) use counts as absolute point values.
 * Composed rules use counts as number of sub-units.
 */
export interface OrgTypeRule {
    readonly type: OrgType;
    /** Prefix -> count mapping. '' prefix = regular/default count. */
    readonly modifiers: Record<string, number>;
    /**
     * Which sub-unit types this rule is composed of.
     * E.g. Cluster's composedOfAny = ['Binary', 'Trinary'].
     * Leaf rules (Point, Single, Flight, etc.) leave this undefined.
     */
    readonly composedOfAny?: OrgType[];
    readonly commandRank?: string;
    readonly strict?: boolean;
    readonly tier: number;
    readonly filter?: (comp: ForceComposition) => boolean;
    readonly customMatch?: (comp: ForceComposition) => number;
    /** For group-based force evaluation: this type also counts as another type. */
    readonly countsAs?: OrgType;
    /**
     * Explicit tie-breaker for group-based evaluation. Higher priority wins
     * when two rules match the same groups at equal distance. Defaults to 0.
     */
    readonly priority?: number;
    /**
     * Group-level filter for group-based force evaluation.
     * Checked in evaluateForceByGroups - receives the array of group results
     * and returns false to skip this rule.
     */
    readonly groupFilter?: (groups: ReadonlyArray<GroupSizeResult>) => boolean;
}

/** The regular ('') modifier's count, or the first modifier if no regular exists. */
export function getRegularCount(rule: OrgTypeRule): number {
    return rule.modifiers[''] ?? Object.values(rule.modifiers)[0];
}

/** Find the best modifier prefix for the given sub-unit count. */
export function getModifierPrefix(rule: OrgTypeRule, count: number): string {
    let bestPrefix = '';
    let bestDist = Infinity;
    for (const [prefix, modCount] of Object.entries(rule.modifiers)) {
        const d = Math.abs(count - modCount);
        if (d < bestDist) {
            bestDist = d;
            bestPrefix = prefix;
        }
    }
    if (bestDist > 0 && bestPrefix === '') {
        const regular = rule.modifiers[''];
        if (regular !== undefined) {
            return count < regular ? 'Under-Strength ' : 'Reinforced ';
        }
    }
    return bestPrefix;
}

//  Helpers 

function isPureAero(comp: ForceComposition): boolean {
    return comp.AF > 0 && comp.BM === 0 && comp.CV === 0 && comp.BA_troopers === 0 && comp.CI_troopers === 0 && comp.CI_mechanized_troopers === 0 && comp.PM === 0 && comp.other === 0;
}

function isPureInfantry(comp: ForceComposition): boolean {
    return comp.BM === 0 && comp.CV === 0 && comp.AF === 0 && comp.PM === 0 && comp.other === 0 &&
        (comp.BA_troopers > 0 || comp.CI_troopers > 0 || comp.CI_mechanized_troopers > 0);
}

// Shared Rules 
// Rules reused across org definitions (e.g. WDOrg extends Clan + IS rules).

// Clan rules
const CLAN_POINT: OrgTypeRule = { type: 'Point', modifiers: { '': 1 }, commandRank: 'Point Commander', tier: 0 };
const CLAN_STAR: OrgTypeRule = {
    type: 'Star', composedOfAny: ['Point'], modifiers: {
        'Half ': 2, 'Short ': 3, 'Under-Strength ': 4, '': 5, 'Reinforced ': 6, 'Fortified ': 7,
    }, commandRank: 'Star Commander', tier: 1,
};
const CLAN_NOVA: OrgTypeRule = {
    type: 'Nova', strict: true, countsAs: 'Star', modifiers: { '': 10 }, commandRank: 'Nova Commander', tier: 1,
    filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25) + (comp.CI_mechanized_troopers / 25)) > 0,
    customMatch: (comp) => {
        const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25) + (comp.CI_mechanized_troopers / 25);
        const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
        return Math.abs(comp.BM - 5) + Math.abs(infPoints - 5) + otherPoints;
    },
};
const CLAN_BINARY: OrgTypeRule = {
    type: 'Binary', strict: true, composedOfAny: ['Star'],
    modifiers: { '': 2 }, commandRank: 'Star Captain', tier: 2,
};
const CLAN_TRINARY: OrgTypeRule = {
    type: 'Trinary', strict: true, composedOfAny: ['Star'],
    modifiers: { '': 3 }, commandRank: 'Star Captain', tier: 2,
};
const CLAN_SUPERNOVA_BINARY: OrgTypeRule = {
    type: 'Supernova Binary', strict: true, priority: 2, countsAs: 'Binary',
    composedOfAny: ['Nova'], modifiers: { '': 2 }, commandRank: 'Nova Captain', tier: 2,
};
const CLAN_SUPERNOVA_TRINARY: OrgTypeRule = {
    type: 'Supernova Trinary', strict: true, priority: 1, countsAs: 'Trinary',
    composedOfAny: ['Nova'], modifiers: { '': 3 }, commandRank: 'Nova Captain', tier: 2,
};
const CLAN_CLUSTER: OrgTypeRule = {
    type: 'Cluster',
    composedOfAny: ['Binary', 'Trinary'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5 },
    commandRank: 'Star Colonel', tier: 3,
};
const CLAN_GALAXY: OrgTypeRule = {
    type: 'Galaxy', composedOfAny: ['Cluster'], modifiers: {
        'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5,
    }, commandRank: 'Galaxy Commander', tier: 4,
};

// IS rules
const IS_FLIGHT: OrgTypeRule = {
    type: 'Flight', modifiers: { 'Under-Strength ': 1, '': 2, 'Reinforced ': 3 },
    commandRank: 'Lieutenant', tier: 1, priority: 1,
    filter: (comp) => isPureAero(comp),
};
const IS_SQUADRON: OrgTypeRule = {
    type: 'Squadron', composedOfAny: ['Flight'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain', tier: 2,
    filter: (comp) => isPureAero(comp),
};
const IS_WING: OrgTypeRule = {
    type: 'Wing', composedOfAny: ['Squadron'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major', tier: 3,
    filter: (comp) => isPureAero(comp),
};
const IS_SQUAD: OrgTypeRule = {
    type: 'Squad', modifiers: { '': 1 }, commandRank: 'Sergeant', tier: 0,
    filter: (comp) => isPureInfantry(comp),
    customMatch: (comp) => {
        if (comp.BA_troopers > 0 && comp.CI_troopers === 0 && comp.CI_mechanized_troopers === 0) return Math.abs(comp.BA_troopers - 4) / 4;
        if ((comp.CI_troopers > 0 || comp.CI_mechanized_troopers > 0) && comp.BA_troopers === 0) {
            const ciTroopers = comp.CI_troopers + comp.CI_mechanized_troopers;
            if (ciTroopers >= 2 && ciTroopers <= 8) return 0;
            if (ciTroopers < 2) return (2 - ciTroopers) / 7;
            return (ciTroopers - 8) / 7;
        }
        return Infinity;
    },
};
const IS_SINGLE: OrgTypeRule = {
    type: 'Single', modifiers: { '': 1 }, tier: 0,
    filter: (comp) => !isPureAero(comp) && !isPureInfantry(comp),
};
const IS_LANCE: OrgTypeRule = {
    type: 'Lance', composedOfAny: ['Single'], tier: 1,
    modifiers: { 'Short ': 2, 'Under-Strength ': 3, '': 4, 'Reinforced ': 5, 'Fortified ': 6 },
    commandRank: 'Lieutenant',
    filter: (comp) => !isPureAero(comp) && !isPureInfantry(comp),
};
const IS_PLATOON: OrgTypeRule = {
    type: 'Platoon', countsAs: 'Lance', priority: 1, modifiers: { '': 1 }, commandRank: 'Lieutenant', tier: 1,
    filter: (comp) => isPureInfantry(comp),
    customMatch: (comp) => {
        const ciTroopers = comp.CI_troopers + comp.CI_mechanized_troopers;
        if (ciTroopers >= 6 && ciTroopers <= 32) return 0;
        if (ciTroopers < 6) return (6 - ciTroopers) / 28;
        return (ciTroopers - 32) / 28;
    },
};
const IS_COMPANY: OrgTypeRule = {
    type: 'Company', composedOfAny: ['Lance'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain', tier: 2,
    filter: (comp) => !isPureAero(comp),
};
const IS_BATTALION: OrgTypeRule = {
    type: 'Battalion', composedOfAny: ['Company'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major', tier: 3,
    filter: (comp) => !isPureAero(comp),
};
const IS_REGIMENT: OrgTypeRule = {
    type: 'Regiment', composedOfAny: ['Battalion', 'Wing'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5 },
    commandRank: 'Colonel', tier: 4,
    filter: (comp) => !isPureAero(comp),
};
const IS_BRIGADE: OrgTypeRule = {
    type: 'Brigade', composedOfAny: ['Regiment'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'General', tier: 5,
    filter: (comp) => !isPureAero(comp),
};

//  Org Definitions 

/**
 * Shared shape for all org definitions (ClanOrg, ISOrg, ComStarOrg, etc.).
 */
export interface OrgDefinition {
    readonly rules: OrgTypeRule[];
    readonly distanceFactor: number;
    readonly minDistance: number;
    readonly groupDistanceFactor: number;
    readonly groupMinDistance: number;
    getPointRange(comp: ForceComposition): PointRange;
}

const ClanOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
    getPointRange(comp: ForceComposition): PointRange {
        const pts = comp.BM +
            (comp.BA_troopers / 5) +
            (comp.CI_troopers / 25) +
            (comp.CI_mechanized_troopers / 25) +
            (comp.PM / 5) +
            (comp.CV / 2) +
            (comp.AF / 2) +
            comp.other;
        return { min: pts, max: pts };
    },
    rules: [
        CLAN_NOVA, CLAN_SUPERNOVA_BINARY, CLAN_SUPERNOVA_TRINARY,
        CLAN_POINT, 
        CLAN_STAR,
        CLAN_BINARY, CLAN_TRINARY,
        CLAN_CLUSTER, CLAN_GALAXY,
    ],
};

const ISOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
    getPointRange(comp: ForceComposition): PointRange {
        const fixed = comp.BM +
            (comp.BA_troopers / 4) +
            comp.PM +
            comp.CV +
            comp.AF +
            comp.other;
        return {
            min: fixed + ((comp.CI_troopers + comp.CI_mechanized_troopers) / 28),
            max: fixed + ((comp.CI_troopers + comp.CI_mechanized_troopers) / 21),
        };
    },
    rules: [
        IS_FLIGHT, IS_SQUADRON, IS_WING,
        IS_SQUAD, IS_PLATOON,
        IS_SINGLE, IS_LANCE, IS_COMPANY, IS_BATTALION, IS_REGIMENT, IS_BRIGADE,
    ],
};

const ComStarOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
    getPointRange(comp: ForceComposition): PointRange {
        const fixed = comp.BM + comp.PM + comp.CV + comp.AF + comp.other;
        let minPts = fixed;
        let maxPts = fixed;
        if (comp.CI_troopers > 0) {
            minPts += (comp.CI_troopers + comp.CI_mechanized_troopers) / 36;
            maxPts += (comp.CI_troopers + comp.CI_mechanized_troopers) / 30;
        }
        if (comp.BA_troopers > 0) {
            const ba = comp.BA_troopers / 6;
            minPts += ba;
            maxPts += ba;
        }
        return { min: minPts, max: maxPts };
    },
    rules: [
        { type: 'Level I', modifiers: { 'Demi-': 0.5, '': 1 }, commandRank: 'Acolyte', tier: 0 },
        {
            type: 'Level II', composedOfAny: ['Level I'], modifiers: {
                'Thin ': 2, 'Half ': 3, 'Short ': 4, 'Under-Strength ': 5, '': 6, 'Reinforced ': 7, 'Fortified ': 8, 'Heavy ': 9,
            }, commandRank: 'Adept', tier: 1,
        },
        {
            type: 'Level III', composedOfAny: ['Level II'], modifiers: {
                'Under-Strength ': 5, '': 6, 'Reinforced ': 7,
            }, commandRank: 'Adept (Demi-Precentor)', tier: 2,
        },
        {
            type: 'Level IV', composedOfAny: ['Level III'], modifiers: {
                'Under-Strength ': 5, '': 6, 'Reinforced ': 7,
            }, commandRank: 'Precentor', tier: 3,
        },
        {
            type: 'Level V', composedOfAny: ['Level IV'], modifiers: {
                'Under-Strength ': 5, '': 6, 'Reinforced ': 7,
            }, commandRank: 'Precentor', tier: 4,
        },
        {
            type: 'Level VI', composedOfAny: ['Level V'], modifiers: {
                'Under-Strength ': 5, '': 6, 'Reinforced ': 7,
            }, commandRank: 'Precentor Martial', tier: 5,
        },
    ],
};

const SocietyOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.5,
    groupMinDistance: 1,
    getPointRange(comp: ForceComposition): PointRange {
        const pts = comp.BM +
            (comp.BA_troopers / 9) +
            ((comp.CI_troopers + comp.CI_mechanized_troopers) / 75) +
            (comp.PM / 3) +
            (comp.CV / 7) +
            (comp.AF / 3) +
            comp.other;
        return { min: pts, max: pts };
    },
    rules: [
        { type: 'Un', modifiers: { '': 1 }, tier: 0 },
        { type: 'Trey', modifiers: { '': 3 }, tier: 1 },
        { type: 'Sept', modifiers: { '': 7 }, tier: 2 },
    ],
};

const MHOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.5,
    groupMinDistance: 1,
    getPointRange(comp: ForceComposition): PointRange {
        const fixed = comp.BM +
            (comp.BA_troopers / 5) +
            (comp.CI_troopers / 10) +
            (comp.CI_mechanized_troopers / 5) +
            comp.PM +
            comp.CV +
            comp.AF +
            comp.other;
        return {
            min: fixed,
            max: fixed,
        };
    },
    rules: [
        { type: 'Contubernium', modifiers: { '': 1 }, commandRank: 'Miles probatus', tier: 0 },
        {
            type: 'Century', composedOfAny: ['Contubernium'], modifiers: {
                'Half ': 2, 'Short ': 3, 'Under-Strength ': 4, '': 5, 'Reinforced ': 6, 'Fortified ': 7,
            }, commandRank: 'Centurion', tier: 1,
            filter: (comp) => comp.CI_troopers === 0 && comp.CI_mechanized_troopers === 0,
        },
        // Century (Infantry) = 4-10 CI infantry Points
        {
            type: 'Century', composedOfAny: ['Contubernium'], modifiers: {
                'Under-Strength ': 4, '': 7, 'Reinforced ': 10,
            }, commandRank: 'Centurion', tier: 1,
            filter: (comp) => isPureInfantry(comp) && comp.BA_troopers === 0,
        },
        {
            type: 'Maniple', strict: true, composedOfAny: ['Century'],
            modifiers: { '': 2 }, commandRank: 'Principes', tier: 2,
        },
        {
            type: 'Cohort', composedOfAny: ['Maniple'], modifiers: {
                'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5,
            }, commandRank: 'Legatus', tier: 3,
        },
        {
            type: 'Legion', composedOfAny: ['Cohort'], modifiers: {
                'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5,
            }, commandRank: 'General', tier: 4,
        },
    ],
};

const WDOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
    getPointRange(comp: ForceComposition): PointRange {
        const fixed = comp.BM +
            (comp.BA_troopers / 5) +
            comp.PM +
            comp.CV +
            comp.AF +
            comp.other;
        return {
            min: fixed + (comp.CI_troopers + comp.CI_mechanized_troopers) / 28,
            max: fixed + (comp.CI_troopers + comp.CI_mechanized_troopers) / 21,
        };
    },
    rules: [
        IS_FLIGHT, IS_SQUADRON, IS_WING,
        { ...IS_SQUAD, filter: (comp: ForceComposition) => comp.BA_troopers === 0 },
        { ...IS_PLATOON, filter: (comp: ForceComposition) => comp.BA_troopers === 0 },
        // WD Nova (modified Clan Nova)
        {
            ...CLAN_NOVA, commandRank: 'Lieutenant',
            filter: (comp: ForceComposition) => comp.BM > 0 && (comp.BA_troopers / 5) > 0,
            customMatch: (comp: ForceComposition) => {
                const infPoints = (comp.BA_troopers / 5);
                const otherPoints = (comp.PM / 5) + comp.CV + comp.other;
                return Math.abs(comp.BM - 5) + Math.abs(infPoints - 5) + otherPoints;
            },
        },
        { ...CLAN_SUPERNOVA_BINARY, commandRank: 'Captain' },
        { ...CLAN_SUPERNOVA_TRINARY, commandRank: 'Captain' },
        // WD Point (excludes aero and conventional infantry)
        { ...CLAN_POINT, commandRank: 'Sergeant', filter: (comp: ForceComposition) => comp.AF === 0 && comp.CI_troopers === 0 && comp.CI_mechanized_troopers === 0},
        // WD Lance (composedOf Point, not Single; limited to 2-4 BM non-BA)
        { ...IS_LANCE, filter: (comp: ForceComposition) => !isPureAero(comp) && comp.BA_troopers === 0 && comp.BM <= 4},
        // WD Star (composedOf Point; for BA or 5+ BM non-vehicle)
        { ...CLAN_STAR, commandRank: 'Lieutenant', filter: (comp: ForceComposition) => comp.CV === 0 && (comp.BA_troopers > 0 || comp.BM > 4)},
        { ...CLAN_BINARY, countsAs: 'Company' as OrgType, commandRank: 'Captain', filter: (comp: ForceComposition) => !isPureAero(comp) },
        { ...CLAN_TRINARY, countsAs: 'Company' as OrgType, commandRank: 'Captain', filter: (comp: ForceComposition) => !isPureAero(comp) },
        { ...CLAN_CLUSTER, priority: 1, countsAs: 'Battalion' as OrgType, commandRank: 'Major', filter: (comp: ForceComposition) => !isPureAero(comp) },
        // WD Company (accepts Lance + Star, requires at least 1 Lance)
        {
            ...IS_COMPANY,
            composedOfAny: ['Lance', 'Star'] as OrgType[],
            groupFilter: (groups: ReadonlyArray<GroupSizeResult>) => groups.some(g => g.type === 'Lance' || g.countsAsType === 'Lance'),
        },
        // WD Battalion (accepts Company + Binary + Trinary, requires at least 1 Company)
        {
            ...IS_BATTALION,
            composedOfAny: ['Company', 'Binary', 'Trinary'] as OrgType[],
            filter: (comp: ForceComposition) => !isPureAero(comp),
            groupFilter: (groups: ReadonlyArray<GroupSizeResult>) => groups.some(g => g.type === 'Company' || g.countsAsType === 'Company'),
        },
        // WD Regiment
        { ...IS_REGIMENT, composedOfAny: ['Battalion', 'Wing'] as OrgType[] },
    ],
};

const CCOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
    getPointRange(comp: ForceComposition): PointRange {
        const fixed = comp.BM +
            (comp.BA_troopers / 4) +
            comp.PM +
            comp.CV +
            comp.AF +
            comp.other;
        return {
            min: fixed + (comp.CI_troopers + comp.CI_mechanized_troopers) / 28,
            max: fixed + (comp.CI_troopers + comp.CI_mechanized_troopers) / 21,
        };
    },
    rules: [
        IS_FLIGHT, IS_SQUADRON, IS_WING, IS_SQUAD, IS_PLATOON, IS_SINGLE, IS_LANCE, IS_COMPANY, IS_BATTALION, IS_REGIMENT,
        // CC Augmented Lance
        {
            type: 'Augmented Lance', strict: true, composedOfAny: ['Single', 'Squad'],
            modifiers: { '': 6 }, commandRank: 'Lieutenant', tier: 1,
            filter: (comp) => (comp.AF === 0 && (comp.BM === 4 && (comp.CV === 2 || comp.BA_troopers === 8) || (comp.CV === 4 && (comp.BM === 2 || comp.BA_troopers === 16)))),
        },
        // CC Augmented Company (Reinforced Augmented Company is not canonically listed, but seems reasonable to allow in the app)
        {
            type: 'Augmented Company', composedOfAny: ['Augmented Lance'],
            modifiers: { '': 2, 'Reinforced ': 3 }, commandRank: 'Captain', tier: 2,
        },
        // CC Augmented Battalion (Short, Under-Strength, and Strong variants are not canonically listed, but seem reasonable to allow in the app)
        {
            type: 'Augmented Battalion', composedOfAny: ['Augmented Company'],
            modifiers: {'Short ': 2, 'Under-Strength ': 3, '': 4, 'Reinforced ': 5 }, commandRank: 'Major', tier: 3,
        },
        // CC Augmented Regiment
        {
            type: 'Augmented Regiment', composedOfAny: ['Augmented Battalion', 'Battalion', 'Wing'],
            modifiers: {'Under-Strength ': 3, '': 4, 'Reinforced ': 5 }, commandRank: 'General', tier: 4,
            groupFilter: (groups: ReadonlyArray<GroupSizeResult>) => groups.some(g => g.type === 'Augmented Battalion'),
        },
    ],
};

//  Org Resolution 

/**
 * Registry of org definitions with faction/tech-base matchers.
 * Order matters: first match wins. IS is the default fallback.
 * To add a new org, append one entry here.
 */
export const ORG_REGISTRY: { match: (techBase: string, factionName: string) => boolean; org: OrgDefinition }[] = [
    { match: (_, f) => f === 'ComStar' || f === 'Word of Blake', org: ComStarOrg },
    { match: (_, f) => f === 'Society', org: SocietyOrg },
    { match: (_, f) => f.includes('Marian Hegemony'), org: MHOrg },
    { match: (_, f) => f.includes('Dragoons'), org: WDOrg },
    { match: (_, f) => f.includes('Capellan Confederation'), org: CCOrg },
    { match: (_, f) => f.includes('Clan'), org: ClanOrg },
    { match: (_, f) => f.includes('Rasalhague Dominion') || f.includes('Wolf Empire') || f.includes('Escorpion') || f.includes('Scorpion Empire'), org: ClanOrg },
    // ISOrg is the default fallback if no other org matches
];

export const DEFAULT_ORG: OrgDefinition = ISOrg;