// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import { getVibrobladeProfileFromFlags } from '../rules/vibroblade-rules';
import {
    isVibrobladeMode,
    VIBROBLADE_MODES,
    VIBROBLADE_OFF_MODE,
    VIBROBLADE_ON_MODE,
} from '../vibroblade-mode.model';
import {
    ComponentModeHandler,
    type ComponentModeDefinition,
} from './component-mode';
import type {
    EquipmentInteractionCommandContext,
    EquipmentInteractionQueryContext,
} from './equipment-interaction';
import { createCommandId } from './runtime-state';
import type { CBTUnitInstance } from './unit-instance';

export class VibrobladeHandler extends ComponentModeHandler {
    readonly id = 'vibroblade-handler';
    override readonly priority = 20;

    applicableToComponent(definition: ComponentModeDefinition): boolean {
        return getVibrobladeProfileFromFlags(definition.flags) !== null;
    }

    getComponentModeChoices(
        runtime: CBTUnitInstance,
        definition: ComponentModeDefinition,
        _context: EquipmentInteractionQueryContext,
    ): PickerChoice[] {
        const mode = runtime.query().componentMode(definition.componentId);
        if (!isVibrobladeMode(mode)) return [];
        return [{
            label: 'Mode',
            value: mode,
            displayType: 'dropdown',
            choices: [
                { label: VIBROBLADE_ON_MODE, value: VIBROBLADE_ON_MODE },
                { label: VIBROBLADE_OFF_MODE, value: VIBROBLADE_OFF_MODE },
            ],
            keepOpen: true,
        }];
    }

    handleComponentModeSelection(
        runtime: CBTUnitInstance,
        definition: ComponentModeDefinition,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        if (!isVibrobladeMode(choice.value)) return false;
        if (runtime.query().componentMode(definition.componentId) === choice.value) return true;
        return runtime.dispatch({
            type: 'set-component-mode',
            componentId: definition.componentId,
            mode: choice.value,
        }).accepted;
    }
}
