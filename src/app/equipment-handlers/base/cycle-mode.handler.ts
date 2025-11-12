/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { EquipmentInteractionHandler, HandlerContext } from '../../services/equipment-interaction-registry.service';
import { MountedEquipment } from '../../models/force-serialization';
import { PickerChoice, PickerValue } from '../../components/picker/picker.interface';

/**
 * Base handler for equipment with multiple modes
 */
export abstract class CycleModeHandler extends EquipmentInteractionHandler {
    protected abstract getModes(equipment: MountedEquipment): Array<{ value: string; label: string; shortLabel?: string }>;
    protected abstract getDefaultMode(): string;
    
    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const currentState = equipment.state || this.getDefaultMode();
        const modes = this.getModes(equipment);
        const currentMode = modes.find(m => m.value === currentState);
        
        
        // Return single choice representing the current mode
        return [{
            label: 'Mode: ' + (currentMode?.label || currentState),
            shortLabel: currentMode?.shortLabel || currentMode?.label || currentState,
            value: currentMode?.value || currentState,
            disabled: equipment.destroyed,
            active: false,
            keepOpen: true,
        }];
    }
    
    handleSelection(equipment: MountedEquipment, value: PickerValue, context: HandlerContext): boolean {
        const modes = this.getModes(equipment);
        const currentIndex = modes.findIndex(m => m.value === value);
        // Calculate next mode (wrap around to first if at end)
        const nextIndex = currentIndex === -1 || currentIndex === modes.length - 1 
            ? 0 
            : currentIndex + 1;
        const nextMode = modes[nextIndex];
        equipment.state = nextMode.value;
        equipment.owner.setInventoryEntry(equipment);
        
        context.toastService.show(
            `${equipment.name} mode: ${nextMode?.label || value}`,
            'info'
        );
        return true;
    }
    
    /**
     * Get the current mode display name
     */
    getCurrentMode(equipment: MountedEquipment): string {
        const currentState = equipment.state || this.getDefaultMode();
        const mode = this.getModes(equipment).find(m => m.value === currentState);
        return mode?.label || currentState;
    }
    
    /**
     * Get the next mode that will be cycled to
     */
    getNextMode(equipment: MountedEquipment): { value: string; label: string; shortLabel?: string } {
        const currentState = equipment.state || this.getDefaultMode();
        const modes = this.getModes(equipment);
        const currentIndex = modes.findIndex(m => m.value === currentState);
        
        // Calculate next mode (wrap around to first if at end)
        const nextIndex = currentIndex === -1 || currentIndex === modes.length - 1 
            ? 0 
            : currentIndex + 1;
        
        return modes[nextIndex];
    }
}