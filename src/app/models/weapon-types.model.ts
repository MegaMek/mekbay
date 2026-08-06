// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
