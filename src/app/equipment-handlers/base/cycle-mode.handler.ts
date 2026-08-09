// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentInteractionHandler, type HandlerCommandContext, type HandlerQueryContext } from '../../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../../models/mounted-equipment.model';
import type { PickerChoice, PickerValue } from '../../components/picker/picker.interface';

/**
 * Base handler for equipment with multiple modes
 */
export abstract class CycleModeHandler extends EquipmentInteractionHandler {
    protected readonly modeLabel: string = 'Mode';
    protected readonly stateKey: string = 'state';
    protected abstract getModes(equipment: MountedEquipment): Array<PickerChoice>;
    protected abstract getDefaultMode(): string;
    
    getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        const nextMode = this.getNextMode(equipment);
        
        // Return single choice representing the next mode
        return [nextMode];
    }
    
    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerCommandContext): boolean {
        if (equipment.setState(this.stateKey, String(choice.value))) {
            equipment.owner.setInventoryEntry(equipment);
        }
        
        context.toastService.showToast(
            `${equipment.equipment?.name||equipment.name} changed ${this.modeLabel.toLowerCase()}: ${choice.label}`,
            choice.tooltipType || 'info'
        );
        return true;
    }
    
    /**
     * Get the current mode display name
     */
    getCurrentMode(equipment: MountedEquipment): string {
        const currentState = this.getCurrentState(equipment);
        const mode = this.getModes(equipment).find(m => m.value === currentState);
        return mode?.label || currentState;
    }

    private getCurrentState(equipment: MountedEquipment): string {
        return equipment.states?.get(this.stateKey) || this.getDefaultMode();
    }
    
    /**
     * Get the next mode that will be cycled to
     */
    getNextMode(equipment: MountedEquipment): PickerChoice {
        const currentState = this.getCurrentState(equipment);
        const modes = this.getModes(equipment);
        const currentIndex = modes.findIndex(m => m.value === currentState);
        
        // Calculate next mode (wrap around to first if at end)
        const nextIndex = currentIndex === -1 || currentIndex === modes.length - 1 
            ? 0 
            : currentIndex + 1;
        
        return modes[nextIndex];
    }
}
