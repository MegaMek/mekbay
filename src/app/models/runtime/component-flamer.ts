// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import type { EquipmentFlag } from '../equipment-flags.type';
import {
FLAMER_DAMAGE_MODE,
FLAMER_FLAG,
hasFlamerModes,
} from '../flamer-mode.model';
import { type CBTMekUnit } from './cbt-unit';
import {
ComponentModeHandler,
type ComponentModeDefinition,
} from './component-mode';
import type {
EquipmentInteractionChoice,
EquipmentInteractionCommandContext,
EquipmentInteractionHandlerId,
EquipmentInteractionQueryContext,
} from './equipment-interaction';

export const FLAMER_HANDLER_ID: EquipmentInteractionHandlerId = 'flamer-handler';

/** The heat-or-damage declaration of a flamer, Mek or not. */
export function flamerModeChoice(mode: string | undefined, modes: readonly string[]): EquipmentInteractionChoice {
    return {
        label: 'Mode',
        value: mode ?? FLAMER_DAMAGE_MODE,
        displayType: 'dropdown',
        choices: modes.map(value => ({ label: value, value })),
        keepOpen: true,
    };
}

export class FlamerHandler extends ComponentModeHandler {
    readonly id = FLAMER_HANDLER_ID;
    override readonly flags: EquipmentFlag[] = [FLAMER_FLAG];
    override readonly priority = 105;

    applicableToComponent(definition: ComponentModeDefinition): boolean {
        return hasFlamerModes(definition.modes);
    }

    getComponentModeChoices(
        runtime: CBTMekUnit,
        definition: ComponentModeDefinition,
        _context: EquipmentInteractionQueryContext,
    ): PickerChoice[] {
        return [flamerModeChoice(runtime.query().componentMode(definition.componentId), definition.modes)];
    }

    handleComponentModeSelection(
        runtime: CBTMekUnit,
        definition: ComponentModeDefinition,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        const mode = String(choice.value);
        if (!definition.modes.includes(mode)) return false;
        if (runtime.query().componentMode(definition.componentId) === mode) return true;
        return runtime.dispatch({
            type: 'set-component-mode',
            componentId: definition.componentId,
            mode,
        }).accepted;
    }
}
