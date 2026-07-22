import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import { EquipmentInteractionHandler, type HandlerContext, type ToHitAdjustmentContext } from '../services/equipment-interaction-registry.service';
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

    getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        const module = this.linkedRiscLaserPulseModule(equipment);
        if (!module || !this.isModuleUsable(equipment, module)) return [];

        return [{
            label: 'Mode',
            value: this.selectedMode(equipment),
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: RISC_LASER_STANDARD_MODE },
                { label: 'PULSE', value: RISC_LASER_PULSE_MODE }
            ],
            disabled: equipment.isUnavailable(),
            keepOpen: true
        }];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, _context: HandlerContext): boolean {
        setInventoryControlMode(equipment, String(choice.value));
        return true;
    }

    override applyInventoryControlHeatEffects(equipment: MountedEquipment, effect: InventoryControlHeatEffect, _context: HandlerContext): InventoryControlHeatEffect {
        const module = this.linkedRiscLaserPulseModule(equipment);
        return module && this.isModuleUsable(equipment, module) && this.selectedMode(equipment) === RISC_LASER_PULSE_MODE
            ? { ...effect, value: effect.value + 2 }
            : effect;
    }

    override getToHitAdjustments(equipment: MountedEquipment, context: ToHitAdjustmentContext): readonly ToHitAdjustment[] {
        const parent = context.parent;
        if (!parent) return isRiscLaserPulseModule(equipment) ? [{ kind: 'replace-base', value: -2 }] : [];
        if (!isRiscLaserPulseModule(equipment) || !this.isLaserWithRiscModule(parent)) return [];
        const active = this.isModuleUsable(parent, equipment) && this.selectedMode(parent) === RISC_LASER_PULSE_MODE;
        return [{ kind: 'add', value: active ? -2 : 0 }];
    }

    override canPerformAimedShot(equipment: MountedEquipment, _context: HandlerContext): boolean | null {
        const module = this.linkedRiscLaserPulseModule(equipment);
        if (!module || !this.isModuleUsable(equipment, module)) return null;
        return this.selectedMode(equipment) === RISC_LASER_PULSE_MODE ? false : null;
    }

    private linkedRiscLaserPulseModule(equipment: MountedEquipment): MountedEquipment | null {
        return linkedRiscLaserPulseModule(equipment);
    }

    private isLaserWithRiscModule(equipment: MountedEquipment): boolean {
        return isLaserWithRiscModule(equipment);
    }

    private isModuleUsable(laser: MountedEquipment, module: MountedEquipment): boolean {
        return !laser.isUnavailable() && !module.isUnavailable();
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
