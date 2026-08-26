// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from '../equipment-flags.type';
import { BAP_FLAG } from '../bap-equipment.model';
import { ToggleHandler } from './component-mode';

/** Active-probe modes and interaction owner. */
export class BAPHandler extends ToggleHandler {
    readonly id = 'bap-handler';
    override readonly flags: EquipmentFlag[] = [BAP_FLAG];
    override readonly priority = 10;
    protected override readonly enabledLabel = 'Active Probe is ON';
    protected override readonly disabledLabel = 'Active Probe is OFF';
}
