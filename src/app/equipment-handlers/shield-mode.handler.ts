// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';
import type {
    InventoryControlDisplayData,
    InventoryControlDisplayEffectOptions,
} from '../utils/inventory-control.util';
import {
    selectedShieldMode,
    setShieldMode,
    shieldModeOptions,
    SHIELD_INACTIVE_MODE,
    SHIELD_RAISED_MODE,
    type ShieldMode,
} from '../utils/shield-mode.util';

export class ShieldModeHandler extends EquipmentInteractionHandler {
    readonly id = 'shield-mode-handler';
    override readonly flags: EquipmentFlag[] = ['F_SHIELD'];
    override readonly priority = 100;

    override applicableTo(mounted: MountedEquipment): boolean {
        return mounted.equipment?.hasFlag('F_SHIELD') === true;
    }

    override getChoices(mounted: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [{
            label: 'Mode',
            value: selectedShieldMode(mounted),
            displayType: 'dropdown',
            choices: shieldModeOptions(mounted).map(mode => ({ ...mode })),
            keepOpen: true,
        }];
    }

    override handleSelection(
        mounted: MountedEquipment,
        choice: PickerChoice,
        _context: HandlerCommandContext,
    ): boolean {
        const mode = String(choice.value) as ShieldMode;
        if (!shieldModeOptions(mounted).some(option => option.value === mode)) return true;
        if (mounted.owner.gameRules.id === 'core2026' && mode === SHIELD_RAISED_MODE) {
            for (const other of mounted.owner.getInventory()) {
                if (other.id !== mounted.id
                    && other.equipment?.hasFlag('F_SHIELD') === true
                    && selectedShieldMode(other) === SHIELD_RAISED_MODE) {
                    setShieldMode(other, SHIELD_INACTIVE_MODE);
                }
            }
        }
        setShieldMode(mounted, mode);
        return true;
    }

    override applyInventoryControlDisplayEffects(
        mounted: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        _context: HandlerQueryContext,
    ): InventoryControlDisplayData {
        if (!options.showModeName) return display;

        const selectedMode = selectedShieldMode(mounted);
        const label = shieldModeOptions(mounted)
            .find(mode => mode.value === selectedMode)?.label ?? selectedMode;
        const baseName = display.name.replace(/\s+\((?:Lowered|Raised|Inactive|Active|Passive)\)$/, '');
        return { ...display, name: `${baseName} (${label})` };
    }

    override onEndPhase(mounted: MountedEquipment): void {
        if (mounted.owner.gameRules.id === 'core2026'
            && selectedShieldMode(mounted) === SHIELD_RAISED_MODE) {
            setShieldMode(mounted, SHIELD_INACTIVE_MODE);
        }
    }
}
