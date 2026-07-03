import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/force-serialization';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';

export class LaserInsulatorHandler extends EquipmentInteractionHandler {
    readonly id = 'laser-insulator-handler';
    override readonly flags = ['F_ENERGY', 'F_LASER'];

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.linkedWith?.some(linked => this.isLaserInsulator(linked)) ?? false;
    }

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return false;
    }

    override applyInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        _options: InventoryControlDisplayEffectOptions,
        _context: HandlerContext
    ): InventoryControlDisplayData {
        if (!equipment.linkedWith?.some(linked => this.isLaserInsulator(linked) && linked.isUnavailable())) return display;
        const heat = addNumericBonus(display.heat, 1);
        if (heat === null) return display;
        return { ...display, heat };
    }

    private isLaserInsulator(equipment: MountedEquipment): boolean {
        return equipment.equipment?.hasFlag('F_WEAPON_ENHANCEMENT') === true
            && equipment.equipment.hasFlag('F_LASER_INSULATOR');
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