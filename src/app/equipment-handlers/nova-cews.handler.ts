// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { EQUIPMENT_HEAT_SOURCE_GROUP, type UnitHeatSource } from '../models/rules/unit-type-rules';
import type { TurnState } from '../models/turn-state.model';
import type { HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { HandlerCommandContext } from '../services/equipment-interaction-registry.service';
import {
    cancelConflictingElectronicSuiteActivations,
    deactivateConflictingElectronicSuites,
    isNovaCewsEffectivelyActive,
    NOVA_CEWS_OFF_STATE,
    NOVA_CEWS_ON_STATE,
    NOVA_CEWS_STATE_KEY,
    NOVA_CEWS_TURNING_OFF_STATE,
    NOVA_CEWS_TURNING_ON_STATE,
    nextEffectiveNovaCewsState,
    novaCewsState,
} from '../utils/ecm-state.util';
import { ToggleHandler } from './base/toggle.handler';

export const NOVA_CEWS_HANDLER_ID = 'nova-cews-handler';

export class NovaCewsHandler extends ToggleHandler {
    readonly id = NOVA_CEWS_HANDLER_ID;
    override readonly flags: EquipmentFlag[] = ['F_NOVA'];
    override readonly priority = 20;

    protected override readonly stateKey = NOVA_CEWS_STATE_KEY;
    protected override readonly toggleMode = 'transient' as const;
    protected override readonly enabledState = NOVA_CEWS_ON_STATE;
    protected override readonly enablingState = NOVA_CEWS_TURNING_ON_STATE;
    protected override readonly disabledState = NOVA_CEWS_OFF_STATE;
    protected override readonly disablingState = NOVA_CEWS_TURNING_OFF_STATE;
    protected override readonly defaultEnabled = true;
    protected override readonly enabledLabel = 'Nova CEWS is ON';
    protected override readonly enablingLabel = 'Turning Nova CEWS on…';
    protected override readonly disabledLabel = 'Nova CEWS is OFF';
    protected override readonly disablingLabel = 'Turning Nova CEWS off…';
    protected override readonly enabledToastVerb = 'on';
    protected override readonly enablingToastVerb = 'turning on';
    protected override readonly disabledToastVerb = 'off';
    protected override readonly disablingToastVerb = 'turning off';

    protected override getToggleState(equipment: MountedEquipment): string {
        return nextEffectiveNovaCewsState(equipment);
    }

    isActive(equipment: MountedEquipment): boolean {
        return isNovaCewsEffectivelyActive(equipment);
    }

    override handleSelection(
        equipment: MountedEquipment,
        choice: PickerChoice,
        context: HandlerCommandContext,
    ): boolean {
        const handled = super.handleSelection(equipment, choice, context);
        const selectedState = String(choice.value);
        const activated = (selectedState === NOVA_CEWS_TURNING_ON_STATE
            || selectedState === NOVA_CEWS_ON_STATE)
            && novaCewsState(equipment) === selectedState;
        if (activated && cancelConflictingElectronicSuiteActivations(equipment)) {
            equipment.owner.turnState().markEquipmentStateChanged();
        }
        return handled;
    }

    override onEndTurn(equipment: MountedEquipment): void {
        const activating = novaCewsState(equipment) === NOVA_CEWS_TURNING_ON_STATE;
        super.onEndTurn(equipment);
        if (!activating || novaCewsState(equipment) !== NOVA_CEWS_ON_STATE) return;

        // Commit the selected suite's ECM/probe handoff after outgoing-turn
        // effects and heat have already resolved.
        deactivateConflictingElectronicSuites(equipment);
    }

    override getInventoryHeatSources(
        equipment: MountedEquipment,
        _turnState: TurnState,
        context: HandlerQueryContext,
    ): UnitHeatSource[] {
        // Stealth Armor suppresses Nova's ECM/probe/C3 effects without powering
        // the suite down. Heat therefore follows power and operability, not the
        // permission to expose a passive electronic effect.
        if (!this.isActive(equipment)
            || context.getStatus(equipment) !== 'available'
            || equipment.owner.destroyed
            || equipment.owner.getCondition('shutdown')) return [];

        return [{
            id: `nova-cews:${equipment.id}`,
            label: 'Nova CEWS',
            value: 2,
            group: EQUIPMENT_HEAT_SOURCE_GROUP,
        }];
    }
}
