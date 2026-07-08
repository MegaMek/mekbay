import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/force-serialization';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE, setInventoryControlMode, type InventoryControlDisplayData, type InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';

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

    override applyInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        _options: InventoryControlDisplayEffectOptions,
        _context: HandlerContext
    ): InventoryControlDisplayData {
        const module = this.linkedRiscLaserPulseModule(equipment);
        if (!module || !this.isModuleUsable(equipment, module) || this.selectedMode(equipment) !== RISC_LASER_PULSE_MODE) return display;
        const heat = addNumericBonus(display.heat, 2);
        return heat === null ? display : { ...display, heat };
    }

    override getInventoryControlBaseHitModifier(equipment: MountedEquipment): number | null {
        return isRiscLaserPulseModule(equipment) ? -2 : null;
    }

    override getLinkedEquipmentHitModifier(equipment: MountedEquipment, parent: MountedEquipment): number | null {
        if (!isRiscLaserPulseModule(equipment) || !this.isLaserWithRiscModule(parent)) return null;
        if (!this.isModuleUsable(parent, equipment) || this.selectedMode(parent) !== RISC_LASER_PULSE_MODE) return 0;
        return -2;
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

function addNumericBonus(value: string, bonus: number): string | null {
    const match = value.trim().match(/^([+-]?\d+(?:\.\d+)?)(.*)$/);
    if (!match) return null;
    const next = Number.parseFloat(match[1]) + bonus;
    if (!Number.isFinite(next)) return null;
    const nextText = Number.isInteger(next) ? next.toString() : next.toFixed(1).replace(/\.0$/, '');
    return `${nextText}${match[2]}`;
}
