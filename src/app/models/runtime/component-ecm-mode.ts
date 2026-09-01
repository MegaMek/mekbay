// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ECMMode } from '../common.model';
import {
    ANGEL_ECM_FLAG,
    ECM_FLAG,
    ecmEquipmentModes,
    ecmModeLabel,
    ecmModes,
    isECMMode,
    isEcmEquipment,
} from '../ecm-mode.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';
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
import { effectiveEcmMode, isNovaCewsFlags } from './component-electronic-suite';
import { electronicFacts } from './component-equipment-power';

export interface ComponentEcmModeDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags: ReadonlySet<EquipmentFlag>;
    readonly modes: readonly ECMMode[];
    readonly defaultMode: ECMMode.ECM;
}

export function createComponentEcmModeDefinition(input: {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags: Iterable<EquipmentFlag>;
    readonly modes?: readonly string[];
    readonly defaultMode?: string;
}): ComponentEcmModeDefinition {
    const displayName = input.displayName.trim();
    const flags = new ImmutableSet(input.flags);
    const expectedModes = ecmModes(flags.has(ANGEL_ECM_FLAG));
    if (!displayName || displayName.includes('\0')) {
        throw new Error(`Invalid ECM display name for ${input.componentId}`);
    }
    if (!flags.has(ECM_FLAG)) {
        throw new Error(`Component ${input.componentId} is not ECM equipment`);
    }
    if (input.modes !== undefined && !sameModes(input.modes, expectedModes)) {
        throw new Error(`Invalid ECM modes for ${input.componentId}`);
    }
    if (input.defaultMode !== undefined && input.defaultMode !== ECMMode.ECM) {
        throw new Error(`Invalid default ECM mode for ${input.componentId}`);
    }
    return Object.freeze({
        componentId: input.componentId,
        displayName,
        flags,
        modes: expectedModes,
        defaultMode: ECMMode.ECM,
    });
}

export function componentEcmModeDefinition(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): ComponentEcmModeDefinition {
    const equipment = equipmentForComponent(index, componentId);
    if (!equipment) throw new Error(`Component ${componentId} has no ECM equipment definition`);
    return createComponentEcmModeDefinition({
        componentId,
        displayName: equipment.shortName || equipment.name,
        flags: equipment.flags,
    });
}

export function componentEcmActive(mode: ECMMode): boolean {
    return mode !== ECMMode.OFF;
}

export { ecmEquipmentModes, isEcmEquipment } from '../ecm-mode.model';

function sameModes(actual: readonly string[], expected: readonly ECMMode[]): boolean {
    return actual.length === expected.length
        && actual.every((mode, index) => mode === expected[index]);
}

/** ECM definitions, canonical modes, activation, and interaction owner. */
export class ECMHandler extends EquipmentInteractionHandler {
    readonly id = 'ecm-handler';
    readonly kind = 'ecm-mode';
    readonly scope = 'component' as const;
    override readonly flags = [ECM_FLAG] as const;
    override readonly priority = 10;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = componentEcmModeDefinition(input.index, input.componentId);
        if (!this.applicableToComponentEcmMode(definition)) return [];
        const mode = effectiveEcmMode(electronicFacts(input), input.componentId, true);
        return this.choicesForMode(definition, mode);
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = componentEcmModeDefinition(input.index, input.componentId);
        return this.applicableToComponentEcmMode(definition)
            && this.handleComponentEcmModeSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentEcmMode(definition: ComponentEcmModeDefinition): boolean {
        return definition.flags.has(ECM_FLAG)
            && !isNovaCewsFlags(definition.flags);
    }

    getComponentEcmModeChoices(
        runtime: CBTUnitInstance,
        definition: ComponentEcmModeDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        const mode = runtime.query().componentMode(definition.componentId);
        if (!isECMMode(mode) || !definition.modes.includes(mode)) return [];
        return this.choicesForMode(definition, mode);
    }

    private choicesForMode(
        definition: ComponentEcmModeDefinition,
        mode: ECMMode,
    ): EquipmentInteractionChoice[] {
        return [{
            label: 'ECM Mode',
            value: mode,
            displayType: 'dropdown',
            choices: definition.modes.map(value => ({ label: ecmModeLabel(value), value })),
            keepOpen: true,
        }];
    }

    handleComponentEcmModeSelection(
        runtime: CBTUnitInstance,
        definition: ComponentEcmModeDefinition,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        if (!isECMMode(choice.value) || !definition.modes.includes(choice.value)) return false;
        const current = runtime.query().componentMode(definition.componentId);
        const result = current === choice.value ? null : runtime.dispatch({
            type: 'set-component-mode',
            componentId: definition.componentId,
            mode: choice.value,
        });
        if (result !== null && !result.accepted) return false;
        context.toastService.showToast(
            `${definition.displayName} mode: ${ecmModeLabel(choice.value)}`,
            'info',
        );
        return true;
    }
}

export { ECMMode };
