// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { WeaponType } from '../models/weapon-types.model';
import {
    GAUSS_POWER_STATE_KEY,
    GAUSS_POWERED_DOWN_STATE,
    GAUSS_POWERED_UP_STATE,
    GAUSS_POWERING_DOWN_STATE,
    GAUSS_POWERING_UP_STATE,
    gaussPowerState,
    isGaussPoweredDown,
} from '../utils/gauss-power-state.util';
import { ToggleHandler } from './base/toggle.handler';

export class GaussPowerHandler extends ToggleHandler {
    readonly id = 'gauss-power-handler';
    override readonly flags: EquipmentFlag[] = ['F_GAUSS'];
    override readonly priority = 10;

    protected override readonly stateKey = GAUSS_POWER_STATE_KEY;
    protected override readonly toggleMode = 'transient' as const;
    protected override readonly enabledState = GAUSS_POWERED_UP_STATE;
    protected override readonly enablingState = GAUSS_POWERING_UP_STATE;
    protected override readonly disabledState = GAUSS_POWERED_DOWN_STATE;
    protected override readonly disablingState = GAUSS_POWERING_DOWN_STATE;
    protected override readonly defaultEnabled = true;
    protected override readonly enabledLabel = 'Powered Up';
    protected override readonly enablingLabel = 'Powering Up…';
    protected override readonly disabledLabel = 'Powered Down';
    protected override readonly disablingLabel = 'Powering Down…';
    protected override readonly enabledToastVerb = 'powered up';
    protected override readonly enablingToastVerb = 'powering up';
    protected override readonly disabledToastVerb = 'powered down';
    protected override readonly disablingToastVerb = 'powering down';

    protected override getToggleState(equipment: MountedEquipment): string {
        return gaussPowerState(equipment);
    }

    override isInventoryControlSelectable(equipment: MountedEquipment): boolean | null {
        return isGaussPoweredDown(equipment) ? false : null;
    }

    override applyInventoryControlWeaponTypes(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
    ): ReadonlySet<WeaponType> {
        if (!isGaussPoweredDown(equipment) || !types.has('X')) return types;
        const poweredTypes = new Set(types);
        poweredTypes.delete('X');
        return poweredTypes;
    }
}
