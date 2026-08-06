// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { isStealthEquipment, STEALTH_STATE_KEY } from '../models/stealth-equipment.model';
import { ToggleHandler } from './base/toggle.handler';

export class StealthHandler extends ToggleHandler {
    readonly id = 'stealth-handler';
    override readonly flags: EquipmentFlag[] = [];
    override readonly priority = 10;
    protected override readonly stateKey = STEALTH_STATE_KEY;
    
    protected override readonly enabledLabel = 'Stealth Active';
    protected override readonly disabledLabel = 'Stealth Deactivated';

    override applicableTo(equipment: MountedEquipment): boolean {
        return isStealthEquipment(equipment);
    }
}