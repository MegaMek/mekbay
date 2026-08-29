// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { EQUIPMENT_HEAT_SOURCE_GROUP, type UnitHeatSource } from '../models/rules/unit-type-rules';
import {
    hasFunctionalEcmForStealth,
    isChameleonShieldActive,
    isChameleonShieldEquipment,
    isNullSignatureActive,
    isNullSignatureEquipment,
    isStealthEquipment,
    isStealthEquipmentFunctioning,
    isStealthSystemEquipment,
    isSwitchableStealthEquipment,
    STEALTH_DISABLED_STATE,
    STEALTH_DISABLING_STATE,
    STEALTH_ENABLED_STATE,
    STEALTH_ENABLING_STATE,
    STEALTH_STATE_KEY,
} from '../models/stealth-equipment.model';
import type { TurnState } from '../models/turn-state.model';
import type { HandlerCommandContext, HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { ToggleHandler } from './base/toggle.handler';

export class StealthHandler extends ToggleHandler {
    readonly id = 'stealth-handler';
    override readonly flags: EquipmentFlag[] = [];
    override readonly priority = 10;
    protected override readonly stateKey = STEALTH_STATE_KEY;
    protected override readonly toggleMode = 'transient' as const;
    protected override readonly enabledState = STEALTH_ENABLED_STATE;
    protected override readonly enablingState = STEALTH_ENABLING_STATE;
    protected override readonly disabledState = STEALTH_DISABLED_STATE;
    protected override readonly disablingState = STEALTH_DISABLING_STATE;
    protected override readonly enabledLabel = 'Stealth Active';
    protected override readonly enablingLabel = 'Activating Stealth…';
    protected override readonly disabledLabel = 'Stealth Deactivated';
    protected override readonly disablingLabel = 'Deactivating Stealth…';

    override applicableTo(equipment: MountedEquipment): boolean {
        return isStealthSystemEquipment(equipment);
    }

    override getChoices(equipment: MountedEquipment, context: HandlerQueryContext): PickerChoice[] {
        if (!isSwitchableStealthEquipment(equipment)) return [];
        const choices = super.getChoices(equipment, context);
        if (isStealthEquipment(equipment)
            && choices[0]?.value === STEALTH_ENABLING_STATE
            && !hasFunctionalEcmForStealth(equipment)) {
            choices[0] = { ...choices[0], disabled: true };
        }
        return choices;
    }

    override handleSelection(
        equipment: MountedEquipment,
        choice: PickerChoice,
        context: HandlerCommandContext,
    ): boolean {
        if (!isSwitchableStealthEquipment(equipment)) return true;
        if (isStealthEquipment(equipment)
            && choice.value === STEALTH_ENABLING_STATE
            && !hasFunctionalEcmForStealth(equipment)) {
            context.toastService.showToast('Stealth armor requires a functional ECM suite', 'error');
            return true;
        }
        return super.handleSelection(equipment, choice, context);
    }

    override getInventoryHeatSources(
        equipment: MountedEquipment,
        _turnState: TurnState,
        context: HandlerQueryContext,
    ): UnitHeatSource[] {
        if (!isSwitchableStealthEquipment(equipment) || !context.canProvidePassiveEffect(equipment)) return [];
        const heat = isChameleonShieldEquipment(equipment)
            ? (isChameleonShieldActive(equipment) ? 6 : 0)
            : isNullSignatureEquipment(equipment)
                ? (isNullSignatureActive(equipment) ? 10 : 0)
                : (isStealthEquipmentFunctioning(equipment) ? 10 : 0);
        return heat > 0 ? [{
            id: `stealth:${equipment.id}`,
            label: 'Stealth',
            value: heat,
            group: EQUIPMENT_HEAT_SOURCE_GROUP,
        }] : [];
    }

    override beforeEquipmentStateCommit(equipment: MountedEquipment): void {
        this.forceOffWithoutEcm(equipment);
    }

    override onEndTurn(equipment: MountedEquipment): void {
        if (this.forceOffWithoutEcm(equipment)) return;
        super.onEndTurn(equipment);
    }

    private forceOffWithoutEcm(equipment: MountedEquipment): boolean {
        if (!isStealthEquipment(equipment)
            || !isSwitchableStealthEquipment(equipment)
            || hasFunctionalEcmForStealth(equipment)) return false;
        if (this.getToggleState(equipment) !== STEALTH_DISABLED_STATE
            && equipment.setState(STEALTH_STATE_KEY, STEALTH_DISABLED_STATE)) {
            equipment.owner.setInventoryEntry(equipment);
        }
        return true;
    }
}
