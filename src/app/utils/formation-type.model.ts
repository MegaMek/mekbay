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

import { GameSystem, Rulebook } from '../models/common.model';
import { ForceUnit } from '../models/force-unit.model';

/*
 * Author: Drake
 */

/**
 * Describes how a group of SPAs is distributed to units in a formation.
 * Each formation may have one or more effect groups, each describing a set of
 * abilities and the rules governing who receives them.
 */
export interface FormationEffectGroup {
    /** SPA ids from AS_PILOT_ABILITIES that may be granted by this effect. */
    abilityIds?: string[];
    /** SCA ids from AS_COMMAND_ABILITIES whose effects are applied by this group. */
    commandAbilityIds?: string[];
    /**
     * How abilities are selected from the list:
     * - `choose-one`: One ability is chosen for all recipients (e.g. Recon Lance picks one SPA for everyone).
     * - `choose-each`: Each recipient picks independently from the list (e.g. Command Lance).
     * - `all`: All listed abilities are granted (used when only one ability in list, or all apply).
     */
    selection: 'choose-one' | 'choose-each' | 'all';
    /**
     * How recipients are determined:
     * - `all`:               Every unit in the formation.
     * - `half-round-down`:   Up to half the units (rounded down).
     * - `half-round-up`:     Up to half the units (rounded up).
     * - `percent-75`:        75% of the units (rounded normally).
     * - `up-to-50-percent`:  Up to 50% of the units.
     * - `fixed`:             A fixed number of units (see `count`).
     * - `fixed-pairs`:       A fixed number of identical pairs (see `count`).
     * - `conditional`:       Units matching a specific condition (see `condition`).
     * - `remainder`:         Units not covered by another effect group.
     * - `shared-pool`:       A shared resource pool for the formation (e.g. Lucky).
     * - `role-filtered`:     All units matching a specific role (see `roleFilter`).
     * - `commander`:         The designated commander unit only.
     */
    distribution: 'all' | 'half-round-down' | 'half-round-up' | 'percent-75'
        | 'up-to-50-percent' | 'fixed' | 'fixed-pairs' | 'conditional'
        | 'remainder' | 'shared-pool' | 'role-filtered' | 'commander';
    /** Whether assignments rotate per turn (`true`) or are fixed at start of play (`false`/omitted). */
    perTurn?: boolean;
    /** Number of units or pairs for `fixed` / `fixed-pairs` distributions. */
    count?: number;
    /** Human-readable condition for `conditional` distribution. */
    condition?: string;
    /** Role name for `role-filtered` distribution. */
    roleFilter?: string;
    /** Maximum abilities from this group a single unit can receive (default 1). */
    maxPerUnit?: number;
}

/**
 * A reference to a specific rulebook and page number.
 */
export interface RulesReference {
    book: Rulebook;
    page: number;
}

export interface FormationTypeDefinition {
    id: string;
    parent?: string;
    name: string;
    description: string;
    effectDescription?: string;
    /** Structured SPA distribution rules for this formation's bonus ability. */
    effectGroups?: FormationEffectGroup[];
    validator?: (units: ForceUnit[], gameSystem: GameSystem) => boolean;
    idealRole?: string;
    techBase?: 'Inner Sphere' | 'Clan' | 'Special';
    minUnits?: number;
    exclusiveFaction?: string;
    /** Multiple rulebook references (e.g. CO p.62, AS:CE p.117). */
    rulesRef?: RulesReference[];
}
