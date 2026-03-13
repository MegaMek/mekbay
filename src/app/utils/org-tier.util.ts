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

export const ORG_TIER_GROUPING_FACTOR = 3;

function floorToTwoDecimals(value: number): number {
    return Math.floor(value * 100) / 100;
}

export function getEquivalentGroupCountAtTier(groupTier: number, baseTier: number): number {
    return Math.pow(ORG_TIER_GROUPING_FACTOR, groupTier - baseTier);
}

export function getAggregatedTier(groupTiers: ReadonlyArray<number>): number {
    if (groupTiers.length === 0) return 0;

    const baseTier = Math.max(...groupTiers);
    const equivalentBaseGroups = groupTiers.reduce(
        (sum, tier) => sum + getEquivalentGroupCountAtTier(tier, baseTier),
        0,
    );

    return floorToTwoDecimals(
        baseTier + Math.log(equivalentBaseGroups) / Math.log(ORG_TIER_GROUPING_FACTOR),
    );
}

export function getRepeatCountForTierDelta(sourceTier: number, targetTier: number): number {
    return Math.max(1, Math.floor(getEquivalentGroupCountAtTier(sourceTier, targetTier)));
}