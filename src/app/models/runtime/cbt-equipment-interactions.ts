// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTEquipmentChoice,CBTEquipmentChoiceCommand,CBTEquipmentInteraction } from '../cbt-force.types';
import { type CBTMekUnit,type CBTNonMekUnit } from './cbt-unit';

import type { ComponentId } from '../entity/entity-identifiers';
import { ESCALATING_FAILURE_DISABLED_CHOICE_VALUE,ESCALATING_FAILURE_HANDLER_ID } from './component-escalating-failure';
import { componentJamChoices,componentJamDefinition,selectComponentJam,UAC_JAMMING_HANDLER_ID } from './component-rapid-fire-autocannon';
import type {
EquipmentInteractionChoice,
EquipmentInteractionChoiceBinding,
EquipmentInteractionCommandContext,
EquipmentInteractionHandlerId,
EquipmentInteractionKind,
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

/** One live non-Mek choice and the shared equipment behavior that applies it. */
interface NonMekEquipmentChoiceBinding {
    readonly componentId: ComponentId;
    readonly componentLabel: string;
    readonly handlerId: EquipmentInteractionHandlerId;
    readonly kind: EquipmentInteractionKind;
    readonly choice: EquipmentInteractionChoice;
    readonly select: (context: EquipmentInteractionCommandContext) => boolean;
}

/**
 * Non-Mek units bind the escalating-failure and UAC/RAC jamming behaviors
 * directly. Projection and dispatch share these bindings, so a detached
 * choice is applied only while the live unit still offers it.
 */
function nonMekEquipmentChoiceBindings(
    unit: CBTNonMekUnit,
    context: EquipmentInteractionQueryContext,
): readonly NonMekEquipmentChoiceBinding[] {
    const index = unit.getIndex();
    const escalatingFailures = projectNonMekEscalatingFailureInteractions(
        unit.getUnit(),
        index,
        unit.snapshot(),
        unit.ruleset(),
        context.choiceSurface,
    ).flatMap(interaction => interaction.choices.map((choice): NonMekEquipmentChoiceBinding => Object.freeze({
        componentId: interaction.componentId,
        componentLabel: interaction.componentLabel,
        handlerId: ESCALATING_FAILURE_HANDLER_ID,
        kind: 'escalating-failure',
        choice,
        select: () => {
            const edit = choice.value === ESCALATING_FAILURE_DISABLED_CHOICE_VALUE
                ? Object.freeze({
                    kind: 'set-status' as const,
                    status: interaction.status === 'disabled' ? 'available' as const : 'disabled' as const,
                })
                : typeof choice.value === 'number' && Number.isSafeInteger(choice.value)
                    ? Object.freeze({ kind: 'select-sequence' as const, index: choice.value })
                    : null;
            return edit !== null && unit.dispatch({
                type: 'edit-escalating-failure',
                componentId: interaction.componentId,
                edit,
            }).accepted;
        },
    })));
    const jams = [...index.components.values()].flatMap(component => {
        const definition = componentJamDefinition(component.id, component.mount.equipment, unit.ruleset());
        return definition === null ? [] : componentJamChoices(unit, definition)
            .map((choice): NonMekEquipmentChoiceBinding => Object.freeze({
                componentId: component.id,
                componentLabel: component.mount.displayName(),
                handlerId: UAC_JAMMING_HANDLER_ID,
                kind: 'jam',
                choice,
                select: (commandContext: EquipmentInteractionCommandContext) =>
                    selectComponentJam(unit, definition, choice, commandContext),
            }));
    });
    return Object.freeze([...escalatingFailures, ...jams]);
}

export function projectNonMekEquipmentInteractions(
    unit: CBTNonMekUnit,
    context: EquipmentInteractionQueryContext,
    readOnly: boolean,
): readonly CBTEquipmentInteraction[] {
    const entity = unit.getUnit();
    const rows = new Map<ComponentId, { componentLabel: string; choices: CBTEquipmentChoice[] }>();
    for (const binding of nonMekEquipmentChoiceBindings(unit, context)) {
        const row = rows.get(binding.componentId) ?? { componentLabel: binding.componentLabel, choices: [] };
        row.choices.push(detachedEquipmentChoice(
            Object.freeze({
                instanceId: unit.instanceId,
                entityUuid: entity.uuid(),
                componentId: binding.componentId,
                handlerId: binding.handlerId,
                value: binding.choice.value,
            }),
            binding.kind,
            binding.choice,
            readOnly || binding.choice.disabled === true,
        ));
        rows.set(binding.componentId, row);
    }
    return Object.freeze([...rows].map(([componentId, row]) => Object.freeze({
        componentId,
        componentLabel: row.componentLabel,
        choices: Object.freeze(row.choices),
    })));
}

/** Applies a detached choice through its live binding; null when the unit no longer offers it. */
export function selectNonMekEquipmentChoice(
    unit: CBTNonMekUnit,
    selected: CBTEquipmentChoiceCommand,
    queryContext: EquipmentInteractionQueryContext,
    commandContext: EquipmentInteractionCommandContext,
): boolean | null {
    const binding = selected.relatedComponentId === undefined
        ? nonMekEquipmentChoiceBindings(unit, queryContext).find(candidate =>
            candidate.componentId === selected.componentId
            && candidate.handlerId === selected.handlerId
            && candidate.choice.disabled !== true
            && Object.is(candidate.choice.value, selected.value))
        : undefined;
    return binding === undefined ? null : binding.select(commandContext);
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
