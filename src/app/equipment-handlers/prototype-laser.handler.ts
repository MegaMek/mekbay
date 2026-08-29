// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from '../models/mounted-equipment.model';
import { WeaponEquipment } from '../models/equipment.model';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';

const PROTOTYPE_LASER_MAX_EXTRA_HEAT = new Map<string, 3 | 6>([
    ['ISSmallPulseLaserPrototype', 3],
    ['ISMediumPulseLaserPrototype', 6],
    ['ISLargePulseLaserPrototype', 6],
    ['ISERLargeLaserPrototype', 6],
    ['ISMediumPulseLaserRecovered', 6],
]);

export class PrototypeLaserHandler extends EquipmentInteractionHandler {
    readonly id = 'prototype-laser-handler';

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment instanceof WeaponEquipment
            && PROTOTYPE_LASER_MAX_EXTRA_HEAT.has(equipment.equipment.internalName);
    }

    override getChoices(_equipment: MountedEquipment, _context: HandlerQueryContext) {
        return [];
    }

    override handleSelection(
        _equipment: MountedEquipment,
        _choice: never,
        _context: HandlerCommandContext,
    ): boolean {
        return true;
    }

    override applyInventoryControlHeatEffects(
        equipment: MountedEquipment,
        effect: InventoryControlHeatEffect,
        _context: HandlerQueryContext,
    ): InventoryControlHeatEffect {
        const maximum = this.maximumExtraHeat(equipment);
        if (maximum === 0) return effect;
        if (equipment.owner.getUnit().type === 'Aero') {
            return { ...effect, value: effect.value + maximum };
        }
        return { ...effect, suffix: '*' };
    }

    override afterInventoryControlFire(equipment: MountedEquipment): void {
        if (equipment.owner.getUnit().type === 'Aero') return;
        const maximum = this.maximumExtraHeat(equipment);
        if (maximum === 0) return;
        const roll = Math.floor(Math.random() * 6) + 1;
        const extraHeat = maximum === 3 ? Math.ceil(roll / 2) : roll;
        const manualHeatTarget = equipment.owner.getHeat().next;
        equipment.owner.turnState().addFiredHeat(extraHeat);
        if (manualHeatTarget !== undefined) {
            equipment.owner.setHeat(manualHeatTarget + extraHeat);
        }
    }

    private maximumExtraHeat(equipment: MountedEquipment): 0 | 3 | 6 {
        return PROTOTYPE_LASER_MAX_EXTRA_HEAT.get(equipment.equipment?.internalName ?? '') ?? 0;
    }
}
