// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import { AmmoEquipment, type Equipment } from '../equipment.model';
import type { ComponentId } from '../entity/entity-identifiers';
import { isRadicalHeatSinkEquipment } from '../escalating-equipment.model';
import { equipmentForComponent } from './mek-runtime-index';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
} from './equipment-interaction';
import { createCommandId } from './runtime-state';

export const COOLANT_POD_READY_MODE = 'Ready';
export const COOLANT_POD_ACTIVE_MODE = 'Active';

export function isCoolantPodEquipment(equipment: Equipment | undefined): equipment is AmmoEquipment {
    return equipment instanceof AmmoEquipment && equipment.ammoType === 'COOLANT_POD';
}

export function coolantPodComponentModes(
    equipment: Equipment | undefined,
): Readonly<{
    readonly modes: readonly [typeof COOLANT_POD_READY_MODE, typeof COOLANT_POD_ACTIVE_MODE];
    readonly defaultMode: typeof COOLANT_POD_READY_MODE;
}> | null {
    return isCoolantPodEquipment(equipment)
        ? Object.freeze({
            modes: Object.freeze([COOLANT_POD_READY_MODE, COOLANT_POD_ACTIVE_MODE] as const),
            defaultMode: COOLANT_POD_READY_MODE,
        })
        : null;
}

export class CoolantPodHandler extends EquipmentInteractionHandler {
    readonly id = 'coolant-pod-handler';
    readonly kind = 'coolant-pod';
    readonly scope = 'component' as const;
    override readonly priority = 50;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!isCoolantPodEquipment(equipment)) return [];
        const query = input.runtime.query();
        const expended = query.remainingAmmo(input.componentId) === 0;
        const alreadyUsed = activeCoolantPodId(input) !== undefined;
        return [Object.freeze({
            label: expended ? 'Coolant Pod Expended' : 'Use Coolant Pod',
            value: 'use',
            active: query.componentMode(input.componentId) === COOLANT_POD_ACTIVE_MODE,
            disabled: expended || alreadyUsed
                || query.componentStatus(input.componentId) !== 'available',
            displayType: 'toggle' as const,
            action: 'activate' as const,
        })];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!isCoolantPodEquipment(equipment) || choice.value !== 'use') return false;
        if (activeCoolantPodId(input) !== undefined) {
            context.toastService.showToast('Only one Coolant Pod may be used per turn', 'error');
            return true;
        }
        const result = input.runtime.dispatch({
            type: 'activate-coolant-pod',
            commandId: createCommandId(),
            expectedRevision: input.runtime.revision(),
            componentId: input.componentId,
        });
        if (!result.accepted) return false;
        const blocked = activeRadicalHeatSink(input);
        context.toastService.showToast(
            blocked
                ? 'Coolant Pod triggered, but the active Radical Heat Sink prevents its effect'
                : 'Coolant Pod triggered',
            blocked ? 'error' : 'info',
        );
        return true;
    }
}

function activeCoolantPodId(input: EquipmentInteractionInput): ComponentId | undefined {
    return [...input.index.components].find(([componentId, component]) =>
        component.kind === 'equipment'
        && isCoolantPodEquipment(component.mount.equipment)
        && input.runtime.query().componentMode(componentId) === COOLANT_POD_ACTIVE_MODE)?.[0];
}

function activeRadicalHeatSink(input: EquipmentInteractionInput): boolean {
    return [...input.index.components].some(([componentId, component]) =>
        component.kind === 'equipment'
        && isRadicalHeatSinkEquipment(component.mount.equipment)
        && input.runtime.query().componentStatus(componentId) === 'available'
        && input.runtime.query().componentEscalatingFailure(componentId)?.active === true);
}
