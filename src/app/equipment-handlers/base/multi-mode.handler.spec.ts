// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment } from '../../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../../models/equipment-lookup';
import { MountedEquipment } from '../../models/mounted-equipment.model';
import type { DialogsService } from '../../services/dialogs.service';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
} from '../../services/equipment-interaction-registry.service';
import type { ToastService } from '../../services/toast.service';
import { createTestEquipmentOwner } from '../../testing/unit-test-helpers';
import { MultiModeHandler } from './multi-mode.handler';

class TestMultiModeHandler extends MultiModeHandler {
    readonly id = 'test-multi-mode';

    protected getModes(_equipment: MountedEquipment): Array<{ value: string; label: string }> {
        return [
            { label: 'Standard', value: 'standard' },
            { label: 'Alternate', value: 'alternate' },
        ];
    }

    protected getDefaultMode(): string {
        return 'standard';
    }
}

describe('MultiModeHandler', () => {
    it('persists the selected mode value and round-trips it through the choices', () => {
        const { owner } = createTestEquipmentOwner();
        spyOn(owner, 'setInventoryEntry').and.callThrough();
        const equipment = new MountedEquipment({
            owner,
            id: 'test-equipment',
            name: 'Test Equipment',
            equipment: new MiscEquipment({
                id: 'test-equipment',
                name: 'Test Equipment',
                type: 'misc',
            }),
        });
        const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
        const dialogsService = jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']);
        const commandContext = createHandlerCommandContext(
            EMPTY_EQUIPMENT_REGISTRY,
            toastService,
            dialogsService,
        );
        const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
        const handler = new TestMultiModeHandler();

        expect(handler.handleSelection(
            equipment,
            { label: 'Alternate', value: 'alternate' },
            commandContext,
        )).toBeTrue();

        expect(equipment.states.get('state')).toBe('alternate');
        expect(equipment.states.get('state')).not.toBe('[object Object]');
        expect(equipment.owner.setInventoryEntry).toHaveBeenCalledWith(equipment);
        expect(handler.getChoices(equipment, queryContext)).toEqual([
            jasmine.objectContaining({ value: 'standard', active: false }),
            jasmine.objectContaining({ value: 'alternate', active: true }),
        ]);
    });
});
