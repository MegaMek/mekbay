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

export const WEAPON_TYPES = ['A', 'AE', 'AI', 'B', 'C', 'DB', 'DE', 'E', 'F', 'H', 'M', 'N', 'OS', 'P', 'PB', 'R', 'S', 'V', 'X'] as const;
export type WeaponType = typeof WEAPON_TYPES[number];

export const WEAPON_TYPE_DISPLAY_NAMES: Readonly<Record<WeaponType, string>> = {
    A: 'Artillery',
    AE: 'Area-Effect',
    AI: 'Anti-Infantry',
    B: 'Ballistic',
    C: 'Cluster',
    DB: 'Direct-Fire, Ballistic',
    DE: 'Direct-Fire, Energy',
    E: 'Energy',
    F: 'Flak',
    H: 'Heat-Causing',
    M: 'Missile',
    N: 'Nuclear',
    OS: 'One-Shot',
    P: 'Pulse',
    PB: 'Point-Blank',
    R: 'Rapid-Fire',
    S: 'Switchable Ammo',
    V: 'Variable Damage',
    X: 'Explosive',
};

/** Converts supported aliases and case variants to their canonical weapon type. */
export function normalizeWeaponType(value: string): string {
    const normalized = value.trim().toUpperCase();
    return normalized === 'AP' ? 'AI' : normalized;
}
