// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import { EquipmentInteractionHandler, type HandlerCommandContext, type HandlerQueryContext, type ToHitAdjustmentContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE, setInventoryControlMode } from '../utils/inventory-control.util';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';

export const RISC_LASER_STANDARD_MODE = 'Standard';
export const RISC_LASER_PULSE_MODE = 'Pulse';

export class RiscLaserPulseModuleHandler extends EquipmentInteractionHandler {
    readonly id = 'risc-laser-pulse-module-handler';
    override readonly priority = 105;

    override applicableTo(equipment: MountedEquipment): boolean {
        return isRiscLaserPulseModule(equipment) || this.linkedRiscLaserPulseModule(equipment) !== null;
    }

    getChoices(equipment: MountedEquipment, context: HandlerQueryContext): PickerChoice[] {
        const module = this.linkedRiscLaserPulseModule(equipment);
        if (!module || !this.isModuleUsable(equipment, module, context)) return [];

        return [{
            label: 'Mode',
            value: this.selectedMode(equipment),
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: RISC_LASER_STANDARD_MODE },
                { label: 'PULSE', value: RISC_LASER_PULSE_MODE }
            ],
            keepOpen: true
        }];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, _context: HandlerCommandContext): boolean {
        setInventoryControlMode(equipment, String(choice.value));
        return true;
    }

    override applyInventoryControlHeatEffects(equipment: MountedEquipment, effect: InventoryControlHeatEffect, context: HandlerQueryContext): InventoryControlHeatEffect {
        const module = this.linkedRiscLaserPulseModule(equipment);
        return module && this.isModuleUsable(equipment, module, context) && this.selectedMode(equipment) === RISC_LASER_PULSE_MODE
            ? { ...effect, value: effect.value + 2 }
            : effect;
    }

    override getToHitAdjustments(
        equipment: MountedEquipment,
        adjustmentContext: ToHitAdjustmentContext,
        context: HandlerQueryContext
    ): readonly ToHitAdjustment[] {
        const parent = adjustmentContext.parent;
        const label = equipment.getDisplayName();
        if (!parent) return isRiscLaserPulseModule(equipment) ? [{ kind: 'replace-base', value: -2, label }] : [];
        if (!isRiscLaserPulseModule(equipment) || !this.isLaserWithRiscModule(parent)) return [];
        const active = this.isModuleUsable(parent, equipment, context) && this.selectedMode(parent) === RISC_LASER_PULSE_MODE;
        return [{
            kind: 'add',
            label: active ? label : `${label} Inactive`,
            modifier: active ? -2 : 0
        }];
    }

    override canPerformAimedShot(equipment: MountedEquipment, context: HandlerQueryContext): boolean | null {
        const module = this.linkedRiscLaserPulseModule(equipment);
        if (!module || !this.isModuleUsable(equipment, module, context)) return null;
        return this.selectedMode(equipment) === RISC_LASER_PULSE_MODE ? false : null;
    }

    private linkedRiscLaserPulseModule(equipment: MountedEquipment): MountedEquipment | null {
        return linkedRiscLaserPulseModule(equipment);
    }

    private isLaserWithRiscModule(equipment: MountedEquipment): boolean {
        return isLaserWithRiscModule(equipment);
    }

    private isModuleUsable(
        laser: MountedEquipment,
        module: MountedEquipment,
        context: HandlerQueryContext
    ): boolean {
        return context.getStatus(laser) === 'available' && context.getStatus(module) === 'available';
    }

    private selectedMode(equipment: MountedEquipment): string {
        return selectedRiscLaserMode(equipment);
    }
}

export function isRiscLaserPulseModule(equipment: MountedEquipment): boolean {
    return equipment.equipment?.hasFlag('F_WEAPON_ENHANCEMENT') === true
        && equipment.equipment.hasFlag('F_RISC_LASER_PULSE_MODULE');
}

export function isLaserWithRiscModule(equipment: MountedEquipment): boolean {
    return equipment.equipment instanceof WeaponEquipment
        && equipment.equipment.hasFlag('F_ENERGY')
        && equipment.equipment.hasFlag('F_LASER')
        && (equipment.linkedWith?.some(isRiscLaserPulseModule) ?? false);
}

export function linkedRiscLaserPulseModule(equipment: MountedEquipment): MountedEquipment | null {
    if (!isLaserWithRiscModule(equipment)) return null;
    return equipment.linkedWith?.find(isRiscLaserPulseModule) ?? null;
}

export function selectedRiscLaserMode(equipment: MountedEquipment): string {
    const persisted = equipment.states.get(INVENTORY_CONTROL_MODE_STATE);
    return persisted === RISC_LASER_PULSE_MODE ? RISC_LASER_PULSE_MODE : RISC_LASER_STANDARD_MODE;
}
