import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';

export class LaserInsulatorHandler extends EquipmentInteractionHandler {
    readonly id = 'laser-insulator-handler';
    override readonly flags = ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR'];

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return false;
    }

    override applyLinkedInventoryControlHeatEffects(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        effect: InventoryControlHeatEffect,
        _context: HandlerContext
    ): InventoryControlHeatEffect {
        if (!this.isLaser(parent)) return effect;
        return equipment.isUnavailable()
            ? { ...effect, weakened: true }
            : { ...effect, value: Math.max(1, effect.value - 1), suffix: '*' };
    }

    private isLaser(equipment: MountedEquipment): boolean {
        return equipment.equipment?.hasFlag('F_ENERGY') === true
            && equipment.equipment.hasFlag('F_LASER');
    }
}