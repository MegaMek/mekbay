// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';
import { getVibrobladeProfileFromFlags } from './rules/vibroblade-rules';

export const VIBROBLADE_ON_MODE = 'ON';
export const VIBROBLADE_OFF_MODE = 'OFF';
export const VIBROBLADE_MODES = Object.freeze([
    VIBROBLADE_ON_MODE,
    VIBROBLADE_OFF_MODE,
] as const);

export type VibrobladeMode = typeof VIBROBLADE_MODES[number];

export function isVibrobladeMode(value: unknown): value is VibrobladeMode {
    return value === VIBROBLADE_ON_MODE || value === VIBROBLADE_OFF_MODE;
}

export function vibrobladeComponentModes(
    equipment: { readonly flags: ReadonlySet<EquipmentFlag> } | null | undefined,
): { readonly modes: readonly string[]; readonly defaultMode: string } | null {
    return equipment && getVibrobladeProfileFromFlags(equipment.flags) !== null
        ? Object.freeze({ modes: VIBROBLADE_MODES, defaultMode: VIBROBLADE_OFF_MODE })
        : null;
}
