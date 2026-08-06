// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../models/equipment-flags.type';
import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { DisabledStateToggleHandler } from './disabled-equipment.handler';

export class UACJammingHandler extends DisabledStateToggleHandler {
    readonly id = 'uac-jamming-handler';
    override readonly flags: EquipmentFlag[] = ['F_AC']; // We then filter by ammo type
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