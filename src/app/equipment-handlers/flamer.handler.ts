// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { WeaponEquipment } from '../models/equipment.model';
import type { WeaponType } from '../models/weapon-types.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext
} from '../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';
import { INVENTORY_CONTROL_MODE_STATE, setInventoryControlMode } from '../utils/inventory-control.util';

export const FLAMER_DAMAGE_MODE = 'Damage';
export const FLAMER_HEAT_MODE = 'Heat';

const FLAMER_MODES = [FLAMER_DAMAGE_MODE, FLAMER_HEAT_MODE] as const;
type FlamerMode = typeof FLAMER_MODES[number];

export class FlamerHandler extends EquipmentInteractionHandler {
    readonly id = 'flamer-handler';
    override readonly flags: EquipmentFlag[] = ['F_FLAMER'];
    override readonly priority = 105;

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.owner.gameRules.supportsFlamerModes
            && equipment.equipment instanceof WeaponEquipment;
    }

    override getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [{
            label: 'Mode',
            value: selectedFlamerMode(equipment),
            displayType: 'dropdown',
            choices: FLAMER_MODES.map(mode => ({ label: mode, value: mode })),
            keepOpen: true
        }];
    }

    override handleSelection(equipment: MountedEquipment, choice: PickerChoice, _context: HandlerCommandContext): boolean {
        const mode = String(choice.value);
        if (isFlamerMode(mode)) setInventoryControlMode(equipment, mode);
        return true;
    }

    override applyInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        _context: HandlerQueryContext
    ): InventoryControlDisplayData {
        return options.showModeName && selectedFlamerMode(equipment) === FLAMER_HEAT_MODE
            ? { ...display, name: `${display.name} (${FLAMER_HEAT_MODE})` }
            : display;
    }

    override applyInventoryControlWeaponTypes(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        _context: HandlerQueryContext
    ): ReadonlySet<WeaponType> {
        if (selectedFlamerMode(equipment) === FLAMER_HEAT_MODE || !types.has('H')) return types;
        const damageTypes = new Set(types);
        damageTypes.delete('H');
        return damageTypes;
    }
}

export function selectedFlamerMode(equipment: MountedEquipment): FlamerMode {
    const mode = equipment.states.get(INVENTORY_CONTROL_MODE_STATE);
    return mode && isFlamerMode(mode) ? mode : FLAMER_DAMAGE_MODE;
}

function isFlamerMode(mode: string): mode is FlamerMode {
    return FLAMER_MODES.some(candidate => candidate === mode);
}
