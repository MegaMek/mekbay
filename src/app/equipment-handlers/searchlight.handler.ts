// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    EQUIPMENT_POWER_OFF_STATE,
    EQUIPMENT_POWER_ON_STATE,
    EQUIPMENT_POWER_STATE_KEY,
    EQUIPMENT_POWER_TURNING_OFF_STATE,
    EQUIPMENT_POWER_TURNING_ON_STATE,
} from '../utils/equipment-power-state.util';
import { ToggleHandler } from './base/toggle.handler';

export class SearchlightHandler extends ToggleHandler {
    readonly id = 'searchlight-handler';
    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment?.hasAnyFlag(['F_SEARCHLIGHT', 'F_BA_SEARCHLIGHT']) === true;
    }
    protected override readonly stateKey = EQUIPMENT_POWER_STATE_KEY;
    protected override readonly toggleMode = 'transient' as const;
    protected override readonly enabledState = EQUIPMENT_POWER_ON_STATE;
    protected override readonly enablingState = EQUIPMENT_POWER_TURNING_ON_STATE;
    protected override readonly disabledState = EQUIPMENT_POWER_OFF_STATE;
    protected override readonly disablingState = EQUIPMENT_POWER_TURNING_OFF_STATE;
    protected override readonly defaultEnabled = true;
    protected override readonly enabledLabel = 'Searchlight is ON';
    protected override readonly enablingLabel = 'Turning searchlight on…';
    protected override readonly disabledLabel = 'Searchlight is OFF';
    protected override readonly disablingLabel = 'Turning searchlight off…';
}
