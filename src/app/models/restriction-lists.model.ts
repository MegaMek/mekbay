/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import type { GameSystem } from './common.model';
import type { AmmoType } from './equipment.model';
import type { Unit } from './units.model';

export type RestrictionViolationSeverity = 'error' | 'warning' | 'info';

export interface RestrictionCrewSkillSnapshot {
    readonly label: string;
    readonly gunnery: number;
    readonly piloting: number;
}

export interface RestrictionUnitSnapshot {
    readonly displayName: string;
    readonly unit: Pick<Unit, 'id' | 'chassis' | 'model' | 'jump' | 'quirks' | 'type' | 'subtype' | 'comp' | 'as'>;
    readonly classicCrewSkills?: readonly RestrictionCrewSkillSnapshot[];
    readonly manualAbilityCount?: number;
    readonly formationAbilityCount?: number;
}

export interface RestrictionForceSnapshot {
    readonly name: string;
    readonly gameSystem: GameSystem;
    readonly units: readonly RestrictionUnitSnapshot[];
}

export interface RestrictionCatalogRules {
    readonly allowClassicUnitTypes?: readonly string[];
    readonly allowClassicUnitSubtypes?: readonly string[];
    readonly allowAlphaStrikeUnitTypes?: readonly string[];
    readonly requireCanon?: boolean;
    readonly forbidQuirks?: boolean;
    readonly forbidAmmoTypes?: readonly AmmoType[];
    readonly forbidArrowIVHoming?: boolean;
}

export interface RestrictionRosterRules {
    readonly minUnits?: number;
    readonly maxUnits?: number;
    readonly uniqueChassis?: boolean;
    readonly maxUnitsWithJumpAtLeast?: {
        readonly minimumJump: number;
        readonly maxUnits: number;
    };
}

export interface RestrictionClassicLiveRules {
    readonly crewSkillMin?: number;
    readonly crewSkillMax?: number;
    readonly maxGunneryPilotingDelta?: number;
}

export interface RestrictionAlphaStrikeLiveRules {
    readonly allowManualPilotAbilities?: boolean;
    readonly allowFormationAbilities?: boolean;
}

export interface RestrictionLiveRules {
    readonly classic?: RestrictionClassicLiveRules;
    readonly alphaStrike?: RestrictionAlphaStrikeLiveRules;
}

export interface RestrictionListDefinition {
    readonly slug: string;
    readonly name: string;
    readonly description?: string;
    readonly updatedAt: string;
    readonly gameSystem: GameSystem;
    readonly catalog?: RestrictionCatalogRules;
    readonly roster?: RestrictionRosterRules;
    readonly live?: RestrictionLiveRules;
    readonly notes?: readonly string[];
}

export interface RestrictionViolation {
    readonly listSlug: string;
    readonly listName: string;
    readonly severity: RestrictionViolationSeverity;
    readonly message: string;
}

export interface RestrictionValidationResult {
    readonly list: RestrictionListDefinition;
    readonly violations: readonly RestrictionViolation[];
}