// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../models/equipment-flags.type';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { Equipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { ENTRY_DISABLED_STATE_KEY } from '../models/rules/unit-type-rules';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
} from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { DisabledStateToggleHandler, isEquipmentDisabledByFailure } from './disabled-equipment.handler';

class TestDisabledHandler extends DisabledStateToggleHandler {
    readonly id = 'test-disabled-handler';
    override readonly flags: EquipmentFlag[] = ['F_TEST_ONLY'];
}

function owner() {
    const { owner } = createTestEquipmentOwner();
    spyOn(owner, 'setInventoryEntry').and.callThrough();
    return owner;
}

function entry(flags: EquipmentFlag[], states = new Map<string, string>(), destroyed = false): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: flags.join('-') || 'entry',
        name: 'Entry',
        equipment: { name: 'Entry', flags: new Set(flags) } as Equipment,
        states,
        destroyed
    });
}

describe('DisabledStateToggleHandler', () => {
    const handler = new TestDisabledHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    it('is selected by the registry through its concrete handler flags', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);

        expect(registry.getHandlers(entry(['F_TEST_ONLY']))).toEqual([handler]);
        expect(registry.getHandlers(entry(['F_RADICAL_HEATSINK']))).toEqual([]);
    });

    it('is transparent unless disabled is true', () => {
        expect(isEquipmentDisabledByFailure(entry(['F_RADICAL_HEATSINK']))).toBeFalse();
        expect(isEquipmentDisabledByFailure(entry(['F_RADICAL_HEATSINK'], new Map([[ENTRY_DISABLED_STATE_KEY, 'false']])))).toBeFalse();
        expect(isEquipmentDisabledByFailure(entry(['F_RADICAL_HEATSINK'], new Map([[ENTRY_DISABLED_STATE_KEY, 'true']])))).toBeTrue();
    });

    it('toggles disabled state and persists the inventory entry', () => {
        const mounted = entry(['F_TEST_ONLY']);

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);

        expect(mounted.states.get(ENTRY_DISABLED_STATE_KEY)).toBe('true');
        expect(mounted.owner.setInventoryEntry).toHaveBeenCalledWith(mounted);
        expect(mounted.owner.getEquipmentStatus(mounted)).toBe('disabled');

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);

        expect(mounted.states.has(ENTRY_DISABLED_STATE_KEY)).toBeFalse();
        expect(mounted.owner.getEquipmentStatus(mounted)).toBe('available');
    });

    it('keeps the toggle available while the entry is disabled by this handler', () => {
        const mounted = entry(['F_TEST_ONLY'], new Map([[ENTRY_DISABLED_STATE_KEY, 'true']]));
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);

        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            active: true,
            stateEdit: 'enable',
        }));
        expect(registry.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            active: true,
            stateEdit: 'enable',
            disabled: false,
        }));
    });
});
