// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from './mounted-equipment.model';

export const STEALTH_STATE_KEY = 'state';
export const STEALTH_ENABLED_STATE = 'enabled';

export function isStealthEquipment(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_STEALTH') === true
        || equipment.equipment?.flags.has('F_CHAMELEON_SHIELD') === true;
}

export function isStealthEquipmentActive(equipment: MountedEquipment): boolean {
    return isStealthEquipment(equipment)
        && equipment.states.get(STEALTH_STATE_KEY) === STEALTH_ENABLED_STATE;
}

/** Active stealth cuts C3 links, except for Chameleon LPS. */
export function isC3DisruptingStealthActive(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_STEALTH') === true
        && equipment.equipment.flags.has('F_CHAMELEON_SHIELD') === false
        && equipment.states.get(STEALTH_STATE_KEY) === STEALTH_ENABLED_STATE;
}
