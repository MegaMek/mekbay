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
import { GroupSizeResult } from './org-solver.util';

/*
 * Author: Drake
 *
 * Force org definitions: OrgType, OrgTypeRule, and all org classes
 * (ClanOrg, ISOrg, ComStarOrg, SocietyOrg, MHOrg).
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

    // Society-specific types
    | 'Un'
    | 'Trey'
    | 'Sept'

    // MH-specific types
    | 'Contubernium'
    | 'Century'
    | 'Maniple'
    | 'Cohort'
    | 'Legion';

export interface ForceComposition {
    BM: number;
    BA_troopers: number;
    CI_troopers: number;
    PM: number;
    CV: number;
    AF: number;
    other: number;
}

export function getForceComposition(units: ForceUnit[]): ForceComposition {
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

export function getForceCompositionFromRawUnits(units: Unit[]): ForceComposition {
    const comp: ForceComposition = {
        BM: 0,
        BA_troopers: 0,
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
export type ForceModifier = {
    prefix: string;   // '' for regular, Short, Under-Strength, Reinforced, etc.
    count: number;  // number of sub-units (or absolute pts for leaf rules)
};

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

export class OrgTypeRule {
    readonly type: OrgType;
    readonly modifiers: ForceModifier[];
    readonly composedOf?: OrgTypeRule;
    /**
     * For group-based force evaluation: accept groups matching ANY of these types.
     * E.g. Cluster accepts Binaries, Trinaries, or Supernovas (via countsAs aliases).
     * When set, this takes precedence over `composedOf` for group-based evaluation.
     * `composedOf` is still used for flat point-based evaluation.
     */
    readonly composedOfAny?: OrgType[];
    readonly commandRank?: string;
    readonly strict?: boolean;
    readonly filter?: (comp: ForceComposition) => boolean;
    readonly customMatch?: (comp: ForceComposition) => number;
    /**
     * For group-based force evaluation: this type also counts as another type.
     * E.g. a Nova also counts as a Star, so 2 Stars + 1 Nova = 3 Stars = Trinary.
     */
    readonly countsAs?: OrgType;
    /**
     * Explicit tie-breaker for group-based evaluation. Higher priority wins
     * when two rules match the same groups at equal distance. Defaults to 0.
     * E.g. Supernova Trinary (priority 1) beats Trinary (priority 0) when
     * both match 3 groups at dist 0.
     */
    readonly priority: number;
    /**
     * Group-level filter for group-based force evaluation.
     * Checked in evaluateForceByGroups — receives the array of group results
     * and returns false to skip this rule.  Use when a composed rule accepts
     * multiple group types (composedOfAny) but requires at least one group
     * of a specific type (e.g. Company requires at least 1 Lance).
     */
    readonly groupFilter?: (groups: ReadonlyArray<GroupSizeResult>) => boolean;
    private readonly _nominalPts: number; // Cached nominal pts

    constructor(config: {
        type: OrgType;
        modifiers: ForceModifier[];
        composedOf?: OrgTypeRule;
        composedOfAny?: OrgType[];
        commandRank?: string;
        strict?: boolean;
        filter?: (comp: ForceComposition) => boolean;
        customMatch?: (comp: ForceComposition) => number;
        countsAs?: OrgType;
        priority?: number;
        groupFilter?: (groups: ReadonlyArray<GroupSizeResult>) => boolean;
    }) {
        this.type = config.type;
        // Ensure modifiers are sorted ascending by count
        this.modifiers = [...config.modifiers].sort((a, b) => a.count - b.count);
        this.composedOf = config.composedOf;
        this.composedOfAny = config.composedOfAny;
        this.commandRank = config.commandRank;
        this.strict = config.strict;
        this.filter = config.filter;
        this.customMatch = config.customMatch;
        this.countsAs = config.countsAs;
        this.priority = config.priority ?? 0;
        this.groupFilter = config.groupFilter;

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

    /**
     * Find the best modifier prefix by comparing raw modifier counts (not resolved
     * through the composedOf chain). Used by group-based force evaluation where
     * the "points" are the number of sub-groups rather than unit points.
     */
    getModifierPrefixByRawCount(count: number): string {
        let closest = this.modifiers[0];
        let closestDist = Math.abs(count - closest.count);

        for (let i = 1; i < this.modifiers.length; i++) {
            const d = Math.abs(count - this.modifiers[i].count);
            if (d < closestDist) {
                closestDist = d;
                closest = this.modifiers[i];
            }
        }

        if (closestDist > 0 && closest.prefix === '') {
            if (count < closest.count) return 'Under-Strength ';
            return 'Reinforced ';
        }

        return closest.prefix;
    }
}

// ─── Org Definitions ───────────────────────────────────────────────────────────

class ClanOrg {
    /** Flat evaluation: max allowed distance as a fraction of midPts before falling back to "Force". */
    static readonly DISTANCE_FACTOR = 0.2;
    /** Flat evaluation: floor for the max allowed distance (pts). */
    static readonly MIN_DISTANCE = 2;

    /** Group evaluation: max allowed distance as a fraction of total group count before falling back to "Force". */
    static readonly GROUP_DISTANCE_FACTOR = 0.25;
    /** Group evaluation: floor for the max allowed distance (groups). */
    static readonly GROUP_MIN_DISTANCE = 1;

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

    static readonly POINT = new OrgTypeRule({
        type: 'Point', modifiers: [{ prefix: '', count: 1 }], commandRank: 'Point Commander',
    });
    // Star = N Points
    static readonly STAR = new OrgTypeRule({
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
    static readonly BINARY = new OrgTypeRule({
        type: 'Binary', strict: true, composedOf: ClanOrg.STAR,
        modifiers: [{ prefix: '', count: 2 }], commandRank: 'Star Captain',
    });
    // Trinary = 3 Stars
    static readonly TRINARY = new OrgTypeRule({
        type: 'Trinary', strict: true, composedOf: ClanOrg.STAR,
        modifiers: [{ prefix: '', count: 3 }], commandRank: 'Star Captain',
    });
    // Nova = Star of Mechs + Star of Infantry (counts as Star for force composition)
    static readonly NOVA = new OrgTypeRule({
        type: 'Nova', strict: true, countsAs: 'Star', modifiers: [{ prefix: '', count: 10 }], commandRank: 'Nova Commander',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 5) + Math.abs(infPoints - 5) + otherPoints;
        },
    });
    // Supernova Binary = 2 Novas (counts as Binary for force composition)
    static readonly SUPERNOVA_BINARY = new OrgTypeRule({
        type: 'Supernova Binary', strict: true, priority: 1, countsAs: 'Binary', composedOf: ClanOrg.NOVA, modifiers: [{ prefix: '', count: 2 }], commandRank: 'Nova Captain',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 10) + Math.abs(infPoints - 10) + otherPoints;
        },
    });
    // Supernova Trinary = 3 Novas (counts as Trinary for force composition)
    static readonly SUPERNOVA_TRINARY = new OrgTypeRule({
        type: 'Supernova Trinary', strict: true, priority: 1, countsAs: 'Trinary', composedOf: ClanOrg.NOVA, modifiers: [{ prefix: '', count: 3 }], commandRank: 'Nova Captain',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 15) + Math.abs(infPoints - 15) + otherPoints;
        },
    });
    // Cluster = N Binaries, Trinaries, or Supernovas (can mix and match)
    static readonly CLUSTER = new OrgTypeRule({
        type: 'Cluster', composedOf: ClanOrg.BINARY, // for flat point-based evaluation
        composedOfAny: ['Binary', 'Trinary'], // for group-based: accepts any Binary/Trinary-tier
        modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
            { prefix: 'Strong ', count: 5 },
        ], commandRank: 'Star Colonel',
    });
    // Galaxy = N Clusters
    static readonly GALAXY = new OrgTypeRule({
        type: 'Galaxy', composedOf: ClanOrg.CLUSTER, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
            { prefix: 'Strong ', count: 5 },
        ], commandRank: 'Galaxy Commander',
    });
    static readonly ALL: OrgTypeRule[] = [
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
    /** Flat evaluation: max allowed distance as a fraction of midPts before falling back to "Force". */
    static readonly DISTANCE_FACTOR = 0.2;
    /** Flat evaluation: floor for the max allowed distance (pts). */
    static readonly MIN_DISTANCE = 2;

    /** Group evaluation: max allowed distance as a fraction of total group count before falling back to "Force". */
    static readonly GROUP_DISTANCE_FACTOR = 0.25;
    /** Group evaluation: floor for the max allowed distance (groups). */
    static readonly GROUP_MIN_DISTANCE = 1;

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
    static readonly FLIGHT = new OrgTypeRule({
        type: 'Flight', modifiers: [
            { prefix: 'Under-Strength ', count: 1 },
            { prefix: '', count: 2 },
            { prefix: 'Reinforced ', count: 3 },
        ], commandRank: 'Lieutenant',
        filter: (comp) => isPureAero(comp),
    });
    static readonly SQUADRON = new OrgTypeRule({
        type: 'Squadron', composedOf: ISOrg.FLIGHT, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
        ], commandRank: 'Captain',
        filter: (comp) => isPureAero(comp),
    });
    static readonly WING = new OrgTypeRule({
        type: 'Wing', composedOf: ISOrg.SQUADRON, countsAs: 'Battalion', modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
        ], commandRank: 'Major',
        filter: (comp) => isPureAero(comp),
    });
    static readonly SQUAD = new OrgTypeRule({
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
    static readonly SINGLE = new OrgTypeRule({
        type: 'Single', modifiers: [{ prefix: '', count: 1 }],
        filter: (comp) => !isPureAero(comp) && !isPureInfantry(comp),
    });
    static readonly LANCE = new OrgTypeRule({
        type: 'Lance', composedOf: ISOrg.SINGLE, modifiers: [
            { prefix: 'Short ', count: 2 },
            { prefix: 'Under-Strength ', count: 3 },
            { prefix: '', count: 4 },
            { prefix: 'Reinforced ', count: 5 },
            { prefix: 'Fortified ', count: 6 },
        ], commandRank: 'Lieutenant', filter: (comp) => !isPureAero(comp) && !isPureInfantry(comp),
    });
    static readonly PLATOON = new OrgTypeRule({
        type: 'Platoon', countsAs: 'Lance', priority: 1, modifiers: [{ prefix: '', count: 1 }], commandRank: 'Lieutenant',
        filter: (comp) => isPureInfantry(comp),
        customMatch: (comp) => {
            if (comp.CI_troopers >= 6 && comp.CI_troopers <= 32) return 0;
            if (comp.CI_troopers < 6) return (6 - comp.CI_troopers) / 28;
            return (comp.CI_troopers - 32) / 28;
        },
    });
    // Company = N Lances
    static readonly COMPANY = new OrgTypeRule({
        type: 'Company', composedOf: ISOrg.LANCE, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
        ], commandRank: 'Captain', filter: (comp) => !isPureAero(comp),
    });
    // Battalion = N Companies
    static readonly BATTALION = new OrgTypeRule({
        type: 'Battalion', composedOf: ISOrg.COMPANY, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
        ], commandRank: 'Major', filter: (comp) => !isPureAero(comp),
    });
    // Regiment = N Battalions
    static readonly REGIMENT = new OrgTypeRule({
        type: 'Regiment', composedOf: ISOrg.BATTALION, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
            { prefix: 'Strong ', count: 5 },
        ], commandRank: 'Colonel', filter: (comp) => !isPureAero(comp),
    });
    // Brigade = N Regiments
    static readonly BRIGADE = new OrgTypeRule({
        type: 'Brigade', composedOf: ISOrg.REGIMENT, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
        ], commandRank: 'General', filter: (comp) => !isPureAero(comp),
    });
    static readonly ALL: OrgTypeRule[] = [
        ISOrg.FLIGHT, ISOrg.SQUADRON, ISOrg.WING,
        ISOrg.SQUAD, ISOrg.PLATOON,
        ISOrg.SINGLE, ISOrg.LANCE, ISOrg.COMPANY, ISOrg.BATTALION, ISOrg.REGIMENT, ISOrg.BRIGADE,
    ];
}

class ComStarOrg {
    /** Flat evaluation: max allowed distance as a fraction of midPts before falling back to "Force". */
    static readonly DISTANCE_FACTOR = 0.2;
    /** Flat evaluation: floor for the max allowed distance (pts). */
    static readonly MIN_DISTANCE = 2;

    /** Group evaluation: max allowed distance as a fraction of total group count before falling back to "Force". */
    static readonly GROUP_DISTANCE_FACTOR = 0.25;
    /** Group evaluation: floor for the max allowed distance (groups). */
    static readonly GROUP_MIN_DISTANCE = 1;

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

    static readonly LEVEL_I = new OrgTypeRule({
        type: 'Level I', modifiers: [{ prefix: 'Demi-', count: 0.5 }, { prefix: '', count: 1 }], commandRank: 'Acolyte',
    });
    // Level II = N Level Is
    static readonly LEVEL_II = new OrgTypeRule({
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
    static readonly LEVEL_III = new OrgTypeRule({
        type: 'Level III', composedOf: ComStarOrg.LEVEL_II, modifiers: [
            { prefix: 'Under-Strength ', count: 5 },
            { prefix: '', count: 6 },
            { prefix: 'Reinforced ', count: 7 },
        ], commandRank: 'Adept (Demi-Precentor)',
    });
    // Level IV = N Level IIIs
    static readonly LEVEL_IV = new OrgTypeRule({
        type: 'Level IV', composedOf: ComStarOrg.LEVEL_III, modifiers: [
            { prefix: 'Under-Strength ', count: 5 },
            { prefix: '', count: 6 },
            { prefix: 'Reinforced ', count: 7 },
        ], commandRank: 'Precentor',
    });
    // Level V = N Level IVs
    static readonly LEVEL_V = new OrgTypeRule({
        type: 'Level V', composedOf: ComStarOrg.LEVEL_IV, modifiers: [
            { prefix: 'Under-Strength ', count: 5 },
            { prefix: '', count: 6 },
            { prefix: 'Reinforced ', count: 7 },
        ], commandRank: 'Precentor',
    });
    static readonly ALL: OrgTypeRule[] = [
        ComStarOrg.LEVEL_I, ComStarOrg.LEVEL_II, ComStarOrg.LEVEL_III,
        ComStarOrg.LEVEL_IV, ComStarOrg.LEVEL_V,
    ];
}

class SocietyOrg {
    /** Flat evaluation: max allowed distance as a fraction of midPts before falling back to "Force". */
    static readonly DISTANCE_FACTOR = 0.2;
    /** Flat evaluation: floor for the max allowed distance (pts). */
    static readonly MIN_DISTANCE = 2;

    /** Group evaluation: max allowed distance as a fraction of total group count before falling back to "Force". */
    static readonly GROUP_DISTANCE_FACTOR = 0.25;
    /** Group evaluation: floor for the max allowed distance (groups). */
    static readonly GROUP_MIN_DISTANCE = 1;

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

    static readonly UN = new OrgTypeRule({
        type: 'Un', modifiers: [{ prefix: '', count: 1 }],
    });
    static readonly TREY = new OrgTypeRule({
        type: 'Trey', modifiers: [{ prefix: '', count: 3 }],
    });
    static readonly SEPT = new OrgTypeRule({
        type: 'Sept', modifiers: [{ prefix: '', count: 7 }],
    });
    static readonly ALL: OrgTypeRule[] = [
        SocietyOrg.UN, SocietyOrg.TREY, SocietyOrg.SEPT,
    ];
}

class MHOrg {
    /** Flat evaluation: max allowed distance as a fraction of midPts before falling back to "Force". */
    static readonly DISTANCE_FACTOR = 0.2;
    /** Flat evaluation: floor for the max allowed distance (pts). */
    static readonly MIN_DISTANCE = 2;

    /** Group evaluation: max allowed distance as a fraction of total group count before falling back to "Force". */
    static readonly GROUP_DISTANCE_FACTOR = 0.5;
    /** Group evaluation: floor for the max allowed distance (groups). */
    static readonly GROUP_MIN_DISTANCE = 1;

    static getPointRange(comp: ForceComposition): PointRange {
        const fixed = comp.BM +
            (comp.BA_troopers / 5) +
            comp.PM +
            comp.CV +
            comp.AF +
            comp.other;
        // MH infantry platoon = 5-10 troopers per point
        // Dividing by 10 = minimum pts; dividing by 5 = maximum pts
        return {
            min: fixed + comp.CI_troopers / 10,
            max: fixed + comp.CI_troopers / 5,
        };
    }
    static readonly CONTUBERNIUM = new OrgTypeRule({
        type: 'Contubernium', modifiers: [{ prefix: '', count: 1 }], commandRank: 'Miles probatus',
    });
    // Century = N Contubernii
    static readonly CENTURY = new OrgTypeRule({
        type: 'Century', composedOf: MHOrg.CONTUBERNIUM, modifiers: [
            { prefix: 'Half ', count: 2 },
            { prefix: 'Short ', count: 3 },
            { prefix: 'Under-Strength ', count: 4 },
            { prefix: '', count: 5 },
            { prefix: 'Reinforced ', count: 6 },
            { prefix: 'Fortified ', count: 7 },
        ], commandRank: 'Centurion',
        filter: (comp) => !isPureInfantry(comp),
    });
    // Century (Infantry) = 4-10 CI infantry Points
    static readonly CENTURY_INF = new OrgTypeRule({
        type: 'Century', composedOf: MHOrg.CONTUBERNIUM, modifiers: [
            { prefix: '', count: 4 },
            { prefix: '', count: 10 },
        ], commandRank: 'Centurion',
        filter: (comp) => isPureInfantry(comp),
    });
    // Maniple = 2 Century
    static readonly MANIPLE = new OrgTypeRule({
        type: 'Maniple', strict: true,
        composedOf: MHOrg.CENTURY, modifiers: [
            { prefix: '', count: 2 }
        ], commandRank: 'Principes',
    });
    // Cohort = N Maniples
    static readonly COHORT = new OrgTypeRule({
        type: 'Cohort', composedOf: MHOrg.MANIPLE,
        modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
            { prefix: 'Strong ', count: 5 },
        ], commandRank: 'Legatus',
    });
    // Legion = N Cohorts
    static readonly LEGION = new OrgTypeRule({
        type: 'Legion', composedOf: MHOrg.COHORT, modifiers: [
            { prefix: 'Under-Strength ', count: 2 },
            { prefix: '', count: 3 },
            { prefix: 'Reinforced ', count: 4 },
            { prefix: 'Strong ', count: 5 },
        ], commandRank: 'General',
    });
    static readonly ALL: OrgTypeRule[] = [
        MHOrg.CONTUBERNIUM, MHOrg.CENTURY, MHOrg.CENTURY_INF,
        MHOrg.MANIPLE, MHOrg.COHORT, MHOrg.LEGION,
    ];
}

class WDOrg {
    /** Flat evaluation: max allowed distance as a fraction of midPts before falling back to "Force". */
    static readonly DISTANCE_FACTOR = 0.2;
    /** Flat evaluation: floor for the max allowed distance (pts). */
    static readonly MIN_DISTANCE = 2;

    /** Group evaluation: max allowed distance as a fraction of total group count before falling back to "Force". */
    static readonly GROUP_DISTANCE_FACTOR = 0.25;
    /** Group evaluation: floor for the max allowed distance (groups). */
    static readonly GROUP_MIN_DISTANCE = 1;

    static getPointRange(comp: ForceComposition): PointRange {
        const fixed = comp.BM +
            (comp.BA_troopers / 5) +
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
    static readonly FLIGHT = ISOrg.FLIGHT;
    static readonly SQUADRON = new OrgTypeRule({
        ...ISOrg.SQUADRON, composedOf: WDOrg.FLIGHT,
    });
    static readonly WING = new OrgTypeRule({
        ...ISOrg.WING, composedOf: WDOrg.SQUADRON,
    });
    static readonly SQUAD = new OrgTypeRule({
        ...ISOrg.SQUAD, filter: (comp) => comp.BA_troopers === 0,
    });
    static readonly POINT = new OrgTypeRule({
        type: 'Point', modifiers: [{ prefix: '', count: 1 }], commandRank: 'Sergeant',
        filter: (comp) => comp.AF === 0 && comp.CI_troopers === 0, // excluded Aero (Flights) and Conventional Infantry (Squads)
    });
    static readonly LANCE = new OrgTypeRule({
        type: 'Lance', composedOf: WDOrg.POINT, modifiers: [
            { prefix: 'Short ', count: 2 },
            { prefix: 'Under-Strength ', count: 3 },
            { prefix: '', count: 4 },
            { prefix: 'Reinforced ', count: 5 },
            { prefix: 'Fortified ', count: 6 },
        ], commandRank: 'Lieutenant', filter: (comp) => !isPureAero(comp) && comp.BA_troopers === 0 && comp.BM <= 4, // BA can only be part of Stars, 2-4 BM are part of Lances
    });
    static readonly PLATOON = new OrgTypeRule({
        ...ISOrg.PLATOON, countsAs: 'Lance', filter: (comp) => comp.BA_troopers === 0,
    });
    // Star = N Points
    static readonly STAR = new OrgTypeRule({
        type: 'Star', composedOf: WDOrg.POINT, modifiers: [
            { prefix: 'Half ', count: 2 },
            { prefix: 'Short ', count: 3 },
            { prefix: 'Under-Strength ', count: 4 },
            { prefix: '', count: 5 },
            { prefix: 'Reinforced ', count: 6 },
            { prefix: 'Fortified ', count: 7 },
        ], commandRank: 'Lieutenant', filter: (comp) => comp.CV === 0 && (comp.BA_troopers > 0 || comp.BM > 4), // Vehicles can only be part of Lances, 5-7 BM are part of Stars
    });
    // Nova = Star of Mechs + Star of Infantry (counts as Star for force composition)
    static readonly NOVA = new OrgTypeRule({
        ...ClanOrg.NOVA, countsAs: 'Star', composedOf: WDOrg.POINT, commandRank: 'Lieutenant',
         // Added composedOf to filter out AF and CI
        filter: (comp) => comp.BM > 0 && (comp.BA_troopers / 5) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5);
            const otherPoints = (comp.PM / 5) + comp.CV + comp.other;
            return Math.abs(comp.BM - 5) + Math.abs(infPoints - 5) + otherPoints;
        },
    });
    static readonly COMPANY = new OrgTypeRule({
        ...ISOrg.COMPANY, composedOf: WDOrg.LANCE,
        composedOfAny: ['Lance', 'Star'], // allowed Stars (and Novas) to be part of a company if there is at least 1 Lance
        groupFilter: (groups) => groups.some(g => g.type === 'Lance' || g.countsAsType === 'Lance'),
    });
    // Binary = 2 Stars
    static readonly BINARY = new OrgTypeRule({
        ...ClanOrg.BINARY, countsAs: 'Company', composedOf: WDOrg.STAR, commandRank: 'Captain',
        filter: (comp) => !isPureAero(comp),
    });
    // Trinary = 3 Stars
    static readonly TRINARY = new OrgTypeRule({
        ...ClanOrg.TRINARY, countsAs: 'Company', composedOf: WDOrg.STAR,
        commandRank: 'Captain',
        filter: (comp) => !isPureAero(comp),
    });
    // Supernova Binary = 2 Novas (counts as Binary for force composition)
    static readonly SUPERNOVA_BINARY = new OrgTypeRule({
        ...ClanOrg.SUPERNOVA_BINARY, countsAs: 'Binary', composedOf: WDOrg.NOVA,
        commandRank: 'Captain',
        filter: (comp) => comp.BM > 0 && (comp.BA_troopers / 5) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5);
            const otherPoints = (comp.PM / 5) + comp.CV + comp.other;
            return Math.abs(comp.BM - 10) + Math.abs(infPoints - 10) + otherPoints;
        },
    });
    // Supernova Trinary = 3 Novas (counts as Trinary for force composition)
    static readonly SUPERNOVA_TRINARY = new OrgTypeRule({
        ...ClanOrg.SUPERNOVA_TRINARY, countsAs: 'Trinary', composedOf: WDOrg.NOVA, commandRank: 'Captain',
        filter: (comp) => comp.BM > 0 && (comp.BA_troopers / 5) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5);
            const otherPoints = (comp.PM / 5) + comp.CV + comp.other;
            return Math.abs(comp.BM - 15) + Math.abs(infPoints - 15) + otherPoints;
        },
    });
    // Battalion = N Companies
    static readonly BATTALION = new OrgTypeRule({
        ...ISOrg.BATTALION, composedOf: WDOrg.COMPANY,
        composedOfAny: ['Company', 'Binary', 'Trinary'], // allowed Binaries and Trinaries (and Supernovas) to be part of a Battalion if there is at least 1 Company
        filter: (comp) => !isPureAero(comp),
        groupFilter: (groups) => groups.some(g => g.type === 'Company' || g.countsAsType === 'Company'),
    });
    // Cluster = N Binaries, Trinaries, or Supernovas (can mix and match)
    static readonly CLUSTER = new OrgTypeRule({
        ...ClanOrg.CLUSTER, priority: 1, composedOf: WDOrg.BINARY, // for flat point-based evaluation
        countsAs: 'Battalion', commandRank: 'Major',
        filter: (comp) => !isPureAero(comp),
    });
    // Regiment = N Battalions
    static readonly REGIMENT = new OrgTypeRule({
        ...ISOrg.REGIMENT, composedOf: WDOrg.BATTALION,
    });
    static readonly ALL: OrgTypeRule[] = [
        WDOrg.FLIGHT, WDOrg.SQUADRON, WDOrg.WING,
        WDOrg.SQUAD, WDOrg.PLATOON,
        WDOrg.NOVA, WDOrg.SUPERNOVA_BINARY, WDOrg.SUPERNOVA_TRINARY,
        WDOrg.POINT, WDOrg.LANCE, WDOrg.STAR, WDOrg.BINARY, WDOrg.TRINARY,
        WDOrg.CLUSTER, WDOrg.COMPANY, WDOrg.BATTALION, WDOrg.REGIMENT,
    ];
}

// ─── Org Resolution ────────────────────────────────────────────────────────────

/**
 * Shared shape for all org classes (ClanOrg, ISOrg, ComStarOrg, etc.).
 */
export interface OrgDefinition {
    readonly ALL: OrgTypeRule[];
    readonly DISTANCE_FACTOR: number;
    readonly MIN_DISTANCE: number;
    readonly GROUP_DISTANCE_FACTOR: number;
    readonly GROUP_MIN_DISTANCE: number;
    getPointRange(comp: ForceComposition): PointRange;
}

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
    { match: (_, f) => f.includes('Clan'), org: ClanOrg },
    { match: (_, f) => f.includes('Rasalhague Dominion') || f.includes('Wolf Empire') || f.includes('Escorpion') || f.includes('Scorpion Empire'), org: ClanOrg },
    // ISOrg is the default fallback if no other org matches
];

export const DEFAULT_ORG: OrgDefinition = ISOrg;