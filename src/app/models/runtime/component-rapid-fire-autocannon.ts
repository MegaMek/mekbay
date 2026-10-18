// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import type { EquipmentFlag } from '../equipment-flags.type';
import { WeaponEquipment, type Equipment } from '../equipment.model';
import { gameRulesFor } from '../rules/game-rules';
import { type CBTMekUnit, type CBTUnit } from './cbt-unit';
import {
ComponentModeHandler,
type ComponentModeDefinition,
} from './component-mode';
import {
EquipmentInteractionHandler,
type EquipmentInteractionChoice,
type EquipmentInteractionCommandContext,
type EquipmentInteractionHandlerId,
type EquipmentInteractionInput,
type EquipmentInteractionQueryContext,
} from './equipment-interaction';
import { equipmentForComponent } from './mek-runtime-index';

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId } from '../entity/entity-identifiers';
import { rapidFireAutocannonComponentModes } from '../rapid-fire-autocannon-mode.model';

export const UAC_JAMMING_HANDLER_ID: EquipmentInteractionHandlerId = 'uac-jamming-handler';
export const UAC_JAMMED_CHOICE_VALUE = 'true';
const UAC_UNJAMMED_CHOICE_VALUE = 'false';

export interface ComponentJamDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
}

/** Rotary ACs always jam; Ultra ACs jam only where the ruleset uses UAC jamming. */
export function rapidFireAutocannonSupportsJamming(
    equipment: Equipment | undefined,
    ruleset: CBTRuleset,
): boolean {
    if (!(equipment instanceof WeaponEquipment)) return false;
    return equipment.ammoType === 'AC_ROTARY'
        || (gameRulesFor(ruleset).usesUacJamming
            && ['AC_ULTRA', 'AC_ULTRA_THB'].includes(equipment.ammoType));
}

/**
 * The to-hit roll at or below which a rapid-firing autocannon jams (TW p.140, Core p.183): 2 for two or
 * three shots, plus 1 for every two more. Null when a single shot or this weapon cannot jam.
 */
export function rapidFireAutocannonJamRoll(
    equipment: Equipment | undefined,
    ruleset: CBTRuleset,
    shots: number,
): number | null {
    return shots > 1 && rapidFireAutocannonSupportsJamming(equipment, ruleset)
        ? 2 + Math.floor((shots - 2) / 2)
        : null;
}

/** The jam control of one component in either runtime family; null when it cannot jam. */
export function componentJamDefinition(
    componentId: ComponentId,
    equipment: Equipment | undefined,
    ruleset: CBTRuleset,
): ComponentJamDefinition | null {
    if (equipment === undefined || !rapidFireAutocannonSupportsJamming(equipment, ruleset)) return null;
    return Object.freeze({ componentId, displayName: equipment.shortName || equipment.name });
}

export function componentJamChoices(
    runtime: CBTUnit,
    definition: ComponentJamDefinition,
): EquipmentInteractionChoice[] {
    const jammed = runtime.query().componentJammed(definition.componentId);
    return [{
        label: jammed ? 'Jammed' : 'Jam',
        shortLabel: jammed ? 'Unjam' : 'Jam',
        value: jammed ? UAC_UNJAMMED_CHOICE_VALUE : UAC_JAMMED_CHOICE_VALUE,
        stateEdit: jammed ? 'enable' : 'disable',
        displayType: 'toggle',
        active: jammed,
        tooltipType: jammed ? 'error' : undefined,
    }];
}

export function selectComponentJam(
    runtime: CBTUnit,
    definition: ComponentJamDefinition,
    choice: PickerChoice,
    context: EquipmentInteractionCommandContext,
): boolean {
    const jammed = choice.value === UAC_JAMMED_CHOICE_VALUE;
    if (runtime.query().componentJammed(definition.componentId) === jammed) return true;
    const result = runtime.dispatch({
        type: 'set-component-jammed',
        componentId: definition.componentId,
        jammed,
    });
    if (result.accepted && result.changed) {
        context.toastService.showToast(
            `${definition.displayName} is ${jammed ? 'jammed' : 'unjammed'}`,
            jammed ? 'error' : 'info',
        );
    }
    return result.accepted;
}

/** Ordered UAC/RAC entity modes map directly to one through six fired shots. */
export function rapidFireAutocannonShotCount(
    equipment: WeaponEquipment,
    selectedMode: string | undefined,
): number {
    const definition = rapidFireAutocannonComponentModes(equipment);
    if (definition === null) return 1;
    const mode = selectedMode && definition.modes.includes(selectedMode)
        ? selectedMode
        : definition.defaultMode;
    const index = mode === undefined ? -1 : definition.modes.indexOf(mode);
    return index < 0 ? 1 : index + 1;
}

export class UACFiringModeHandler extends ComponentModeHandler {
    readonly id = 'uac-firing-mode-handler';
    override readonly flags: EquipmentFlag[] = ['F_AC'];
    override readonly priority = 105;

    applicableToComponent(definition: ComponentModeDefinition): boolean {
        return definition.rapidFire && definition.modes.length > 1;
    }

    getComponentModeChoices(
        runtime: CBTMekUnit,
        definition: ComponentModeDefinition,
        _context: EquipmentInteractionQueryContext,
    ): PickerChoice[] {
        if (definition.modes.length === 0) return [];
        const mode = runtime.query().componentMode(definition.componentId) ?? definition.modes[0];
        return [{
            label: 'Mode',
            value: mode,
            displayType: 'dropdown',
            choices: definition.modes.map(value => ({ label: value, value })),
            keepOpen: true,
        }];
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

export class UACJammingHandler extends EquipmentInteractionHandler {
    readonly id = UAC_JAMMING_HANDLER_ID;
    readonly kind = 'jam';
    readonly scope = 'component' as const;
    override readonly flags: EquipmentFlag[] = ['F_AC'];
    override readonly priority = 10;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = this.definition(input);
        return definition === null ? [] : componentJamChoices(input.runtime, definition);
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = this.definition(input);
        return definition !== null && selectComponentJam(input.runtime, definition, choice, context);
    }

    private definition(input: EquipmentInteractionInput): ComponentJamDefinition | null {
        return componentJamDefinition(
            input.componentId,
            equipmentForComponent(input.index, input.componentId),
            input.ruleset,
        );
    }
}
