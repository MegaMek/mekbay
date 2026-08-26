// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export const HAG_STANDARD_MODE = 'Standard' as const;
export const HAG_FLAG = 'F_HAG' as const;
export const HAG_FLAK_MODE = 'Flak' as const;
export const HAG_MODES = Object.freeze([HAG_STANDARD_MODE, HAG_FLAK_MODE] as const);

export type HagMode = typeof HAG_MODES[number];

export function isHagMode(value: unknown): value is HagMode {
    return value === HAG_STANDARD_MODE || value === HAG_FLAK_MODE;
}

export function isHagEquipment(
    equipment: { hasFlag(flag: string): boolean } | null | undefined,
): boolean {
    return equipment?.hasFlag(HAG_FLAG) === true;
}
