import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/force-serialization';
import type { InventoryControlRuntimeRangeKey } from '../models/inventory-control-runtime-state.model';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';

const VSP_RANGE_HIT_MODIFIERS: Partial<Record<InventoryControlRuntimeRangeKey, number>> = {
    short: -3,
    medium: -2,
    long: -1
};

export class VspPulseHandler extends EquipmentInteractionHandler {
    readonly id = 'vsp-pulse-handler';
    override readonly flags = ['F_VSP'];

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return false;
    }

    override getInventoryControlBaseHitModifier(equipment: MountedEquipment, _context: HandlerContext, range?: InventoryControlRuntimeRangeKey | null): number | null {
        if (!range || !(equipment.equipment instanceof WeaponEquipment)) return null;
        return VSP_RANGE_HIT_MODIFIERS[range] ?? null;
    }
}