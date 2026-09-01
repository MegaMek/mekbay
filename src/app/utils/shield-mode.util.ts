// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from '../models/mounted-equipment.model';

export const SHIELD_MODE_STATE_KEY = 'shieldMode';
export const SHIELD_INACTIVE_MODE = 'None';
export const SHIELD_RAISED_MODE = 'Active';
export const SHIELD_PASSIVE_MODE = 'Passive';

export type ShieldMode =
    | typeof SHIELD_INACTIVE_MODE
    | typeof SHIELD_RAISED_MODE
    | typeof SHIELD_PASSIVE_MODE;

export interface ShieldModeOption {
    readonly label: string;
    readonly value: ShieldMode;
}

const CORE_SHIELD_MODES: readonly ShieldModeOption[] = [
    // MegaMek serializes the Core lowered state as its legacy "None" mode.
    { label: 'Lowered', value: SHIELD_INACTIVE_MODE },
    { label: 'Raised', value: SHIELD_RAISED_MODE },
];

const TW_SHIELD_MODES: readonly ShieldModeOption[] = [
    { label: 'Inactive', value: SHIELD_INACTIVE_MODE },
    { label: 'Active', value: SHIELD_RAISED_MODE },
    { label: 'Passive', value: SHIELD_PASSIVE_MODE },
];

export function shieldModeOptions(mounted: MountedEquipment): readonly ShieldModeOption[] {
    return mounted.owner.gameRules.id === 'core2026' ? CORE_SHIELD_MODES : TW_SHIELD_MODES;
}

export function selectedShieldMode(mounted: MountedEquipment): ShieldMode {
    const selected = mounted.states.get(SHIELD_MODE_STATE_KEY);
    const modes = shieldModeOptions(mounted);
    return modes.some(mode => mode.value === selected)
        ? selected as ShieldMode
        : SHIELD_INACTIVE_MODE;
}

export function setShieldMode(mounted: MountedEquipment, mode: ShieldMode): boolean {
    if (!shieldModeOptions(mounted).some(option => option.value === mode)) return false;
    if (!mounted.setState(SHIELD_MODE_STATE_KEY, mode)) return false;
    mounted.owner.setInventoryEntry(mounted);
    return true;
}

export function isShieldRaised(mounted: MountedEquipment): boolean {
    return selectedShieldMode(mounted) === SHIELD_RAISED_MODE;
}

export function shieldMountingArm(mounted: MountedEquipment): 'LA' | 'RA' | null {
    return Array.from(mounted.locations ?? []).find((location): location is 'LA' | 'RA' =>
        location === 'LA' || location === 'RA')
        ?? mounted.critSlots
            ?.map(slot => slot.loc)
            .find((location): location is 'LA' | 'RA' => location === 'LA' || location === 'RA')
        ?? null;
}

/** Whether this shield mode prevents attacks from this mounted location. */
export function shieldProtectsLocation(
    mounted: MountedEquipment,
    location: string,
    rearMounted = false,
): boolean {
    const arm = shieldMountingArm(mounted);
    if (!arm) return false;

    switch (selectedShieldMode(mounted)) {
        case SHIELD_RAISED_MODE:
            if (mounted.owner.gameRules.id === 'core2026') {
                // Core shields cover the center torso and the mounting side, but
                // not the head. Rear-mounted weapons may still fire.
                if (rearMounted || location === 'HD') return false;
                if (location === 'CT') return true;
                return arm === 'LA'
                    ? location === 'LA' || location === 'LT' || location === 'LL'
                    : location === 'RA' || location === 'RT' || location === 'RL';
            }
            if (location === 'CT') return !rearMounted;
            if (location === 'HD') return true;
            return arm === 'LA'
                ? location === 'LA' || location === 'LT' || location === 'LL'
                : location === 'RA' || location === 'RT' || location === 'RL';
        case SHIELD_PASSIVE_MODE:
            return !rearMounted && (arm === 'LA'
                ? location === 'LA' || location === 'LT'
                : location === 'RA' || location === 'RT');
        case SHIELD_INACTIVE_MODE:
            return location === arm;
    }
}
