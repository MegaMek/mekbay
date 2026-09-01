// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import { EQUIPMENT_DISABLED_CHOICE_VALUE } from '../component-control-choice';
import { WeaponEquipment } from '../equipment.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import { weaponTraitFlag } from '../weapon-traits-kernel';
import { gameRulesFor } from '../rules/game-rules';
import {
    ComponentModeHandler,
    type ComponentModeDefinition,
} from './component-mode';
import {
    createComponentJamDefinition,
    type ComponentJamDefinition,
} from './component-jam';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import type { CBTUnitInstance } from './unit-instance';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId } from '../entity/entity-identifiers';
import { rapidFireAutocannonComponentModes } from '../rapid-fire-autocannon-mode.model';

export function rapidFireAutocannonSupportsJamming(
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): boolean {
    const equipment = equipmentForComponent(index, componentId);
    if (!(equipment instanceof WeaponEquipment)) return false;
    return equipment.ammoType === 'AC_ROTARY'
        || (gameRulesFor(ruleset).usesUacJamming
            && ['AC_ULTRA', 'AC_ULTRA_THB'].includes(equipment.ammoType));
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
    override readonly flags: EquipmentFlag[] = [weaponTraitFlag('autocannon')];
    override readonly priority = 105;

    applicableToComponent(definition: ComponentModeDefinition): boolean {
        return definition.rapidFire && definition.modes.length > 1;
    }

    getComponentModeChoices(
        runtime: CBTUnitInstance,
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
            componentId: definition.componentId,
            mode,
        }).accepted;
    }
}

export class UACJammingHandler extends EquipmentInteractionHandler {
    readonly id = 'uac-jamming-handler';
    readonly kind = 'jam';
    readonly scope = 'component' as const;
    override readonly flags: EquipmentFlag[] = [weaponTraitFlag('autocannon')];
    override readonly priority = 10;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = this.definition(input);
        return definition.supportsJamming
            ? this.getComponentJamChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = this.definition(input);
        return definition.supportsJamming
            && this.handleComponentJamSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentJam(definition: ComponentJamDefinition): boolean {
        return definition.supportsJamming;
    }

    getComponentJamChoices(
        runtime: CBTUnitInstance,
        definition: ComponentJamDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        const jammed = runtime.query().componentJammed(definition.componentId);
        return [{
            label: jammed ? 'Jammed' : 'Jam',
            shortLabel: jammed ? 'Unjam' : 'Jam',
            value: jammed ? 'false' : EQUIPMENT_DISABLED_CHOICE_VALUE,
            stateEdit: jammed ? 'enable' : 'disable',
            displayType: 'toggle',
            active: jammed,
            tooltipType: jammed ? 'error' : undefined,
        }];
    }

    handleComponentJamSelection(
        runtime: CBTUnitInstance,
        definition: ComponentJamDefinition,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const jammed = choice.value === EQUIPMENT_DISABLED_CHOICE_VALUE;
        if (!definition.supportsJamming) return false;
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

    private definition(input: EquipmentInteractionInput): ComponentJamDefinition {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!equipment) throw new Error(`Component ${input.componentId} has no equipment`);
        return createComponentJamDefinition({
            componentId: input.componentId,
            displayName: equipment.shortName || equipment.name,
            flags: equipment.flags,
            supportsJamming: rapidFireAutocannonSupportsJamming(
                input.index,
                input.componentId,
                input.ruleset,
            ),
        });
    }
}
