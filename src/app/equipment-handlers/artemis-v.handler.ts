import type { PickerChoice } from '../components/picker/picker.interface';
import { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import { isArtemisCompatibleWeapon } from '../models/entity/utils/equipment-link-rules';
import { EquipmentInteractionHandler, type HandlerContext, type ToHitAdjustmentContext } from '../services/equipment-interaction-registry.service';

export class ArtemisVHandler extends EquipmentInteractionHandler {
    readonly id = 'artemis-v-handler';
    override readonly flags: EquipmentFlag[] = ['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'];

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerContext): boolean {
        return false;
    }

    override getToHitAdjustments(equipment: MountedEquipment, context: ToHitAdjustmentContext): readonly ToHitAdjustment[] {
        const weapon = context.parent?.equipment;
        if (!weapon || !isArtemisCompatibleWeapon(weapon)) return [];
        const selectedAmmo = context.selectedAmmo;
        const weakened = equipment.isUnavailable()
            || (selectedAmmo !== undefined && !selectedAmmo?.hasMunitionType('M_ARTEMIS_V_CAPABLE'));
        return [{ kind: 'add', value: weakened ? 0 : -1, weakened }];
    }
}