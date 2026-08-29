// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment, type WeaponDamage } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { DialogsService } from '../services/dialogs.service';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
} from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import {
    MGA_ACTIVATION_STATE_KEY,
    MGA_ACTIVE_STATE,
    MGA_OFF_STATE,
    MGA_TURNING_OFF_STATE,
    MGA_TURNING_ON_STATE,
} from '../utils/mga-state.util';
import { MgaActivationHandler } from './mga-activation.handler';

function fixture(memberCount = 3) {
    const { owner } = createTestEquipmentOwner();
    Object.assign(owner, {
        turnState: () => ({ markEquipmentStateChanged: jasmine.createSpy('markEquipmentStateChanged') }),
    });
    const arrayType = new WeaponEquipment({
        id: 'ISMGA',
        name: 'Machine Gun Array',
        type: 'weapon',
        flags: ['F_MGA'],
        weapon: { ammoType: 'MG', rackSize: 2, damage: 2 },
    });
    const memberType = new WeaponEquipment({
        id: 'ISMachineGun',
        name: 'Machine Gun',
        type: 'weapon',
        flags: ['F_MG'],
        weapon: { ammoType: 'MG', rackSize: 2, damage: 2 },
    });
    const array = new MountedEquipment({
        owner,
        id: 'array',
        name: arrayType.name,
        equipment: arrayType,
        locations: new Set(['LT']),
    });
    const members = Array.from({ length: memberCount }, (_, index) => new MountedEquipment({
        owner,
        id: `member-${index + 1}`,
        name: memberType.name,
        equipment: memberType,
        locations: new Set(['LT']),
    }));
    array.setLinkedEquipment(members);
    [array, ...members].forEach(entry => owner.setInventoryEntry(entry));
    return { owner, array, members };
}

describe('MgaActivationHandler', () => {
    const handler = new MgaActivationHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        jasmine.createSpyObj<ToastService>('ToastService', ['showToast', 'toasts']),
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );
    const damageContext = {
        selectedRange: null,
        selectedAmmo: null,
        equipmentCatalog: EMPTY_EQUIPMENT_REGISTRY,
    } as const;

    it('models the rulebook Activated/Off state instead of generic equipment power', () => {
        const { array, members } = fixture();

        expect(handler.getChoices(array, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Array linked',
            active: true,
            value: MGA_TURNING_OFF_STATE,
        }));
        expect(handler.getChoices(members[0], queryContext)).toEqual([]);

        handler.handleSelection(array, handler.getChoices(array, queryContext)[0], commandContext);
        expect(array.states.get(MGA_ACTIVATION_STATE_KEY)).toBe(MGA_TURNING_OFF_STATE);
        expect(handler.isInventoryControlSelectable(array, queryContext)).toBeNull();
        expect(handler.isInventoryControlSelectable(members[0], queryContext)).toBeFalse();

        handler.onEndTurn(array);
        expect(array.states.get(MGA_ACTIVATION_STATE_KEY)).toBe(MGA_OFF_STATE);
        expect(handler.isInventoryControlSelectable(array, queryContext)).toBeFalse();
        expect(handler.isInventoryControlSelectable(members[0], queryContext)).toBeNull();

        handler.handleSelection(array, handler.getChoices(array, queryContext)[0], commandContext);
        expect(array.states.get(MGA_ACTIVATION_STATE_KEY)).toBe(MGA_TURNING_ON_STATE);
        expect(handler.isInventoryControlSelectable(array, queryContext)).toBeFalse();
        expect(handler.isInventoryControlSelectable(members[0], queryContext)).toBeNull();
    });

    it('uses each working member for cluster size, maximum damage, and ammo consumption', () => {
        const { array, members } = fixture();
        const damage: WeaponDamage = { values: [2], maximum: 2 };

        expect(handler.applyInventoryControlAmmoConsumption(array, 1, queryContext)).toBe(3);
        expect(handler.applyInventoryControlDamageEffects(array, damage, damageContext, queryContext))
            .toEqual({ values: [2], maximum: 6, unit: 'shot' });
        expect(handler.applyInventoryControlHeatEffects(array, { value: 1, weakened: false }, queryContext))
            .toEqual({ value: 3, displayValue: 1, weakened: false });

        members[1].setCommittedDestroyed(true);

        expect(handler.applyInventoryControlAmmoConsumption(array, 1, queryContext)).toBe(2);
        expect(handler.applyInventoryControlDamageEffects(array, damage, damageContext, queryContext))
            .toEqual({ values: [2], maximum: 4, unit: 'shot' });
        expect(handler.applyInventoryControlHeatEffects(array, { value: 1, weakened: false }, queryContext))
            .toEqual({ value: 2, displayValue: 1, weakened: false });
    });

    it('cannot fire an active array with no working guns', () => {
        const { array, members } = fixture(2);
        members.forEach(member => member.setCommittedDestroyed(true));

        expect(handler.isInventoryControlSelectable(array, queryContext)).toBeFalse();
        expect(handler.applyInventoryControlAmmoConsumption(array, 1, queryContext)).toBe(0);
    });

    it('releases member guns when the controller is destroyed', () => {
        const { array, members } = fixture();
        array.setCommittedDestroyed(true);

        expect(handler.isInventoryControlSelectable(array, queryContext)).toBeFalse();
        expect(handler.isInventoryControlSelectable(members[0], queryContext)).toBeNull();
    });
});
