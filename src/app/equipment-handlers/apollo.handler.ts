import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/force-serialization';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';

export class ApolloHandler extends EquipmentInteractionHandler {
    readonly id = 'apollo-handler';
    override readonly flags = ['F_WEAPON_ENHANCEMENT', 'F_APOLLO'];

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return false;
    }

    override getLinkedEquipmentHitModifier(equipment: MountedEquipment, _parent: MountedEquipment): number {
        return equipment.isUnavailable() ? 1 : 0;
    }
}