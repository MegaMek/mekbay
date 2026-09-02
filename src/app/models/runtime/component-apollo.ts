// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    APOLLO_MODES,
    APOLLO_FLAG,
    APOLLO_SATURATION_MODE,
    APOLLO_STANDARD_MODE,
    isApolloMode,
    isApolloLink,
    supportsApolloSaturationModeForRuleset,
    type ApolloMode,
} from '../apollo-mode.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import type { ToHitAdjustment } from '../rules/game-rules';
import type { WeaponType } from '../weapon-types.model';
import {
    componentStatusDefinition,
    type ComponentStatusDefinition,
} from './component-status';
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
import { isWeaponEnhancementEquipment } from '../weapon-enhancement.model';

export interface ComponentApolloDefinition {
    readonly source: ComponentStatusDefinition;
    readonly parent: ComponentStatusDefinition;
    readonly sourceLabel: string;
    readonly supportsSaturationMode: boolean;
    readonly relation: {
        readonly kind: 'linked';
        readonly sourceId: ComponentId;
        readonly targetId: ComponentId;
    };
}

export interface ComponentApolloRuntimeView {
    componentStatus(componentId: ComponentId): EquipmentStatus;
    componentMode(componentId: ComponentId): string | undefined;
}

export function componentApolloDefinition(
    index: MekRuntimeIndex,
    sourceId: ComponentId,
    parentId: ComponentId,
    ruleset: CBTRuleset,
): ComponentApolloDefinition {
    const definition = resolveComponentApolloDefinition(index, sourceId, parentId, ruleset);
    if (definition === null) throw new Error('Apollo link requires one exact Apollo-to-MRM relation');
    return definition;
}

function resolveComponentApolloDefinition(
    index: MekRuntimeIndex,
    sourceId: ComponentId,
    parentId: ComponentId,
    ruleset: CBTRuleset,
): ComponentApolloDefinition | null {
    const source = equipmentForComponent(index, sourceId);
    const parent = equipmentForComponent(index, parentId);
    if (source === undefined || parent === undefined) return null;
    if (!isApolloLink(source, parent)
        || index.relationships.linkedTargetBySource.get(sourceId) !== parentId
        || index.relationships.linkedSourceByTarget.get(parentId) !== sourceId) {
        return null;
    }
    return Object.freeze({
        source: componentStatusDefinition(index, sourceId),
        parent: componentStatusDefinition(index, parentId),
        sourceLabel: source.shortName || source.name,
        supportsSaturationMode: supportsApolloSaturationModeForRuleset(ruleset),
        relation: Object.freeze({
            kind: 'linked' as const,
            sourceId,
            targetId: parentId,
        }),
    });
}

/** Canonical parent-weapon modes for one exact Apollo-to-MRM relation. */
export function componentApolloModes(
    index: MekRuntimeIndex,
    parentId: ComponentId,
    ruleset: CBTRuleset,
): Readonly<{ readonly modes: readonly ApolloMode[]; readonly defaultMode: ApolloMode }> | null {
    if (!supportsApolloSaturationModeForRuleset(ruleset)) return null;
    const sourceId = index.relationships.linkedSourceByTarget.get(parentId);
    if (sourceId === undefined
        || resolveComponentApolloDefinition(index, sourceId, parentId, ruleset) === null) return null;
    return Object.freeze({ modes: APOLLO_MODES, defaultMode: APOLLO_STANDARD_MODE });
}

export function componentApolloMode(
    runtime: ComponentApolloRuntimeView,
    definition: ComponentApolloDefinition,
): ApolloMode {
    if (!definition.supportsSaturationMode
        || runtime.componentStatus(definition.source.componentId) !== 'available') {
        return APOLLO_STANDARD_MODE;
    }
    const mode = runtime.componentMode(definition.parent.componentId);
    return isApolloMode(mode) ? mode : APOLLO_STANDARD_MODE;
}

export function componentApolloToHitAdjustment(
    index: MekRuntimeIndex,
    runtime: ComponentApolloRuntimeView,
    parentId: ComponentId,
    ruleset: CBTRuleset,
): ToHitAdjustment | null {
    const sourceId = index.relationships.linkedSourceByTarget.get(parentId);
    if (sourceId === undefined) return null;
    const definition = resolveComponentApolloDefinition(index, sourceId, parentId, ruleset);
    if (definition === null) return null;
    if (definition.supportsSaturationMode) return null;
    const status = runtime.componentStatus(sourceId);
    const weakened = status !== 'available';
    return Object.freeze({
        kind: 'add' as const,
        label: status === 'destroyed'
            ? `${definition.sourceLabel} Destroyed`
            : status === 'disabled'
                ? `${definition.sourceLabel} Disabled`
                : definition.sourceLabel,
        modifier: weakened ? 0 : -1,
        weakened,
    });
}

export function applyComponentApolloWeaponTypes(
    index: MekRuntimeIndex,
    runtime: ComponentApolloRuntimeView,
    parentId: ComponentId,
    ruleset: CBTRuleset,
    types: ReadonlySet<WeaponType>,
): ReadonlySet<WeaponType> {
    const sourceId = index.relationships.linkedSourceByTarget.get(parentId);
    if (sourceId === undefined) return types;
    const definition = resolveComponentApolloDefinition(index, sourceId, parentId, ruleset);
    if (definition === null) return types;
    return definition.supportsSaturationMode
        && runtime.componentStatus(sourceId) === 'available'
        && componentApolloMode(runtime, definition) === APOLLO_SATURATION_MODE
        ? new Set([...types, 'AE'])
        : types;
}

/** Apollo owns its authored link, mode interaction, targeting, and weapon projections. */
export class ApolloHandler extends EquipmentInteractionHandler {
    readonly id = 'apollo-handler';
    readonly kind = 'apollo';
    readonly scope = 'link' as const;
    override readonly flags = [APOLLO_FLAG] as const;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = this.definition(input);
        return this.applicableToComponentApollo(definition)
            ? this.getComponentApolloChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = this.definition(input);
        return this.applicableToComponentApollo(definition)
            && this.handleComponentApolloSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentApollo(definition: ComponentApolloDefinition): boolean {
        return isWeaponEnhancementEquipment(definition.source.flags)
            && definition.source.flags.has(APOLLO_FLAG)
            && definition.parent.flags.has('F_MRM');
    }

    getComponentApolloChoices(
        runtime: CBTUnitInstance,
        definition: ComponentApolloDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        if (!definition.supportsSaturationMode) return [];
        const sourceStatus = runtime.query().componentStatus(definition.source.componentId);
        return [{
            label: 'Mode',
            value: componentApolloMode(runtime.query(), definition),
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: APOLLO_STANDARD_MODE },
                { label: 'SAT', value: APOLLO_SATURATION_MODE },
            ],
            disabled: sourceStatus !== 'available',
            keepOpen: true,
        }];
    }

    handleComponentApolloSelection(
        runtime: CBTUnitInstance,
        definition: ComponentApolloDefinition,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        if (!definition.supportsSaturationMode || !isApolloMode(choice.value)) return false;
        if (componentApolloMode(runtime.query(), definition) === choice.value) return true;
        return runtime.dispatch({
            type: 'set-component-mode',
            componentId: definition.parent.componentId,
            mode: choice.value,
        }).accepted;
    }

    private definition(input: EquipmentInteractionInput): ComponentApolloDefinition {
        if (input.relatedComponentId === undefined) throw new Error('Apollo requires an authored link');
        return componentApolloDefinition(
            input.index,
            input.relatedComponentId,
            input.componentId,
            input.ruleset,
        );
    }
}
