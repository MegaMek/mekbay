// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { WeaponEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import {
    GAUSS_POWER_STATE_KEY,
    GAUSS_POWERED_DOWN_STATE,
    GAUSS_POWERED_UP_STATE,
    GAUSS_POWERING_DOWN_STATE,
    GAUSS_POWERING_UP_STATE,
    gaussPowerState,
    isGaussPoweredDown,
} from '../utils/gauss-power-state.util';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { WeaponType } from '../models/weapon-types.model';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
} from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { selectInventoryControlEntry } from '../utils/inventory-control.util';
import { GaussPowerHandler } from './gauss-power.handler';

function entry(
    flags: EquipmentFlag[] = ['F_GAUSS'],
    states = new Map<string, string>(),
): MountedEquipment {
    const { owner } = createTestEquipmentOwner();
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    spyOn(owner, 'setInventoryEntry').and.callThrough();
    Object.assign(owner, {
        turnState: () => ({ markEquipmentStateChanged }),
    });
    const equipment = new WeaponEquipment({
        id: 'TestGauss',
        name: 'Gauss Rifle',
        type: 'weapon',
        flags,
    });
    return new MountedEquipment({
        owner,
        id: equipment.id,
        name: equipment.name,
        equipment,
        states,
    });
}

function equipmentStateChangeMarker(equipment: MountedEquipment): jasmine.Spy {
    return equipment.owner.turnState().markEquipmentStateChanged as jasmine.Spy;
}

describe('GaussPowerHandler', () => {
    const handler = new GaussPowerHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        toastService,
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    beforeEach(() => toastService.showToast.calls.reset());

    it('applies only to equipment carrying the Gauss flag', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);

        expect(registry.getHandlers(entry()).map(candidate => candidate.id)).toEqual([handler.id]);
        expect(registry.getHandlers(entry([]))).toEqual([]);
    });

    it('starts powered up and selectable when no state was stored', () => {
        const mounted = entry();

        expect(isGaussPoweredDown(mounted)).toBeFalse();
        expect(handler.isInventoryControlSelectable(mounted)).toBeNull();
        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Powered Up',
            value: GAUSS_POWERING_DOWN_STATE,
            active: true,
            displayType: 'toggle',
        }));
    });

    it('removes X only while the Gauss weapon is effectively powered down', () => {
        const baseTypes = new Set<WeaponType>(['DE', 'X']);
        for (const state of [GAUSS_POWERED_DOWN_STATE, GAUSS_POWERING_UP_STATE]) {
            const mounted = entry(['F_GAUSS'], new Map([[GAUSS_POWER_STATE_KEY, state]]));
            expect(handler.applyInventoryControlWeaponTypes(mounted, baseTypes)).toEqual(new Set<WeaponType>(['DE']));
        }
        for (const state of [GAUSS_POWERED_UP_STATE, GAUSS_POWERING_DOWN_STATE]) {
            const mounted = entry(['F_GAUSS'], new Map([[GAUSS_POWER_STATE_KEY, state]]));
            expect(handler.applyInventoryControlWeaponTypes(mounted, baseTypes)).toBe(baseTypes);
        }
        expect(baseTypes).toEqual(new Set<WeaponType>(['DE', 'X']));
    });

    it('remains powered up while powering down, then completes at end turn', () => {
        const mounted = entry();
        const stateChangeMarker = equipmentStateChangeMarker(mounted);

        handler.handleSelection(
            mounted,
            handler.getChoices(mounted, queryContext)[0] as PickerChoice,
            commandContext,
        );

        expect(mounted.states.get(GAUSS_POWER_STATE_KEY)).toBe(GAUSS_POWERING_DOWN_STATE);
        expect(gaussPowerState(mounted)).toBe(GAUSS_POWERING_DOWN_STATE);
        expect(isGaussPoweredDown(mounted)).toBeFalse();
        expect(handler.isInventoryControlSelectable(mounted)).toBeNull();
        expect(mounted.owner.setInventoryEntry).toHaveBeenCalledWith(mounted);
        expect(stateChangeMarker).toHaveBeenCalledTimes(1);
        expect(toastService.showToast).toHaveBeenCalledWith('Gauss Rifle is powering down', 'info');
        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Powering Down…',
            value: GAUSS_POWERED_UP_STATE,
            active: true,
        }));

        handler.onEndTurn(mounted);

        expect(gaussPowerState(mounted)).toBe(GAUSS_POWERED_DOWN_STATE);
        expect(isGaussPoweredDown(mounted)).toBeTrue();
        expect(handler.isInventoryControlSelectable(mounted)).toBeFalse();
    });

    it('remains powered down while powering up, then completes at end turn', () => {
        const mounted = entry(['F_GAUSS'], new Map([
            [GAUSS_POWER_STATE_KEY, GAUSS_POWERED_DOWN_STATE],
        ]));
        const stateChangeMarker = equipmentStateChangeMarker(mounted);

        handler.handleSelection(
            mounted,
            handler.getChoices(mounted, queryContext)[0] as PickerChoice,
            commandContext,
        );

        expect(gaussPowerState(mounted)).toBe(GAUSS_POWERING_UP_STATE);
        expect(isGaussPoweredDown(mounted)).toBeTrue();
        expect(handler.isInventoryControlSelectable(mounted)).toBeFalse();
        expect(stateChangeMarker).toHaveBeenCalledTimes(1);
        expect(toastService.showToast).toHaveBeenCalledWith('Gauss Rifle is powering up', 'info');
        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Powering Up…',
            value: GAUSS_POWERED_DOWN_STATE,
            active: false,
        }));

        handler.onEndTurn(mounted);

        expect(gaussPowerState(mounted)).toBe(GAUSS_POWERED_UP_STATE);
        expect(isGaussPoweredDown(mounted)).toBeFalse();
        expect(handler.isInventoryControlSelectable(mounted)).toBeNull();
    });

    it('allows either pending transition to be cancelled before end turn', () => {
        const poweringDown = entry();
        handler.handleSelection(poweringDown, handler.getChoices(poweringDown, queryContext)[0], commandContext);
        handler.handleSelection(poweringDown, handler.getChoices(poweringDown, queryContext)[0], commandContext);
        handler.onEndTurn(poweringDown);

        expect(gaussPowerState(poweringDown)).toBe(GAUSS_POWERED_UP_STATE);
        expect(equipmentStateChangeMarker(poweringDown)).toHaveBeenCalledTimes(1);

        const poweringUp = entry(['F_GAUSS'], new Map([
            [GAUSS_POWER_STATE_KEY, GAUSS_POWERED_DOWN_STATE],
        ]));
        handler.handleSelection(poweringUp, handler.getChoices(poweringUp, queryContext)[0], commandContext);
        handler.handleSelection(poweringUp, handler.getChoices(poweringUp, queryContext)[0], commandContext);
        handler.onEndTurn(poweringUp);

        expect(gaussPowerState(poweringUp)).toBe(GAUSS_POWERED_DOWN_STATE);
        expect(equipmentStateChangeMarker(poweringUp)).toHaveBeenCalledTimes(1);
    });

    it('prevents powered-down Gauss weapons from being selected to fire', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);
        for (const state of [GAUSS_POWERED_DOWN_STATE, GAUSS_POWERING_UP_STATE]) {
            const mounted = entry(['F_GAUSS'], new Map([[GAUSS_POWER_STATE_KEY, state]]));
            Object.assign(mounted.owner, {
                getInventoryControlRules: () => registry.inventoryControlRules(queryContext),
            });

            expect(selectInventoryControlEntry(mounted.owner, mounted)).toBeFalse();
        }
    });
});
