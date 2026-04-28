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
export const MEGAMEK_AVAILABILITY_UNKNOWN = 'Unknown' as const;
export const MEGAMEK_AVAILABILITY_NOT_AVAILABLE = 'Not Available' as const;

export const MEGAMEK_AVAILABILITY_FROM_OPTIONS = ['Requisition', 'Salvage'] as const;
export type MegaMekAvailabilityFrom = typeof MEGAMEK_AVAILABILITY_FROM_OPTIONS[number];
export const MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS = [
    ...MEGAMEK_AVAILABILITY_FROM_OPTIONS,
    MEGAMEK_AVAILABILITY_UNKNOWN,
] as const;
export type MegaMekAvailabilityFromFilter = typeof MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS[number];

export const MEGAMEK_PRODUCTION_ICON_PATH = 'M32.45,8.44,22,15.3V9.51a1,1,0,0,0-1.63-.78L14.07,14H10V4.06L4,2.71V14H2V31a1,1,0,0,0,1,1H33a1,1,0,0,0,1-1V9.27A1,1,0,0,0,32.45,8.44ZM14,29H6V27h8Zm0-4H6V23h8Zm0-4H6V19h8Zm8,8H20V26h2Zm0-6H20V20h2Zm4,6H24V26h2Zm0-6H24V20h2Zm4,6H28V26h2Zm0-6H28V20h2Z';
export const MEGAMEK_SALVAGE_ICON_PATH = 'M92.4,192.7c-6.3,6.4-12.9,12.9-18.3,18.3l34.2,41l34.2-41c-6-6.2-12.4-12.1-18.3-18.3H92.4z M62.1,169.9l12.3,12.3l-2.7,2.7l-12.3-12.3L62.1,169.9z M110.2,157.8v17.4h-3.8v-17.4H110.2z M154.4,169.9l-12.3,12.3l2.7,2.7l12.3-12.3L154.4,169.9z M220.9,89.3c-2.4,4.7-4.8,9.5-7.1,14.5L191,176.3c-1.1,6.6-6.9,11.7-13.8,11.7c-7.7,0-14-6.3-14-14c0-0.8,0.1-1.6,0.2-2.3l-0.2-0.1l3.3-13.3c2.6-14.1,12.6-36.7-18.3-42.5c-32.2-6.1-63.5,21.5-63.5,21.5c-11.9,8.8-23.6,20.1-32.9,34.8c-2.3,3.6-6.1,5.5-10.1,5.5c-2.2,0-4.4-0.6-6.4-1.9c-5.6-3.5-7.2-10.9-3.7-16.5c15.3-24,35.7-40.4,53.9-51.1c0.2-0.1,0.3-0.2,0.4-0.3c0.4-0.4,0-1.1-0.6-1.1c-0.2,0-0.3,0-0.5,0.1c-32.9,13.5-60.6,29.6-61,29.8c-1.9,1.1-4,1.6-6,1.6c-4.1,0-8.1-2.1-10.3-5.9c-3.3-5.7-1.4-13,4.3-16.4c1.5-0.9,26.8-15.6,58.5-29c0.4-0.2,0.5-0.3,0.6-0.5c0.1-0.3,0-0.7-0.2-0.9c-0.4-0.3-0.8-0.1-0.8-0.1l-43.2,6.8c-0.6,0.1-1.3,0.1-1.9,0.1C19,92.4,14,88.2,13,82.3c-1-6.5,3.4-12.6,9.9-13.7l42.7-6.8l-0.5-0.1c0,0,36.3-5.3,78.3-21.9c23.5-9.3,38-26.5,49.6-39.8h63v39.5L220.9,89.3z';

export const MEGAMEK_AVAILABILITY_RARITY_OPTIONS = [
    'Very Rare',
    'Rare',
    'Uncommon',
    'Common',
    'Very Common',
] as const;

export const MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS: Record<typeof MEGAMEK_AVAILABILITY_RARITY_OPTIONS[number], string> = {
    'Very Rare': '#b5443c',
    'Rare': '#d67c34',
    'Uncommon': '#c0a548',
    'Common': '#6a9d42',
    'Very Common': '#2f8b57',
};

export const MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS = [
    MEGAMEK_AVAILABILITY_UNKNOWN,
    MEGAMEK_AVAILABILITY_NOT_AVAILABLE,
    ...MEGAMEK_AVAILABILITY_RARITY_OPTIONS,
] as const;
export type MegaMekAvailabilityRarity = typeof MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS[number];

export const MEGAMEK_AVAILABILITY_BADGE_COLORS: Record<MegaMekAvailabilityRarity, string> = {
    [MEGAMEK_AVAILABILITY_UNKNOWN]: 'silver',
    [MEGAMEK_AVAILABILITY_NOT_AVAILABLE]: 'silver',
    'Very Rare': MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS['Very Rare'],
    'Rare': MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS['Rare'],
    'Uncommon': MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS['Uncommon'],
    'Common': MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS['Common'],
    'Very Common': MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS['Very Common'],
};

const MEGAMEK_AVAILABILITY_MIN_RARITY_SCORE = 1;
const MEGAMEK_AVAILABILITY_RARITY_THRESHOLDS = [2.8, 4.6, 6.4, 8.2] as const;

export type MegaMekWeightedEraAvailability = Record<string, MegaMekWeightedAvailabilityValue>;

export interface MegaMekWeightedAvailabilityRecord {
    n: string;
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
    return availabilityFrom === 'Requisition'
        ? value[0] ?? 0
        : value[1] ?? 0;
}

export function isMegaMekAvailabilityValueAvailable(value: MegaMekWeightedAvailabilityValue | null | undefined): boolean {
    if (!value) {
        return false;
    }

    return (value[0] ?? 0) > 0 || (value[1] ?? 0) > 0;
}

export function getMegaMekAvailabilityRarityForScore(
    score: number,
): Exclude<MegaMekAvailabilityRarity, typeof MEGAMEK_AVAILABILITY_UNKNOWN> {
    if (score < MEGAMEK_AVAILABILITY_MIN_RARITY_SCORE) {
        return MEGAMEK_AVAILABILITY_NOT_AVAILABLE;
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