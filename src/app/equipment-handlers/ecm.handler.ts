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

import { EquipmentInteractionHandler, HandlerContext } from '../services/equipment-interaction-registry.service';
import { MountedEquipment } from '../models/force-serialization';
import { PickerChoice, PickerValue } from '../components/picker/picker.interface';
import { ECMMode } from '../models/common.model';

export class ECMHandler extends EquipmentInteractionHandler {
    readonly id = 'ecm-handler';
    readonly flags = ['F_ECM'];
    override readonly priority = 10;

    private readonly stateKey = 'ecm_mode';

    private getDefaultMode(): string {
        return ECMMode.ECM;
    }

    private getModes(equipment: MountedEquipment) {
        const modes = [
            { value: ECMMode.ECM, label: 'ECM' },
            { value: ECMMode.ECCM, label: 'ECCM' },
            { value: ECMMode.GHOST, label: 'Ghost' },
            { value: ECMMode.OFF, label: 'Off' }
        ];
        if (equipment.equipment?.flags.has('F_ANGEL_ECM')) {
            modes.splice(modes.length - 1, 0, // Insert before "Off"
                {
                    label: 'ECM+ECCM',
                    value: ECMMode.ECM_ECCM,
                },
                {
                    label: 'ECM+Ghost',
                    value: ECMMode.ECM_GHOST,
                },
                {
                    label: 'ECCM+Ghost',
                    value: ECMMode.ECCM_GHOST,
                }
            );
        }
        return modes;
    }

    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const currentState = equipment.states?.get(this.stateKey) || this.getDefaultMode();
        const modes = this.getModes(equipment);

        return [
            {
                label: 'ECM Mode:',
                value: currentState,
                displayType: 'dropdown',
                choices: modes,
                disabled: equipment.destroyed,
                keepOpen: true
            }
        ];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        equipment.states?.set(this.stateKey, String(choice.value));
        equipment.owner.setInventoryEntry(equipment);
        context.toastService.show(
            `${equipment.equipment?.name||equipment.name} mode: ${choice.label}`,
            'info'
        );
        return true;
    }

    isActive(equipment: MountedEquipment): boolean {
        const ecmMode = equipment.states?.get(this.stateKey);
        return (ecmMode || ECMMode.ECM) !== ECMMode.OFF;
    }
}