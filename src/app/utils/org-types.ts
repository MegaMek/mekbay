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

/*
 * Author: Drake
 *
 * Pure type / interface definitions for the force-org system.
 * No runtime code — only types and interfaces live here.
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
    | 'Air Lance'
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
    | 'Choir'
//  | 'Demi-Level III'
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
 * Result of a group-level size evaluation.
 * Carries the matched OrgType so force-level evaluation can
 * count groups by type without re-evaluating them.
 */
export interface GroupSizeResult {
    name: string;
    type: OrgType | null;
    /** Alias type for group-based counting (e.g. Nova also counts as Star). */
    countsAsType: OrgType | null;
    /** Cross-Organization evaluation */
    tier: number;
    /** Sub-groups that compose this result (the structural breakdown). */
    children?: GroupSizeResult[];
    /** The units that went into this group (leaf-level only). */
    units?: Unit[];
    /** Units outside the topmost matched formation; only set on top-level results. */
    leftoverUnits?: Unit[];
    /** tag for groupFilter differentiation (e.g. 'infantry' vs 'non-infantry'). */
    tag?: string;
    /** Max priority from rules used to produce this result. Higher = preferred. */
    priority?: number;
}

/**
 * Modifier for an org type count. Used when a rule has multiple thresholds (e.g.
 * under-strength, reinforced, etc.) that map to different counts and tiers.
 * `count` is the actual count for this modifier, while `tier` is an optional tier override
 * for this specific modifier (otherwise inherits from the base rule tier).
 */
export interface OrgTypeModifier {
    count: number;
    tier?: number;
}

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
    readonly modifiers: Record<string, number | OrgTypeModifier>;
    /**
     * Which sub-unit types this rule is composed of.
     * E.g. Cluster's composedOfAny = ['Binary', 'Trinary'].
     * Leaf rules (Point, Single, Flight, etc.) leave this undefined.
     */
    readonly composedOfAny?: OrgType[];
    /** Subset compositions must include at least one group matching each listed type. */
    readonly requiredChildTypes?: readonly OrgType[];
    readonly commandRank?: string;
    readonly strict?: boolean;
    readonly tier: number;
    readonly dynamicTier?: number;
    /**
     * Per-unit gate: returns true if this individual unit is relevant to this rule.
     * Used to quickly filter which units even get considered for this rule.
     */
    readonly filter?: (unit: Unit) => boolean;
    /**
     * Distance function on a set of units. Returns 0 for a perfect match.
     * The solver enumerates unit subsets and calls this to find valid shapes.
     */
    readonly customMatch?: (units: Unit[]) => number;
    /**
     * Optional total unit counts worth enumerating for customMatch.
     * Use this when customMatch can only return 0 for specific subset sizes.
     */
    readonly customMatchUnitCounts?: readonly number[];
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
    /** tag propagated to GroupSizeResult for groupFilter differentiation. */
    readonly tag?: string;
}

/**
 * Shared shape for all org definitions (ClanOrg, ISOrg, ComStarOrg, etc.).
 */
export interface OrgDefinition {
    readonly rules: OrgTypeRule[];
    readonly distanceFactor: number;
    readonly minDistance: number;
    readonly groupDistanceFactor: number;
    readonly groupMinDistance: number;
    getPointRange(units: Unit[]): PointRange;
}