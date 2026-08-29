// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';

export const BOOBY_TRAP_DETONATED_STATE_KEY = 'boobyTrapDetonated';

/** One-shot self-destruction control. Blast damage still needs a battlefield map to resolve. */
export class BoobyTrapHandler extends EquipmentInteractionHandler {
    readonly id = 'booby-trap-handler';
    override readonly flags: EquipmentFlag[] = ['F_BOOBY_TRAP'];

    override getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        const detonated = this.isDetonated(equipment);
        return [{
            label: detonated ? 'Booby Trap Detonated' : 'Detonate Booby Trap',
            value: 'detonate',
            active: detonated,
            disabled: detonated,
            displayType: 'toggle',
        }];
    }

    override async handleSelection(
        equipment: MountedEquipment,
        choice: PickerChoice,
        context: HandlerCommandContext,
    ): Promise<boolean> {
        if (choice.value !== 'detonate' || this.isDetonated(equipment)) return true;

        const confirmed = await context.dialogsService.requestConfirmation(
            `Detonate ${equipment.owner.getDisplayName()}'s Booby Trap? `
                + 'The unit will be completely destroyed. Ejection and blast damage must be resolved on the battlefield.',
            'Detonate Booby Trap',
            'danger',
        );
        if (!confirmed) return true;

        equipment.setAmmoState({ consumed: 1 });
        equipment.setState(BOOBY_TRAP_DETONATED_STATE_KEY, 'true');
        equipment.owner.setInventoryEntry(equipment);
        equipment.owner.setDestroyed(true);
        equipment.owner.setModified();

        await context.dialogsService.showNoticeHtml(
            '<p>The unit has been destroyed.</p>'
                + '<p>Resolve the Booby Trap blast, any +4 ejection modifier, and resulting fire manually on the battlefield.</p>',
            'Booby Trap Detonated',
        );
        return true;
    }

    private isDetonated(equipment: MountedEquipment): boolean {
        return equipment.states.get(BOOBY_TRAP_DETONATED_STATE_KEY) === 'true'
            || (equipment.consumed ?? 0) > 0;
    }
}
