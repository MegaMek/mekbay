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
 * Base handler for simple on/off equipment
 */
export abstract class ToggleHandler extends EquipmentInteractionHandler {
    protected readonly enabledLabel: string = 'Enable';
    protected readonly disabledLabel: string = 'Disable';
    
    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const currentState = equipment.state || 'disabled';
        return [
            {
                label: this.enabledLabel,
                value: 'enabled',
                disabled: equipment.destroyed || currentState === 'enabled',
                active: currentState === 'enabled'
            },
            {
                label: this.disabledLabel,
                value: 'disabled',
                disabled: equipment.destroyed || currentState === 'disabled',
                active: currentState === 'disabled'
            }
        ];
    }
    
    handleSelection(equipment: MountedEquipment, value: PickerValue, context: HandlerContext): boolean {
        equipment.state = value as string;
        equipment.owner.setInventoryEntry(equipment);
        context.toastService.show(
            `${equipment.name} ${value === 'enabled' ? this.enabledLabel : this.disabledLabel}`,
            'info'
        );
        return false;
    }
}