// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from './cbt-ruleset.model';
import type { Equipment } from './equipment.model';

export const BOMBAST_LASER_FLAG = 'F_BOMBAST_LASER' as const;

export const BOMBAST_LASER_DAMAGE_7_MODE = 'Damage 7';
export const BOMBAST_LASER_DAMAGE_8_MODE = 'Damage 8';
export const BOMBAST_LASER_DAMAGE_9_MODE = 'Damage 9';
export const BOMBAST_LASER_DAMAGE_10_MODE = 'Damage 10';
export const BOMBAST_LASER_DAMAGE_11_MODE = 'Damage 11';
export const BOMBAST_LASER_DAMAGE_12_MODE = 'Damage 12';
export const BOMBAST_LASER_DAMAGE_16_MODE = 'Damage 16';

export const CORE_BOMBAST_LASER_MODES = Object.freeze([
    BOMBAST_LASER_DAMAGE_8_MODE,
    BOMBAST_LASER_DAMAGE_12_MODE,
    BOMBAST_LASER_DAMAGE_16_MODE,
] as const);

export const TW_BOMBAST_LASER_MODES = Object.freeze([
    BOMBAST_LASER_DAMAGE_7_MODE,
    BOMBAST_LASER_DAMAGE_8_MODE,
    BOMBAST_LASER_DAMAGE_9_MODE,
    BOMBAST_LASER_DAMAGE_10_MODE,
    BOMBAST_LASER_DAMAGE_11_MODE,
    BOMBAST_LASER_DAMAGE_12_MODE,
] as const);

export type CoreBombastLaserMode = typeof CORE_BOMBAST_LASER_MODES[number];
export type TwBombastLaserMode = typeof TW_BOMBAST_LASER_MODES[number];
export type BombastLaserMode = CoreBombastLaserMode | TwBombastLaserMode;

export interface BombastLaserProfile {
    readonly damage: number;
    readonly heat: number;
    readonly toHitModifier: number;
}

const CORE_PROFILES: Readonly<Record<CoreBombastLaserMode, BombastLaserProfile>> = Object.freeze({
    [BOMBAST_LASER_DAMAGE_8_MODE]: Object.freeze({ damage: 8, heat: 6, toHitModifier: 0 }),
    [BOMBAST_LASER_DAMAGE_12_MODE]: Object.freeze({ damage: 12, heat: 9, toHitModifier: 1 }),
    [BOMBAST_LASER_DAMAGE_16_MODE]: Object.freeze({ damage: 16, heat: 12, toHitModifier: 2 }),
});

const TW_PROFILES: Readonly<Record<TwBombastLaserMode, BombastLaserProfile>> = Object.freeze({
    [BOMBAST_LASER_DAMAGE_7_MODE]: Object.freeze({ damage: 7, heat: 7, toHitModifier: 0 }),
    [BOMBAST_LASER_DAMAGE_8_MODE]: Object.freeze({ damage: 8, heat: 8, toHitModifier: 1 }),
    [BOMBAST_LASER_DAMAGE_9_MODE]: Object.freeze({ damage: 9, heat: 9, toHitModifier: 1 }),
    [BOMBAST_LASER_DAMAGE_10_MODE]: Object.freeze({ damage: 10, heat: 10, toHitModifier: 2 }),
    [BOMBAST_LASER_DAMAGE_11_MODE]: Object.freeze({ damage: 11, heat: 11, toHitModifier: 2 }),
    [BOMBAST_LASER_DAMAGE_12_MODE]: Object.freeze({ damage: 12, heat: 12, toHitModifier: 3 }),
});

export function bombastLaserModes(ruleset: CBTRuleset): readonly BombastLaserMode[] {
    return ruleset === 'core-2026' ? CORE_BOMBAST_LASER_MODES : TW_BOMBAST_LASER_MODES;
}

export function bombastLaserProfile(
    ruleset: CBTRuleset,
    mode: unknown,
): BombastLaserProfile | null {
    if (typeof mode !== 'string') return null;
    const profiles: Readonly<Record<string, BombastLaserProfile>> = ruleset === 'core-2026'
        ? CORE_PROFILES
        : TW_PROFILES;
    return profiles[mode] ?? null;
}

export function isBombastLaserMode(
    ruleset: CBTRuleset,
    value: unknown,
): value is BombastLaserMode {
    return bombastLaserProfile(ruleset, value) !== null;
}

export function isBombastLaserEquipment(
    equipment: Equipment | null | undefined,
): boolean {
    return equipment?.hasFlag(BOMBAST_LASER_FLAG) === true;
}

export function bombastLaserEquipmentProfile(
    equipment: Equipment | null | undefined,
    ruleset: CBTRuleset,
    mode: unknown,
): BombastLaserProfile | null {
    return isBombastLaserEquipment(equipment) ? bombastLaserProfile(ruleset, mode) : null;
}

export function bombastLaserEquipmentModes(
    equipment: Equipment | null | undefined,
    ruleset: CBTRuleset,
): { readonly modes: readonly BombastLaserMode[]; readonly defaultMode: BombastLaserMode } | null {
    return isBombastLaserEquipment(equipment)
        ? Object.freeze({
            modes: bombastLaserModes(ruleset),
            defaultMode: BOMBAST_LASER_DAMAGE_12_MODE,
        })
        : null;
}
