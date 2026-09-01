// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from '../models/mounted-equipment.model';
import { EQUIPMENT_HEAT_SOURCE_GROUP, type UnitHeatSource } from '../models/rules/unit-type-rules';
import type { TurnState } from '../models/turn-state.model';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';

const SPOT_WELDER_HEAT = 2;
const SPOT_WELDER_USES_STATE_KEY = 'spotWelderUses';

export class SpotWelderHandler extends EquipmentInteractionHandler {
    readonly id = 'spot-welder-handler';

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment?.hasAllFlags(['F_CLUB', 'S_SPOT_WELDER']) === true;
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

    override getInventoryControlHeatEffect(): InventoryControlHeatEffect {
        return { value: SPOT_WELDER_HEAT, weakened: false };
    }

    override afterInventoryControlFire(equipment: MountedEquipment): void {
        const uses = this.useCount(equipment) + 1;
        equipment.owner.turnState().removeFiredHeat(SPOT_WELDER_HEAT);
        if (equipment.setState(SPOT_WELDER_USES_STATE_KEY, String(uses))) {
            equipment.owner.setInventoryEntry(equipment);
        }
    }

    override getInventoryHeatSources(
        equipment: MountedEquipment,
        _turnState: TurnState,
        _context: HandlerQueryContext,
    ): UnitHeatSource[] {
        const uses = this.useCount(equipment);
        return uses > 0 ? [{
            id: `spot-welder:${equipment.id}`,
            label: 'Spot Welder',
            value: uses * SPOT_WELDER_HEAT,
            group: EQUIPMENT_HEAT_SOURCE_GROUP,
        }] : [];
    }

    override onEndTurn(equipment: MountedEquipment): void {
        if (equipment.deleteState(SPOT_WELDER_USES_STATE_KEY)) {
            equipment.owner.setInventoryEntry(equipment);
        }
    }

    private useCount(equipment: MountedEquipment): number {
        const value = Number(equipment.states.get(SPOT_WELDER_USES_STATE_KEY));
        return Number.isInteger(value) && value > 0 ? value : 0;
    }
}
