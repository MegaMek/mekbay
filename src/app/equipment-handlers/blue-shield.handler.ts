// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { EscalatingFailureHandler } from './escalatingfailure.handler';

export const BLUE_SHIELD_HANDLER_ID = 'blue-shield-handler';
export const BLUE_SHIELD_SEQUENCE_STATE_KEY = 'blueShieldUses';
export const BLUE_SHIELD_ACTIVE_STATE_KEY = 'blueShieldUsedThisTurn';

export class BlueShieldHandler extends EscalatingFailureHandler {
    override readonly id = BLUE_SHIELD_HANDLER_ID;
    override readonly flags: EquipmentFlag[] = ['F_BLUE_SHIELD'];

    protected static override readonly sequenceStateKey = BLUE_SHIELD_SEQUENCE_STATE_KEY;

    protected static override getSequenceTargets(equipment: MountedEquipment): readonly number[] {
        return equipment.owner.gameRules.blueShieldFailureTargets;
    }

    protected override readonly sequenceStateKey = BLUE_SHIELD_SEQUENCE_STATE_KEY;
    protected override readonly activeStateKey = BLUE_SHIELD_ACTIVE_STATE_KEY;
    protected override readonly recoversWhenUnused = false;

    protected override canUseHandler(equipment: MountedEquipment): boolean {
        // Legacy TO:AUE explicitly exempts fighters from Blue Shield failure checks.
        return equipment.owner.gameRules.id !== 'tw' || equipment.owner.getUnit().type !== 'Aero';
    }
}
