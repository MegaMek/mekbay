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
        const unavailable = equipment.isUnavailable();
        const unitJammed = equipment.owner.getCondition('jammed');
        const incompatibleAmmo = selectedAmmo !== undefined && !selectedAmmo?.hasMunitionType('M_ARTEMIS_V_CAPABLE');
        const weakened = unavailable || unitJammed || incompatibleAmmo;
        const label = equipment.equipment?.shortName ?? equipment.name;
        const unavailableLabel = unavailable
            ? `${label} Destroyed`
            : unitJammed
                ? 'Unit Jammed'
                : selectedAmmo
                    ? `Incompatible Ammo (${selectedAmmo.shortName})`
                    : 'Artemis V Ammo Not Selected';
        return [{
            kind: 'add',
            label: weakened ? unavailableLabel : label,
            modifier: weakened ? 0 : -1,
            weakened
        }];
    }
}