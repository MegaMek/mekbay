// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { ToggleHandler } from './base/toggle.handler';

export class BAPHandler extends ToggleHandler {
    readonly id = 'bap-handler';
    override readonly flags: EquipmentFlag[] = ['F_BAP'];
    override readonly priority = 10;

    override applicableTo(equipment: MountedEquipment): boolean {
        // Nova CEWS powers its probe together with its ECM and C3 functions.
        return equipment.equipment?.flags.has('F_NOVA') !== true;
    }
    
    protected override readonly enabledLabel = 'Active Probe is ON';
    protected override readonly disabledLabel = 'Active Probe is OFF';
}
