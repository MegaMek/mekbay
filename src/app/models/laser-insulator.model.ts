// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Equipment, WeaponEquipment } from './equipment.model';

export const LASER_INSULATOR_HEAT_REDUCTION = 1;
export const LASER_INSULATOR_MINIMUM_WEAPON_HEAT = 1;
export const LASER_INSULATOR_FLAG = 'F_LASER_INSULATOR' as const;

export function isLaserInsulatorEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(LASER_INSULATOR_FLAG) === true;
}

export function isLaserInsulatorCompatibleWeapon(
    equipment: Equipment | null | undefined,
): equipment is WeaponEquipment {
    return equipment instanceof WeaponEquipment
        && equipment.hasWeaponTrait('laser');
}

export function isLaserInsulatorPair(
    enhancement: Equipment | null | undefined,
    weapon: Equipment | null | undefined,
): weapon is WeaponEquipment {
    return isLaserInsulatorEquipment(enhancement)
        && isLaserInsulatorCompatibleWeapon(weapon);
}

/** Exact operating-heat rule shared by BV, cost, record sheets, and runtimes. */
export function laserInsulatorAdjustedHeat(
    baseHeat: number,
    enhancement: Equipment | null | undefined,
    weapon: Equipment | null | undefined,
    operational = true,
): number {
    return operational && isLaserInsulatorPair(enhancement, weapon)
        ? Math.max(LASER_INSULATOR_MINIMUM_WEAPON_HEAT, baseHeat - LASER_INSULATOR_HEAT_REDUCTION)
        : baseHeat;
}
