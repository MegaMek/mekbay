// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
