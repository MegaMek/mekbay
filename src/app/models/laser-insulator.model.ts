// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EntityMountedEquipment } from './entity/types/equipment';
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
    // TO:AUE p. 134 includes chemical lasers, which lack F_LASER (MekFileParser accepts CLChemicalLaserWeapon too).
    return equipment instanceof WeaponEquipment
        && (equipment.hasFlag('F_LASER') || equipment.ammoType === 'CHEMICAL_LASER') && !equipment.capital && !equipment.subCapital;
}

export function isLaserInsulatorPair(
    enhancement: Equipment | null | undefined,
    weapon: Equipment | null | undefined,
): weapon is WeaponEquipment {
    return isLaserInsulatorEquipment(enhancement)
        && isLaserInsulatorCompatibleWeapon(weapon);
}

/** Undefined for a bare laser, true only if every installed insulator is unavailable. */
export function laserInsulatorWeakened(
    attachments: readonly EntityMountedEquipment[],
    available: (mount: EntityMountedEquipment) => boolean,
): boolean | undefined {
    const insulators = attachments.filter(mount => isLaserInsulatorEquipment(mount.equipment));
    return insulators.length ? !insulators.some(available) : undefined;
}

/**
 * TO:AUE p. 134: after an unmodified attack roll of 2, an insulated laser rolls 2D6 and suffers a critical hit on 8 or
 * more.
 */
export const LASER_INSULATOR_FAILURE_TARGET = 8;

export function laserInsulatorAdjustedHeat(baseHeat: number, insulated: boolean): number {
    return insulated
        ? Math.max(LASER_INSULATOR_MINIMUM_WEAPON_HEAT, baseHeat - LASER_INSULATOR_HEAT_REDUCTION)
        : baseHeat;
}
