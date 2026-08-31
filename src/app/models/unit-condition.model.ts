// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Closed vocabulary shared by stored and rules-derived Classic unit conditions. */
export const UNIT_CONDITION_KEYS = Object.freeze([
    'shutdown',
    'abandoned',
    'disconnected',
    'immobile',
    'prone',
    'crippled',
    'swarmed',
    'tagged',
    'ecm-shielded',
    'skidding',
    'jammed',
    'out-of-control',
    'random-movement',
    'spotting',
    'stealth',
    'airborne',
] as const);

export type UnitConditionKey = typeof UNIT_CONDITION_KEYS[number];

const UNIT_CONDITION_KEY_SET: ReadonlySet<string> = new Set(UNIT_CONDITION_KEYS);

export function isUnitConditionKey(value: unknown): value is UnitConditionKey {
    return typeof value === 'string' && UNIT_CONDITION_KEY_SET.has(value);
}

export function requireUnitConditionKey(value: unknown): UnitConditionKey {
    if (!isUnitConditionKey(value)) throw new Error(`Unknown unit condition ${String(value)}`);
    return value;
}
