// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { ammoMatchesWeapon, WeaponEquipment, type AmmoType } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
    type ToHitAdjustmentContext,
} from '../services/equipment-interaction-registry.service';
import { inventoryTargetModifierGroupTotal } from '../utils/inventory-target-number.util';

const PRECISION_AMMO_TYPES = new Set<AmmoType>(['AC', 'LAC', 'AC_IMP', 'PAC']);

/** Owns the target-movement reduction provided by Precision autocannon ammunition. */
export class PrecisionAmmoHandler extends EquipmentInteractionHandler {
    readonly id = 'precision-ammo-handler';
    override readonly flags: EquipmentFlag[] = ['F_AC'];

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment instanceof WeaponEquipment
            && PRECISION_AMMO_TYPES.has(equipment.equipment.ammoType);
    }

    override getChoices(_equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [];
    }

    override handleSelection(
        _equipment: MountedEquipment,
        _choice: PickerChoice,
        _context: HandlerCommandContext,
    ): boolean {
        return false;
    }

    override getToHitAdjustments(
        equipment: MountedEquipment,
        adjustmentContext: ToHitAdjustmentContext,
        _context: HandlerQueryContext,
    ): readonly ToHitAdjustment[] {
        const weapon = equipment.equipment;
        const ammo = adjustmentContext.selectedAmmo;
        const target = adjustmentContext.target;
        if (!(weapon instanceof WeaponEquipment)
            || !ammo?.hasMunitionType('M_PRECISION')
            || !target
            || !PRECISION_AMMO_TYPES.has(ammo.ammoType)
            || !ammoMatchesWeapon(weapon, ammo)) {
            return [];
        }

        const targetMovementModifier = inventoryTargetModifierGroupTotal(
            target,
            'target-movement',
            equipment.owner.gameRules,
        );
        const adjustment = Math.min(2, Math.max(0, targetMovementModifier));
        return adjustment > 0
            ? [{ kind: 'add', label: 'Precision', modifier: -adjustment }]
            : [];
    }
}
