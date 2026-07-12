import type { PickerChoice } from '../components/picker/picker.interface';
import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/force-serialization';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import { getSelectedInventoryControlMode } from '../utils/inventory-control.util';

export class MmlHandler extends EquipmentInteractionHandler {
    readonly id = 'mml-handler';
    override readonly priority = 110;

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment instanceof WeaponEquipment && equipment.equipment.ammoType === 'MML';
    }

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return true;
    }

    override matchesInventoryAmmo(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, _context: HandlerContext): boolean | null {
        if (!(equipment.equipment instanceof WeaponEquipment) || equipment.equipment.ammoType !== 'MML') return null;
        if (ammo.ammoType !== 'MML') return false;
        if (equipment.equipment.rackSize > 0 && ammo.rackSize !== equipment.equipment.rackSize) return false;
        const normalizedMode = (mode ?? getSelectedInventoryControlMode(equipment) ?? 'LRM').toLocaleLowerCase();
        const ammoName = `${ammo.shortName} ${ammo.name}`.toLocaleLowerCase();
        if (normalizedMode.includes('lrm')) return ammo.hasFlag('F_MML_LRM') || ammoName.includes('lrm');
        if (normalizedMode.includes('srm')) return ammo.hasFlag('F_MML_SRM') || ammoName.includes('srm');
        return true;
    }
}