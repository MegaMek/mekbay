import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/force-serialization';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';

export class LaserInsulatorHandler extends EquipmentInteractionHandler {
    readonly id = 'laser-insulator-handler';
    override readonly flags = ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR'];

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return false;
    }

    override applyLinkedInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        display: InventoryControlDisplayData,
        _options: InventoryControlDisplayEffectOptions,
        _context: HandlerContext
    ): InventoryControlDisplayData {
        if (!this.isLaser(parent) || !equipment.isUnavailable()) return display;
        const heat = addNumericBonus(display.heat, 1);
        if (heat === null) return display;
        return { ...display, heat };
    }

    private isLaser(equipment: MountedEquipment): boolean {
        return equipment.equipment?.hasFlag('F_ENERGY') === true
            && equipment.equipment.hasFlag('F_LASER');
    }
}

function addNumericBonus(value: string, bonus: number): string | null {
    const match = value.trim().match(/^([+-]?\d+(?:\.\d+)?)(\s*\*)?(.*)$/);
    if (!match) return null;
    const next = Number.parseFloat(match[1]) + bonus;
    if (!Number.isFinite(next)) return null;
    const nextText = Number.isInteger(next) ? next.toString() : next.toFixed(1).replace(/\.0$/, '');
    return `${nextText}${match[3]}`;
}