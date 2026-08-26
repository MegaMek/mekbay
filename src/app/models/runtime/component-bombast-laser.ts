// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    bombastLaserProfile,
    BOMBAST_LASER_FLAG,
    bombastLaserModes,
    isBombastLaserMode,
    isBombastLaserEquipment,
    type BombastLaserMode,
} from '../bombast-laser-mode.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { EquipmentFlag } from '../equipment-flags.type';
import { WeaponEquipment } from '../equipment.model';
import {
    componentStateChangeFromReduction,
    type ComponentStateChangeResult,
    unchangedComponentState,
} from './component-state-change';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import {
    createCommandId,
    type BombastLaserChargeState,
    type BombastLaserRuntimeState,
    type CommandId,
} from './runtime-state';
import type { CBTUnitInstance } from './unit-instance';
import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';

export const BOMBAST_LASER_CHARGING_STATE = 'charging';
export const BOMBAST_LASER_CHARGED_STATE = 'charged';

export interface ComponentBombastLaserDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly ruleset: CBTRuleset;
    readonly flags: ReadonlySet<EquipmentFlag>;
    readonly modes: readonly BombastLaserMode[];
}

export interface BombastLaserLifecycleFacts {
    readonly chargeState: BombastLaserChargeState | null;
    readonly fired: boolean;
}

export function componentBombastLaserDefinition(
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): ComponentBombastLaserDefinition {
    const equipment = equipmentForComponent(index, componentId);
    if (!(equipment instanceof WeaponEquipment) || !isBombastLaserEquipment(equipment)) {
        throw new Error(`Component ${componentId} is not a Bombast Laser weapon`);
    }
    return Object.freeze({
        componentId,
        displayName: equipment.shortName || equipment.name,
        ruleset,
        flags: equipment.flags,
        modes: bombastLaserModes(ruleset),
    });
}

export function isBombastLaserComponent(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): boolean {
    const equipment = equipmentForComponent(index, componentId);
    return equipment instanceof WeaponEquipment && isBombastLaserEquipment(equipment);
}

export function isCoreBombastLaserComponent(
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): boolean {
    return ruleset === 'core-2026' && isBombastLaserComponent(index, componentId);
}

export function componentBombastLaserMode(
    runtime: CBTUnitInstance,
    definition: ComponentBombastLaserDefinition,
): BombastLaserMode {
    const mode = runtime.query().componentMode(definition.componentId);
    if (!isBombastLaserMode(definition.ruleset, mode)) {
        throw new Error(`Unexpected Bombast Laser mode ${String(mode)} for ${definition.componentId}`);
    }
    return mode;
}

export function setComponentBombastLaserMode(
    runtime: CBTUnitInstance,
    definition: ComponentBombastLaserDefinition,
    mode: BombastLaserMode,
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    if (!isBombastLaserMode(definition.ruleset, mode)) {
        return Object.freeze({ accepted: false, changed: false, idempotent: false, reason: 'INVALID_TARGET' });
    }
    if (componentBombastLaserMode(runtime, definition) === mode) return unchangedComponentState();
    return componentStateChangeFromReduction(runtime.dispatch({
        type: 'set-component-mode',
        commandId: commandId(),
        expectedRevision: runtime.revision(),
        componentId: definition.componentId,
        mode,
    }));
}

export function componentBombastLaserLifecycle(
    runtime: CBTUnitInstance,
    definition: ComponentBombastLaserDefinition,
): BombastLaserLifecycleFacts {
    if (definition.ruleset !== 'core-2026') {
        return Object.freeze({ chargeState: null, fired: false });
    }
    const state = runtime.query().componentBombastLaser(definition.componentId);
    if (state !== undefined && !validLifecycleState(state)) {
        throw new Error(`Invalid Bombast Laser runtime facts for ${definition.componentId}`);
    }
    return Object.freeze({
        chargeState: state?.chargeState ?? null,
        fired: state?.firedThisTurn === true,
    });
}

export function setComponentBombastLaserCharge(
    runtime: CBTUnitInstance,
    definition: ComponentBombastLaserDefinition,
    state: typeof BOMBAST_LASER_CHARGING_STATE | null,
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    if (definition.ruleset !== 'core-2026') {
        return Object.freeze({ accepted: false, changed: false, idempotent: false, reason: 'INVALID_TARGET' });
    }
    return componentStateChangeFromReduction(runtime.dispatch({
        type: 'set-bombast-laser-charge',
        commandId: commandId(),
        expectedRevision: runtime.revision(),
        componentId: definition.componentId,
        state,
    }));
}

function validLifecycleState(state: BombastLaserRuntimeState): boolean {
    return (state.chargeState === BOMBAST_LASER_CHARGING_STATE
        || state.chargeState === BOMBAST_LASER_CHARGED_STATE)
        ? state.firedThisTurn === undefined
        : state.chargeState === undefined && state.firedThisTurn === true;
}

export const BOMBAST_LASER_CHARGED_COLOR = '#00a8ff';
export const BOMBAST_LASER_CHARGED_TEXT_COLOR = '#001829';

/** Core Bombast rules: modes, heat profile, charge lifecycle, and interaction. */
export class BombastLaserHandler extends EquipmentInteractionHandler {
    readonly id = 'bombast-laser-handler';
    readonly kind = 'bombast-laser';
    readonly scope = 'component' as const;
    override readonly flags = [BOMBAST_LASER_FLAG] as const;
    override readonly priority = 105;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = componentBombastLaserDefinition(input.index, input.componentId, input.ruleset);
        return this.applicableToComponentBombastLaser(definition)
            ? this.getComponentBombastLaserChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = componentBombastLaserDefinition(input.index, input.componentId, input.ruleset);
        return this.applicableToComponentBombastLaser(definition)
            && this.handleComponentBombastLaserSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentBombastLaser(definition: ComponentBombastLaserDefinition): boolean {
        return definition.ruleset === 'core-2026' && definition.flags.has(BOMBAST_LASER_FLAG);
    }

    getComponentBombastLaserChoices(
        runtime: CBTUnitInstance,
        definition: ComponentBombastLaserDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        const lifecycle = componentBombastLaserLifecycle(runtime, definition);
        const active = lifecycle.chargeState !== null;
        return [
            bombastModeChoice(runtime, definition),
            {
                label: lifecycle.chargeState === BOMBAST_LASER_CHARGED_STATE ? 'Laser Charged!'
                    : lifecycle.chargeState === BOMBAST_LASER_CHARGING_STATE ? 'Laser Charging..' : 'Charge Laser',
                shortLabel: lifecycle.chargeState === BOMBAST_LASER_CHARGED_STATE ? 'Charged!'
                    : lifecycle.chargeState === BOMBAST_LASER_CHARGING_STATE ? 'Charging' : 'Charge',
                value: active ? 'discharged' : BOMBAST_LASER_CHARGING_STATE,
                active,
                disabled: lifecycle.fired,
                ...(active ? {
                    colors: {
                        selected: BOMBAST_LASER_CHARGED_COLOR,
                        selectedText: BOMBAST_LASER_CHARGED_TEXT_COLOR,
                    },
                } : {}),
                displayType: 'toggle',
            },
        ];
    }

    handleComponentBombastLaserSelection(
        runtime: CBTUnitInstance,
        definition: ComponentBombastLaserDefinition,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        if (isBombastLaserMode(definition.ruleset, choice.value)) {
            return setComponentBombastLaserMode(runtime, definition, choice.value).accepted;
        }
        const lifecycle = componentBombastLaserLifecycle(runtime, definition);
        if (choice.value === BOMBAST_LASER_CHARGING_STATE) {
            if (lifecycle.fired) {
                context.toastService.showToast('A fired Bombast Laser cannot charge this turn.', 'error');
                return true;
            }
            const change = setComponentBombastLaserCharge(runtime, definition, BOMBAST_LASER_CHARGING_STATE);
            if (change.accepted) context.toastService.showToast('Bombast Laser charging', 'info');
            return change.accepted;
        }
        if (choice.value === 'discharged') {
            const change = setComponentBombastLaserCharge(runtime, definition, null);
            if (change.accepted) context.toastService.showToast('Bombast Laser discharged', 'info');
            return change.accepted;
        }
        return false;
    }
}

/** Total Warfare's six damage modes; it deliberately has no Core charge lifecycle. */
export class TwBombastLaserHandler extends EquipmentInteractionHandler {
    readonly id = 'tw-bombast-laser-handler';
    readonly kind = 'bombast-laser';
    readonly scope = 'component' as const;
    override readonly flags = [BOMBAST_LASER_FLAG] as const;
    override readonly priority = 105;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = componentBombastLaserDefinition(input.index, input.componentId, input.ruleset);
        return this.applicableToComponentBombastLaser(definition)
            ? this.getComponentBombastLaserChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = componentBombastLaserDefinition(input.index, input.componentId, input.ruleset);
        return this.applicableToComponentBombastLaser(definition)
            && this.handleComponentBombastLaserSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentBombastLaser(definition: ComponentBombastLaserDefinition): boolean {
        return definition.ruleset === 'total-warfare' && definition.flags.has(BOMBAST_LASER_FLAG);
    }

    getComponentBombastLaserChoices(
        runtime: CBTUnitInstance,
        definition: ComponentBombastLaserDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        return [bombastModeChoice(runtime, definition)];
    }

    handleComponentBombastLaserSelection(
        runtime: CBTUnitInstance,
        definition: ComponentBombastLaserDefinition,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        return isBombastLaserMode(definition.ruleset, choice.value)
            && setComponentBombastLaserMode(runtime, definition, choice.value).accepted;
    }
}

export function bombastModeChoice(
    runtime: CBTUnitInstance,
    definition: ComponentBombastLaserDefinition,
): EquipmentInteractionChoice {
    return {
        label: 'Mode',
        value: componentBombastLaserMode(runtime, definition),
        displayType: 'dropdown',
        choices: definition.modes.map(mode => ({
            label: `${bombastLaserProfile(definition.ruleset, mode)!.damage} DMG`,
            value: mode,
        })),
        keepOpen: true,
    };
}
