import type { PickerChoice } from '../components/picker/picker.interface';
import type { AmmoEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/force-serialization';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';

export class ArtemisVHandler extends EquipmentInteractionHandler {
    readonly id = 'artemis-v-handler';
    override readonly flags = ['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'];

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return false;
    }

    override getLinkedEquipmentHitModifier(equipment: MountedEquipment, _parent: MountedEquipment, selectedAmmo?: AmmoEquipment | null): number {
        if (equipment.isUnavailable()) return 1;
        if (selectedAmmo !== undefined && !selectedAmmo?.hasMunitionType('M_ARTEMIS_V_CAPABLE')) return 1;
        return 0;
    }
}