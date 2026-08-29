// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { DialogsService } from '../services/dialogs.service';
import { createHandlerCommandContext } from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { BOOBY_TRAP_DETONATED_STATE_KEY, BoobyTrapHandler } from './booby-trap.handler';

describe('BoobyTrapHandler', () => {
    const handler = new BoobyTrapHandler();

    function fixture(confirmed: boolean) {
        const { owner } = createTestEquipmentOwner();
        const setDestroyed = jasmine.createSpy('setDestroyed');
        const setModified = jasmine.createSpy('setModified');
        Object.assign(owner, {
            getDisplayName: () => 'Test Mek',
            setDestroyed,
            setModified,
        });
        const equipment = new MiscEquipment({
            id: 'ISBoobyTrap',
            name: 'Booby Trap',
            type: 'misc',
            flags: ['F_BOOBY_TRAP'],
        });
        const mounted = new MountedEquipment({
            owner,
            id: equipment.id,
            name: equipment.name,
            equipment,
        });
        owner.setInventoryEntry(mounted);
        const dialogs = jasmine.createSpyObj<DialogsService>(
            'DialogsService',
            ['createDialog', 'requestConfirmation', 'showNoticeHtml'],
        );
        dialogs.requestConfirmation.and.resolveTo(confirmed);
        dialogs.showNoticeHtml.and.resolveTo();
        const context = createHandlerCommandContext(
            EMPTY_EQUIPMENT_REGISTRY,
            jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
            dialogs,
        );
        return { mounted, dialogs, context, setDestroyed, setModified };
    }

    it('does nothing when detonation is cancelled', async () => {
        const test = fixture(false);

        await handler.handleSelection(test.mounted, { label: 'Detonate', value: 'detonate' }, test.context);

        expect(test.mounted.consumed).toBeUndefined();
        expect(test.mounted.states.has(BOOBY_TRAP_DETONATED_STATE_KEY)).toBeFalse();
        expect(test.setDestroyed).not.toHaveBeenCalled();
        expect(test.dialogs.showNoticeHtml).not.toHaveBeenCalled();
    });

    it('consumes the trap and destroys the carrying unit after confirmation', async () => {
        const test = fixture(true);

        await handler.handleSelection(test.mounted, { label: 'Detonate', value: 'detonate' }, test.context);

        expect(test.mounted.consumed).toBe(1);
        expect(test.mounted.states.get(BOOBY_TRAP_DETONATED_STATE_KEY)).toBe('true');
        expect(test.setDestroyed).toHaveBeenCalledOnceWith(true);
        expect(test.setModified).toHaveBeenCalled();
        expect(test.dialogs.showNoticeHtml).toHaveBeenCalled();
        expect(handler.getChoices(test.mounted, {} as never)[0])
            .toEqual(jasmine.objectContaining({ label: 'Booby Trap Detonated', disabled: true }));
    });
});
