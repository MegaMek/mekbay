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
 * ('' for regular/default) and a count of sub-units.
 *
 * For leaf rules (no composedOf), count equals absolute pts.
 * For composed rules, resolved pts = count x nominal pts of the base rule.
 */
type ForceModifier = {
    prefix: string;   // '' for regular, Short, Under-Strength, Reinforced, etc.
    count: number;  // number of sub-units (or absolute pts for leaf rules)
};

class ForceTypeRule {
    readonly type: ForceType;
    readonly modifiers: ForceModifier[];
    readonly composedOf?: ForceTypeRule;
    readonly commandRank?: string;
    readonly strict?: boolean;
    readonly filter?: (comp: ForceComposition) => boolean;
    readonly customMatch?: (comp: ForceComposition) => number;
    private readonly _nominalPts: number; // Cached nominal pts

    constructor(config: {
        type: ForceType;
        modifiers: ForceModifier[];
        composedOf?: ForceTypeRule;
        commandRank?: string;
        strict?: boolean;
        filter?: (comp: ForceComposition) => boolean;
        customMatch?: (comp: ForceComposition) => number;
    }) {
        this.type = config.type;
        // Ensure modifiers are sorted ascending by count
        this.modifiers = [...config.modifiers].sort((a, b) => a.count - b.count);
        this.composedOf = config.composedOf;
        this.commandRank = config.commandRank;
        this.strict = config.strict;
        this.filter = config.filter;
        this.customMatch = config.customMatch;

        const regularMod = this.modifiers.find(m => m.prefix === '') ?? this.modifiers[0];
        this._nominalPts = this.composedOf
            ? regularMod.count * this.composedOf.nominalPts
            : regularMod.count;
    }

    /** Nominal pts for this rule's "regular" modifier, recursively resolved */
    get nominalPts(): number {
        return this._nominalPts;
    }

    /** Resolve a modifier's absolute pts through the composition chain */
    resolveModPts(mod: ForceModifier): number {
        if (!this.composedOf) return mod.count;
        return mod.count * this.composedOf.nominalPts;
    }

    /**
     * Find the best modifier prefix for a given point range.
     * Resolves each modifier's pts from the composition chain, then picks the one
     * whose resolved pts is closest to (or within) the range.
     */
    getModifierPrefix(range: PointRange): string {
        let closest = this.modifiers[0];
        let closestPts = this.resolveModPts(this.modifiers[0]);
        let closestDist = rangeDistToPoint(range, closestPts);

        for (let i = 1; i < this.modifiers.length; i++) {
            const pts = this.resolveModPts(this.modifiers[i]);
            const d = rangeDistToPoint(range, pts);
            if (d < closestDist) {
                closestDist = d;
                closest = this.modifiers[i];
                closestPts = pts;
            }
        }

        // If the closest modifier is the regular one ('') and the range doesn't
        // cover it, fall back to generic Under-Strength / Reinforced
        if (closestDist > 0 && closest.prefix === '') {
            const mid = (range.min + range.max) / 2;
            if (mid < closestPts) return 'Under-Strength ';
            return 'Reinforced ';
        }

        return closest.prefix;
    }
}

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

class ClanOrg {
    static getPointRange(comp: ForceComposition): PointRange {
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

    static readonly NOVA = new ForceTypeRule({
        type: 'Nova', strict: true, modifiers: [{ prefix: '', count: 10 }], commandRank: 'Nova Commander',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 5) + Math.abs(infPoints - 5) + otherPoints;
        },
    });
    static readonly SUPERNOVA_BINARY = new ForceTypeRule({
        type: 'Supernova Binary', strict: true, modifiers: [{ prefix: '', count: 20 }], commandRank: 'Nova Captain',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 10) + Math.abs(infPoints - 10) + otherPoints;
        },
    });
    static readonly SUPERNOVA_TRINARY = new ForceTypeRule({
        type: 'Supernova Trinary', strict: true, modifiers: [{ prefix: '', count: 30 }], commandRank: 'Nova Captain',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 15) + Math.abs(infPoints - 15) + otherPoints;
        },
    });
    static readonly POINT = new ForceTypeRule({
        type: 'Point', modifiers: [{ prefix: '', count: 1 }], commandRank: 'Point Commander',
    });
    // Star = N Points
    static readonly STAR = new ForceTypeRule({
        type: 'Star', composedOf: ClanOrg.POINT, modifiers: [
            { prefix: 'Half ', count: 2 },
            { prefix: 'Short ', count: 3 },
            { prefix: 'Under-Strength ', count: 4 },
            { prefix: '', count: 5 },
            { prefix: 'Reinforced ', count: 6 },
            { prefix: 'Fortified ', count: 7 },
        ], commandRank: 'Star Commander',
    });
    // Binary = 2 Stars
    static readonly BINARY = new ForceTypeRule({
        type: 'Binary', composedOf: ClanOrg.STAR,
        modifiers: [{ prefix: '', count: 2 }], commandRank: 'Star Captain',
    });
    // Trinary = 3 Stars
    static readonly TRINARY = new ForceTypeRule({
        type: 'Trinary', composedOf: ClanOrg.STAR,
        modifiers: [{ prefix: '', count: 3 }], commandRank: 'Star Captain',
    });
    // Cluster = N Trinaries (can also be Binaries/Supernovas in practice)
    static readonly CLUSTER = new ForceTypeRule({
        type: 'Cluster', composedOf: ClanOrg.TRINARY, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
            { prefix: 'Strong ', count: 5 },
        ], commandRank: 'Star Colonel',
    });
    // Galaxy = N Clusters
    static readonly GALAXY = new ForceTypeRule({
        type: 'Galaxy', composedOf: ClanOrg.CLUSTER, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
            { prefix: 'Strong ', count: 5 },
        ], commandRank: 'Galaxy Commander',
    });
    static readonly ALL: ForceTypeRule[] = [
        ClanOrg.NOVA, ClanOrg.SUPERNOVA_BINARY, ClanOrg.SUPERNOVA_TRINARY,
        ClanOrg.POINT, ClanOrg.STAR, ClanOrg.BINARY, ClanOrg.TRINARY,
        ClanOrg.CLUSTER, ClanOrg.GALAXY,
    ];
}



function isPureAero(comp: ForceComposition): boolean {
    return comp.AF > 0 && comp.BM === 0 && comp.CV === 0 && comp.BA_troopers === 0 && comp.CI_troopers === 0 && comp.PM === 0 && comp.other === 0;
}

function isPureInfantry(comp: ForceComposition): boolean {
    return comp.BM === 0 && comp.CV === 0 && comp.AF === 0 && comp.PM === 0 && comp.other === 0 &&
           (comp.BA_troopers > 0 || comp.CI_troopers > 0);
}

class ISOrg {
    static getPointRange(comp: ForceComposition): PointRange {
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
    static readonly FLIGHT = new ForceTypeRule({
        type: 'Flight', modifiers: [{ prefix: '', count: 2 }], commandRank: 'Lieutenant',
        filter: (comp) => isPureAero(comp),
    });
    static readonly SQUADRON = new ForceTypeRule({
        type: 'Squadron', modifiers: [{ prefix: '', count: 6 }], commandRank: 'Captain',
        filter: (comp) => isPureAero(comp),
    });
    static readonly WING = new ForceTypeRule({
        type: 'Wing', modifiers: [
            { prefix: 'Under-Strength ', count: 18 },
            { prefix: '', count: 21 },
            { prefix: 'Reinforced ', count: 24 },
        ], commandRank: 'Major',
        filter: (comp) => isPureAero(comp),
    });
    static readonly SQUAD = new ForceTypeRule({
        type: 'Squad', modifiers: [{ prefix: '', count: 1 }], commandRank: 'Sergeant',
        filter: (comp) => isPureInfantry(comp),
        customMatch: (comp) => {
            if (comp.BA_troopers > 0 && comp.CI_troopers === 0) return Math.abs(comp.BA_troopers - 4) / 4;
            if (comp.CI_troopers > 0 && comp.BA_troopers === 0) {
                if (comp.CI_troopers >= 2 && comp.CI_troopers <= 8) return 0;
                if (comp.CI_troopers < 2) return (2 - comp.CI_troopers) / 7;
                return (comp.CI_troopers - 8) / 7;
            }
            return Infinity;
        },
    });
    static readonly PLATOON = new ForceTypeRule({
        type: 'Platoon', modifiers: [{ prefix: '', count: 1 }], commandRank: 'Sergeant',
        filter: (comp) => isPureInfantry(comp) && comp.CI_troopers > 0 && comp.BA_troopers === 0,
        customMatch: (comp) => {
            if (comp.CI_troopers >= 6 && comp.CI_troopers <= 32) return 0;
            if (comp.CI_troopers < 6) return (6 - comp.CI_troopers) / 28;
            return (comp.CI_troopers - 32) / 28;
        },
    });
    static readonly SINGLE = new ForceTypeRule({
        type: 'Single', modifiers: [{ prefix: '', count: 1 }],
        filter: (comp) => !isPureAero(comp) && !isPureInfantry(comp),
    });
    static readonly LANCE = new ForceTypeRule({
        type: 'Lance', composedOf: ISOrg.SINGLE,  modifiers: [
            { prefix: 'Short ', count: 2 },
            { prefix: 'Under-Strength ', count: 3 },
            { prefix: '', count: 4 },
            { prefix: 'Reinforced ', count: 5 },
            { prefix: 'Fortified ', count: 6 },
        ], commandRank: 'Lieutenant', filter: (comp) => !isPureAero(comp),
    });
    // Company = N Lances
    static readonly COMPANY = new ForceTypeRule({
        type: 'Company', composedOf: ISOrg.LANCE, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
        ], commandRank: 'Captain', filter: (comp) => !isPureAero(comp),
    });
    // Battalion = N Companies
    static readonly BATTALION = new ForceTypeRule({
        type: 'Battalion', composedOf: ISOrg.COMPANY, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
        ], commandRank: 'Major', filter: (comp) => !isPureAero(comp),
    });
    // Regiment = N Battalions
    static readonly REGIMENT = new ForceTypeRule({
        type: 'Regiment', composedOf: ISOrg.BATTALION, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
            { prefix: 'Strong ', count: 5 },
        ], commandRank: 'Colonel', filter: (comp) => !isPureAero(comp),
    });
    // Brigade = N Regiments
    static readonly BRIGADE = new ForceTypeRule({
        type: 'Brigade', composedOf: ISOrg.REGIMENT, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
        ], commandRank: 'General', filter: (comp) => !isPureAero(comp),
    });
    static readonly ALL: ForceTypeRule[] = [
        ISOrg.FLIGHT, ISOrg.SQUADRON, ISOrg.WING,
        ISOrg.SQUAD, ISOrg.PLATOON,
        ISOrg.SINGLE, ISOrg.LANCE, ISOrg.COMPANY, ISOrg.BATTALION, ISOrg.REGIMENT, ISOrg.BRIGADE,
    ];
}

class ComStarOrg {
    static getPointRange(comp: ForceComposition): PointRange {
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

    static readonly LEVEL_I = new ForceTypeRule({
        type: 'Level I', modifiers: [{ prefix: 'Demi-', count: 0.5 }, { prefix: '', count: 1 }], commandRank: 'Acolyte',
    });
    // Level II = N Level Is
    static readonly LEVEL_II = new ForceTypeRule({
        type: 'Level II', composedOf: ComStarOrg.LEVEL_I, modifiers: [
            { prefix: 'Thin ', count: 2 },
            { prefix: 'Half ', count: 3 },
            { prefix: 'Short ', count: 4 },
            { prefix: 'Under-Strength ', count: 5 },
            { prefix: '', count: 6 },
            { prefix: 'Reinforced ', count: 7 },
            { prefix: 'Fortified ', count: 8 },
            { prefix: 'Heavy ', count: 9 },
        ], commandRank: 'Adept',
    });
    // Level III = N Level IIs
    static readonly LEVEL_III = new ForceTypeRule({
        type: 'Level III', composedOf: ComStarOrg.LEVEL_II, modifiers: [
            { prefix: 'Under-Strength ', count: 5 },
            { prefix: '', count: 6 },
            { prefix: 'Reinforced ', count: 7 },
        ], commandRank: 'Adept (Demi-Precentor)',
    });
    // Level IV = N Level IIIs
    static readonly LEVEL_IV = new ForceTypeRule({
        type: 'Level IV', composedOf: ComStarOrg.LEVEL_III, modifiers: [
            { prefix: 'Under-Strength ', count: 5 },
            { prefix: '', count: 6 },
            { prefix: 'Reinforced ', count: 7 },
        ], commandRank: 'Precentor',
    });
    // Level V = N Level IVs
    static readonly LEVEL_V = new ForceTypeRule({
        type: 'Level V', composedOf: ComStarOrg.LEVEL_IV, modifiers: [
            { prefix: 'Under-Strength ', count: 5 },
            { prefix: '', count: 6 },
            { prefix: 'Reinforced ', count: 7 },
        ], commandRank: 'Precentor',
    });
    static readonly ALL: ForceTypeRule[] = [
        ComStarOrg.LEVEL_I, ComStarOrg.LEVEL_II, ComStarOrg.LEVEL_III,
        ComStarOrg.LEVEL_IV, ComStarOrg.LEVEL_V,
    ];
}

class SocietyOrg {
    static getPointRange(comp: ForceComposition): PointRange {
        const pts = comp.BM +
            (comp.BA_troopers / 9) +
            (comp.CI_troopers / 75) +
            (comp.PM / 3) +
            (comp.CV / 7) +
            (comp.AF / 3) +
            comp.other;
        return { min: pts, max: pts };
    }

    static readonly UN = new ForceTypeRule({
        type: 'Un', modifiers: [{ prefix: '', count: 1 }],
    });
    static readonly TREY = new ForceTypeRule({
        type: 'Trey', modifiers: [{ prefix: '', count: 3 }],
    });
    static readonly SEPT = new ForceTypeRule({
        type: 'Sept', modifiers: [{ prefix: '', count: 7 }],
    });
    static readonly ALL: ForceTypeRule[] = [
        SocietyOrg.UN, SocietyOrg.TREY, SocietyOrg.SEPT,
    ];
}

/**
 * Distance from a point range to a single point.
 * Returns 0 if the point is within the range.
 */
function rangeDistToPoint(range: PointRange, point: number): number {
    if (point >= range.min && point <= range.max) return 0;
    if (point < range.min) return range.min - point;
    return point - range.max;
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
    let bestNominal = 0;
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
                    bestNominal = rule.nominalPts;
                    bestType = rule.type;
                    // Perfect custom match = regular; otherwise derive from modifier table
                    bestModName = customDist === 0
                        ? ''
                        : rule.getModifierPrefix(range);
                }
                continue;
            }
            // customDist === -1: fall through to range-based evaluation
        }

        // Rule range from first to last modifier resolved pts
        const ruleMin = rule.resolveModPts(rule.modifiers[0]);
        const ruleMax = rule.resolveModPts(rule.modifiers[rule.modifiers.length - 1]);

        // Check overlap between force point range and rule modifier range
        if (range.max >= ruleMin && range.min <= ruleMax) {
            dist = 0;
        } else if (range.max < ruleMin) {
            dist = ruleMin - range.max;
        } else {
            dist = range.min - ruleMax;
        }

        if (rule.strict && dist !== 0) continue;

        // On equal distance, prefer the larger formation (higher nominalPts)
        if (dist < bestDist || (dist === bestDist && rule.nominalPts > bestNominal)) {
            bestDist = dist;
            bestNominal = rule.nominalPts;
            bestType = rule.type;
            bestModName = rule.getModifierPrefix(range);
        }
    }

    const maxAllowedDistance = Math.max(2, midPts * 0.2);
    if (bestDist <= maxAllowedDistance) {
        return bestModName ? bestModName + bestType : bestType;
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
        return evaluateForce(comp, ComStarOrg.ALL, ComStarOrg.getPointRange);
    } else if (factionName === 'Society') {
        return evaluateForce(comp, SocietyOrg.ALL, SocietyOrg.getPointRange);
    } else if (factionName.includes('Clan') || techBase === 'Clan') {
        return evaluateForce(comp, ClanOrg.ALL, ClanOrg.getPointRange);
    } else {
        return evaluateForce(comp, ISOrg.ALL, ISOrg.getPointRange);
    }
}
