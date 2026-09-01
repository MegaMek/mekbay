// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../models/equipment-flags.type';
import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { HandlerCommandContext } from '../services/equipment-interaction-registry.service';
import {
    EQUIPMENT_POWER_OFF_STATE,
    EQUIPMENT_POWER_ON_STATE,
    EQUIPMENT_POWER_STATE_KEY,
    EQUIPMENT_POWER_TURNING_OFF_STATE,
    EQUIPMENT_POWER_TURNING_ON_STATE,
    equipmentPowerState,
} from '../utils/equipment-power-state.util';
import {
    cancelConflictingElectronicSuiteActivations,
    deactivateConflictingElectronicSuites,
    isActiveProbeEffectivelyActive,
    nextEffectiveProbePowerState,
} from '../utils/ecm-state.util';
import { ToggleHandler } from './base/toggle.handler';

export class BAPHandler extends ToggleHandler {
    readonly id = 'bap-handler';
    override readonly flags: EquipmentFlag[] = ['F_BAP'];
    override readonly priority = 10;

    override applicableTo(equipment: MountedEquipment): boolean {
        // Every combined ECM/probe system has one shared mode control.
        return equipment.equipment?.flags.has('F_ECM') !== true
            && equipment.equipment?.flags.has('F_NOVA') !== true;
    }

    protected override readonly stateKey = EQUIPMENT_POWER_STATE_KEY;
    protected override readonly toggleMode = 'transient' as const;
    protected override readonly enabledState = EQUIPMENT_POWER_ON_STATE;
    protected override readonly enablingState = EQUIPMENT_POWER_TURNING_ON_STATE;
    protected override readonly disabledState = EQUIPMENT_POWER_OFF_STATE;
    protected override readonly disablingState = EQUIPMENT_POWER_TURNING_OFF_STATE;
    protected override readonly defaultEnabled = true;
    protected override readonly enabledLabel = 'Active Probe is ON';
    protected override readonly enablingLabel = 'Turning Active Probe on…';
    protected override readonly disabledLabel = 'Active Probe is OFF';
    protected override readonly disablingLabel = 'Turning Active Probe off…';

    protected override getToggleState(equipment: MountedEquipment): string {
        return nextEffectiveProbePowerState(equipment);
    }

    isActive(equipment: MountedEquipment): boolean {
        return isActiveProbeEffectivelyActive(equipment);
    }

    override handleSelection(
        equipment: MountedEquipment,
        choice: PickerChoice,
        context: HandlerCommandContext,
    ): boolean {
        const handled = super.handleSelection(equipment, choice, context);
        const selectedState = String(choice.value);
        const activated = (selectedState === EQUIPMENT_POWER_TURNING_ON_STATE
            || selectedState === EQUIPMENT_POWER_ON_STATE)
            && equipmentPowerState(equipment) === selectedState;
        if (activated && cancelConflictingElectronicSuiteActivations(equipment)) {
            equipment.owner.turnState().markEquipmentStateChanged();
        }
        return handled;
    }

    override onEndTurn(equipment: MountedEquipment): void {
        const activating = equipmentPowerState(equipment) === EQUIPMENT_POWER_TURNING_ON_STATE;
        super.onEndTurn(equipment);
        if (activating && equipmentPowerState(equipment) === EQUIPMENT_POWER_ON_STATE) {
            deactivateConflictingElectronicSuites(equipment);
        }
    }
}
