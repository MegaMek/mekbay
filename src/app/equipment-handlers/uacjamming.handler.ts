/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { DisabledStateToggleHandler } from './disabled-equipment.handler';

export class UACJammingHandler extends DisabledStateToggleHandler {
    readonly id = 'uac-jamming-handler';
    override readonly flags = ['F_AC']; // We then filter by ammo type
    override readonly priority = 10;
    protected override readonly enabledLabel = 'Jam';
    protected override readonly disabledLabel = 'Jammed';
    protected override readonly enabledShortLabel = 'Jam';
    protected override readonly disabledShortLabel = 'Unjam';
    protected override readonly enabledToastVerb = 'jammed';
    protected override readonly disabledToastVerb = 'unjammed';

    override applicableTo = (equipment: MountedEquipment): boolean => {
        if (equipment.equipment instanceof WeaponEquipment) {
            const ammoType = equipment.equipment.ammoType;
            if (ammoType == 'AC_ROTARY') return true;
            if (equipment.owner?.gameRules.usesUacJamming) {
                return ammoType == 'AC_ULTRA' || ammoType == 'AC_ULTRA_THB';
            }
        }
        return false;
    }
}