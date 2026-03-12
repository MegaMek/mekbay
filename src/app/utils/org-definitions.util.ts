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

import type { Unit } from '../models/units.model';
import type {
    GroupSizeResult,
    OrgDefinition,
    OrgType,
    OrgTypeRule,
    PointRange,
} from './org-types';

/*
 * Author: Drake
 *
 * Force org definitions: OrgTypeRule constants and OrgDefinition instances
 * (ClanOrg, ISOrg, ComStarOrg, SocietyOrg, MHOrg, WDOrg, CCOrg).
 *
 * Type definitions live in org-types.ts.
 * Solver logic lives in org-solver.util.ts.
 */

/**
 * Distance from a point range to a single point.
 * Returns 0 if the point is within the range.
 */
export function rangeDistToPoint(range: PointRange, point: number): number {
    if (point >= range.min && point <= range.max) return 0;
    if (point < range.min) return range.min - point;
    return point - range.max;
}

//  Unit classification helpers 

function isAero(u: Unit): boolean {
    return u.type === 'Aero';
}

function isBM(u: Unit): boolean {
    return u.type === 'Mek';
}

function isCV(u: Unit): boolean {
    return u.type === 'Tank' || u.type === 'VTOL' || u.type === 'Naval';
}

function isBA(u: Unit): boolean {
    return u.type === 'Infantry' && u.subtype === 'Battle Armor';
}

function isCI(u: Unit): boolean {
    return u.type === 'Infantry' && u.subtype !== 'Battle Armor';
}

function isInfantry(u: Unit): boolean {
    return u.type === 'Infantry';
}

function isPM(u: Unit): boolean {
    return u.type === 'ProtoMek';
}

/** Count helpers for customMatch — derive counts from Unit[] */
function countBM(units: Unit[]): number { return units.filter(isBM).length; }
function countBMOmni(units: Unit[]): number { return units.filter(u => isBM(u) && u.omni === 1).length; }
function countBA(units: Unit[]): number { return units.filter(isBA).length; }
function countBAMEC(units: Unit[]): number { return units.filter(u => isBA(u) && u.as.specials.includes('MEC')).length; }
function countBAXMEC(units: Unit[]): number { return units.filter(u => isBA(u) && u.as.specials.includes('XMEC')).length; }
function countCV(units: Unit[]): number { return units.filter(isCV).length; }
function countCVOmni(units: Unit[]): number { return units.filter(u => isCV(u) && u.omni === 1).length; }
function countAF(units: Unit[]): number { return units.filter(isAero).length; }
function countAFOmni(units: Unit[]): number { return units.filter(u => isAero(u) && u.omni === 1).length; }
function countCI(units: Unit[]): number { return units.filter(isCI).length; }
function countPM(units: Unit[]): number { return units.filter(isPM).length; }
function sumBATroopers(units: Unit[]): number { return units.filter(isBA).reduce((s, u) => s + (u.internal || 0), 0); }
function sumCITroopers(units: Unit[]): number { return units.filter(isCI).reduce((s, u) => s + (u.internal || 0), 0); }
function sumCIMechanizedTroopers(units: Unit[]): number {
    return units.filter(u => isCI(u) && u.subtype === 'Mechanized Conventional Infantry').reduce((s, u) => s + (u.internal || 0), 0);
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
    type: 'Nova', strict: true, priority: 1, countsAs: 'Star', modifiers: { '': 10 }, commandRank: 'Nova Commander', tier: 1.7,
    filter: (u) => isBM(u) || isCV(u) || isAero(u) || isBA(u),
    customMatchUnitCounts: [10],
    customMatch: (units) => {
        const ba = countBA(units);
        const baMEC = countBAMEC(units);
        const baXMEC = countBAXMEC(units);
        const qualBA = Math.min(ba, baMEC + baXMEC);
        const nonQualBA = ba - qualBA;
        const bm = countBM(units); const bmOmni = countBMOmni(units);
        const cv = countCV(units); const cvOmni = countCVOmni(units);
        const af = countAF(units); const afOmni = countAFOmni(units);
        if (qualBA === 0) return Infinity;
        const configs = [
            { carrier: bm, omni: bmOmni, others: cv + af },
            { carrier: cv, omni: cvOmni, others: bm + af },
            { carrier: af, omni: afOmni, others: bm + cv },
        ];
        return Math.min(...configs.map(cfg =>
            Math.abs(cfg.carrier - 5) + Math.abs(qualBA - 5) + cfg.others +
            Math.max(0, baMEC - cfg.omni) + nonQualBA
        ));
    },
};
const CLAN_BINARY: OrgTypeRule = {
    type: 'Binary', strict: true, composedOfAny: ['Star'],
    modifiers: { '': 2 }, commandRank: 'Star Captain', tier: 1.8,
};
const CLAN_TRINARY: OrgTypeRule = {
    type: 'Trinary', strict: true, composedOfAny: ['Star'],
    modifiers: { '': 3 }, commandRank: 'Star Captain', tier: 2,
};
const CLAN_SUPERNOVA_BINARY: OrgTypeRule = {
    type: 'Supernova Binary', strict: true, priority: 2, countsAs: 'Binary',
    composedOfAny: ['Nova'], modifiers: { '': 2 }, commandRank: 'Nova Captain', tier: 3,
};
const CLAN_SUPERNOVA_TRINARY: OrgTypeRule = {
    type: 'Supernova Trinary', strict: true, priority: 1, countsAs: 'Trinary',
    composedOfAny: ['Nova'], modifiers: { '': 3 }, commandRank: 'Nova Captain', tier: 3,
};
const CLAN_SUPERNOVA_TRINARY_FROM_BINARY: OrgTypeRule = {
    type: 'Supernova Trinary', strict: true, priority: 1, countsAs: 'Trinary',
    composedOfAny: ['Supernova Binary', 'Nova'], modifiers: { '': 2 }, commandRank: 'Nova Captain', tier: 3,
    groupFilter: (groups) =>
        groups.length === 2 &&
        groups.some(group => group.type === 'Supernova Binary') &&
        groups.some(group => group.type === 'Nova'),
};
const CLAN_CLUSTER: OrgTypeRule = {
    type: 'Cluster',
    composedOfAny: ['Binary', 'Trinary'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5 },
    commandRank: 'Star Colonel', tier: 4,
};
const CLAN_GALAXY: OrgTypeRule = {
    type: 'Galaxy', composedOfAny: ['Cluster'], modifiers: {
        'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5,
    }, commandRank: 'Galaxy Commander', tier: 8,
};

// IS rules
const IS_FLIGHT: OrgTypeRule = {
    type: 'Flight', modifiers: { 'Under-Strength ': 1, '': 2, 'Reinforced ': 3 },
    commandRank: 'Lieutenant', tier: 1, priority: 1,
    filter: (u) => isAero(u),
};
const IS_SQUADRON: OrgTypeRule = {
    type: 'Squadron', composedOfAny: ['Flight'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain', tier: 2,
};
const IS_WING: OrgTypeRule = {
    type: 'Wing', composedOfAny: ['Squadron'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major', tier: 4,
};
const IS_SQUAD: OrgTypeRule = {
    type: 'Squad', modifiers: { '': 1 }, commandRank: 'Sergeant', tier: 0,
    filter: (u) => isInfantry(u),
    customMatch: (units) => {
        const baTroopers = sumBATroopers(units);
        const ciTroopers = sumCITroopers(units);
        if (baTroopers > 0 && ciTroopers === 0) return Math.abs(baTroopers - 4) / 4;
        if (ciTroopers > 0 && baTroopers === 0) {
            if (ciTroopers >= 2 && ciTroopers <= 8) return 0;
            if (ciTroopers < 2) return (2 - ciTroopers) / 7;
            return (ciTroopers - 8) / 7;
        }
        return Infinity;
    },
};
const IS_LANCE: OrgTypeRule = {
    type: 'Lance', tier: 1,
    modifiers: { 'Short ': 2, 'Under-Strength ': 3, '': 4, 'Reinforced ': 5, 'Fortified ': 6 },
    commandRank: 'Lieutenant',
    filter: (u) => !isCI(u),
};
const IS_AIR_LANCE: OrgTypeRule = {
    type: 'Air Lance', countsAs: 'Lance', priority: 1, composedOfAny: ['Flight', 'Lance'], tier: 1.5,
    modifiers: { '': 2 },
    commandRank: 'Lieutenant',
    filter: (u) => !isInfantry(u),
    groupFilter: (groups) =>
        groups.some(g => g.type === 'Flight') &&
        groups.some(g => g.type === 'Lance' || g.countsAsType === 'Lance'),
};
const IS_PLATOON: OrgTypeRule = {
    type: 'Platoon', countsAs: 'Lance', priority: 1, modifiers: { '': 1 }, commandRank: 'Lieutenant', tier: 1,
    filter: (u) => isCI(u),
    customMatch: (units) => {
        const ciTroopers = sumCITroopers(units);
        if (ciTroopers >= 6 && ciTroopers <= 32) return 0;
        if (ciTroopers < 6) return (6 - ciTroopers) / 28;
        return (ciTroopers - 32) / 28;
    },
};
const IS_COMPANY: OrgTypeRule = {
    type: 'Company', composedOfAny: ['Lance', 'Flight'],
    modifiers: { 'Under-Strength ': { count: 2, tier: 1.5 }, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain', tier: 2, dynamicTier: 1
};
const IS_BATTALION: OrgTypeRule = {
    type: 'Battalion', composedOfAny: ['Company', 'Squadron'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major', tier: 4, dynamicTier: 1
};
const IS_REGIMENT: OrgTypeRule = {
    type: 'Regiment', composedOfAny: ['Battalion', 'Wing'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5 },
    commandRank: 'Colonel', tier: 8, dynamicTier: 1
};
const IS_BRIGADE: OrgTypeRule = {
    type: 'Brigade', composedOfAny: ['Regiment'],
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'General', tier: 16, dynamicTier: 1
};

//  Org Definitions 

const ClanOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
    getPointRange(units: Unit[]): PointRange {
        const baTroopers = sumBATroopers(units);
        const ciTroopers = sumCITroopers(units);
        const fixed = countBM(units) +
            (baTroopers / 5) +
            (countPM(units) / 5) +
            (countCV(units) / 2) +
            (countAF(units) / 2) +
            units.filter(u => !isBM(u) && !isBA(u) && !isCI(u) && !isPM(u) && !isCV(u) && !isAero(u)).length;
        let minPts = fixed;
        let maxPts = fixed;
        if (ciTroopers > 0) {
            minPts += ciTroopers / 25;
            maxPts += ciTroopers / 25;
        }
        return { min: minPts, max: maxPts };
    },
    rules: [
        CLAN_NOVA, CLAN_SUPERNOVA_BINARY, CLAN_SUPERNOVA_TRINARY, CLAN_SUPERNOVA_TRINARY_FROM_BINARY,
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
    getPointRange(units: Unit[]): PointRange {
        const baTroopers = sumBATroopers(units);
        const ciTroopers = sumCITroopers(units);
        const fixed = countBM(units) +
            (baTroopers / 4) +
            countPM(units) +
            countCV(units) +
            countAF(units) +
            units.filter(u => !isBM(u) && !isBA(u) && !isCI(u) && !isPM(u) && !isCV(u) && !isAero(u)).length;
        let minPts = fixed;
        let maxPts = fixed;
        if (ciTroopers > 0) {
            minPts += ciTroopers / 28;
            maxPts += ciTroopers / 21;
        }
        return { min: minPts, max: maxPts };
    },
    rules: [
        IS_FLIGHT, IS_SQUADRON, IS_WING,
        IS_SQUAD, IS_PLATOON,
        IS_LANCE, IS_AIR_LANCE, IS_COMPANY, IS_BATTALION, IS_REGIMENT, IS_BRIGADE,
    ],
};

const ComStarOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
    getPointRange(units: Unit[]): PointRange {
        const ciTroopers = sumCITroopers(units);
        const fixed = countBM(units) + countPM(units) + countCV(units) + countAF(units) + countBA(units) +
            units.filter(u => !isBM(u) && !isBA(u) && !isCI(u) && !isPM(u) && !isCV(u) && !isAero(u)).length;
        let minPts = fixed;
        let maxPts = fixed;
        if (ciTroopers > 0) {
            minPts += ciTroopers / 36;
            maxPts += ciTroopers / 30;
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
            type: 'Choir', strict: true, priority: 1, countsAs: 'Level II', modifiers: { '': 12 }, commandRank: 'Adept', tier: 1.6,
            filter: (u) => isBM(u) || isBA(u),
            customMatchUnitCounts: [12],
            customMatch: (units) => {
                const bm = countBM(units);
                const ba = countBA(units);
                const baMEC = countBAMEC(units);
                const baXMEC = countBAXMEC(units);
                const bmOmni = countBMOmni(units);
                const qualBA = Math.min(ba, baMEC + baXMEC);
                if (qualBA === 0 || bm === 0) return Infinity;
                if (!((baMEC > 0 && bmOmni > 0) || (baXMEC > 0 && bm > 0))) return Infinity;
                return Math.abs(bm - 6) + Math.abs(ba - 6);
            },
        },
 /*       {
            type: 'Demi-Level III', composedOfAny: ['Level II'], modifiers: {
                'Under-Strength ': 2, '': 3, 'Reinforced ': 4,
            }, commandRank: 'Adept (Demi-Precentor)', tier: 2,
        },*/
        {
            type: 'Level III', composedOfAny: ['Level II'], modifiers: {
                'Under-Strength ': 5, '': 6, 'Reinforced ': 7,
            }, commandRank: 'Adept (Demi-Precentor)', tier: 2,
        },
        {
            type: 'Level IV', composedOfAny: ['Level III'], modifiers: {
                'Under-Strength ': 5, '': 6, 'Reinforced ': 7,
            }, commandRank: 'Precentor', tier: 4,
        },
        {
            type: 'Level V', composedOfAny: ['Level IV'], modifiers: {
                'Under-Strength ': 5, '': 6, 'Reinforced ': 7,
            }, commandRank: 'Precentor', tier: 8,
        },
        {
            type: 'Level VI', composedOfAny: ['Level V'], modifiers: { '': 2, },
            commandRank: 'Precentor Martial', tier: 16,
        },
    ],
};


function isSocietyUn(units: Unit[]): boolean {
    if (units.length === 0) return false;
    if (units.every(isBM)) return countBM(units) === 1;
    if (units.every(isBA)) return sumBATroopers(units) === 3;
    if (units.every(isCI)) return sumCITroopers(units) === 75;
    if (units.every(isPM)) return countPM(units) === 3;
    if (units.every(isAero)) return countAF(units) === 3;
    if (units.every(isCV)) return countCV(units) === 7;
    return false;
}

const SocietyOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.5,
    groupMinDistance: 1,
    getPointRange(units: Unit[]): PointRange {
        const baTroopers = sumBATroopers(units);
        const ciTroopers = sumCITroopers(units);
        const fixed = countBM(units) +
            (baTroopers / 3) +
            (ciTroopers / 75) +
            (countPM(units) / 3) +
            (countCV(units) / 7) +
            (countAF(units) / 3) +
            units.filter(u => !isBM(u) && !isBA(u) && !isCI(u) && !isPM(u) && !isCV(u) && !isAero(u)).length;
        return { min: fixed, max: fixed };
    },
    rules: [
        {
            type: 'Un',
            modifiers: { '': 1 },
            tier: 0,
            customMatch: (units) => isSocietyUn(units) ? 0 : Infinity,
        },
        { type: 'Trey', strict: true, composedOfAny: ['Un'], modifiers: { '': 3 }, tier: 1 },
        { type: 'Sept', strict: true, composedOfAny: ['Un'], modifiers: { '': 7 }, tier: 1.8 },
    ],
};

const MHOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.5,
    groupMinDistance: 1,
    getPointRange(units: Unit[]): PointRange {
        const baTroopers = sumBATroopers(units);
        const ciTroopers = sumCITroopers(units);
        const ciMechTroopers = sumCIMechanizedTroopers(units);
        const fixed = countBM(units) +
            (baTroopers / 5) +
            countPM(units) +
            countCV(units) +
            countAF(units) +
            units.filter(u => !isBM(u) && !isBA(u) && !isCI(u) && !isPM(u) && !isCV(u) && !isAero(u)).length;
        let minPts = fixed;
        let maxPts = fixed;
        if (ciTroopers > 0) {
            let CI_points = ((ciTroopers - ciMechTroopers) / 10);
            CI_points += (ciMechTroopers / 5);
            minPts += CI_points;
            maxPts += CI_points;
        }
        return { min: minPts, max: maxPts };
    },
    rules: [
        { type: 'Contubernium', tag: 'non-infantry', filter: (u) => !isCI(u), modifiers: { '': 1 }, commandRank: 'Miles probatus', tier: 0 },
        { type: 'Contubernium', tag: 'infantry', filter: (u) => isCI(u), modifiers: { '': 1 }, commandRank: 'Miles probatus', tier: 0 },
        {
            type: 'Century', composedOfAny: ['Contubernium'], modifiers: { '': 5 }, commandRank: 'Centurion', tier: 1,
            groupFilter: (groups) => groups.every(g => g.tag !== 'infantry'),
        },
        // Century (Infantry) = 4-10 CI infantry Points
        {
            type: 'Century', composedOfAny: ['Contubernium'], modifiers: {
                'Under-Strength ': 4, '': 7, 'Reinforced ': 10,
            }, commandRank: 'Centurion', tier: 1,
            groupFilter: (groups) => groups.every(g => g.tag === 'infantry'),
        },
        { type: 'Maniple', composedOfAny: ['Century'], modifiers: { '': 2 }, commandRank: 'Principes', tier: 2 },
        { type: 'Cohort', composedOfAny: ['Maniple'], modifiers: { '': 3 }, commandRank: 'Legatus', tier: 4 },
        { type: 'Legion', composedOfAny: ['Cohort'], modifiers: { '': 4 }, commandRank: 'General', tier: 8 },
    ],
};

const WDOrg: OrgDefinition = {
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
    getPointRange(units: Unit[]): PointRange {
        const baTroopers = sumBATroopers(units);
        const ciTroopers = sumCITroopers(units);
        const fixed = countBM(units) +
            (baTroopers / 5) +
            countPM(units) +
            countCV(units) +
            countAF(units) +
            units.filter(u => !isBM(u) && !isBA(u) && !isCI(u) && !isPM(u) && !isCV(u) && !isAero(u)).length;
        let minPts = fixed;
        let maxPts = fixed;
        if (ciTroopers > 0) {
            minPts += ciTroopers / 28;
            maxPts += ciTroopers / 21;
        }
        return { min: minPts, max: maxPts };
    },
    rules: [
        IS_FLIGHT, IS_SQUADRON, IS_WING,
        { ...IS_SQUAD, filter: (u: Unit) => isCI(u) },
        { ...IS_PLATOON, filter: (u: Unit) => isCI(u) },
        { ...CLAN_NOVA, commandRank: 'Lieutenant' },
        { ...CLAN_SUPERNOVA_BINARY, commandRank: 'Captain' },
        { ...CLAN_SUPERNOVA_TRINARY, commandRank: 'Captain' },
        { ...CLAN_SUPERNOVA_TRINARY_FROM_BINARY, commandRank: 'Captain' },
        // WD Point (excludes aero and conventional infantry)
        { ...CLAN_POINT, commandRank: 'Sergeant', filter: (u: Unit) => !isAero(u) && !isCI(u) },
        // WD Lance (composedOf Point, not Single; limited to 2-4 BM non-BA)
        { ...IS_LANCE, composedOfAny: ['Point'], filter: (u: Unit) => !isAero(u) && !isBA(u) },
        // WD Star (composedOf Point; for BA or 5+ BM non-vehicle)
        { ...CLAN_STAR, commandRank: 'Lieutenant', filter: (u: Unit) => !isCV(u) },
        { ...CLAN_BINARY, countsAs: 'Company' as OrgType, commandRank: 'Captain', filter: (u: Unit) => !isAero(u) },
        { ...CLAN_TRINARY, countsAs: 'Company' as OrgType, commandRank: 'Captain', filter: (u: Unit) => !isAero(u) },
        { ...CLAN_CLUSTER, priority: 1, countsAs: 'Battalion' as OrgType, commandRank: 'Major', filter: (u: Unit) => !isAero(u) },
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
            filter: (u: Unit) => !isAero(u),
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
    getPointRange(units: Unit[]): PointRange {
        const baTroopers = sumBATroopers(units);
        const ciTroopers = sumCITroopers(units);
        const fixed = countBM(units) +
            (baTroopers / 4) +
            countPM(units) +
            countCV(units) +
            countAF(units) +
            units.filter(u => !isBM(u) && !isBA(u) && !isCI(u) && !isPM(u) && !isCV(u) && !isAero(u)).length;
        let minPts = fixed;
        let maxPts = fixed;
        if (ciTroopers > 0) {
            minPts += ciTroopers / 28;
            maxPts += ciTroopers / 21;
        }
        return { min: minPts, max: maxPts };
    },
    rules: [
        IS_FLIGHT, IS_SQUADRON, IS_WING, 
        IS_SQUAD, IS_PLATOON, 
        IS_LANCE, IS_COMPANY, IS_BATTALION, IS_REGIMENT,
        { ... IS_COMPANY, composedOfAny: [...IS_COMPANY.composedOfAny!, 'Augmented Lance'] },
        { ... IS_BATTALION, composedOfAny: [...IS_BATTALION.composedOfAny!, 'Augmented Company'] },
        { ... IS_REGIMENT, composedOfAny: [...IS_REGIMENT.composedOfAny!, 'Augmented Battalion'] },
        // CC Augmented Lance
        {
            type: 'Augmented Lance', countsAs: 'Lance', strict: true, priority: 1,
            modifiers: { '': 6 }, commandRank: 'Lieutenant', tier: 1.05,
            filter: (u) => isBM(u) || isCV(u) || isBA(u),
            customMatchUnitCounts: [6],
            customMatch: (units) => {
                const bm = countBM(units); const bmOmni = countBMOmni(units);
                const cv = countCV(units); const cvOmni = countCVOmni(units);
                const ba = countBA(units);
                const baMEC = countBAMEC(units); const baXMEC = countBAXMEC(units);
                const qualBA = Math.min(ba, baMEC + baXMEC);
                const nonQualBA = ba - qualBA;
                const configs = [
                    // BM + CV (no BA)
                    { carrier: bm, targetC: 4, other: cv, targetO: 2, ba: 0, omni: 0 },
                    { carrier: cv, targetC: 4, other: bm, targetO: 2, ba: 0, omni: 0 },
                    // BM + BA (BA rides on BM)
                    { carrier: bm, targetC: 4, other: cv, targetO: 0, ba: 2, omni: bmOmni },
                    // CV + BA (BA rides on CV)
                    { carrier: cv, targetC: 4, other: bm, targetO: 0, ba: 4, omni: cvOmni },
                ];
                return Math.min(...configs.map(cfg =>
                    Math.abs(cfg.carrier - cfg.targetC) + Math.abs(cfg.other - cfg.targetO) +
                    Math.abs(qualBA - cfg.ba) + Math.max(0, baMEC - cfg.omni)
                )) + nonQualBA;
            },
        },
        // CC Augmented Company, slightly inferior tier than Regular Company due to being smaller. It will prevail over Regular Company due to priority if there are no leftovers.
        { type: 'Augmented Company', countsAs: 'Company', composedOfAny: ['Augmented Lance'], priority: 1, modifiers: { '': 2, 'Reinforced ': 3 }, commandRank: 'Captain', tier: 1.95 },
        // CC Augmented Battalion
        { type: 'Augmented Battalion', countsAs: 'Battalion', composedOfAny: ['Augmented Company'], priority: 1, modifiers: { 'Under-Strength ': 3, '': 4, 'Reinforced ': 5 }, commandRank: 'Major', tier: 4 },
        // CC Augmented Regiment
        {
            type: 'Augmented Regiment', countsAs: 'Regiment', composedOfAny: ['Augmented Battalion', 'Battalion', 'Wing'],
            modifiers: { 'Under-Strength ': 3, '': 4, 'Reinforced ': 5 }, commandRank: 'General', tier: 8.01,
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
    { match: (_, f) =>
        f.includes('Rasalhague Dominion') || f.includes('Raven Alliance') || f.includes('Wolf Empire') ||
        f.includes('Escorpion') || f.includes('Scorpion Empire'),
        org: ClanOrg,
    },
    // ISOrg is the default fallback if no other org matches
];

export const DEFAULT_ORG: OrgDefinition = ISOrg;