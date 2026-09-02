// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import { WeaponEquipment } from '../equipment.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { ImmutableSet } from '../entity/immutable-collections';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import { mekComponentModes } from './mek-component-rules';
import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';
import type { CBTUnitInstance } from './unit-instance';

/** Immutable entity and selected-rules facts required by a binary mode control. */
export interface ComponentModeDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags: ReadonlySet<EquipmentFlag>;
    readonly modes: readonly string[];
    readonly defaultMode?: string;
    readonly rapidFire: boolean;
}

export function createComponentModeDefinition(input: {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags?: Iterable<EquipmentFlag>;
    readonly modes?: readonly string[];
    readonly defaultMode?: string;
    readonly rapidFire?: boolean;
}): ComponentModeDefinition {
    if (!input.displayName.trim() || input.displayName.includes('\0')) {
        throw new Error(`Invalid component mode display name for ${input.componentId}`);
    }
    const modes = Object.freeze([...(input.modes ?? [])]);
    if (modes.some(mode => !mode.trim() || mode.includes('\0')) || new Set(modes).size !== modes.length) {
        throw new Error(`Invalid component modes for ${input.componentId}`);
    }
    if (input.defaultMode !== undefined && !modes.includes(input.defaultMode)) {
        throw new Error(`Invalid default component mode for ${input.componentId}`);
    }
    const defaultMode = input.defaultMode
        ?? modes.find(mode => mode.toLowerCase() === 'off')
        ?? modes[0];
    return Object.freeze({
        componentId: input.componentId,
        displayName: input.displayName,
        flags: new ImmutableSet(input.flags ?? []),
        modes,
        rapidFire: input.rapidFire ?? false,
        ...(defaultMode === undefined ? {} : { defaultMode }),
    });
}

export function componentModeDefinition(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): ComponentModeDefinition {
    const equipment = equipmentForComponent(index, componentId);
    if (!equipment) throw new Error(`Component ${componentId} has no equipment mode definition`);
    const state = mekComponentModes(entity, index, componentId, ruleset);
    return createComponentModeDefinition({
        componentId,
        displayName: equipment.name,
        flags: equipment.flags,
        modes: state.modes,
        defaultMode: state.defaultMode,
        rapidFire: equipment instanceof WeaponEquipment
            && ['AC_ROTARY', 'AC_ULTRA', 'AC_ULTRA_THB'].includes(equipment.ammoType),
    });
}

export function binaryComponentModes(definition: ComponentModeDefinition): {
    readonly enabled: string;
    readonly disabled: string;
} {
    const disabled = definition.modes.find(mode => {
        const value = mode.toLowerCase();
        return value === 'off' || value === 'disabled';
    });
    const enabled = definition.modes.filter(mode => mode !== disabled);
    if (!disabled || enabled.length !== 1) {
        throw new Error(`Component ${definition.componentId} is not a binary-mode component`);
    }
    return Object.freeze({ enabled: enabled[0], disabled });
}

/** Generic component-mode plumbing; equipment modules own every actual rule. */
export abstract class ComponentModeHandler extends EquipmentInteractionHandler {
    readonly kind = 'component-mode';
    readonly scope = 'component' as const;

    abstract applicableToComponent(definition: ComponentModeDefinition): boolean;

    abstract getComponentModeChoices(
        runtime: CBTUnitInstance,
        definition: ComponentModeDefinition,
        context: EquipmentInteractionQueryContext,
    ): readonly EquipmentInteractionChoice[];

    abstract handleComponentModeSelection(
        runtime: CBTUnitInstance,
        definition: ComponentModeDefinition,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean | Promise<boolean>;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = this.definition(input);
        return this.applicableToComponent(definition)
            ? this.getComponentModeChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean | Promise<boolean> {
        const definition = this.definition(input);
        return this.applicableToComponent(definition)
            && this.handleComponentModeSelection(input.runtime, definition, choice, context);
    }

    private definition(input: EquipmentInteractionInput): ComponentModeDefinition {
        return componentModeDefinition(input.entity, input.index, input.componentId, input.ruleset);
    }
}
