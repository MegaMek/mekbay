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

export const AS_DAMAGE_ZERO_STAR_VALUE = 0.5;

const AS_DAMAGE_FILTER_KEYS = new Set([
    'as.dmg._dmgS',
    'as.dmg._dmgM',
    'as.dmg._dmgL',
    'as.dmg._dmgE',
]);

const AS_DAMAGE_SEMANTIC_KEYS = new Set(['dmgs', 'dmgm', 'dmgl', 'dmge']);

export function isASDamageFilterKey(key: string | undefined): boolean {
    return !!key && AS_DAMAGE_FILTER_KEYS.has(key);
}

export function isASDamageSemanticKey(key: string | undefined): boolean {
    return !!key && AS_DAMAGE_SEMANTIC_KEYS.has(key);
}

export function parseASDamageValue(value: string | number | null | undefined): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    const text = value?.trim();
    if (!text) {
        return null;
    }

    if (text.toLowerCase() === '0*') {
        return AS_DAMAGE_ZERO_STAR_VALUE;
    }

    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed : null;
}

export function formatASDamageValue(value: number | undefined | null): string {
    if (value === undefined || value === null || !Number.isFinite(value)) {
        return '';
    }

    if (value === AS_DAMAGE_ZERO_STAR_VALUE) {
        return '0*';
    }

    if (Number.isInteger(value)) {
        return value.toString();
    }

    return value.toLocaleString('en-US', {
        maximumFractionDigits: 2,
    });
}
