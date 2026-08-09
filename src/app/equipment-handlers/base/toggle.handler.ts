// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentInteractionHandler, type HandlerCommandContext, type HandlerQueryContext } from '../../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../../models/mounted-equipment.model';
import type { PickerChoice, PickerValue } from '../../components/picker/picker.interface';

/**
 * Base handler for simple on/off equipment
 */
export abstract class ToggleHandler extends EquipmentInteractionHandler {
    protected readonly stateKey: string = 'state';
    protected readonly enabledLabel: string = 'Enable';
    protected readonly disabledLabel: string = 'Disable';
    protected readonly enabledToastVerb: string = 'enabled';
    protected readonly disabledToastVerb: string = 'disabled';
    
    getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        const currentState = equipment.states?.get(this.stateKey) || 'disabled';
        const nextState = currentState === 'enabled' ? 'disabled' : 'enabled';
        return [
            {
                label: currentState === 'enabled' ? this.enabledLabel : this.disabledLabel,
                value: nextState,
                active: currentState === 'enabled',
                displayType: 'toggle',
            },
        ];
    }
    
    handleSelection(equipment: MountedEquipment, value: PickerChoice, context: HandlerCommandContext): boolean {
        const newState = value.value === 'enabled' ? 'enabled' : 'disabled';
        equipment.states?.set(this.stateKey, newState);
        equipment.owner.setInventoryEntry(equipment);
        context.toastService.showToast(
            `${equipment.equipment?.name||equipment.name} is ${newState === 'enabled' ? this.enabledToastVerb : this.disabledToastVerb}`,
            'info'
        );
        return true;
    }
}
