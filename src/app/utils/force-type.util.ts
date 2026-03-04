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
    /**
     * For group-based force evaluation: accept groups matching ANY of these types.
     * E.g. Cluster accepts Binaries, Trinaries, or Supernovas (via countsAs aliases).
     * When set, this takes precedence over `composedOf` for group-based evaluation.
     * `composedOf` is still used for flat point-based evaluation.
     */
    readonly composedOfAny?: ForceTypeRule[];
    readonly commandRank?: string;
    readonly strict?: boolean;
    readonly filter?: (comp: ForceComposition) => boolean;
    readonly customMatch?: (comp: ForceComposition) => number;
    /**
     * For group-based force evaluation: this type also counts as another type.
     * E.g. a Nova also counts as a Star, so 2 Stars + 1 Nova = 3 Stars = Trinary.
     */
    readonly countsAs?: ForceTypeRule;
    /**
     * Explicit tie-breaker for group-based evaluation. Higher priority wins
     * when two rules match the same groups at equal distance. Defaults to 0.
     * E.g. Supernova Trinary (priority 1) beats Trinary (priority 0) when
     * both match 3 groups at dist 0.
     */
    readonly priority: number;
    private readonly _nominalPts: number; // Cached nominal pts

    constructor(config: {
        type: ForceType;
        modifiers: ForceModifier[];
        composedOf?: ForceTypeRule;
        composedOfAny?: ForceTypeRule[];
        commandRank?: string;
        strict?: boolean;
        filter?: (comp: ForceComposition) => boolean;
        customMatch?: (comp: ForceComposition) => number;
        countsAs?: ForceTypeRule;
        priority?: number;
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
        type: 'Binary', strict: true, composedOf: ClanOrg.STAR,
        modifiers: [{ prefix: '', count: 2 }], commandRank: 'Star Captain',
    });
    // Trinary = 3 Stars
    static readonly TRINARY = new ForceTypeRule({
        type: 'Trinary', strict: true, composedOf: ClanOrg.STAR,
        modifiers: [{ prefix: '', count: 3 }], commandRank: 'Star Captain',
    });
    // Nova = Star of Mechs + Star of Infantry (counts as Star for force composition)
    static readonly NOVA = new ForceTypeRule({
        type: 'Nova', strict: true, countsAs: ClanOrg.STAR, modifiers: [{ prefix: '', count: 10 }], commandRank: 'Nova Commander',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 5) + Math.abs(infPoints - 5) + otherPoints;
        },
    });
    // Supernova Binary = 2 Novas (counts as Binary for force composition)
    static readonly SUPERNOVA_BINARY = new ForceTypeRule({
        type: 'Supernova Binary', strict: true, priority: 1, countsAs: ClanOrg.BINARY, composedOf: ClanOrg.NOVA, modifiers: [{ prefix: '', count: 2 }], commandRank: 'Nova Captain',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 10) + Math.abs(infPoints - 10) + otherPoints;
        },
    });
    // Supernova Trinary = 3 Novas (counts as Trinary for force composition)
    static readonly SUPERNOVA_TRINARY = new ForceTypeRule({
        type: 'Supernova Trinary', strict: true, priority: 1, countsAs: ClanOrg.TRINARY, composedOf: ClanOrg.NOVA, modifiers: [{ prefix: '', count: 3 }], commandRank: 'Nova Captain',
        filter: (comp) => comp.BM > 0 && ((comp.BA_troopers / 5) + (comp.CI_troopers / 25)) > 0,
        customMatch: (comp) => {
            const infPoints = (comp.BA_troopers / 5) + (comp.CI_troopers / 25);
            const otherPoints = (comp.PM / 5) + (comp.CV / 2) + (comp.AF / 2) + comp.other;
            return Math.abs(comp.BM - 15) + Math.abs(infPoints - 15) + otherPoints;
        },
    });
    // Cluster = N Binaries, Trinaries, or Supernovas (can mix and match)
    static readonly CLUSTER = new ForceTypeRule({
        type: 'Cluster', composedOf: ClanOrg.BINARY, // for flat point-based evaluation
        composedOfAny: [ClanOrg.BINARY, ClanOrg.TRINARY, ClanOrg.SUPERNOVA_BINARY], // for group-based: accepts any Binary/Trinary-tier
        modifiers: [
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

/** Internal result of a force evaluation, carrying the distance for comparison. */
interface EvaluationResult {
    name: string;
    dist: number;
    matchedRule: ForceTypeRule | null;
}

/**
 * Exported result of a group-level size evaluation.
 * Carries the matched ForceType so force-level evaluation can
 * count groups by type without re-evaluating them.
 */
export interface GroupSizeResult {
    name: string;
    type: ForceType | null;
    /** Alias type for group-based counting (e.g. Nova also counts as Star). */
    countsAsType: ForceType | null;
}

/**
 * Core evaluation: given a composition, find the best-matching rule and modifier.
 * Returns the full result including distance so callers can compare approaches.
 */
function evaluateForceDetailed(
    comp: ForceComposition,
    rules: ForceTypeRule[],
    getPointRange: (comp: ForceComposition) => PointRange,
    minDistance = 2,
    distanceFactor = 0.2,
): EvaluationResult {
    const range = getPointRange(comp);
    const midPts = (range.min + range.max) / 2;

    if (range.max === 0) return { name: 'Force', dist: Infinity, matchedRule: null };

    let bestType: string = 'Force';
    let bestDist = Infinity;
    let bestNominal = 0;
    let bestModName = '';
    let bestRule: ForceTypeRule | null = null;

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
                    bestRule = rule;
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
            bestRule = rule;
            bestModName = rule.getModifierPrefix(range);
        }
    }

    const maxAllowedDistance = Math.max(minDistance, midPts * distanceFactor);
    if (bestDist <= maxAllowedDistance) {
        const name = bestModName ? bestModName + bestType : bestType;
        return { name, dist: bestDist, matchedRule: bestRule };
    }

    return { name: 'Force', dist: Infinity, matchedRule: null };
}

/**
 * Group-based force evaluation.
 *
 * Instead of flattening all units, this evaluates each group individually,
 * then counts how many groups matched each rule type. It looks for higher-level
 * rules whose `composedOf` type equals a group type and matches the group count
 * against the rule's raw modifier counts (without the composedOf multiplication).
 *
 * Example: 6 groups each identified as "Level II" → Level III has
 * composedOf = Level II and modifier count 6 → "Level III".
 */
function evaluateForceByGroups(
    groupResults: GroupSizeResult[],
    rules: ForceTypeRule[],
    groupMinDistance = 1,
    groupDistanceFactor = 0.25,
): EvaluationResult {
    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (const rule of rules) {
        // Determine which types this rule accepts as sub-units for group-based evaluation.
        // composedOfAny takes precedence (e.g. Cluster accepts Binaries OR Trinaries),
        // otherwise fall back to the single composedOf type.
        const acceptedTypes = rule.composedOfAny
            ? rule.composedOfAny
            : rule.composedOf
                ? [rule.composedOf]
                : [];
        if (acceptedTypes.length === 0) continue;

        // Count groups matching any accepted type (each group counted at most once).
        // A group matches if its direct type OR its countsAs alias is in the accepted set.
        const acceptedTypeSet = new Set(acceptedTypes.map(r => r.type));
        let count = 0;
        for (const result of groupResults) {
            if (result.type && acceptedTypeSet.has(result.type)) {
                count++;
            } else if (result.countsAsType && acceptedTypeSet.has(result.countsAsType)) {
                count++;
            }
        }
        if (count === 0) continue;

        // Compare group count against raw modifier counts (not resolved through composedOf)
        const rawMin = rule.modifiers[0].count;
        const rawMax = rule.modifiers[rule.modifiers.length - 1].count;

        let dist: number;
        if (count >= rawMin && count <= rawMax) {
            dist = 0;
        } else if (count < rawMin) {
            dist = rawMin - count;
        } else {
            dist = count - rawMax;
        }

        // Penalize for groups not accounted for by this rule.
        // E.g. Supernova Binary expects 2 Novas — if there's also a Binary group,
        // that unmatched group adds 1 to the distance so more inclusive rules can win.
        const unmatchedCount = groupResults.length - count;
        dist += unmatchedCount;

        const bestPriority = best.matchedRule?.priority ?? 0;
        if (dist < best.dist ||
            (dist === best.dist && rule.priority > bestPriority) ||
            (dist === best.dist && rule.priority === bestPriority && rule.nominalPts > (best.matchedRule?.nominalPts ?? 0))) {
            const modPrefix = rule.getModifierPrefixByRawCount(count);
            best = {
                name: modPrefix ? modPrefix + rule.type : rule.type,
                dist,
                matchedRule: rule,
            };
        }
    }

    const maxAllowed = Math.max(groupMinDistance, groupResults.length * groupDistanceFactor);
    if (best.dist <= maxAllowed) {
        return best;
    }

    return { name: 'Force', dist: Infinity, matchedRule: null };
}

/**
 * Hierarchical group split: when direct group evaluation doesn't find a good
 * match, try splitting groups into K sub-batches, evaluate each batch to find
 * an intermediate formation, then see if K intermediate formations compose
 * into a higher-level formation.
 *
 * Example: 4 Novas => K=2 => [Nova,Nova] + [Nova,Nova]
 *   => each batch = Supernova Binary (2 Novas) => 2 x SN Binary
 *   => SN Binary countsAs Binary => Under-Strength Cluster (2 Binaries).
 */
function trySplitGroupEvaluation(
    groupResults: GroupSizeResult[],
    rules: ForceTypeRule[],
    groupMinDistance: number,
    groupDistanceFactor: number,
): EvaluationResult {
    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (let k = 2; k <= 5; k++) {
        if (groupResults.length < k * 2) break; // Need at least 2 groups per batch

        const batchSize = Math.floor(groupResults.length / k);
        const remainder = groupResults.length % k;

        // Split into K batches
        const batches: GroupSizeResult[][] = [];
        let offset = 0;
        for (let i = 0; i < k; i++) {
            const size = batchSize + (i < remainder ? 1 : 0);
            batches.push(groupResults.slice(offset, offset + size));
            offset += size;
        }

        // Evaluate each batch via group-based evaluation
        const batchResults: GroupSizeResult[] = [];
        let allMatched = true;
        for (const batch of batches) {
            const result = evaluateForceByGroups(batch, rules, groupMinDistance, groupDistanceFactor);
            if (!result.matchedRule) {
                allMatched = false;
                break;
            }
            batchResults.push({
                name: result.name,
                type: result.matchedRule.type,
                countsAsType: result.matchedRule.countsAs?.type ?? null,
            });
        }
        if (!allMatched) continue;

        // Evaluate the batch results as a higher-level grouping
        const higherResult = evaluateForceByGroups(batchResults, rules, groupMinDistance, groupDistanceFactor);
        if (higherResult.matchedRule &&
            (higherResult.dist < best.dist ||
             (higherResult.dist === best.dist &&
              (higherResult.matchedRule.nominalPts) > (best.matchedRule?.nominalPts ?? 0)))) {
            best = higherResult;
        }

        if (best.dist === 0) break;
    }

    return best;
}

/**
 * Evaluate a virtual point value against rules, skipping customMatch.
 * Only matches when the point falls within a rule's modifier range (dist === 0).
 * Used by the virtual split fallback to identify what type a sub-group of
 * a given size would be without knowing the actual unit composition.
 */
function evaluateVirtualGroup(
    pts: number,
    rules: ForceTypeRule[],
    comp: ForceComposition,
): EvaluationResult {
    let bestRule: ForceTypeRule | null = null;
    let bestNominal = 0;

    for (const rule of rules) {
        // Skip rules requiring per-sub-group composition (e.g. Nova's BM+BA split)
        if (rule.customMatch) continue;

        // Apply composition filters so we don't match e.g. Lance for pure-aero groups
        if (rule.filter && !rule.filter(comp)) continue;

        const ruleMin = rule.resolveModPts(rule.modifiers[0]);
        const ruleMax = rule.resolveModPts(rule.modifiers[rule.modifiers.length - 1]);

        // Only accept when the point falls within the modifier range
        if (pts < ruleMin || pts > ruleMax) continue;

        // Prefer the rule with higher nominalPts (larger formation)
        if (!bestRule || rule.nominalPts > bestNominal) {
            bestNominal = rule.nominalPts;
            bestRule = rule;
        }
    }

    if (bestRule) {
        return { name: bestRule.type, dist: 0, matchedRule: bestRule };
    }
    return { name: 'Force', dist: Infinity, matchedRule: null };
}

/**
 * Virtual split fallback: when flat evaluation fails to identify a group,
 * try splitting the total points into K equal sub-groups and check if those
 * virtual sub-groups form a recognized composed formation.
 *
 * Example: 11 Clan pts → K=2 → 5.5 each → Star (within 2–7) → 2 Stars → Binary.
 * Example: 16 Clan pts → K=2 → 8 each → no match; K=3 → 5.33 → Star → 3 Stars → Trinary.
 */
function trySplitEvaluation(
    pts: number,
    rules: ForceTypeRule[],
    comp: ForceComposition,
): EvaluationResult {
    let best: EvaluationResult = { name: 'Force', dist: Infinity, matchedRule: null };

    for (let k = 2; k <= 5; k++) {
        const subPts = pts / k;
        if (subPts < 1) break; // Sub-groups too small to match anything meaningful

        const subResult = evaluateVirtualGroup(subPts, rules, comp);
        if (!subResult.matchedRule) continue;

        // Build K identical virtual group results
        const virtualResults: GroupSizeResult[] = [];
        for (let i = 0; i < k; i++) {
            virtualResults.push({
                name: subResult.name,
                type: subResult.matchedRule.type,
                countsAsType: subResult.matchedRule.countsAs?.type ?? null,
            });
        }

        // Check if K groups of this type match a composed rule
        const groupResult = evaluateForceByGroups(virtualResults, rules);
        if (groupResult.matchedRule &&
            (groupResult.dist < best.dist ||
             (groupResult.dist === best.dist &&
              (groupResult.matchedRule.nominalPts) > (best.matchedRule?.nominalPts ?? 0)))) {
            best = groupResult;
        }

        // Prefer fewer, larger sub-groups: stop on first perfect match
        if (best.dist === 0) break;
    }

    return best;
}

/**
 * Determine the force organizational type (Lance, Company, Star, etc.)
 * based on the number of units, their composition, average tech base, and faction.
 */
/**
 * Resolve the org rules and point-range function for the given tech base / faction.
 */
interface OrgConfig {
    rules: ForceTypeRule[];
    getPointRange: (comp: ForceComposition) => PointRange;
    minDistance: number;
    distanceFactor: number;
    groupMinDistance: number;
    groupDistanceFactor: number;
}

function resolveOrg(techBase: string, factionName: string): OrgConfig {
    if (factionName === 'ComStar' || factionName === 'Word of Blake') {
        return { rules: ComStarOrg.ALL, getPointRange: ComStarOrg.getPointRange, minDistance: ComStarOrg.MIN_DISTANCE, distanceFactor: ComStarOrg.DISTANCE_FACTOR, groupMinDistance: ComStarOrg.GROUP_MIN_DISTANCE, groupDistanceFactor: ComStarOrg.GROUP_DISTANCE_FACTOR };
    } else if (factionName === 'Society') {
        return { rules: SocietyOrg.ALL, getPointRange: SocietyOrg.getPointRange, minDistance: SocietyOrg.MIN_DISTANCE, distanceFactor: SocietyOrg.DISTANCE_FACTOR, groupMinDistance: SocietyOrg.GROUP_MIN_DISTANCE, groupDistanceFactor: SocietyOrg.GROUP_DISTANCE_FACTOR };
    } else if (factionName.includes('Clan') || techBase === 'Clan') {
        return { rules: ClanOrg.ALL, getPointRange: ClanOrg.getPointRange, minDistance: ClanOrg.MIN_DISTANCE, distanceFactor: ClanOrg.DISTANCE_FACTOR, groupMinDistance: ClanOrg.GROUP_MIN_DISTANCE, groupDistanceFactor: ClanOrg.GROUP_DISTANCE_FACTOR };
    } else {
        return { rules: ISOrg.ALL, getPointRange: ISOrg.getPointRange, minDistance: ISOrg.MIN_DISTANCE, distanceFactor: ISOrg.DISTANCE_FACTOR, groupMinDistance: ISOrg.GROUP_MIN_DISTANCE, groupDistanceFactor: ISOrg.GROUP_DISTANCE_FACTOR };
    }
}

/**
 * Evaluate a single group of units and return the structural result
 * (name + matched ForceType). This is the data each UnitGroup can cache
 * in a computed signal so the force-level evaluator doesn't redo it.
 */
export function getGroupSizeResult(units: ForceUnit[], techBase: string, factionName: string): GroupSizeResult {
    if (units.length === 0) return { name: 'Force', type: null, countsAsType: null };
    const { rules, getPointRange, minDistance, distanceFactor } = resolveOrg(techBase, factionName);
    const comp = getForceComposition(units);
    let result = evaluateForceDetailed(comp, rules, getPointRange, minDistance, distanceFactor);

    // Virtual split fallback: if flat evaluation didn't find a match,
    // try splitting points into equal sub-groups to find a composed formation.
    // E.g. 11 Clan pts → 2 × 5.5 → 2 Stars → Binary.
    if (!result.matchedRule) {
        const range = getPointRange(comp);
        const midPts = (range.min + range.max) / 2;
        if (midPts > 0) {
            const splitResult = trySplitEvaluation(midPts, rules, comp);
            if (splitResult.matchedRule) {
                result = splitResult;
            }
        }
    }

    return {
        name: result.name,
        type: result.matchedRule?.type ?? null,
        countsAsType: result.matchedRule?.countsAs?.type ?? null,
    };
}

export function getForceSizeName(units: ForceUnit[], techBase: string, factionName: string, groupResults?: GroupSizeResult[]): string {
    if (units.length === 0) return 'Force';

    const { rules, getPointRange, minDistance, distanceFactor, groupMinDistance, groupDistanceFactor } = resolveOrg(techBase, factionName);
    const comp = getForceComposition(units);
    const flatResult = evaluateForceDetailed(comp, rules, getPointRange, minDistance, distanceFactor);

    // When pre-computed group results are provided with >1 group, also try group-based evaluation
    if (groupResults && groupResults.length > 1) {
        let groupResult = evaluateForceByGroups(groupResults, rules, groupMinDistance, groupDistanceFactor);

        if (groupResult.dist === 0) {
            // If we have a perfect group-based match, prefer it over the flat result even if the flat result was also a perfect custom match.
            return groupResult.name;
        }

        // Try hierarchical split: bundle groups into intermediate formations
        // E.g. 4 Novas → 2 × (2 Novas = SN Binary) → Under-Strength Cluster
        if (groupResults.length >= 4) {
            const splitResult = trySplitGroupEvaluation(groupResults, rules, groupMinDistance, groupDistanceFactor);
            if (splitResult.dist < groupResult.dist ||
                (splitResult.dist === groupResult.dist &&
                 (splitResult.matchedRule?.nominalPts ?? 0) > (groupResult.matchedRule?.nominalPts ?? 0))) {
                groupResult = splitResult;
            }
        }

        // Prefer group-based on tie, unless the flat result was a strict match
        // (strict rules like Supernova Trinary are very specific and should not
        // be overridden by a generic aliased group match at equal distance)
        if (groupResult.dist < flatResult.dist ||
            (groupResult.dist === flatResult.dist && !flatResult.matchedRule?.strict)) {
            return groupResult.name;
        }
    }

    return flatResult.name;
}
