// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isWeaponEnhancementEquipment } from './weapon-enhancement.model';

export const RISC_LASER_STANDARD_MODE = 'Standard';
export const RISC_LASER_PULSE_MODE = 'Pulse';
export const RISC_LASER_PULSE_MODULE_FLAG = 'F_RISC_LASER_PULSE_MODULE' as const;
export const RISC_LASER_PULSE_HEAT_BONUS = 2;
export const RISC_LASER_PULSE_EXPLOSION_DAMAGE = 2;
export const RISC_LASER_MODES = Object.freeze([RISC_LASER_STANDARD_MODE, RISC_LASER_PULSE_MODE] as const);
export type RiscLaserMode = typeof RISC_LASER_MODES[number];
export function isRiscLaserMode(value: unknown): value is RiscLaserMode {
    return value === RISC_LASER_STANDARD_MODE || value === RISC_LASER_PULSE_MODE;
}

export interface RiscLaserEquipmentView {
    readonly techBase?: string;
    hasFlag(flag: string): boolean;
}

export function isRiscLaserPulseModule(
    equipment: RiscLaserEquipmentView | null | undefined,
): boolean {
    return equipment?.hasFlag(RISC_LASER_PULSE_MODULE_FLAG) === true;
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
    return equipment != null
        && equipment.hasFlag('F_LASER')
        && !equipment.hasFlag('F_PULSE')
        && equipment.techBase !== 'Clan';
}

export function isRiscLaserPulseLink(
    module: RiscLaserEquipmentView | null | undefined,
    laser: RiscLaserEquipmentView | null | undefined,
): boolean {
    return isRiscLaserPulseEnhancement(module) && isRiscLaserPulseCompatibleWeapon(laser);
}
