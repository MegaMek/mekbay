// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export const ORG_TIER_GROUPING_FACTOR = 3;

function floorToTwoDecimals(value: number): number {
    return Math.floor(value * 100) / 100;
}

export function getEquivalentGroupCountAtTier(groupTier: number, baseTier: number): number {
    return Math.pow(ORG_TIER_GROUPING_FACTOR, groupTier - baseTier);
}

export function getTierDeltaForEquivalentGroupCount(equivalentGroupCount: number): number {
    if (equivalentGroupCount <= 0) return 0;
    return Math.log(equivalentGroupCount) / Math.log(ORG_TIER_GROUPING_FACTOR);
}

export function getDynamicTierForModifier(
    baseTier: number,
    regularCount: number,
    modifierCount: number,
    dynamicTier: number,
): number {
    if (dynamicTier <= 0 || regularCount <= 0 || modifierCount <= 0 || modifierCount === regularCount) {
        return baseTier;
    }

    return baseTier + (Math.log(modifierCount / regularCount) / Math.log(ORG_TIER_GROUPING_FACTOR)) * dynamicTier;
}

export function getAggregatedTier(groupTiers: ReadonlyArray<number>): number {
    if (groupTiers.length === 0) return 0;

    const baseTier = Math.max(...groupTiers);
    const equivalentBaseGroups = groupTiers.reduce(
        (sum, tier) => sum + getEquivalentGroupCountAtTier(tier, baseTier),
        0,
    );

    return floorToTwoDecimals(
        baseTier + getTierDeltaForEquivalentGroupCount(equivalentBaseGroups),
    );
}

export function getRepeatCountForTierDelta(sourceTier: number, targetTier: number): number {
    return Math.max(1, Math.floor(getEquivalentGroupCountAtTier(sourceTier, targetTier)));
}
