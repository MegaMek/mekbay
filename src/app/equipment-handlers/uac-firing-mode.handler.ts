// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext
} from '../services/equipment-interaction-registry.service';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import { INVENTORY_CONTROL_MODE_STATE, setInventoryControlMode, type InventoryControlDisplayData, type InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';

export class UACFiringModeHandler extends EquipmentInteractionHandler {
    readonly id = 'uac-firing-mode-handler';
    override readonly flags: EquipmentFlag[] = ['F_AC'];
    override readonly priority = 105;

    override applicableTo = (equipment: MountedEquipment): boolean => {
        if (equipment.equipment instanceof WeaponEquipment) {
            const ammoType = equipment.equipment.ammoType;
            if (ammoType === 'AC_ROTARY') return true;
            if (equipment.owner?.gameRules.usesUacJamming) {
                return ammoType === 'AC_ULTRA' || ammoType === 'AC_ULTRA_THB';
            }
        }
        return false;
    };

    override getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        const modes = uacFiringModes(equipment);
        if (modes.length === 0) return [];

        return [{
            label: 'Mode',
            value: selectedUacFiringMode(equipment) ?? modes[0],
            displayType: 'dropdown',
            choices: modes.map(mode => ({ label: mode, value: mode })),
            keepOpen: true
        }];
    }

    override handleSelection(equipment: MountedEquipment, choice: PickerChoice, _context: HandlerCommandContext): boolean {
        const mode = String(choice.value);
        if (!uacFiringModes(equipment).includes(mode)) return true;
        setInventoryControlMode(equipment, mode);
        return true;
    }

    override applyInventoryControlHeatEffects(
        equipment: MountedEquipment,
        effect: InventoryControlHeatEffect,
        _context: HandlerQueryContext
    ): InventoryControlHeatEffect {
        const shotCount = selectedUacFiringModeShotCount(equipment);
        return shotCount > 1
            ? { ...effect, value: effect.value * shotCount, displayValue: effect.value }
            : effect;
    }

    override applyInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        _context: HandlerQueryContext,
    ): InventoryControlDisplayData {
        const mode = selectedUacFiringMode(equipment);
        return options.showModeName && selectedUacFiringModeShotCount(equipment) > 1 && mode
            ? { ...display, name: `${display.name} (${mode})` }
            : display;
    }
}

export function selectedUacFiringMode(equipment: MountedEquipment): string | null {
    const modes = uacFiringModes(equipment);
    if (modes.length === 0) return null;

    const persistedMode = equipment.states.get(INVENTORY_CONTROL_MODE_STATE);
    return persistedMode && modes.includes(persistedMode) ? persistedMode : modes[0];
}

export function selectedUacFiringModeShotCount(equipment: MountedEquipment): number {
    const modes = uacFiringModes(equipment);
    const selectedMode = selectedUacFiringMode(equipment);
    const modeIndex = selectedMode ? modes.indexOf(selectedMode) : -1;
    return modeIndex >= 0 ? modeIndex + 1 : 1;
}

function uacFiringModes(equipment: MountedEquipment): readonly string[] {
    return equipment.equipment instanceof WeaponEquipment ? equipment.equipment.modes : [];
}