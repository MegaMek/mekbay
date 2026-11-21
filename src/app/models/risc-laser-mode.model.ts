// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isWeaponEnhancementEquipment } from './weapon-enhancement.model';

export const RISC_LASER_STANDARD_MODE = 'Standard';
export const RISC_LASER_PULSE_MODE = 'Pulse';
export const RISC_LASER_PULSE_MODULE_FLAG = 'F_RISC_LASER_PULSE_MODULE' as const;
/** IO:AE p. 87: the Inner Sphere standard and ER lasers a pulse module can modify. */
export const RISC_LASER_PULSE_COMPATIBLE_FLAG = 'F_RISC_LASER_PULSE_COMPATIBLE' as const;
export const RISC_LASER_PULSE_HEAT_BONUS = 2;
export const RISC_LASER_PULSE_EXPLOSION_DAMAGE = 2;
export const RISC_LASER_MODES = Object.freeze([RISC_LASER_STANDARD_MODE, RISC_LASER_PULSE_MODE] as const);
export type RiscLaserMode = typeof RISC_LASER_MODES[number];
export function isRiscLaserMode(value: unknown): value is RiscLaserMode {
    return value === RISC_LASER_STANDARD_MODE || value === RISC_LASER_PULSE_MODE;
}

export interface RiscLaserEquipmentView {
    hasFlag(flag: string): boolean;
}

export function isRiscLaserPulseModule(
    equipment: RiscLaserEquipmentView | null | undefined,
): boolean {
    return equipment?.hasFlag(RISC_LASER_PULSE_MODULE_FLAG) === true;
}

/**
 * IO:AE p. 87: pulse fire mode adds 2 to the heat of the laser a pulse module modifies, regardless of weapon size. The
 * heat belongs to that laser, so the module itself makes none; this is the static (pulse-mode) heat of a laser with
 * these attachments.
 */
export function riscLaserPulseHeat(
    attachments: readonly { readonly equipment?: RiscLaserEquipmentView | null }[],
): number {
    return attachments.some(source => isRiscLaserPulseModule(source.equipment)) ? RISC_LASER_PULSE_HEAT_BONUS : 0;
}

export function isRiscLaserPulseEnhancement(
    equipment: RiscLaserEquipmentView | null | undefined,
): boolean {
    return isRiscLaserPulseModule(equipment)
        && isWeaponEnhancementEquipment(equipment);
}

export function isRiscLaserPulseCompatibleWeapon(
    equipment: RiscLaserEquipmentView | null | undefined,
): boolean {
    return equipment?.hasFlag(RISC_LASER_PULSE_COMPATIBLE_FLAG) === true;
}

export function isRiscLaserPulseLink(
    module: RiscLaserEquipmentView | null | undefined,
    laser: RiscLaserEquipmentView | null | undefined,
): boolean {
    return isRiscLaserPulseEnhancement(module) && isRiscLaserPulseCompatibleWeapon(laser);
}

export function riscLaserPulseToHitAdjustment(label: string, active: boolean) {
    return {
        kind: 'add' as const,
        label: active ? label : `${label} Inactive`,
        modifier: active ? -2 : 0,
        weakened: !active,
    };
}
