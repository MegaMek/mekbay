// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTEquipmentChoice,CBTEquipmentChoiceCommand,CBTEquipmentInteraction } from '../cbt-force.types';
import { type CBTMekUnit,type CBTNonMekUnit } from './cbt-unit';

import { ESCALATING_FAILURE_HANDLER_ID } from './component-escalating-failure';
import type {
EquipmentInteractionChoice,
EquipmentInteractionChoiceBinding,
EquipmentInteractionQueryContext,
} from './equipment-interaction';
import { canPerformMekAction } from './mek-action-availability';
import { projectNonMekEscalatingFailureInteractions } from './non-mek-unit-instance';

type ExpandedEquipmentInteractionChoiceBinding = EquipmentInteractionChoiceBinding & Readonly<{
    groupLabel?: string;
}>;

/** The same action gate controls offered choices and dispatch of a saved selection. */
export function canSelectMekEquipmentInteraction(
    unit: CBTMekUnit,
    interaction: EquipmentInteractionChoiceBinding,
): boolean {
    const choice = interaction.choice;
    const runtime = unit;
    return choice.stateEdit !== undefined
        || choice.skipActionGate === true
        || choice.action === 'configure-network'
        || canPerformMekAction(
            unit.getUnit(),
            unit.getIndex(),
            runtime.query(),
            { kind: 'component', componentId: interaction.componentId },
            choice.action ?? 'change-mode',
            runtime.ruleset(),
        );
}

/** Detached display rows; runtime owners and handlers never enter the public choices. */
export function projectMekEquipmentInteractions(
    unit: CBTMekUnit,
    offered: readonly EquipmentInteractionChoiceBinding[],
    readOnly: boolean,
): readonly CBTEquipmentInteraction[] {
    const entity = unit.getUnit();
    const groups = new Map<string, ExpandedEquipmentInteractionChoiceBinding[]>();
    for (const binding of offered.flatMap(expandEquipmentDropdownBinding)) {
        const key = `${binding.componentId}\0${binding.relatedComponentId ?? ''}`;
        const group = groups.get(key) ?? [];
        group.push(binding);
        groups.set(key, group);
    }
    const rows: CBTEquipmentInteraction[] = [];
    for (const group of groups.values()) {
        const first = group[0];
        const choices = group.map(interaction => detachedEquipmentChoice(
            Object.freeze({
                instanceId: unit.instanceId,
                entityUuid: entity.uuid(),
                componentId: interaction.componentId,
                ...(interaction.relatedComponentId === undefined
                    ? {}
                    : { relatedComponentId: interaction.relatedComponentId }),
                handlerId: interaction.handler.id,
                value: interaction.choice.value,
            }),
            interaction.kind,
            interaction.choice,
            (readOnly && interaction.choice.readOnlySafe !== true)
                || interaction.choice.disabled === true
                || !canSelectMekEquipmentInteraction(unit, interaction),
            interaction.groupLabel,
        ));
        const component = entity.equipment().find(mount => mount.mountId === String(first.componentId));
        rows.push(Object.freeze({
            componentId: first.componentId,
            componentLabel: component?.displayName() ?? first.componentId,
            choices: Object.freeze(choices),
        }));
    }
    return Object.freeze(rows);
}

export function projectNonMekEquipmentInteractions(
    unit: CBTNonMekUnit,
    context: EquipmentInteractionQueryContext,
    readOnly: boolean,
): readonly CBTEquipmentInteraction[] {
    const entity = unit.getUnit();
    const runtime = unit;
    return Object.freeze(projectNonMekEscalatingFailureInteractions(
        entity,
        unit.getIndex(),
        runtime.snapshot(),
        runtime.ruleset(),
        context.choiceSurface,
    ).map(interaction => Object.freeze({
        componentId: interaction.componentId,
        componentLabel: interaction.componentLabel,
        choices: Object.freeze(interaction.choices.map(choice => detachedEquipmentChoice(
            Object.freeze({
                instanceId: unit.instanceId,
                entityUuid: entity.uuid(),
                componentId: interaction.componentId,
                handlerId: ESCALATING_FAILURE_HANDLER_ID,
                value: choice.value,
            }),
            'escalating-failure',
            choice,
            readOnly || choice.disabled === true,
        ))),
    })));
}

export function expandEquipmentDropdownBinding(
    binding: EquipmentInteractionChoiceBinding,
): readonly ExpandedEquipmentInteractionChoiceBinding[] {
    const options = binding.choice.choices;
    if (!options?.length) return Object.freeze([binding]);
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

function detachedEquipmentChoice(
    command: CBTEquipmentChoiceCommand,
    interactionKind: CBTEquipmentChoice['interactionKind'],
    choice: EquipmentInteractionChoice,
    disabled: boolean,
    groupLabel?: string,
): CBTEquipmentChoice {
    return Object.freeze({
        command,
        interactionKind,
        label: choice.label,
        ...(groupLabel === undefined ? {} : { groupLabel }),
        ...(choice.shortLabel === undefined ? {} : { shortLabel: choice.shortLabel }),
        active: choice.active === true,
        disabled,
        ...(choice.selectionTone === undefined ? {} : { selectionTone: choice.selectionTone }),
        ...(choice.colors === undefined ? {} : { colors: Object.freeze({ ...choice.colors }) }),
        ...(choice.keepOpen === undefined ? {} : { keepOpen: choice.keepOpen }),
        ...(choice.displayType === undefined ? {} : { displayType: choice.displayType }),
        ...(choice.tooltipType === undefined ? {} : { tooltipType: choice.tooltipType }),
        ...(choice.failureTarget === undefined ? {} : { failureTarget: choice.failureTarget }),
    });
}
