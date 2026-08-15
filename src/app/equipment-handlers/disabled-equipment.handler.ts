// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    ENTRY_DISABLED_STATE_KEY,
    ENTRY_DISABLED_STATE_VALUE,
} from '../models/rules/unit-type-rules';
import { EquipmentInteractionHandler, type HandlerChoice, type HandlerCommandContext, type HandlerQueryContext } from '../services/equipment-interaction-registry.service';

export function isEquipmentDisabledByFailure(equipment: MountedEquipment): boolean {
    return equipment.states.get(ENTRY_DISABLED_STATE_KEY) === ENTRY_DISABLED_STATE_VALUE;
}

export abstract class DisabledStateToggleHandler extends EquipmentInteractionHandler {
    protected readonly enabledLabel: string = 'Disable';
    protected readonly disabledLabel: string = 'Disabled';
    protected readonly enabledShortLabel: string = 'Disable';
    protected readonly disabledShortLabel: string = 'Enable';
    protected readonly enabledToastVerb: string = 'disabled';
    protected readonly disabledToastVerb: string = 'enabled';

    override readonly priority = 10;

    getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): HandlerChoice[] {
        const disabled = isEquipmentDisabledByFailure(equipment);
        return [{
            label: disabled ? this.disabledLabel : this.enabledLabel,
            shortLabel: disabled ? this.disabledShortLabel : this.enabledShortLabel,
            value: disabled ? 'false' : ENTRY_DISABLED_STATE_VALUE,
            stateEdit: disabled ? 'enable' : 'disable',
            displayType: 'toggle',
            active: disabled,
            tooltipType: disabled ? 'error' : undefined
        }];
    }

    handleSelection(equipment: MountedEquipment, _choice: PickerChoice, context: HandlerCommandContext): boolean {
        const disabled = isEquipmentDisabledByFailure(equipment);
        const changed = disabled
            ? equipment.deleteState(ENTRY_DISABLED_STATE_KEY)
            : equipment.setState(ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE);
        if (!changed) return true;

        equipment.owner.setInventoryEntry(equipment);
        context.toastService.showToast(
            `${equipment.equipment?.name || equipment.name} is ${disabled ? this.disabledToastVerb : this.enabledToastVerb}`,
            disabled ? 'info' : 'error'
        );
        return true;
    }
}
