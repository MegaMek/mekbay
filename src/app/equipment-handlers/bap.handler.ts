// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../models/equipment-flags.type';
import { ToggleHandler } from './base/toggle.handler';

export class BAPHandler extends ToggleHandler {
    readonly id = 'bap-handler';
    override readonly flags: EquipmentFlag[] = ['F_BAP'];
    override readonly priority = 10;
    
    protected override readonly enabledLabel = 'Active Probe is ON';
    protected override readonly disabledLabel = 'Active Probe is OFF';
}