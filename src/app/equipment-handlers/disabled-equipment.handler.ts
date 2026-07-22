import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    ENTRY_DISABLED_STATE_KEY,
    ENTRY_DISABLED_STATE_VALUE,
} from '../models/rules/unit-type-rules';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';

const DISABLEABLE_EQUIPMENT_FLAGS = ['F_RADICAL_HEATSINK'] as const;

export function isEquipmentDisabledByFailure(equipment: MountedEquipment): boolean {
    return equipment.states.get(ENTRY_DISABLED_STATE_KEY) === ENTRY_DISABLED_STATE_VALUE;
}

export abstract class DisabledStateToggleHandler extends EquipmentInteractionHandler {
    protected readonly enabledLabel: string = 'Disable';
    protected readonly disabledLabel: string = 'Disabled';
    protected readonly enabledShortLabel: string = 'Disable';
    protected readonly disabledShortLabel: string = 'Enable';
    protected readonly enabledToastVerb: string = 'disabled';
    protected readonly disabledToastVerb: string = 'enabled';

    override readonly priority = 10;

    getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        const disabled = isEquipmentDisabledByFailure(equipment);
        return [{
            label: disabled ? this.disabledLabel : this.enabledLabel,
            shortLabel: disabled ? this.disabledShortLabel : this.enabledShortLabel,
            value: disabled ? 'false' : ENTRY_DISABLED_STATE_VALUE,
            displayType: 'toggle',
            disabled: equipment.isDestroyed(),
            active: disabled,
            tooltipType: disabled ? 'error' : undefined
        }];
    }

    handleSelection(equipment: MountedEquipment, _choice: PickerChoice, context: HandlerContext): boolean {
        const disabled = isEquipmentDisabledByFailure(equipment);
        const changed = disabled
            ? equipment.deleteState(ENTRY_DISABLED_STATE_KEY)
            : equipment.setState(ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE);
        if (!changed) return true;

        equipment.owner.setInventoryEntry(equipment);
        context.toastService.showToast(
            `${equipment.equipment?.name || equipment.name} is ${disabled ? this.disabledToastVerb : this.enabledToastVerb}`,
            disabled ? 'info' : 'error'
        );
        return true;
    }
}

export class DisabledEquipmentHandler extends DisabledStateToggleHandler {
    readonly id = 'disabled-equipment-handler';

    override applicableTo(equipment: MountedEquipment): boolean {
        const flags = equipment.equipment?.flags;
        return !!flags && DISABLEABLE_EQUIPMENT_FLAGS.some(flag => flags.has(flag));
    }
}