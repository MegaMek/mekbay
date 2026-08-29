// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    EQUIPMENT_POWER_OFF_STATE,
    EQUIPMENT_POWER_ON_STATE,
    EQUIPMENT_POWER_STATE_KEY,
    EQUIPMENT_POWER_TURNING_OFF_STATE,
    EQUIPMENT_POWER_TURNING_ON_STATE,
} from '../utils/equipment-power-state.util';
import { ToggleHandler } from './base/toggle.handler';

const END_PHASE_POWER_FLAGS: EquipmentFlag[] = [
    'F_MINESWEEPER',
    'F_EI_INTERFACE',
];

/** Shared delayed power switch for electronics governed by the End Phase. */
export class EquipmentPowerHandler extends ToggleHandler {
    readonly id = 'equipment-power-handler';
    override readonly priority = 5;
    protected override readonly stateKey = EQUIPMENT_POWER_STATE_KEY;
    protected override readonly toggleMode = 'transient' as const;
    protected override readonly enabledState = EQUIPMENT_POWER_ON_STATE;
    protected override readonly enablingState = EQUIPMENT_POWER_TURNING_ON_STATE;
    protected override readonly disabledState = EQUIPMENT_POWER_OFF_STATE;
    protected override readonly disablingState = EQUIPMENT_POWER_TURNING_OFF_STATE;
    protected override readonly defaultEnabled = true;
    protected override readonly enabledLabel = 'System is ON';
    protected override readonly enablingLabel = 'Turning system on…';
    protected override readonly disabledLabel = 'System is OFF';
    protected override readonly disablingLabel = 'Turning system off…';

    override applicableTo(equipment: MountedEquipment): boolean {
        if (equipment.equipment?.hasAnyFlag(END_PHASE_POWER_FLAGS) !== true) return false;
        return equipment.equipment.hasFlag('F_EI_INTERFACE') === false
            || equipment.owner.getUnit().type !== 'ProtoMek';
    }
}
