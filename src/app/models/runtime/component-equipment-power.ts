// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import { equipmentForComponent } from './mek-runtime-index';
import {
    isNovaCewsEquipment,
    isPowerControlledEquipment,
    isSearchlightEquipment,
    isStandaloneBapEquipment,
    nextPowerToggleMode,
    powerEffectivelyEnabled,
    presentedElectronicPowerMode,
    POWER_DISABLING_MODE,
    POWER_DISABLED_MODE,
    POWER_ENABLING_MODE,
    POWER_ENABLED_MODE,
    type ElectronicComponentFact,
} from './component-electronic-suite';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
} from './equipment-interaction';
import { createCommandId } from './runtime-state';
import { isBapEquipment } from '../bap-equipment.model';
import { isEcmEquipment } from '../ecm-mode.model';

/** One delayed-power owner for probes, Nova CEWS, searchlights, and simple electronics. */
export class EquipmentPowerHandler extends EquipmentInteractionHandler {
    readonly id = 'equipment-power-handler';
    readonly kind = 'equipment-power';
    readonly scope = 'component' as const;
    override readonly priority = 15;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!isPowerControlledEquipment(equipment)) return [];
        const facts = electronicFacts(input);
        const state = presentedElectronicPowerMode(facts, input.componentId);
        const labels = powerLabels(equipment!, state);
        return [Object.freeze({
            label: labels.label,
            value: nextPowerToggleMode(state),
            active: powerEffectivelyEnabled(state),
            displayType: 'toggle' as const,
        })];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!equipment || !isPowerControlledEquipment(equipment)) return false;
        const offered = this.choices(input)[0];
        if (!offered || choice.value !== offered.value) return false;
        const result = input.runtime.dispatch({
            type: 'set-component-mode',
            commandId: createCommandId(),
            expectedRevision: input.runtime.revision(),
            componentId: input.componentId,
            mode: String(choice.value),
        });
        if (!result.accepted) return false;
        if (!result.idempotent) {
            context.toastService.showToast(`${equipment.shortName || equipment.name}: ${offered.label}`, 'info');
        }
        return true;
    }
}

export function electronicFacts(input: EquipmentInteractionInput): readonly ElectronicComponentFact[] {
    const state = input.runtime.snapshot();
    const unavailable = state.destroyed || state.conditions.has('shutdown');
    return Object.freeze([...input.index.components].flatMap(([componentId, component]) => {
        if (component.kind !== 'equipment' || !component.mount.equipment) return [];
        const equipment = component.mount.equipment;
        const claimsElectronicFunction = isEcmEquipment(equipment)
            || isBapEquipment(equipment)
            || isNovaCewsEquipment(equipment)
            || isPowerControlledEquipment(equipment);
        if (!claimsElectronicFunction) return [];
        return [Object.freeze({
            componentId,
            equipment,
            mode: state.components.get(componentId)?.mode,
            operational: !unavailable
                && input.runtime.query().componentStatus(componentId) === 'available',
        })];
    }));
}

function powerLabels(
    equipment: NonNullable<ReturnType<typeof equipmentForComponent>>,
    state: import('./component-electronic-suite').EquipmentPowerMode,
): Readonly<{ readonly label: string }> {
    const subject = isStandaloneBapEquipment(equipment)
        ? 'Active Probe'
        : isNovaCewsEquipment(equipment)
            ? 'Nova CEWS'
            : isSearchlightEquipment(equipment)
                ? 'Searchlight'
                : 'System';
    switch (state) {
        case POWER_ENABLED_MODE: return Object.freeze({ label: `${subject} is ON` });
        case POWER_ENABLING_MODE: return Object.freeze({ label: `Turning ${subject.toLowerCase()} on…` });
        case POWER_DISABLED_MODE: return Object.freeze({ label: `${subject} is OFF` });
        case POWER_DISABLING_MODE: return Object.freeze({ label: `Turning ${subject.toLowerCase()} off…` });
    }
}
