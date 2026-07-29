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

import type { WeaponEquipment } from '../models/equipment.model';
import type { InventoryControlRuntimeRangeKey } from '../models/inventory-control-runtime-state.model';
import type { AmmoWeaponProfile } from '../models/ammo-weapon-profile.model';

export type AerospaceRangeLimits = readonly [short: number, medium: number, long: number, extreme: number];

export const AEROSPACE_RANGE_BRACKETS: readonly InventoryControlRuntimeRangeKey[] = [
    'short',
    'medium',
    'long',
    'extreme'
];

export const STANDARD_AEROSPACE_RANGE_LIMITS: AerospaceRangeLimits = [6, 12, 20, 25];
export const CAPITAL_AEROSPACE_RANGE_LIMITS: AerospaceRangeLimits = [12, 24, 40, 50];

export function aerospaceRangeCaptions(limits: AerospaceRangeLimits): readonly [string, string, string, string] {
    return limits.map((maximum, index) => {
        const minimum = index === 0 ? 1 : limits[index - 1] + 1;
        return `(${minimum}–${maximum})`;
    }) as [string, string, string, string];
}

export function aerospaceRangeLimits(weapon: Pick<WeaponEquipment, 'capital'>): AerospaceRangeLimits {
    return weapon.capital ? CAPITAL_AEROSPACE_RANGE_LIMITS : STANDARD_AEROSPACE_RANGE_LIMITS;
}

export function aerospaceRangeBracket(
    distance: number,
    limits: AerospaceRangeLimits
): InventoryControlRuntimeRangeKey | null {
    const bracketIndex = limits.findIndex(limit => distance <= limit);
    return bracketIndex < 0 ? null : AEROSPACE_RANGE_BRACKETS[bracketIndex];
}

export function isRangeBracketWithinMaximum(
    range: InventoryControlRuntimeRangeKey,
    maximumRange: InventoryControlRuntimeRangeKey
): boolean {
    return AEROSPACE_RANGE_BRACKETS.indexOf(range) <= AEROSPACE_RANGE_BRACKETS.indexOf(maximumRange);
}

export function aerospaceMaximumDistance(
    weapon: Pick<WeaponEquipment, 'capital'>,
    maximumRange: InventoryControlRuntimeRangeKey
): number {
    return aerospaceRangeLimits(weapon)[AEROSPACE_RANGE_BRACKETS.indexOf(maximumRange)];
}

export function effectiveAerospaceMaximumBracket(
    weapon: Pick<WeaponEquipment, 'maxRangeBracket'>,
    ammoProfile: AmmoWeaponProfile | null
): InventoryControlRuntimeRangeKey {
    return ammoProfile?.maximumAerospaceBracket ?? weapon.maxRangeBracket;
}

export function aerospaceAttackValues(
    weapon: Pick<WeaponEquipment, 'weapon'>,
    ammoProfile: AmmoWeaponProfile | null
): readonly [short: number, medium: number, long: number, extreme: number] {
    const base = [0, 1, 2, 3].map(index => Math.ceil(weapon.weapon.av[index] ?? 0)) as [number, number, number, number];
    switch (ammoProfile?.id) {
        case 'atm-extended-range': {
            const value = Math.ceil(base[1] / 2);
            return [value, value, value, value];
        }
        case 'atm-high-explosive':
            return [base[0] + Math.ceil(base[0] / 2), 0, 0, 0];
        case 'mml-srm':
            return [base[0] * 2, 0, 0, 0];
        default:
            return base;
    }
}
