// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { equipmentForComponent } from './mek-runtime-index';
import type { Equipment } from '../equipment.model';
import { GAUSS_FLAG, isGaussEquipment } from '../gauss-equipment.model';
import type { WeaponType } from '../weapon-types.model';
import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';
import { createCommandId } from './runtime-state';
import type { CBTUnitInstance } from './unit-instance';

export const GAUSS_POWERED_UP = 'Powered Up';
export const GAUSS_POWERING_DOWN = 'Powering Down';
export const GAUSS_POWERED_DOWN = 'Powered Down';
export const GAUSS_POWERING_UP = 'Powering Up';
export const MEK_GAUSS_POWER_STATES = Object.freeze([
    GAUSS_POWERED_UP,
    GAUSS_POWERING_DOWN,
    GAUSS_POWERED_DOWN,
    GAUSS_POWERING_UP,
] as const);

export type MekGaussPowerState = typeof MEK_GAUSS_POWER_STATES[number];
export type SparseMekGaussPowerState = Exclude<MekGaussPowerState, typeof GAUSS_POWERED_UP>;

export interface MekGaussPowerDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
}

export function mekGaussPowerDefinition(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): MekGaussPowerDefinition {
    const equipment = equipmentForComponent(index, componentId);
    if (!equipment || !isGaussEquipment(equipment)) {
        throw new Error(`Component ${componentId} is not a Gauss weapon`);
    }
    return Object.freeze({ componentId, displayName: equipment.name });
}

export function isMekGaussPowerState(value: unknown): value is MekGaussPowerState {
    return typeof value === 'string'
        && MEK_GAUSS_POWER_STATES.includes(value as MekGaussPowerState);
}

export function isSparseMekGaussPowerState(value: unknown): value is SparseMekGaussPowerState {
    return isMekGaussPowerState(value) && value !== GAUSS_POWERED_UP;
}

/** Powering up does not take effect until the turn boundary. */
export function isGaussPoweredDown(state: MekGaussPowerState): boolean {
    return state === GAUSS_POWERED_DOWN || state === GAUSS_POWERING_UP;
}

export function gaussPowerLabel(state: MekGaussPowerState): string {
    return state === GAUSS_POWERING_DOWN || state === GAUSS_POWERING_UP
        ? `${state}…`
        : state;
}

export function nextGaussPowerState(state: MekGaussPowerState): MekGaussPowerState {
    switch (state) {
        case GAUSS_POWERED_UP: return GAUSS_POWERING_DOWN;
        case GAUSS_POWERING_DOWN: return GAUSS_POWERED_UP;
        case GAUSS_POWERED_DOWN: return GAUSS_POWERING_UP;
        case GAUSS_POWERING_UP: return GAUSS_POWERED_DOWN;
    }
}

export function settledGaussPowerState(state: MekGaussPowerState): MekGaussPowerState {
    if (state === GAUSS_POWERING_DOWN) return GAUSS_POWERED_DOWN;
    if (state === GAUSS_POWERING_UP) return GAUSS_POWERED_UP;
    return state;
}

export function applyGaussPowerWeaponTypes(
    equipment: Equipment,
    state: MekGaussPowerState,
    types: ReadonlySet<WeaponType>,
): ReadonlySet<WeaponType> {
    if (!isGaussEquipment(equipment) || !isGaussPoweredDown(state) || !types.has('X')) return types;
    const effective = new Set(types);
    effective.delete('X');
    return effective;
}

/** Gauss power definition, lifecycle, labels, settlement, and interaction owner. */
export class GaussPowerHandler extends EquipmentInteractionHandler {
    readonly id = 'gauss-power-handler';
    readonly kind = 'gauss-power';
    readonly scope = 'component' as const;
    override readonly flags = [GAUSS_FLAG] as const;
    override readonly priority = 10;

    override choices(input: EquipmentInteractionInput): readonly PickerChoice[] {
        return this.getComponentGaussPowerChoices(
            input.runtime,
            mekGaussPowerDefinition(input.index, input.componentId),
            input.context,
        );
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        return this.handleComponentGaussPowerSelection(
            input.runtime,
            mekGaussPowerDefinition(input.index, input.componentId),
            choice,
            context,
        );
    }

    applicableToComponentGaussPower(_definition: MekGaussPowerDefinition): boolean {
        return true;
    }

    getComponentGaussPowerChoices(
        runtime: CBTUnitInstance,
        definition: MekGaussPowerDefinition,
        _context: EquipmentInteractionQueryContext,
    ): PickerChoice[] {
        const state = runtime.query().componentGaussPower(definition.componentId);
        return [{
            label: gaussPowerLabel(state),
            value: nextGaussPowerState(state),
            active: !isGaussPoweredDown(state),
            displayType: 'toggle',
        }];
    }

    handleComponentGaussPowerSelection(
        runtime: CBTUnitInstance,
        definition: MekGaussPowerDefinition,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const state = runtime.query().componentGaussPower(definition.componentId);
        const next = nextGaussPowerState(state);
        if (choice.value !== next) return false;
        const result = runtime.dispatch({
            type: 'toggle-gauss-power',
            commandId: createCommandId(),
            expectedRevision: runtime.revision(),
            componentId: definition.componentId,
        });
        if (result.accepted && !result.idempotent) {
            context.toastService.showToast(`${definition.displayName} is ${next.toLowerCase()}`, 'info');
        }
        return result.accepted;
    }
}
