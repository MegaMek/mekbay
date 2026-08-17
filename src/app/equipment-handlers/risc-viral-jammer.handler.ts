// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import type { TurnState } from '../models/turn-state.model';
import type { HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { EscalatingFailureHandler } from './escalatingfailure.handler';

export const RISC_VIRAL_JAMMER_HANDLER_ID = 'risc-viral-jammer-handler';
export const RISC_VIRAL_JAMMER_SEQUENCE_STATE_KEY = 'riscViralJammer';
export const RISC_VIRAL_JAMMER_ACTIVE_STATE_KEY = 'riscViralJammerActive';

const RISC_VIRAL_JAMMER_FLAGS: readonly EquipmentFlag[] = [
    'F_VIRAL_JAMMER_DECOY',
    'F_VIRAL_JAMMER_HOMING',
];

export class RiscViralJammerHandler extends EscalatingFailureHandler {
    override readonly id = RISC_VIRAL_JAMMER_HANDLER_ID;

    protected static override readonly sequenceStateKey = RISC_VIRAL_JAMMER_SEQUENCE_STATE_KEY;

    protected static override getSequenceTargets(equipment: MountedEquipment): readonly number[] {
        return equipment.owner.gameRules.viralJammerFailureTargets;
    }

    protected override readonly sequenceStateKey = RISC_VIRAL_JAMMER_SEQUENCE_STATE_KEY;
    protected override readonly activeStateKey = RISC_VIRAL_JAMMER_ACTIVE_STATE_KEY;
    protected override readonly recoversWhenUnused = false;

    override applicableTo(equipment: MountedEquipment): boolean {
        return RISC_VIRAL_JAMMER_FLAGS.some(flag => equipment.equipment?.flags.has(flag));
    }

    override getInventoryHeatSources(
        equipment: MountedEquipment,
        _turnState: TurnState,
        context: HandlerQueryContext,
    ): UnitHeatSource[] {
        if (!this.isActive(equipment) || !context.canProvidePassiveEffect(equipment)) return [];
        return [{
            id: `risc-viral-jammer:${equipment.id}`,
            label: 'RISC Viral Jammer',
            value: 12,
        }];
    }
}
