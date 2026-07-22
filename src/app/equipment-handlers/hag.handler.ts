/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment, type WeaponType } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import { EquipmentInteractionHandler, type HandlerContext, type ToHitAdjustmentContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE, setInventoryControlMode } from '../utils/inventory-control.util';

export const HAG_STANDARD_MODE = 'Standard';
export const HAG_FLAK_MODE = 'Flak';

export class HagHandler extends EquipmentInteractionHandler {
    readonly id = 'hag-handler';
    override readonly flags = ['F_HAG'];
    override readonly priority = 100;

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment instanceof WeaponEquipment;
    }

    override getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [{
            label: 'Mode',
            value: selectedHagMode(equipment),
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: HAG_STANDARD_MODE },
                { label: 'FLAK', value: HAG_FLAK_MODE }
            ],
            disabled: equipment.isUnavailable(),
            keepOpen: true
        }];
    }

    override handleSelection(equipment: MountedEquipment, choice: PickerChoice, _context: HandlerContext): boolean {
        setInventoryControlMode(equipment, String(choice.value));
        return true;
    }

    override applyInventoryControlWeaponTypes(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        _context: HandlerContext
    ): ReadonlySet<WeaponType> {
        const effectiveTypes = new Set(types);
        if (selectedHagMode(equipment) === HAG_FLAK_MODE) {
            effectiveTypes.delete('DB');
            effectiveTypes.add('F');
        } else {
            effectiveTypes.delete('F');
        }
        return effectiveTypes;
    }

    override getToHitAdjustments(
        equipment: MountedEquipment,
        _adjustmentContext: ToHitAdjustmentContext,
        _context: HandlerContext
    ): readonly ToHitAdjustment[] {
        return selectedHagMode(equipment) === HAG_FLAK_MODE
            ? [{ kind: 'add', value: -1 }]
            : [];
    }
}

export function selectedHagMode(equipment: MountedEquipment): string {
    return equipment.states.get(INVENTORY_CONTROL_MODE_STATE) === HAG_FLAK_MODE
        ? HAG_FLAK_MODE
        : HAG_STANDARD_MODE;
}