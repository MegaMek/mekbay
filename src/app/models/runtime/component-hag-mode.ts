// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from '../equipment-flags.type';
import { Equipment, WeaponEquipment } from '../equipment.model';
import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';
import {
    HAG_FLAK_MODE,
    HAG_FLAG,
    HAG_MODES,
    HAG_STANDARD_MODE,
    isHagEquipment,
    isHagMode,
    type HagMode,
} from '../hag-mode.model';
import type { WeaponType } from '../weapon-types.model';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';
import type { CBTUnitInstance } from './unit-instance';

export interface ComponentHagModeDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags: ReadonlySet<EquipmentFlag>;
    readonly weapon: boolean;
    readonly modes: readonly HagMode[];
}

export interface ComponentHagToHitAdjustment {
    readonly kind: 'add';
    readonly label: string;
    readonly modifier: -1;
}

export function createComponentHagModeDefinition(input: {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags?: Iterable<EquipmentFlag>;
    readonly weapon: boolean;
    readonly modes?: readonly string[];
}): ComponentHagModeDefinition {
    if (!input.displayName.trim() || input.displayName.includes('\0')) {
        throw new Error(`Invalid HAG display name for ${input.componentId}`);
    }
    const modes = input.modes ?? HAG_MODES;
    if (modes.length !== HAG_MODES.length
        || modes.some((mode, index) => mode !== HAG_MODES[index])) {
        throw new Error(`Invalid HAG modes for ${input.componentId}`);
    }
    return Object.freeze({
        componentId: input.componentId,
        displayName: input.displayName,
        flags: new ImmutableSet(input.flags ?? []),
        weapon: input.weapon,
        modes: HAG_MODES,
    });
}

export function componentHagModeDefinition(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): ComponentHagModeDefinition {
    const equipment = equipmentForComponent(index, componentId);
    if (!equipment) throw new Error(`Component ${componentId} has no HAG equipment definition`);
    return createComponentHagModeDefinition({
        componentId,
        displayName: equipment.shortName,
        flags: equipment.flags,
        weapon: equipment instanceof WeaponEquipment,
    });
}

/** Canonical HAG modes, or null for another equipment family. */
export function hagEquipmentModes(
    equipment: Equipment | undefined,
): Readonly<{ readonly modes: readonly HagMode[]; readonly defaultMode: HagMode }> | null {
    return equipment instanceof WeaponEquipment && isHagEquipment(equipment)
        ? Object.freeze({ modes: HAG_MODES, defaultMode: HAG_STANDARD_MODE })
        : null;
}

export function applyHagWeaponTypes(
    mode: HagMode,
    types: ReadonlySet<WeaponType>,
): ReadonlySet<WeaponType> {
    const effective = new Set(types);
    if (mode === HAG_FLAK_MODE) {
        effective.delete('DB');
        effective.add('F');
    } else {
        effective.delete('F');
    }
    return effective;
}

export function applyHagEquipmentWeaponTypes(
    equipment: Equipment | undefined,
    mode: string | undefined,
    types: ReadonlySet<WeaponType>,
): ReadonlySet<WeaponType> {
    return equipment instanceof WeaponEquipment && isHagEquipment(equipment) && isHagMode(mode)
        ? applyHagWeaponTypes(mode, types)
        : types;
}

export function hagEquipmentToHitAdjustments(
    index: MekRuntimeIndex,
    componentId: ComponentId,
    mode: string | undefined,
): readonly ComponentHagToHitAdjustment[] {
    const equipment = equipmentForComponent(index, componentId);
    return equipment instanceof WeaponEquipment && isHagEquipment(equipment) && isHagMode(mode)
        ? hagToHitAdjustments(componentHagModeDefinition(index, componentId), mode)
        : Object.freeze([]);
}

export function hagToHitAdjustments(
    definition: ComponentHagModeDefinition,
    mode: HagMode,
): readonly ComponentHagToHitAdjustment[] {
    return mode === HAG_FLAK_MODE
        ? Object.freeze([Object.freeze({
            kind: 'add' as const,
            label: `${definition.displayName} (FLAK)`,
            modifier: -1 as const,
        })])
        : Object.freeze([]);
}

/** HAG modes, weapon projections, targeting adjustment, and interaction owner. */
export class HagHandler extends EquipmentInteractionHandler {
    readonly id = 'hag-handler';
    readonly kind = 'hag-mode';
    readonly scope = 'component' as const;
    override readonly flags = [HAG_FLAG] as const;
    override readonly priority = 100;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = componentHagModeDefinition(input.index, input.componentId);
        return this.applicableToComponentHagMode(definition)
            ? this.getComponentHagModeChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = componentHagModeDefinition(input.index, input.componentId);
        return this.applicableToComponentHagMode(definition)
            && this.handleComponentHagModeSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentHagMode(definition: ComponentHagModeDefinition): boolean {
        return definition.weapon && definition.flags.has(HAG_FLAG);
    }

    getComponentHagModeChoices(
        runtime: CBTUnitInstance,
        definition: ComponentHagModeDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        const mode = runtime.query().componentMode(definition.componentId);
        if (!isHagMode(mode)) return [];
        return [{
            label: 'Mode',
            value: mode,
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: HAG_STANDARD_MODE },
                { label: 'FLAK', value: HAG_FLAK_MODE },
            ],
            keepOpen: true,
        }];
    }

    handleComponentHagModeSelection(
        runtime: CBTUnitInstance,
        definition: ComponentHagModeDefinition,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        if (!isHagMode(choice.value)) return false;
        if (runtime.query().componentMode(definition.componentId) === choice.value) return true;
        return runtime.dispatch({
            type: 'set-component-mode',
            componentId: definition.componentId,
            mode: choice.value,
        }).accepted;
    }
}

export { HAG_FLAK_MODE, HAG_STANDARD_MODE, isHagMode, type HagMode };
