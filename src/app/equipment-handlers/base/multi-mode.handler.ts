// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentInteractionHandler, type HandlerContext } from '../../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../../models/mounted-equipment.model';
import type { PickerChoice, PickerValue } from '../../components/picker/picker.interface';

/**
 * Base handler for equipment with multiple modes
 */
export abstract class MultiModeHandler extends EquipmentInteractionHandler {
    protected readonly stateKey: string = 'state';
    protected abstract getModes(equipment: MountedEquipment): Array<{ value: string; label: string; shortLabel?: string }>;
    protected abstract getDefaultMode(): string;
    
    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const currentState = equipment.states?.get(this.stateKey) || this.getDefaultMode();
        return this.getModes(equipment).map(mode => ({
            label: mode.label,
            shortLabel: mode.shortLabel,
            value: mode.value,
            disabled: equipment.isUnavailable(),
            active: currentState === mode.value
        }));
    }
    
    handleSelection(equipment: MountedEquipment, value: PickerChoice, context: HandlerContext): boolean {
        equipment.states?.set(this.stateKey, String(value));
        equipment.owner.setInventoryEntry(equipment);
        
        const mode = this.getModes(equipment).find(m => m.value === value.value);
        context.toastService.showToast(
            `${equipment.equipment?.name||equipment.name} mode: ${mode?.label || value.value}`,
            'info'
        );
        return true;
    }
}