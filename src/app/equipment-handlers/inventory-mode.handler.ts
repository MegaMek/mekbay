import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    getInventoryControlModeChoices,
    getInventoryControlModes,
    getSelectedInventoryControlMode,
    setInventoryControlMode
} from '../utils/inventory-control.util';

export const INVENTORY_MODE_HANDLER_ID = 'inventory-mode-handler';
export const INVENTORY_MODE_CHOICE_LABEL = 'Mode';

export class InventoryModeHandler extends EquipmentInteractionHandler {
    readonly id = INVENTORY_MODE_HANDLER_ID;
    override readonly priority = 100;

    override applicableTo(equipment: MountedEquipment): boolean {
        return getInventoryControlModes(equipment).length > 0;
    }

    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const choices = getInventoryControlModeChoices(equipment, context.dataService.getEquipments());
        if (choices.length === 0) return [];

        const currentMode = getSelectedInventoryControlMode(
            equipment,
            context.dataService.getEquipments(),
            equipment.owner.getInventoryControlRules?.() ?? {}
        ) ?? choices[0].value;
        return [
            {
                label: INVENTORY_MODE_CHOICE_LABEL,
                value: currentMode,
                displayType: 'dropdown',
                choices,
                disabled: equipment.isUnavailable(),
                keepOpen: true
            }
        ];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        setInventoryControlMode(equipment, String(choice.value));
        return true;
    }
}
