// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import type { EquipmentFlag } from '../equipment-flags.type';
import {
    FLAMER_DAMAGE_MODE,
    FLAMER_FLAG,
    FLAMER_HEAT_MODE,
} from '../flamer-mode.model';
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

export class FlamerHandler extends ComponentModeHandler {
    readonly id = 'flamer-handler';
    override readonly flags: EquipmentFlag[] = [FLAMER_FLAG];
    override readonly priority = 105;

    applicableToComponent(definition: ComponentModeDefinition): boolean {
        return definition.modes.includes(FLAMER_DAMAGE_MODE)
            && definition.modes.includes(FLAMER_HEAT_MODE);
    }

    getComponentModeChoices(
        runtime: CBTUnitInstance,
        definition: ComponentModeDefinition,
        _context: EquipmentInteractionQueryContext,
    ): PickerChoice[] {
        const mode = runtime.query().componentMode(definition.componentId) ?? FLAMER_DAMAGE_MODE;
        return [{
            label: 'Mode',
            value: mode,
            displayType: 'dropdown',
            choices: definition.modes.map(value => ({ label: value, value })),
            keepOpen: true,
        }];
    }

    handleComponentModeSelection(
        runtime: CBTUnitInstance,
        definition: ComponentModeDefinition,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        const mode = String(choice.value);
        if (!definition.modes.includes(mode)) return false;
        if (runtime.query().componentMode(definition.componentId) === mode) return true;
        return runtime.dispatch({
            type: 'set-component-mode',
            commandId: createCommandId(),
            expectedRevision: runtime.revision(),
            componentId: definition.componentId,
            mode,
        }).accepted;
    }
}
