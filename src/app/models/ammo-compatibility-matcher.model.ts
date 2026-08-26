// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, WeaponEquipment } from './equipment.model';
import { resolveAmmoWeaponProfile } from './ammo-weapon-profile.model';

/**
 * Detached input for the inventory ammo compatibility rules.  The selected mode
 * has already crossed its mount/state boundary before reaching this DTO.
 */
export interface AmmoCompatibilityMatch {
    readonly weapon: WeaponEquipment;
    readonly ammo: AmmoEquipment;
    readonly selectedMode?: string;
}

export function createAmmoCompatibilityMatch(input: {
    readonly weapon: WeaponEquipment;
    readonly ammo: AmmoEquipment;
    readonly selectedMode?: string | null;
}): AmmoCompatibilityMatch {
    return Object.freeze({
        weapon: input.weapon,
        ammo: input.ammo,
        ...(typeof input.selectedMode === 'string' ? { selectedMode: input.selectedMode } : {}),
    });
}

/**
 * Pure ATM/IATM and MML compatibility decision over canonical equipment.
 * `null` means the weapon does not belong to either closed compatibility family.
 */
export function matchesAmmoCompatibility(
    match: AmmoCompatibilityMatch,
): boolean | null {
    const weaponAmmoType = match.weapon.ammoType;
    if (weaponAmmoType === 'ATM' || weaponAmmoType === 'IATM') {
        if (match.ammo.ammoType !== weaponAmmoType || !matchingRack(match)) return false;
        return match.ammo.hasMunitionType(atmMunitionForMode(match.selectedMode));
    }
    if (weaponAmmoType !== 'MML') return null;
    if (match.ammo.ammoType !== 'MML' || !matchingRack(match)) return false;
    return resolveAmmoWeaponProfile(match.ammo)?.displayName === (match.selectedMode ?? 'SRM');
}

function matchingRack(match: AmmoCompatibilityMatch): boolean {
    return match.weapon.rackSize <= 0 || match.ammo.rackSize === match.weapon.rackSize;
}

function atmMunitionForMode(mode: string | undefined) {
    switch (mode) {
        case 'High Explosive': return 'M_HIGH_EXPLOSIVE' as const;
        case 'Extended Range': return 'M_EXTENDED_RANGE' as const;
        case 'Standard':
        default: return 'M_STANDARD' as const;
    }
}
