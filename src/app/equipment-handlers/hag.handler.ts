// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { EquipmentFlag } from '../models/equipment-flags.type';
import { WeaponEquipment } from '../models/equipment.model';
import type { WeaponType } from '../models/weapon-types.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import { EquipmentInteractionHandler, type HandlerCommandContext, type HandlerQueryContext, type ToHitAdjustmentContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE, setInventoryControlMode } from '../utils/inventory-control.util';

export const HAG_STANDARD_MODE = 'Standard';
export const HAG_FLAK_MODE = 'Flak';

export class HagHandler extends EquipmentInteractionHandler {
    readonly id = 'hag-handler';
    override readonly flags: EquipmentFlag[] = ['F_HAG'];
    override readonly priority = 100;

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment instanceof WeaponEquipment;
    }

    override getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [{
            label: 'Mode',
            value: selectedHagMode(equipment),
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: HAG_STANDARD_MODE },
                { label: 'FLAK', value: HAG_FLAK_MODE }
            ],
            keepOpen: true
        }];
    }

    override handleSelection(equipment: MountedEquipment, choice: PickerChoice, _context: HandlerCommandContext): boolean {
        setInventoryControlMode(equipment, String(choice.value));
        return true;
    }

    override applyInventoryControlWeaponTypes(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        _context: HandlerQueryContext
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
        _context: HandlerQueryContext
    ): readonly ToHitAdjustment[] {
        return selectedHagMode(equipment) === HAG_FLAK_MODE
            ? [{
                kind: 'add',
                label: `${equipment.equipment?.shortName ?? equipment.name} (FLAK)`,
                modifier: -1
            }]
            : [];
    }
}

export function selectedHagMode(equipment: MountedEquipment): string {
    return equipment.states.get(INVENTORY_CONTROL_MODE_STATE) === HAG_FLAK_MODE
        ? HAG_FLAK_MODE
        : HAG_STANDARD_MODE;
}
