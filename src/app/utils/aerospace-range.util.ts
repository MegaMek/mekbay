// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { WeaponEquipment } from '../models/equipment.model';
import type { InventoryControlRuntimeRangeKey } from '../models/inventory-control-runtime-state.model';
import type { AmmoWeaponProfile } from '../models/ammo-weapon-profile.model';

export type AerospaceRangeLimits = readonly [short: number, medium: number, long: number, extreme: number];
export type AerospaceAttackValues = readonly [short: number, medium: number, long: number, extreme: number];

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
): AerospaceAttackValues {
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
