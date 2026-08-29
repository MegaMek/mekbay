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
    EQUIPMENT_POWER_STATE_KEY,
    EQUIPMENT_POWER_TURNING_OFF_STATE,
} from '../utils/equipment-power-state.util';
import { EquipmentPowerHandler } from './equipment-power.handler';

function entry(flags: EquipmentFlag[], type: 'Mek' | 'ProtoMek' = 'Mek'): MountedEquipment {
    const { owner } = createTestEquipmentOwner({ unit: { type } });
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    Object.assign(owner, { turnState: () => ({ markEquipmentStateChanged }) });
    const equipment = new MiscEquipment({
        id: flags.join('-'),
        name: 'Test Equipment',
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

describe('EquipmentPowerHandler', () => {
    const handler = new EquipmentPowerHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        jasmine.createSpyObj<ToastService>('ToastService', ['showToast', 'toasts']),
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    it('only exposes switches with an explicit rules benefit', () => {
        expect(handler.applicableTo(entry(['F_MINESWEEPER']))).toBeTrue();
        expect(handler.applicableTo(entry(['F_EI_INTERFACE']))).toBeTrue();

        for (const flag of [
            'F_APOLLO',
            'F_ARTEMIS',
            'F_ARTEMIS_PROTO',
            'F_ARTEMIS_V',
            'F_TAG',
            'F_TARGETING_COMPUTER',
            'F_C3S',
        ] satisfies EquipmentFlag[]) {
            expect(handler.applicableTo(entry([flag])))
                .withContext(flag)
                .toBeFalse();
        }
    });

    it('does not offer the non-switchable ProtoMek EI interface', () => {
        expect(handler.applicableTo(entry(['F_EI_INTERFACE'], 'ProtoMek'))).toBeFalse();
    });

    it('keeps the system effective until its End-Phase shutdown commits', () => {
        const mounted = entry(['F_MINESWEEPER']);
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);

        const choice = registry.getChoices(mounted, queryContext)[0] as PickerChoice;
        expect(choice).toEqual(jasmine.objectContaining({
            label: 'System is ON',
            value: EQUIPMENT_POWER_TURNING_OFF_STATE,
            active: true,
        }));

        handler.handleSelection(mounted, choice, commandContext);
        expect(mounted.states.get(EQUIPMENT_POWER_STATE_KEY)).toBe(EQUIPMENT_POWER_TURNING_OFF_STATE);

        handler.onEndTurn(mounted);
        expect(mounted.states.get(EQUIPMENT_POWER_STATE_KEY)).toBe(EQUIPMENT_POWER_OFF_STATE);
    });
});
