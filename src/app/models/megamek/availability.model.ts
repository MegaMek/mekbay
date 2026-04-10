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

import type { UnitType } from '../units.model';

export type MegaMekWeightedAvailabilityValue = [number, number];

export const MEGAMEK_AVAILABILITY_UNKNOWN_SCORE = -1;

export const MEGAMEK_AVAILABILITY_FROM_OPTIONS = ['Production', 'Salvage'] as const;
export type MegaMekAvailabilityFrom = typeof MEGAMEK_AVAILABILITY_FROM_OPTIONS[number];

export const MEGAMEK_AVAILABILITY_RARITY_OPTIONS = [
    'Very Rare',
    'Rare',
    'Uncommon',
    'Common',
    'Very Common',
] as const;

export const MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS = [
    'Not Available',
    ...MEGAMEK_AVAILABILITY_RARITY_OPTIONS,
] as const;
export type MegaMekAvailabilityRarity = typeof MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS[number];

const MEGAMEK_AVAILABILITY_MIN_RARITY_SCORE = 1;
const MEGAMEK_AVAILABILITY_RARITY_THRESHOLDS = [2.8, 4.6, 6.4, 8.2] as const;

export type MegaMekWeightedEraAvailability = Record<string, MegaMekWeightedAvailabilityValue>;

export interface MegaMekWeightedAvailabilityRecord {
    n: string;
    // t: UnitType;
    // c: string;
    // m: string;
    e: Record<string, MegaMekWeightedEraAvailability>;
}

export interface MegaMekAvailabilityData {
    etag: string;
    records: MegaMekWeightedAvailabilityRecord[];
}

export function getMegaMekAvailabilityValueForSource(
    value: MegaMekWeightedAvailabilityValue,
    availabilityFrom: MegaMekAvailabilityFrom,
): number {
    return availabilityFrom === 'Production'
        ? value[0] ?? 0
        : value[1] ?? 0;
}

export function isMegaMekAvailabilityValueAvailable(value: MegaMekWeightedAvailabilityValue | null | undefined): boolean {
    if (!value) {
        return false;
    }

    return (value[0] ?? 0) > 0 || (value[1] ?? 0) > 0;
}

export function getMegaMekAvailabilityRarityForScore(score: number): MegaMekAvailabilityRarity {
    if (score < MEGAMEK_AVAILABILITY_MIN_RARITY_SCORE) {
        return 'Not Available';
    }
    if (score <= MEGAMEK_AVAILABILITY_RARITY_THRESHOLDS[0]) {
        return 'Very Rare';
    }
    if (score <= MEGAMEK_AVAILABILITY_RARITY_THRESHOLDS[1]) {
        return 'Rare';
    }
    if (score <= MEGAMEK_AVAILABILITY_RARITY_THRESHOLDS[2]) {
        return 'Uncommon';
    }
    if (score <= MEGAMEK_AVAILABILITY_RARITY_THRESHOLDS[3]) {
        return 'Common';
    }

    return 'Very Common';
}