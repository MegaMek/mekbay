// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentInteractionHandler, type HandlerCommandContext, type HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { PickerChoice, PickerValue } from '../components/picker/picker.interface';
import { ECMMode } from '../models/common.model';
import { EquipmentFlag } from '../models/equipment-flags.type';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { unitHasActiveC3DisruptingStealth } from '../models/stealth-equipment.model';
import { ECM_MODE_STATE_KEY, isEcmModeActive } from '../utils/ecm-state.util';

export { ECM_MODE_STATE_KEY } from '../utils/ecm-state.util';

export class ECMHandler extends EquipmentInteractionHandler {
    readonly id = 'ecm-handler';
    override readonly flags: EquipmentFlag[] = ['F_ECM'];
    override readonly priority = 10;

    override applicableTo(equipment: MountedEquipment): boolean {
        // Nova CEWS has one shared ECM/Active Probe/C3 power state.
        return equipment.equipment?.flags.has('F_NOVA') !== true;
    }

    private getDefaultMode(): string {
        return ECMMode.ECM;
    }

    private getModes(equipment: MountedEquipment) {
        const modes = [
            { value: ECMMode.ECM, label: 'ECM' },
            { value: ECMMode.ECCM, label: 'ECCM' },
            { value: ECMMode.GHOST, label: 'Ghost' },
            { value: ECMMode.OFF, label: 'Off' }
        ];
        if (equipment.equipment?.flags.has('F_ANGEL_ECM')) {
            modes.splice(modes.length - 1, 0, // Insert before "Off"
                {
                    label: 'ECM+ECCM',
                    value: ECMMode.ECM_ECCM,
                },
                {
                    label: 'ECM+Ghost',
                    value: ECMMode.ECM_GHOST,
                },
                {
                    label: 'ECCM+Ghost',
                    value: ECMMode.ECCM_GHOST,
                }
            );
        }
        return modes;
    }

    getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        const currentState = equipment.states?.get(ECM_MODE_STATE_KEY) || this.getDefaultMode();
        const modes = this.getModes(equipment);

        return [
            {
                label: 'ECM Mode',
                value: currentState,
                displayType: 'dropdown',
                choices: modes,
                keepOpen: true
            }
        ];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerCommandContext): boolean {
        if (equipment.setState(ECM_MODE_STATE_KEY, String(choice.value))) {
            equipment.owner.setInventoryEntry(equipment);
        }
        context.toastService.showToast(
            `${equipment.getDisplayName()} mode: ${choice.label}`,
            'info'
        );
        return true;
    }

    isActive(equipment: MountedEquipment): boolean {
        if (unitHasActiveC3DisruptingStealth(equipment.owner as CBTForceUnit)) return false;
        return isEcmModeActive(equipment);
    }
}
