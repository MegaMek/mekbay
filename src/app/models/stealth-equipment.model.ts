/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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
