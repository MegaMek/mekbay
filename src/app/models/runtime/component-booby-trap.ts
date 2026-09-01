// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    BOOBY_TRAP_FLAG,
    isBoobyTrapEquipment,
} from '../aerospace-support-equipment.model';
import type { Equipment } from '../equipment.model';
import { equipmentForComponent } from './mek-runtime-index';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
} from './equipment-interaction';

export const BOOBY_TRAP_ARMED_MODE = 'Armed';
export const BOOBY_TRAP_DETONATED_MODE = 'Detonated';
export const BOOBY_TRAP_MODES = Object.freeze([
    BOOBY_TRAP_ARMED_MODE,
    BOOBY_TRAP_DETONATED_MODE,
] as const);

export function boobyTrapComponentModes(
    equipment: Equipment | null | undefined,
): Readonly<{
    readonly modes: typeof BOOBY_TRAP_MODES;
    readonly defaultMode: typeof BOOBY_TRAP_ARMED_MODE;
}> | null {
    return isBoobyTrapEquipment(equipment)
        ? Object.freeze({ modes: BOOBY_TRAP_MODES, defaultMode: BOOBY_TRAP_ARMED_MODE })
        : null;
}

export function isBoobyTrapDetonated(mode: string | undefined): boolean {
    return mode === BOOBY_TRAP_DETONATED_MODE;
}

/** One-shot confirmation shell over the atomic direct-runtime detonation command. */
export class BoobyTrapHandler extends EquipmentInteractionHandler {
    readonly id = 'booby-trap-handler';
    readonly kind = 'booby-trap';
    readonly scope = 'component' as const;
    override readonly priority = 100;
    override readonly flags = Object.freeze([BOOBY_TRAP_FLAG]);

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!isBoobyTrapEquipment(equipment)) return [];
        const query = input.runtime.query();
        const detonated = isBoobyTrapDetonated(query.componentMode(input.componentId));
        return Object.freeze([Object.freeze({
            label: detonated ? 'Booby Trap Detonated' : 'Detonate Booby Trap',
            value: 'detonate',
            active: detonated,
            disabled: detonated || query.componentStatus(input.componentId) !== 'available',
            displayType: 'toggle' as const,
            action: 'activate' as const,
            tooltipType: detonated ? 'info' as const : 'error' as const,
        })]);
    }

    override async select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): Promise<boolean> {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!isBoobyTrapEquipment(equipment) || choice.value !== 'detonate') return false;
        if (isBoobyTrapDetonated(input.runtime.query().componentMode(input.componentId))) return true;
        if (context.dialogsService.requestConfirmation === undefined) return false;
        const confirmed = await context.dialogsService.requestConfirmation(
            `Detonate ${input.entity.displayName()}'s Booby Trap? `
                + 'The unit will be completely destroyed. Ejection and blast damage must be resolved on the battlefield.',
            'Detonate Booby Trap',
            'danger',
        );
        if (!confirmed) return true;

        const result = input.runtime.dispatch({
            type: 'detonate-booby-trap',
            componentId: input.componentId,
        });
        if (!result.accepted) return false;
        await context.dialogsService.showNoticeHtml(
            '<p>The unit has been destroyed.</p>'
                + '<p>Resolve the Booby Trap blast, any +4 ejection modifier, and resulting fire manually on the battlefield.</p>',
            'Booby Trap Detonated',
        );
        return true;
    }
}
