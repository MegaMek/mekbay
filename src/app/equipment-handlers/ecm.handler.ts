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
import { MountedEquipment } from '../models/force-unit.model';
import { PickerChoice, PickerValue } from '../components/picker/picker.interface';
import { CycleModeHandler } from './base/cycle-mode.handler';

export class ECMHandler extends CycleModeHandler {
    readonly id = 'ecm-handler';
    readonly flag = 'F_ECM';
    override readonly priority = 10;

    protected getDefaultMode(): string {
        return 'ecm';
    }

    protected getModes(equipment: MountedEquipment) {
        const modes = [
            { value: 'ecm', label: 'ECM', shortLabel: 'ECM' },
            { value: 'eccm', label: 'ECCM', shortLabel: 'ECCM' },
            { value: 'ghost', label: 'Ghost', shortLabel: 'Ghost' },
            { value: 'off', label: 'Off', shortLabel: 'Off' }
        ];
        if (equipment.equipment?.flags.has('F_ANGEL_ECM')) {
            modes.splice(modes.length - 1, 0, // Insert before "Off"
                {
                    label: 'ECM+ECCM',
                    shortLabel: 'Dual',
                    value: 'ecm-eccm',
                },
                {
                    label: 'ECM+Ghost',
                    shortLabel: 'ECM+Ghost',
                    value: 'ecm-ghost',
                },
                {
                    label: 'ECCM+Ghost',
                    shortLabel: 'ECCM+Ghost',
                    value: 'eccm-ghost',
                }
            );
        }
        return modes;
    }

    // Override to add Angel ECM support
    override getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const choices = super.getChoices(equipment, context);
        return choices;
    }

    isActive(equipment: MountedEquipment): boolean {
        return (equipment.state || 'ecm') !== 'off';
    }
}