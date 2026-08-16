// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from '../models/mounted-equipment.model';
import { INVENTORY_CONTROL_MODE_STATE } from './inventory-control.util';

export const GAUSS_POWER_STATE_KEY = INVENTORY_CONTROL_MODE_STATE;
export const GAUSS_POWERED_UP_STATE = 'Powered Up';
export const GAUSS_POWERING_DOWN_STATE = 'Powering Down';
export const GAUSS_POWERED_DOWN_STATE = 'Powered Down';
export const GAUSS_POWERING_UP_STATE = 'Powering Up';

export type GaussPowerState =
    | typeof GAUSS_POWERED_UP_STATE
    | typeof GAUSS_POWERING_DOWN_STATE
    | typeof GAUSS_POWERED_DOWN_STATE
    | typeof GAUSS_POWERING_UP_STATE;

/** Missing and invalid states preserve the rulebook/default powered-up state. */
export function gaussPowerState(equipment: MountedEquipment | null | undefined): GaussPowerState {
    switch (equipment?.states.get(GAUSS_POWER_STATE_KEY)?.trim().toLowerCase()) {
        case 'powering down': return GAUSS_POWERING_DOWN_STATE;
        case 'powered down': return GAUSS_POWERED_DOWN_STATE;
        case 'powering up': return GAUSS_POWERING_UP_STATE;
        default: return GAUSS_POWERED_UP_STATE;
    }
}

/** Powering up does not take effect until the End Phase. */
export function isGaussPoweredDown(equipment: MountedEquipment | null | undefined): boolean {
    const state = gaussPowerState(equipment);
    return state === GAUSS_POWERED_DOWN_STATE || state === GAUSS_POWERING_UP_STATE;
}
