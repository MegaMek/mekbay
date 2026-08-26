// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ATM_INVENTORY_MODES, MML_INVENTORY_MODES } from '../ammo-weapon-profile.model';
import { WeaponEquipment, type AmmoType } from '../equipment.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { formatInventoryControlModeName } from '../inventory-control-display';
import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';
import { createCommandId } from './runtime-state';
import type { CBTUnitInstance } from './unit-instance';

export const INVENTORY_MODE_HANDLER_ID = 'inventory-mode-handler';
export const INVENTORY_MODE_CHOICE_LABEL = 'Mode';

export type MmlInventoryMode = (typeof MML_INVENTORY_MODES)[number];
export type AtmInventoryMode = (typeof ATM_INVENTORY_MODES)[number];
export type ComponentInventoryMode = MmlInventoryMode | AtmInventoryMode;
export type ComponentInventoryModeFamily = 'mml' | 'atm';

export interface ComponentInventoryModeDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly family: ComponentInventoryModeFamily;
    readonly ammoType: AmmoType;
    readonly rackSize: number;
    readonly modes: readonly ComponentInventoryMode[];
}

export function createComponentInventoryModeDefinition(input: {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly ammoType: AmmoType;
    readonly rackSize: number;
    readonly modes?: readonly string[];
}): ComponentInventoryModeDefinition {
    const displayName = input.displayName.trim();
    if (!displayName || displayName.includes('\0')) {
        throw new Error(`Invalid inventory-mode display name for ${input.componentId}`);
    }
    if (!Number.isSafeInteger(input.rackSize) || input.rackSize < 0) {
        throw new Error(`Invalid inventory-mode rack size for ${input.componentId}`);
    }
    const expected = expectedInventoryModes(input.ammoType);
    if (!expected) throw new Error(`Unsupported inventory-mode family for ${input.componentId}`);
    const modes = input.modes ?? expected;
    if (modes.length !== expected.length || modes.some((mode, index) => mode !== expected[index])) {
        throw new Error(`Invalid inventory modes for ${input.componentId}`);
    }
    return Object.freeze({
        componentId: input.componentId,
        displayName,
        family: input.ammoType === 'MML' ? 'mml' : 'atm',
        ammoType: input.ammoType,
        rackSize: input.rackSize,
        modes: Object.freeze([...expected]),
    });
}

export function componentInventoryModeDefinition(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): ComponentInventoryModeDefinition {
    const component = index.components.get(componentId);
    const weapon = component?.kind === 'equipment' ? component.mount.equipment : undefined;
    if (!(weapon instanceof WeaponEquipment)) {
        throw new Error(`Component ${componentId} is not an inventory-mode weapon`);
    }
    return createComponentInventoryModeDefinition({
        componentId,
        displayName: weapon.shortName || weapon.name,
        ammoType: weapon.ammoType,
        rackSize: weapon.rackSize,
    });
}

export function expectedInventoryModes(
    ammoType: AmmoType,
): readonly ComponentInventoryMode[] | null {
    if (ammoType === 'MML') return MML_INVENTORY_MODES;
    if (ammoType === 'ATM' || ammoType === 'IATM') return ATM_INVENTORY_MODES;
    return null;
}

/** Canonical modes for one ATM/IATM/MML weapon, or null for another equipment family. */
export function inventoryEquipmentModes(
    equipment: unknown,
): Readonly<{ readonly modes: readonly ComponentInventoryMode[]; readonly defaultMode?: ComponentInventoryMode }> | null {
    if (!(equipment instanceof WeaponEquipment)) return null;
    const modes = expectedInventoryModes(equipment.ammoType);
    if (modes === null) return null;
    return Object.freeze({
        modes,
        ...(equipment.ammoType === 'MML' ? {} : { defaultMode: modes[0] }),
    });
}

/** ATM/IATM/MML inventory-mode definition, validation, and interaction owner. */
export class InventoryModeHandler extends EquipmentInteractionHandler {
    readonly id = INVENTORY_MODE_HANDLER_ID;
    readonly kind = 'inventory-mode';
    readonly scope = 'component' as const;
    override readonly priority = 100;

    override choices(input: EquipmentInteractionInput): readonly PickerChoice[] {
        const definition = componentInventoryModeDefinition(input.index, input.componentId);
        return this.applicableToComponentInventoryMode(definition)
            ? this.getComponentInventoryModeChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = componentInventoryModeDefinition(input.index, input.componentId);
        return this.applicableToComponentInventoryMode(definition)
            && this.handleComponentInventoryModeSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentInventoryMode(definition: ComponentInventoryModeDefinition): boolean {
        return definition.modes.length > 0;
    }

    getComponentInventoryModeChoices(
        runtime: CBTUnitInstance,
        definition: ComponentInventoryModeDefinition,
        _context: EquipmentInteractionQueryContext,
    ): PickerChoice[] {
        const mode = runtime.query().componentMode(definition.componentId);
        if (!definition.modes.includes(mode as ComponentInventoryMode)) return [];
        return [{
            label: INVENTORY_MODE_CHOICE_LABEL,
            value: mode!,
            displayType: 'dropdown',
            choices: definition.modes.map(value => ({
                label: formatInventoryControlModeName(value),
                value,
                disabled: false,
            })),
            keepOpen: true,
        }];
    }

    handleComponentInventoryModeSelection(
        runtime: CBTUnitInstance,
        definition: ComponentInventoryModeDefinition,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        const mode = String(choice.value);
        if (!definition.modes.includes(mode as ComponentInventoryMode)) return false;
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
