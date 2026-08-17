// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { HeatDissipationState } from '../models/rules/heat-management';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import type { TurnState } from '../models/turn-state.model';
import type { HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { getFailedCoolantSystemHeatSources } from './coolant-system-failure.util';
import { EscalatingFailureHandler } from './escalatingfailure.handler';

export const RADICAL_HEAT_SINK_HANDLER_ID = 'radical-heat-sink-handler';
export const RADICAL_HEAT_SINK_SEQUENCE_STATE_KEY = 'radicalHeatSink';
export const RADICAL_HEAT_SINK_ACTIVE_STATE_KEY = 'radicalHeatSinkActive';

export class RadicalHeatSinkHandler extends EscalatingFailureHandler {
    override readonly id = RADICAL_HEAT_SINK_HANDLER_ID;
    override readonly flags: EquipmentFlag[] = ['F_RADICAL_HEATSINK'];

    protected static override readonly sequenceStateKey = RADICAL_HEAT_SINK_SEQUENCE_STATE_KEY;

    protected static override getSequenceTargets(equipment: MountedEquipment): readonly number[] {
        return equipment.owner.gameRules.radicalHeatSinkFailureTargets;
    }

    protected override readonly sequenceStateKey = RADICAL_HEAT_SINK_SEQUENCE_STATE_KEY;
    protected override readonly activeStateKey = RADICAL_HEAT_SINK_ACTIVE_STATE_KEY;

    static isActive(equipment: MountedEquipment): boolean {
        return equipment.states.get(RADICAL_HEAT_SINK_ACTIVE_STATE_KEY) === 'true';
    }

    override isActive(equipment: MountedEquipment): boolean {
        return RadicalHeatSinkHandler.isActive(equipment);
    }

    override getHeatDissipationBonus(
        equipment: MountedEquipment,
        dissipation: HeatDissipationState,
        context: HandlerQueryContext,
    ): number {
        if (!this.isActive(equipment) || !context.canProvidePassiveEffect(equipment)) return 0;
        return Math.max(0, dissipation.healthyPips - dissipation.heatsinksOff);
    }

    override getInventoryHeatSources(
        equipment: MountedEquipment,
        turnState: TurnState,
        _context: HandlerQueryContext,
    ): UnitHeatSource[] {
        return getFailedCoolantSystemHeatSources(
            equipment,
            turnState,
            `radical-heat-sink:${equipment.id}`,
            'Radical Heat Sink leak',
        );
    }
}
