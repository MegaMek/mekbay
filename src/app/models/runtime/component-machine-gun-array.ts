// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import type { EquipmentFlag } from '../equipment-flags.type';
import { WeaponEquipment } from '../equipment.model';
import { weaponTraitFlag } from '../weapon-traits-kernel';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekRuntimeIndex } from './mek-runtime-index';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
} from './equipment-interaction';
import type { CBTUnitInstance } from './unit-instance';
import type { CBTRuleset } from '../cbt-ruleset.model';

export const MGA_LINKED_MODE = 'Linked';
export const MGA_OFF_MODE = 'Off';
export const MGA_LINKING_MODE = 'turning-on';
export const MGA_UNLINKING_MODE = 'turning-off';

export type MachineGunArrayLifecycleState =
    | typeof MGA_LINKED_MODE
    | typeof MGA_OFF_MODE
    | typeof MGA_LINKING_MODE
    | typeof MGA_UNLINKING_MODE;

const MACHINE_GUN_ARRAY_FLAG: EquipmentFlag = weaponTraitFlag('machine-gun-array');
const MACHINE_GUN_ARRAY_MODES = Object.freeze<MachineGunArrayLifecycleState[]>([
    MGA_LINKED_MODE,
    MGA_OFF_MODE,
    MGA_LINKING_MODE,
    MGA_UNLINKING_MODE,
]);

export function isMachineGunArrayEquipment(equipment: unknown): equipment is WeaponEquipment {
    return equipment instanceof WeaponEquipment
        && equipment.hasWeaponTrait('machine-gun-array');
}

/** Rule-owned modes. Arrays start linked; the two internal values preserve End-Phase transitions. */
export function machineGunArrayComponentModes(
    equipment: unknown,
): Readonly<{ readonly modes: readonly MachineGunArrayLifecycleState[]; readonly defaultMode: typeof MGA_LINKED_MODE }> | null {
    return isMachineGunArrayEquipment(equipment)
        ? Object.freeze({ modes: MACHINE_GUN_ARRAY_MODES, defaultMode: MGA_LINKED_MODE })
        : null;
}

export function isMachineGunArrayLifecycleState(value: unknown): value is MachineGunArrayLifecycleState {
    return value === MGA_LINKED_MODE || value === MGA_OFF_MODE
        || value === MGA_LINKING_MODE || value === MGA_UNLINKING_MODE;
}

/** Missing sparse state is the rules default: linked. */
export function machineGunArrayLifecycleState(value: string | undefined): MachineGunArrayLifecycleState {
    return isMachineGunArrayLifecycleState(value) ? value : MGA_LINKED_MODE;
}

export function effectiveMachineGunArrayMode(
    state: MachineGunArrayLifecycleState,
): typeof MGA_LINKED_MODE | typeof MGA_OFF_MODE {
    return state === MGA_LINKED_MODE || state === MGA_UNLINKING_MODE
        ? MGA_LINKED_MODE
        : MGA_OFF_MODE;
}

export function nextMachineGunArrayState(
    state: MachineGunArrayLifecycleState,
): MachineGunArrayLifecycleState {
    switch (state) {
        case MGA_LINKED_MODE: return MGA_UNLINKING_MODE;
        case MGA_UNLINKING_MODE: return MGA_LINKED_MODE;
        case MGA_OFF_MODE: return MGA_LINKING_MODE;
        case MGA_LINKING_MODE: return MGA_OFF_MODE;
    }
}

export function settledMachineGunArrayState(
    state: MachineGunArrayLifecycleState,
): typeof MGA_LINKED_MODE | typeof MGA_OFF_MODE {
    return state === MGA_LINKING_MODE ? MGA_LINKED_MODE
        : state === MGA_UNLINKING_MODE ? MGA_OFF_MODE
            : state;
}

export function isMachineGunArrayTransition(
    state: MachineGunArrayLifecycleState,
): state is typeof MGA_LINKING_MODE | typeof MGA_UNLINKING_MODE {
    return state === MGA_LINKING_MODE || state === MGA_UNLINKING_MODE;
}

/** Core grants +2 on the Cluster Hits Table; Total Warfare uses the unmodified roll. */
export function machineGunArrayClusterModifier(ruleset: CBTRuleset): 0 | 2 {
    return ruleset === 'core-2026' ? 2 : 0;
}

export function isMachineGunArrayController(index: MekRuntimeIndex, componentId: ComponentId): boolean {
    const component = index.components.get(componentId);
    return component?.kind === 'equipment'
        && isMachineGunArrayEquipment(component.mount.equipment)
        && index.relationships.bays.some(bay => bay.kind === 'machine-gun-array'
            && bay.controllerId === componentId);
}

/** End-Phase activation owner for an Entity-authored machine-gun-array bay. */
export class MachineGunArrayHandler extends EquipmentInteractionHandler {
    readonly id = 'machine-gun-array-handler';
    readonly kind = 'machine-gun-array';
    readonly scope = 'component' as const;
    override readonly flags: readonly EquipmentFlag[] = [MACHINE_GUN_ARRAY_FLAG];
    override readonly priority = 50;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        if (!isMachineGunArrayController(input.index, input.componentId)) return [];
        const state = runtimeMachineGunArrayState(input.runtime, input.componentId);
        return [Object.freeze({
            label: stateLabel(state),
            value: nextMachineGunArrayState(state),
            active: effectiveMachineGunArrayMode(state) === MGA_LINKED_MODE,
            displayType: 'toggle' as const,
            action: 'change-mode' as const,
            disabled: input.runtime.query().componentStatus(input.componentId) !== 'available',
        })];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        if (!isMachineGunArrayController(input.index, input.componentId)) return false;
        const current = runtimeMachineGunArrayState(input.runtime, input.componentId);
        const next = nextMachineGunArrayState(current);
        if (choice.value !== next) return false;
        const result = input.runtime.dispatch({
            type: 'set-component-mode',
            componentId: input.componentId,
            mode: next,
        });
        if (!result.accepted) return false;
        if (result.changed) {
            context.toastService.showToast(
                `${displayName(input)} is ${stateVerb(next)}`,
                'info',
            );
        }
        return true;
    }
}

function runtimeMachineGunArrayState(
    runtime: CBTUnitInstance,
    componentId: ComponentId,
): MachineGunArrayLifecycleState {
    return machineGunArrayLifecycleState(runtime.snapshot().components.get(componentId)?.mode);
}

function displayName(input: EquipmentInteractionInput): string {
    const component = input.index.components.get(input.componentId);
    return component?.kind === 'equipment'
        ? component.mount.displayName()
        : 'Machine Gun Array';
}

function stateLabel(state: MachineGunArrayLifecycleState): string {
    switch (state) {
        case MGA_LINKED_MODE: return 'Array linked';
        case MGA_UNLINKING_MODE: return 'Unlinks at End Phase…';
        case MGA_OFF_MODE: return 'Array unlinked';
        case MGA_LINKING_MODE: return 'Links at End Phase…';
    }
}

function stateVerb(state: MachineGunArrayLifecycleState): string {
    switch (state) {
        case MGA_LINKED_MODE: return 'linked';
        case MGA_UNLINKING_MODE: return 'scheduled to unlink at End Phase';
        case MGA_OFF_MODE: return 'unlinked';
        case MGA_LINKING_MODE: return 'scheduled to link at End Phase';
    }
}
