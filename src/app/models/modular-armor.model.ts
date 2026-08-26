// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';

export const MODULAR_ARMOR_FLAG = 'F_MODULAR_ARMOR' as const;
export const MODULAR_ARMOR_POINTS_PER_MOUNT = 10;

export interface EquipmentMountLike {
    readonly equipment?: Equipment;
}

export function isModularArmorEquipment(equipment: Equipment | undefined): equipment is Equipment {
    return equipment?.hasFlag(MODULAR_ARMOR_FLAG) === true;
}

export function hasModularArmor(mounts: Iterable<EquipmentMountLike>): boolean {
    return [...mounts].some(mount => isModularArmorEquipment(mount.equipment));
}

export function modularArmorMovementPenalty(
    mounts: Iterable<EquipmentMountLike>,
    ignored = false,
): 0 | 1 {
    return !ignored && hasModularArmor(mounts) ? 1 : 0;
}

export function modularArmorPoints(mounts: Iterable<EquipmentMountLike>): number {
    return [...mounts].filter(mount => isModularArmorEquipment(mount.equipment)).length
        * MODULAR_ARMOR_POINTS_PER_MOUNT;
}
