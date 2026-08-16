// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import { isArtemisCompatibleWeapon } from '../models/entity/utils/equipment-link-rules';
import { EquipmentInteractionHandler, type HandlerCommandContext, type HandlerQueryContext, type ToHitAdjustmentContext } from '../services/equipment-interaction-registry.service';
import { inventoryControlTargetUsesIndirectFire } from '../models/inventory-control-runtime-state.model';

export class ArtemisVHandler extends EquipmentInteractionHandler {
    readonly id = 'artemis-v-handler';
    override readonly flags: EquipmentFlag[] = ['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'];

    getChoices(_equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerCommandContext): boolean {
        return false;
    }

    override getToHitAdjustments(
        equipment: MountedEquipment,
        adjustmentContext: ToHitAdjustmentContext,
        context: HandlerQueryContext
    ): readonly ToHitAdjustment[] {
        if (adjustmentContext.target && inventoryControlTargetUsesIndirectFire(adjustmentContext.target)) return [];
        const weapon = adjustmentContext.parent?.equipment;
        if (!weapon || !isArtemisCompatibleWeapon(weapon)) return [];
        const selectedAmmo = adjustmentContext.selectedAmmo;
        const status = context.getStatus(equipment);
        const unavailable = status !== 'available';
        const unitJammed = equipment.owner.getCondition('jammed');
        const incompatibleAmmo = selectedAmmo !== undefined && !selectedAmmo?.hasMunitionType('M_ARTEMIS_V_CAPABLE');
        const weakened = unavailable || unitJammed || incompatibleAmmo;
        const label = equipment.getDisplayName();
        const unavailableLabel = status === 'destroyed'
            ? `${label} Destroyed`
            : status === 'disabled'
                ? `${label} Disabled`
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
