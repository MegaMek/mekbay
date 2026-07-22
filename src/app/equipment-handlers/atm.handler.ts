import type { PickerChoice } from '../components/picker/picker.interface';
import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';

const ATM_MUNITION_BY_MODE = new Map<string, string>([
    ['Standard', 'M_STANDARD'],
    ['High Explosive', 'M_HIGH_EXPLOSIVE'],
    ['Extended Range', 'M_EXTENDED_RANGE']
]);

export class AtmHandler extends EquipmentInteractionHandler {
    readonly id = 'atm-handler';
    override readonly priority = 110;

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment instanceof WeaponEquipment
            && (equipment.equipment.ammoType === 'ATM' || equipment.equipment.ammoType === 'IATM');
    }

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return true;
    }

    override matchesInventoryAmmo(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, _context: HandlerContext): boolean | null {
        if (!(equipment.equipment instanceof WeaponEquipment) || (equipment.equipment.ammoType !== 'ATM' && equipment.equipment.ammoType !== 'IATM')) return null;
        if (ammo.ammoType !== equipment.equipment.ammoType) return false;
        if (equipment.equipment.rackSize > 0 && ammo.rackSize !== equipment.equipment.rackSize) return false;
        const persistedMode = equipment.states.get(INVENTORY_CONTROL_MODE_STATE);
        const selectedMode = mode ?? (persistedMode && ATM_MUNITION_BY_MODE.has(persistedMode) ? persistedMode : 'Standard');
        const munitionType = ATM_MUNITION_BY_MODE.get(selectedMode) ?? ATM_MUNITION_BY_MODE.get('Standard')!;
        return ammo.hasMunitionType(munitionType);
    }
}