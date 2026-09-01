// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { MiscEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { DialogsService } from '../services/dialogs.service';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
} from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import {
    EQUIPMENT_POWER_OFF_STATE,
    EQUIPMENT_POWER_ON_STATE,
    EQUIPMENT_POWER_STATE_KEY,
    EQUIPMENT_POWER_TURNING_OFF_STATE,
} from '../utils/equipment-power-state.util';
import { SearchlightHandler } from './searchlight.handler';

function entry(flags: EquipmentFlag[]): MountedEquipment {
    const { owner } = createTestEquipmentOwner();
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    Object.assign(owner, { turnState: () => ({ markEquipmentStateChanged }) });
    const equipment = new MiscEquipment({
        id: flags.join('-'),
        name: 'Searchlight',
        type: 'misc',
        flags,
    });
    const mounted = new MountedEquipment({
        owner,
        id: equipment.id,
        name: equipment.name,
        equipment,
    });
    owner.setInventoryEntry(mounted);
    return mounted;
}

describe('SearchlightHandler', () => {
    const handler = new SearchlightHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        jasmine.createSpyObj<ToastService>('ToastService', ['showToast', 'toasts']),
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    it('handles vehicle and battle-armor searchlights only', () => {
        expect(handler.applicableTo(entry(['F_SEARCHLIGHT']))).toBeTrue();
        expect(handler.applicableTo(entry(['F_BA_SEARCHLIGHT']))).toBeTrue();
        expect(handler.applicableTo(entry(['F_TAG']))).toBeFalse();
    });

    it('keeps the searchlight on until its End-Phase shutdown commits', () => {
        const mounted = entry(['F_SEARCHLIGHT']);
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);

        const choice = registry.getChoices(mounted, queryContext)[0] as PickerChoice;
        expect(choice).toEqual(jasmine.objectContaining({
            label: 'Searchlight is ON',
            value: EQUIPMENT_POWER_TURNING_OFF_STATE,
            active: true,
        }));

        handler.handleSelection(mounted, choice, commandContext);
        expect(mounted.states.get(EQUIPMENT_POWER_STATE_KEY)).toBe(EQUIPMENT_POWER_TURNING_OFF_STATE);
        expect(registry.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Turning searchlight off…',
            value: EQUIPMENT_POWER_ON_STATE,
            active: true,
        }));

        handler.onEndTurn(mounted);
        expect(mounted.states.get(EQUIPMENT_POWER_STATE_KEY)).toBe(EQUIPMENT_POWER_OFF_STATE);
    });
});
