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

import { EquipmentInteractionHandler, type HandlerContext } from '../../services/equipment-interaction-registry.service';
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
    
    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const currentState = equipment.states?.get(this.stateKey) || 'disabled';
        const nextState = currentState === 'enabled' ? 'disabled' : 'enabled';
        return [
            {
                label: currentState === 'enabled' ? this.enabledLabel : this.disabledLabel,
                value: nextState,
                disabled: equipment.isUnavailable(),
                active: currentState === 'enabled',
                displayType: 'toggle',
            },
        ];
    }
    
    handleSelection(equipment: MountedEquipment, value: PickerChoice, context: HandlerContext): boolean {
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