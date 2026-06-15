import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/force-serialization';
import {
    getInventoryControlModeChoices,
    getInventoryControlModes,
    getSelectedInventoryControlMode,
    setInventoryControlMode
} from '../utils/inventory-control.util';

export class InventoryModeHandler extends EquipmentInteractionHandler {
    readonly id = 'inventory-mode-handler';
    override readonly priority = 100;

    override applicableTo(equipment: MountedEquipment): boolean {
        return getInventoryControlModes(equipment).length > 0;
    }

    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const choices = getInventoryControlModeChoices(equipment, context.dataService.getEquipments());
        if (choices.length === 0) return [];

        const currentMode = getSelectedInventoryControlMode(equipment) ?? choices[0].value;
        return [
            {
                label: 'Mode',
                value: currentMode,
                displayType: 'dropdown',
                choices,
                disabled: !!equipment.destroyed,
                keepOpen: true
            }
        ];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        setInventoryControlMode(equipment, String(choice.value));
        return true;
    }
}
