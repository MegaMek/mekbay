// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from '../models/mounted-equipment.model';

export const EQUIPMENT_POWER_STATE_KEY = 'powerState';
export const EQUIPMENT_POWER_ON_STATE = 'enabled';
export const EQUIPMENT_POWER_TURNING_ON_STATE = 'enabling';
export const EQUIPMENT_POWER_OFF_STATE = 'disabled';
export const EQUIPMENT_POWER_TURNING_OFF_STATE = 'disabling';

/** Missing state is the tabletop default: installed electronics begin switched on. */
export function equipmentPowerState(equipment: MountedEquipment): string {
    const state = equipment.states.get(EQUIPMENT_POWER_STATE_KEY);
    return state === EQUIPMENT_POWER_ON_STATE
        || state === EQUIPMENT_POWER_TURNING_ON_STATE
        || state === EQUIPMENT_POWER_OFF_STATE
        || state === EQUIPMENT_POWER_TURNING_OFF_STATE
        ? state
        : EQUIPMENT_POWER_ON_STATE;
}

/** End-Phase changes retain the prior turn's effects until committed. */
export function isEquipmentEffectivelyPowered(equipment: MountedEquipment): boolean {
    const state = equipmentPowerState(equipment);
    return state === EQUIPMENT_POWER_ON_STATE || state === EQUIPMENT_POWER_TURNING_OFF_STATE;
}
