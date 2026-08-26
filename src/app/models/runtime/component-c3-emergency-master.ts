// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    C3EM_FRIED_SEQUENCE_VALUE,
    C3EM_MAX_OPERATING_TURNS,
    C3_EMERGENCY_MASTER_FLAG,
    isC3EmergencyMasterEquipment,
    isC3EmergencyMasterModeRequested,
    isC3EmergencyMasterOperatingTurnsFried,
    type C3EmergencyMasterMode,
    type C3EmergencyMasterStatus,
} from '../c3-emergency-master.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import { ImmutableSet } from '../entity/immutable-collections';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { EquipmentStatus } from '../equipment-status.model';
import {
    componentStateChangeFromReduction,
    type ComponentStateChangeResult,
    unchangedComponentState,
} from './component-state-change';
import type { CBTEncounterSnapshot, EncounterNetworkEndpoint } from './encounter-runtime';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import {
    createCommandId,
    type C3EmergencyMasterOperatingTurns,
    type C3EmergencyMasterRuntimeState,
    type CommandId,
    type UnitInstanceId,
} from './runtime-state';
import type { CBTUnitInstance } from './unit-instance';
import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionNotifications,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';

export const C3_EMERGENCY_MASTER_HANDLER_ID = 'c3-emergency-master-handler';
export const C3EM_TOGGLE_CHOICE_VALUE = 'c3em-emergency';

export interface ComponentC3EmergencyMasterDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly unitDisplayName: string;
    readonly flags: ReadonlySet<EquipmentFlag>;
}

export type TypedC3EmergencyMasterEndpointRole = Extract<
    EncounterNetworkEndpoint['role'],
    'master' | 'member'
>;

export interface ComponentC3EmergencyMasterContext {
    readonly instanceId: UnitInstanceId;
    readonly encounter: () => Pick<CBTEncounterSnapshot, 'networks'>;
}

export interface ComponentC3EmergencyMasterFacts {
    readonly mode: C3EmergencyMasterMode;
    readonly operatingTurns: 0 | C3EmergencyMasterOperatingTurns;
    readonly status: C3EmergencyMasterStatus;
    readonly equipmentStatus: EquipmentStatus;
    readonly endpointRole: TypedC3EmergencyMasterEndpointRole | null;
}

export function componentC3EmergencyMasterStatusLabel(
    facts: Pick<ComponentC3EmergencyMasterFacts, 'status' | 'operatingTurns'>,
): string {
    return facts.status === 'fried'
        ? 'fried after 6 operating turns'
        : `${facts.status}, ${facts.operatingTurns}/${C3EM_MAX_OPERATING_TURNS} operating turns`;
}

export function createComponentC3EmergencyMasterDefinition(input: {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly unitDisplayName: string;
    readonly flags: Iterable<EquipmentFlag>;
}): ComponentC3EmergencyMasterDefinition {
    const displayName = input.displayName.trim();
    const unitDisplayName = input.unitDisplayName.trim();
    const flags = new ImmutableSet(input.flags);
    if (!displayName || displayName.includes('\0')
        || !unitDisplayName || unitDisplayName.includes('\0')
        || !flags.has(C3_EMERGENCY_MASTER_FLAG)) {
        throw new Error(`Invalid C3 Emergency Master definition for ${input.componentId}`);
    }
    return Object.freeze({ componentId: input.componentId, displayName, unitDisplayName, flags });
}

export function componentC3EmergencyMasterDefinition(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
): ComponentC3EmergencyMasterDefinition {
    const equipment = equipmentForComponent(index, componentId);
    if (!equipment || !isC3EmergencyMasterEquipment(equipment)) {
        throw new Error(`Component ${componentId} is not a C3 Emergency Master`);
    }
    return createComponentC3EmergencyMasterDefinition({
        componentId,
        displayName: equipment.shortName || equipment.name,
        unitDisplayName: entity.displayName(),
        flags: equipment.flags,
    });
}

export function isC3EmergencyMasterComponent(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): boolean {
    return isC3EmergencyMasterEquipment(equipmentForComponent(index, componentId));
}

export function typedC3EmergencyMasterEndpointRole(
    encounter: Pick<CBTEncounterSnapshot, 'networks'>,
    instanceId: UnitInstanceId,
    componentId: ComponentId,
): TypedC3EmergencyMasterEndpointRole | null {
    const matches = encounter.networks.flatMap(network => network.networkType !== 'c3'
        ? []
        : network.endpoints.filter(endpoint => endpoint.instanceId === instanceId
            && endpoint.componentId === componentId
            && (endpoint.role === 'master' || endpoint.role === 'member')));
    return matches.length === 1 ? matches[0].role as TypedC3EmergencyMasterEndpointRole : null;
}

export function typedC3EmergencyMasterStatus(input: {
    readonly mode: C3EmergencyMasterMode;
    readonly operatingTurns: number;
    readonly equipmentStatus: EquipmentStatus;
    readonly endpointRole: TypedC3EmergencyMasterEndpointRole | null;
}): C3EmergencyMasterStatus {
    if (isC3EmergencyMasterOperatingTurnsFried(input.operatingTurns)) return 'fried';
    if (input.endpointRole === null) return 'dormant';
    const requested = isC3EmergencyMasterModeRequested(
        input.mode,
        input.endpointRole === 'master',
    );
    if (!requested) return 'dormant';
    if (input.equipmentStatus !== 'available') return 'unavailable';
    return input.endpointRole === 'master' ? 'active' : 'standby';
}

export function componentC3EmergencyMasterFacts(
    runtime: CBTUnitInstance,
    definition: ComponentC3EmergencyMasterDefinition,
    context: ComponentC3EmergencyMasterContext,
): ComponentC3EmergencyMasterFacts {
    const query = runtime.query();
    const lifecycle = query.componentC3EmergencyMaster(definition.componentId);
    validateRuntimeFacts(lifecycle, definition.componentId);
    const mode = lifecycle?.mode ?? 'auto';
    const operatingTurns = lifecycle?.operatingTurns ?? 0;
    const equipmentStatus = query.componentStatus(definition.componentId, 'preview');
    const endpointRole = typedC3EmergencyMasterEndpointRole(
        context.encounter(),
        context.instanceId,
        definition.componentId,
    );
    return Object.freeze({
        mode,
        operatingTurns,
        equipmentStatus,
        endpointRole,
        status: typedC3EmergencyMasterStatus({
            mode,
            operatingTurns,
            equipmentStatus,
            endpointRole,
        }),
    });
}

export function toggleComponentC3EmergencyMaster(
    runtime: CBTUnitInstance,
    definition: ComponentC3EmergencyMasterDefinition,
    context: ComponentC3EmergencyMasterContext,
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    const facts = componentC3EmergencyMasterFacts(runtime, definition, context);
    if (facts.status === 'fried') return unchangedComponentState();
    return dispatchC3EmergencyMaster(runtime, definition, {
        kind: 'toggle-requested',
        turningOn: facts.status !== 'active' && facts.status !== 'standby',
    }, commandId);
}

export function selectComponentC3EmergencyMasterOperatingTurns(
    runtime: CBTUnitInstance,
    definition: ComponentC3EmergencyMasterDefinition,
    turns: C3EmergencyMasterOperatingTurns,
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    if (!Number.isSafeInteger(turns) || turns < 1 || turns > C3EM_FRIED_SEQUENCE_VALUE) {
        return rejectedComponentState();
    }
    return dispatchC3EmergencyMaster(runtime, definition, {
        kind: 'select-operating-turns',
        turns,
    }, commandId);
}

/** Seeds turn one after the encounter coordinator promotes this endpoint. */
export function syncComponentC3EmergencyMasterEncounter(
    runtime: CBTUnitInstance,
    definition: ComponentC3EmergencyMasterDefinition,
    context: ComponentC3EmergencyMasterContext,
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    const facts = componentC3EmergencyMasterFacts(runtime, definition, context);
    return facts.status === 'active' && facts.operatingTurns === 0
        ? dispatchC3EmergencyMaster(runtime, definition, {
            kind: 'ensure-active-started',
            endpointRole: 'master',
        }, commandId)
        : unchangedComponentState();
}

export function settleComponentC3EmergencyMasterEndTurn(
    runtime: CBTUnitInstance,
    definition: ComponentC3EmergencyMasterDefinition,
    context: ComponentC3EmergencyMasterContext,
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    return componentC3EmergencyMasterFacts(runtime, definition, context).status === 'active'
        ? dispatchC3EmergencyMaster(runtime, definition, {
            kind: 'settle-active-end-turn',
            endpointRole: 'master',
        }, commandId)
        : unchangedComponentState();
}

function dispatchC3EmergencyMaster(
    runtime: CBTUnitInstance,
    definition: ComponentC3EmergencyMasterDefinition,
    edit:
        | { readonly kind: 'toggle-requested'; readonly turningOn: boolean }
        | { readonly kind: 'select-operating-turns'; readonly turns: C3EmergencyMasterOperatingTurns }
        | { readonly kind: 'ensure-active-started'; readonly endpointRole: 'master' }
        | { readonly kind: 'settle-active-end-turn'; readonly endpointRole: 'master' },
    commandId: () => CommandId,
): ComponentStateChangeResult {
    return componentStateChangeFromReduction(runtime.dispatch({
        type: 'edit-c3-emergency-master',
        commandId: commandId(),
        expectedRevision: runtime.revision(),
        componentId: definition.componentId,
        edit,
    }));
}

function validateRuntimeFacts(
    lifecycle: C3EmergencyMasterRuntimeState | undefined,
    componentId: ComponentId,
): void {
    if (lifecycle === undefined) return;
    if ((lifecycle.mode !== undefined && lifecycle.mode !== 'on' && lifecycle.mode !== 'off')
        || (lifecycle.operatingTurns !== undefined && (
            !Number.isSafeInteger(lifecycle.operatingTurns)
            || lifecycle.operatingTurns < 1
            || lifecycle.operatingTurns > C3EM_FRIED_SEQUENCE_VALUE
        ))
        || (lifecycle.mode === undefined && lifecycle.operatingTurns === undefined)) {
        throw new Error(`Invalid C3 Emergency Master runtime facts for ${componentId}`);
    }
}

function rejectedComponentState(): ComponentStateChangeResult {
    return Object.freeze({
        accepted: false,
        changed: false,
        idempotent: false,
        reason: 'INVALID_TARGET',
    });
}

const C3EM_TRACK_LABELS = ['1', '2', '3', '4', '5', '6', '!!'] as const;
const C3EM_TRACK_COLORS = {
    selected: 'var(--bt-yellow)',
    selectedText: '#000',
    mutedSelected: 'var(--bt-yellow-background)',
    mutedSelectedText: '#888',
    disabledText: '#888',
};
const C3EM_FRIED_COLORS = {
    ...C3EM_TRACK_COLORS,
    selected: '#f00',
    selectedText: '#fff',
    mutedSelected: '#800',
};
const C3EM_EMERGENCY_COLORS = {
    selected: '#d96b00',
    selectedText: 'var(--bt-yellow)',
    mutedSelected: '#d96b00',
    mutedSelectedText: 'var(--bt-yellow)',
};

/** C3EM definition, sequence, network-derived state, lifecycle, and interaction owner. */
export class C3EmergencyMasterHandler extends EquipmentInteractionHandler {
    readonly id = C3_EMERGENCY_MASTER_HANDLER_ID;
    readonly kind = 'c3-emergency-master';
    readonly scope = 'component' as const;
    override readonly flags = [C3_EMERGENCY_MASTER_FLAG] as const;
    override readonly priority = 11;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = componentC3EmergencyMasterDefinition(input.entity, input.index, input.componentId);
        if (!this.applicableToComponentC3EmergencyMaster(definition)) return [];
        return this.getComponentC3EmergencyMasterChoices(
            input.runtime,
            definition,
            input.owner,
            input.context,
        ).map(choice => ({ ...choice, skipActionGate: true }));
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = componentC3EmergencyMasterDefinition(input.entity, input.index, input.componentId);
        return this.applicableToComponentC3EmergencyMaster(definition)
            && this.handleComponentC3EmergencyMasterSelection(
                input.runtime,
                definition,
                input.owner,
                choice,
                context,
            );
    }

    applicableToComponentC3EmergencyMaster(definition: ComponentC3EmergencyMasterDefinition): boolean {
        return definition.flags.has(C3_EMERGENCY_MASTER_FLAG);
    }

    getComponentC3EmergencyMasterChoices(
        runtime: CBTUnitInstance,
        definition: ComponentC3EmergencyMasterDefinition,
        runtimeContext: ComponentC3EmergencyMasterContext,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        const facts = componentC3EmergencyMasterFacts(runtime, definition, runtimeContext);
        const turns = facts.operatingTurns;
        const status = facts.status;
        const unavailable = facts.equipmentStatus !== 'available';
        const track = C3EM_TRACK_LABELS.map((label, index): EquipmentInteractionChoice => {
            const sequenceValue = index + 1;
            const friedChoice = sequenceValue === C3EM_FRIED_SEQUENCE_VALUE;
            const current = sequenceValue === turns;
            return {
                label,
                shortLabel: label,
                value: sequenceValue,
                displayType: 'toggle',
                active: friedChoice ? current : status !== 'fried' && sequenceValue <= turns,
                disabled: unavailable,
                selectionTone: current && (friedChoice || status === 'active') ? 'selected' : 'muted',
                colors: friedChoice ? C3EM_FRIED_COLORS : C3EM_TRACK_COLORS,
                keepOpen: true,
            };
        });
        return [...track, {
            label: 'EMERGENCY',
            shortLabel: 'EMERGENCY',
            value: C3EM_TOGGLE_CHOICE_VALUE,
            displayType: 'toggle',
            disabled: unavailable || status === 'fried',
            active: status === 'active' || status === 'standby',
            selectionTone: 'selected',
            colors: C3EM_EMERGENCY_COLORS,
            keepOpen: true,
        }];
    }

    handleComponentC3EmergencyMasterSelection(
        runtime: CBTUnitInstance,
        definition: ComponentC3EmergencyMasterDefinition,
        runtimeContext: ComponentC3EmergencyMasterContext,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        if (choice.value === C3EM_TOGGLE_CHOICE_VALUE
            && componentC3EmergencyMasterFacts(runtime, definition, runtimeContext).status === 'fried') return true;
        if (choice.value === C3EM_TOGGLE_CHOICE_VALUE) {
            return toggleComponentC3EmergencyMaster(runtime, definition, runtimeContext).accepted;
        }
        const sequenceValue = Number(choice.value);
        if (!Number.isInteger(sequenceValue)
            || sequenceValue < 1
            || sequenceValue > C3EM_FRIED_SEQUENCE_VALUE) return true;
        const result = selectComponentC3EmergencyMasterOperatingTurns(
            runtime,
            definition,
            sequenceValue as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        );
        if (!result.accepted || !result.changed) return result.accepted;
        context.toastService.showToast(
            `${definition.displayName}: ${this.statusLabel(runtime, definition, runtimeContext)}`,
            componentC3EmergencyMasterFacts(runtime, definition, runtimeContext).status === 'fried'
                ? 'error'
                : 'info',
        );
        return true;
    }

    onComponentC3EmergencyMasterEndTurn(
        runtime: CBTUnitInstance,
        definition: ComponentC3EmergencyMasterDefinition,
        runtimeContext: ComponentC3EmergencyMasterContext,
        notifications: EquipmentInteractionNotifications,
    ): void {
        const result = settleComponentC3EmergencyMasterEndTurn(runtime, definition, runtimeContext);
        if (!result.accepted || !result.changed) return;
        const facts = componentC3EmergencyMasterFacts(runtime, definition, runtimeContext);
        notifications.showToast(
            `${definition.unitDisplayName}: ${definition.displayName} ${this.statusLabel(
                runtime,
                definition,
                runtimeContext,
            )}`,
            facts.operatingTurns === C3EM_FRIED_SEQUENCE_VALUE ? 'error' : 'info',
        );
    }

    private statusLabel(
        runtime: CBTUnitInstance,
        definition: ComponentC3EmergencyMasterDefinition,
        runtimeContext: ComponentC3EmergencyMasterContext,
    ): string {
        return componentC3EmergencyMasterStatusLabel(
            componentC3EmergencyMasterFacts(runtime, definition, runtimeContext),
        );
    }
}
