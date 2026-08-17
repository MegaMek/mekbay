// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import type { TurnState } from '../models/turn-state.model';
import type { HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { getFailedCoolantSystemHeatSources } from './coolant-system-failure.util';
import { EscalatingFailureHandler } from './escalatingfailure.handler';

export const RISC_EMERGENCY_COOLANT_SYSTEM_HANDLER_ID = 'risc-emergency-coolant-system-handler';
export const RISC_EMERGENCY_COOLANT_SYSTEM_SEQUENCE_STATE_KEY = 'riscEmergencyCoolantSystem';
export const RISC_EMERGENCY_COOLANT_SYSTEM_ACTIVE_STATE_KEY = 'riscEmergencyCoolantSystemActive';

export class RiscEmergencyCoolantSystemHandler extends EscalatingFailureHandler {
    override readonly id = RISC_EMERGENCY_COOLANT_SYSTEM_HANDLER_ID;
    override readonly flags: EquipmentFlag[] = ['F_EMERGENCY_COOLANT_SYSTEM'];

    protected static override readonly sequenceStateKey = RISC_EMERGENCY_COOLANT_SYSTEM_SEQUENCE_STATE_KEY;

    protected static override getSequenceTargets(equipment: MountedEquipment): readonly number[] {
        return equipment.owner.gameRules.emergencyCoolantSystemFailureTargets;
    }

    protected override readonly sequenceStateKey = RISC_EMERGENCY_COOLANT_SYSTEM_SEQUENCE_STATE_KEY;
    protected override readonly activeStateKey = RISC_EMERGENCY_COOLANT_SYSTEM_ACTIVE_STATE_KEY;

    override getInventoryHeatSources(
        equipment: MountedEquipment,
        turnState: TurnState,
        _context: HandlerQueryContext,
    ): UnitHeatSource[] {
        return getFailedCoolantSystemHeatSources(
            equipment,
            turnState,
            `risc-emergency-coolant:${equipment.id}`,
            'RISC coolant leak',
        );
    }
}
