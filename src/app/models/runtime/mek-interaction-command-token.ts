// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId, type ComponentId } from '../entity/entity-identifiers';
import type {
    V2EquipmentInteractionChoiceBinding,
    V2EquipmentInteractionKind,
} from '../../services/equipment-interaction-registry.service';
import type { MekEquipmentChoiceToken } from '../cbt-force-api';
import {
    asStateRevision,
    asUnitInstanceId,
    type StateRevision,
    type UnitInstanceId,
} from './runtime-state';

export type ExpandedV2EquipmentInteractionChoiceBinding = V2EquipmentInteractionChoiceBinding & Readonly<{
    groupLabel?: string;
}>;

export interface EquipmentChoiceTokenPayload {
    readonly instanceId: UnitInstanceId;
    readonly entityUuid: string;
    readonly stateRevision: StateRevision;
    readonly componentId: ComponentId;
    readonly relatedComponentId?: ComponentId;
    readonly kind: V2EquipmentInteractionKind;
    readonly handlerId: string;
    readonly value: string | number;
    readonly label: string;
    readonly groupLabel?: string;
}

const EQUIPMENT_CHOICE_TOKEN_KIND = 'mek-equipment-choice-v1';
export function encodeEquipmentChoiceToken(input: {
    readonly instanceId: UnitInstanceId;
    readonly entityUuid: string;
    readonly stateRevision: StateRevision;
    readonly interaction: ExpandedV2EquipmentInteractionChoiceBinding;
}): MekEquipmentChoiceToken {
    const interaction = input.interaction;
    return JSON.stringify([
        EQUIPMENT_CHOICE_TOKEN_KIND,
        input.instanceId,
        input.entityUuid,
        input.stateRevision,
        interaction.componentId,
        interaction.relatedComponentId ?? null,
        interaction.kind,
        interaction.handler.id,
        interaction.choice.value,
        interaction.choice.label,
        interaction.groupLabel ?? null,
    ]) as MekEquipmentChoiceToken;
}

export function decodeEquipmentChoiceToken(token: MekEquipmentChoiceToken): EquipmentChoiceTokenPayload | null {
    try {
        const row: unknown = JSON.parse(token);
        if (!Array.isArray(row) || row.length !== 11 || row[0] !== EQUIPMENT_CHOICE_TOKEN_KIND
            || typeof row[1] !== 'string' || typeof row[2] !== 'string'
            || !Number.isSafeInteger(row[3]) || (row[3] as number) < 0
            || typeof row[4] !== 'string' || (row[5] !== null && typeof row[5] !== 'string')
            || typeof row[6] !== 'string' || row[6].length === 0
            || typeof row[7] !== 'string'
            || (typeof row[8] !== 'string' && (typeof row[8] !== 'number' || !Number.isFinite(row[8])))
            || typeof row[9] !== 'string' || (row[10] !== null && typeof row[10] !== 'string')) return null;
        return Object.freeze({
            instanceId: asUnitInstanceId(row[1]),
            entityUuid: row[2],
            stateRevision: asStateRevision(row[3] as number),
            componentId: asComponentId(row[4]),
            ...(row[5] === null ? {} : { relatedComponentId: asComponentId(row[5]) }),
            kind: row[6] as V2EquipmentInteractionKind,
            handlerId: row[7],
            value: row[8],
            label: row[9],
            ...(row[10] === null ? {} : { groupLabel: row[10] }),
        });
    } catch {
        return null;
    }
}

export function equipmentChoiceMatches(
    interaction: ExpandedV2EquipmentInteractionChoiceBinding,
    selected: EquipmentChoiceTokenPayload,
): boolean {
    return interaction.componentId === selected.componentId
        && interaction.relatedComponentId === selected.relatedComponentId
        && interaction.kind === selected.kind
        && interaction.handler.id === selected.handlerId
        && Object.is(interaction.choice.value, selected.value)
        && interaction.choice.label === selected.label
        && interaction.groupLabel === selected.groupLabel;
}

export function expandV2EquipmentDropdownBinding(
    binding: V2EquipmentInteractionChoiceBinding,
): readonly ExpandedV2EquipmentInteractionChoiceBinding[] {
    const options = binding.choice.choices;
    if (!Array.isArray(options) || options.length === 0) return Object.freeze([binding]);
    const { choices: _options, ...baseChoice } = binding.choice;
    return Object.freeze(options.map(option => Object.freeze({
        ...binding,
        groupLabel: binding.choice.label,
        choice: Object.freeze({
            ...baseChoice,
            label: option.label,
            shortLabel: option.label,
            value: option.value,
            active: option.value === binding.choice.value,
            disabled: option.disabled === true,
        }),
    })));
}
