// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { WeaponEquipment } from '../models/equipment.model';
import type { AmmoWeaponProfile } from '../models/ammo-weapon-profile.model';
import type { ArtemisKind } from '../models/artemis-equipment.model';
import type { TnRangeBracket } from '../models/target-number-calculator.model';

export type AerospaceRangeLimits = readonly [short: number, medium: number, long: number, extreme: number];
export type AerospaceAttackValues = readonly [short: number, medium: number, long: number, extreme: number];

export const AEROSPACE_RANGE_BRACKETS: readonly TnRangeBracket[] = [
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
): TnRangeBracket | null {
    const bracketIndex = limits.findIndex(limit => distance <= limit);
    return bracketIndex < 0 ? null : AEROSPACE_RANGE_BRACKETS[bracketIndex];
}

export function isRangeBracketWithinMaximum(
    range: TnRangeBracket,
    maximumRange: TnRangeBracket
): boolean {
    return AEROSPACE_RANGE_BRACKETS.indexOf(range) <= AEROSPACE_RANGE_BRACKETS.indexOf(maximumRange);
}

export function effectiveAerospaceMaximumBracket(
    weapon: Pick<WeaponEquipment, 'maxRangeBracket'>,
    ammoProfile: AmmoWeaponProfile | null
): TnRangeBracket {
    return ammoProfile?.maximumAerospaceBracket ?? weapon.maxRangeBracket;
}

/** The attack values of a weapon firing the given ammo, guided by the given Artemis system. */
export function aerospaceAttackValues(
    weapon: Pick<WeaponEquipment, 'weapon' | 'ammoType' | 'rackSize'>,
    ammoProfile: AmmoWeaponProfile | null,
    artemis: ArtemisKind | null = null,
): AerospaceAttackValues {
    const bonus = aerospaceArtemisBonus(weapon, artemis);
    const base = [0, 1, 2, 3].map(index => {
        const value = Math.ceil(weapon.weapon.av[index] ?? 0);
        return value > 0 ? value + bonus : 0;
    }) as [number, number, number, number];
    switch (ammoProfile?.id) {
        case 'atm-extended-range': {
            const value = Math.ceil(base[1] / 2);
            return [value, value, value, value];
        }
        case 'atm-high-explosive':
            return [base[0] + Math.ceil(base[0] / 2), 0, 0, 0];
        case 'atm-improved-magnetic-pulse':
            // High Explosive's range at 1 point per missile, half the standard value (IO:AE p. 61)
            return [Math.ceil(base[0] / 2), 0, 0, 0];
        case 'mml-srm':
            return [base[0] * 2, 0, 0, 0];
        default:
            return base;
    }
}

/**
 * The attack value a guiding Artemis system adds to each range bracket of a launcher: the Artemis IV values of
 * TW p. 303, a Cluster Hits roll of 10 for Artemis V (TO:AUE p. 95) and of 8 for prototype Artemis IV (IO:AE p. 65).
 */
function aerospaceArtemisBonus(weapon: Pick<WeaponEquipment, 'ammoType' | 'rackSize'>, artemis: ArtemisKind | null): number {
    if (artemis === null) return 0;
    // A roll of 8 instead of 7 only adds a hit to a 2-missile rack
    if (artemis === 'prototype') return weapon.rackSize === 2 ? 2 : 0;
    switch (weapon.ammoType) {
        case 'MML':
            return weapon.rackSize >= 7 ? 2 : (weapon.rackSize >= 5 || artemis === 'v') ? 1 : 0;
        case 'LRM':
        case 'LRM_IMP':
        case 'NLRM':
        case 'EXLRM':
            return Math.floor(weapon.rackSize / 5);
        case 'SRM':
        case 'SRM_IMP':
            return 2;
        default:
            return 0;
    }
}
