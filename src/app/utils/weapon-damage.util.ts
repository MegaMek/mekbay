// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponDamage } from '../models/equipment.model';

export type WeaponDamageRange = 'short' | 'medium' | 'long' | 'extreme';

export interface WeaponDamageFormat {
    readonly showZero?: boolean;
    readonly shotSuffix?: '/Sht';
}

/** Formats resolved damage without adding weapon classification labels. */
export function formatWeaponDamage(
    damage: WeaponDamage,
    options: WeaponDamageFormat = {},
): string {
    const value = damage.values
        .map(value => value === 0 && !options.showZero ? '' : String(value))
        .join('/');

    if (!value) return '';
    if (damage.unit === 'missile') return `${value}/Msl`;
    if (damage.unit === 'shot') return `${value}${options.shotSuffix ?? '/Sht'}`;
    if (damage.unit === 'artillery') return `${value}A`;
    return value;
}
