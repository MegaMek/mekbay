// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    nextStealthState,
    isInteractiveStealthFlags,
    stealthFlagsRequireEcm,
    stealthStateIsActive,
    VOID_SIGNATURE_FLAG,
    type StealthState,
} from '../stealth-equipment.model';
import {
    ComponentModeHandler,
    type ComponentModeDefinition,
} from './component-mode';
import type {
    EquipmentInteractionChoice,
    EquipmentInteractionCommandContext,
    EquipmentInteractionQueryContext,
} from './equipment-interaction';
import { createCommandId } from './runtime-state';
import type { CBTUnitInstance } from './unit-instance';

/** End-turn signature-system lifecycle and interaction owner. */
export class StealthHandler extends ComponentModeHandler {
    readonly id = 'stealth-handler';
    override readonly priority = 10;

    applicableToComponent(definition: ComponentModeDefinition): boolean {
        return isInteractiveStealthFlags(definition.flags);
    }

    getComponentModeChoices(
        runtime: CBTUnitInstance,
        definition: ComponentModeDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        if (!switchable(definition)) return [];
        const state = runtime.query().componentStealthState(definition.componentId);
        const next = nextStealthState(state);
        return [{
            label: stateLabel(state),
            value: next,
            active: stealthStateIsActive(state),
            displayType: 'toggle',
            ...(requiresEcm(definition)
                && next === 'enabling'
                && !runtime.query().functionalEcmForStealth('preview')
                ? { disabled: true }
                : {}),
        }];
    }

    handleComponentModeSelection(
        runtime: CBTUnitInstance,
        definition: ComponentModeDefinition,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        if (!isStealthState(choice.value) || !switchable(definition)) return false;
        const current = runtime.query().componentStealthState(definition.componentId);
        if (choice.value !== nextStealthState(current)) return false;
        if (requiresEcm(definition)
            && choice.value === 'enabling'
            && !runtime.query().functionalEcmForStealth('preview')) {
            context.toastService.showToast(
                definition.flags.has(VOID_SIGNATURE_FLAG)
                    ? 'Void Signature System requires a functional ECM suite'
                    : 'Stealth armor requires a functional ECM suite',
                'error',
            );
            return true;
        }
        const result = runtime.dispatch({
            type: 'set-stealth-state',
            componentId: definition.componentId,
            state: choice.value,
        });
        if (!result.accepted) return false;
        context.toastService.showToast(`${definition.displayName} is ${stateVerb(choice.value)}`, 'info');
        return true;
    }
}

function switchable(definition: ComponentModeDefinition): boolean {
    return definition.modes.some(mode => mode.toLowerCase() === 'off')
        && definition.modes.some(mode => mode.toLowerCase() === 'on');
}

function requiresEcm(definition: ComponentModeDefinition): boolean {
    return stealthFlagsRequireEcm(definition.flags);
}

function isStealthState(value: unknown): value is StealthState {
    return value === 'disabled' || value === 'enabling'
        || value === 'enabled' || value === 'disabling';
}

function stateLabel(state: StealthState): string {
    switch (state) {
        case 'disabled': return 'Stealth Deactivated';
        case 'enabling': return 'Activating Stealth…';
        case 'enabled': return 'Stealth Active';
        case 'disabling': return 'Deactivating Stealth…';
    }
}

function stateVerb(state: StealthState): string {
    switch (state) {
        case 'disabled': return 'deactivated';
        case 'enabling': return 'activating stealth';
        case 'enabled': return 'active';
        case 'disabling': return 'deactivating stealth';
    }
}
