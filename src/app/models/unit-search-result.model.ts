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

/** Inclusive numeric range used by Classic BV normalization. */
export interface UnitSearchNumericRange {
    readonly min: number;
    readonly max: number;
}

export const DEFAULT_CLASSIC_BV_NORMALIZATION_MAX = 999_999;
export const DEFAULT_CLASSIC_BV_NORMALIZATION_MAX_DELTA = 8;

/** User-selected settings for matching a unit to a target adjusted BV. */
export interface BvNormalizationSettings {
    readonly targetBv: UnitSearchNumericRange;
    readonly gunnery: UnitSearchNumericRange;
    /** Ignored for units whose Piloting value is mandatory. */
    readonly piloting: UnitSearchNumericRange;
    /** Ignored for units whose Piloting value is mandatory. */
    readonly maxDelta: number;
}

/** The deterministic skill pair selected for a normalized search result. */
export interface BvNormalizationMatch {
    readonly adjustedBv: number;
    readonly gunnery: number;
    /** The effective Piloting value used by BV calculation and force addition. */
    readonly piloting: number;
}

export type UnitSearchBudgetMode = 'force-limit' | 'bv-normalization' | null;
