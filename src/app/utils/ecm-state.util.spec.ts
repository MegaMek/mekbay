// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { BAPHandler } from '../equipment-handlers/bap.handler';
import { ECMHandler } from '../equipment-handlers/ecm.handler';
import { NovaCewsHandler } from '../equipment-handlers/nova-cews.handler';
import { ECMMode } from '../models/common.model';
import { MiscEquipment } from '../models/equipment.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
} from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import {
    EQUIPMENT_POWER_OFF_STATE,
    EQUIPMENT_POWER_ON_STATE,
    EQUIPMENT_POWER_STATE_KEY,
} from './equipment-power-state.util';
import {
    ECM_MODE_STATE_KEY,
    ECM_PENDING_MODE_STATE_KEY,
    getEffectiveEcmMode,
    isActiveProbeEffectivelyActive,
    normalizeElectronicSuiteDefaults,
    NOVA_CEWS_OFF_STATE,
    NOVA_CEWS_ON_STATE,
    NOVA_CEWS_STATE_KEY,
} from './ecm-state.util';

function fixture() {
    const test = createTestEquipmentOwner({ resolveEquipmentActionPermission: () => true });
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    Object.assign(test.owner, { turnState: () => ({ markEquipmentStateChanged }) });
    spyOn(test.owner, 'setInventoryEntry').and.callThrough();

    const add = (
        id: string,
        flags: EquipmentFlag[],
        states = new Map<string, string>(),
    ): MountedEquipment => {
        const equipment = new MiscEquipment({ id, name: id, type: 'misc', flags });
        const mounted = new MountedEquipment({
            owner: test.owner,
            id,
            name: id,
            equipment,
            states,
        });
        test.owner.setInventoryEntry(mounted);
        return mounted;
    };

    return { ...test, add, markEquipmentStateChanged };
}

describe('electronic suite state', () => {
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast', 'toasts']);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        toastService,
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    beforeEach(() => toastService.showToast.calls.reset());

    it('uses one shared ECM control for every combined ECM/probe suite', () => {
        const test = fixture();
        const ewEquipment = test.add('EW Equipment', ['F_EW_EQUIPMENT', 'F_ECM', 'F_BAP']);
        const registry = new EquipmentInteractionRegistry();
        registry.register(new ECMHandler());
        registry.register(new BAPHandler());

        expect(registry.getHandlers(ewEquipment).map(handler => handler.id)).toEqual(['ecm-handler']);
        expect(registry.getChoices(ewEquipment, queryContext).map(choice => choice.label)).toEqual(['ECM Mode']);
    });

    it('normalizes implicit multiple-ECM defaults with Angel precedence', () => {
        const test = fixture();
        const guardian = test.add('Guardian', ['F_ECM']);
        const angel = test.add('Angel', ['F_ECM', 'F_ANGEL_ECM']);

        normalizeElectronicSuiteDefaults(test.inventory);

        expect(guardian.states.get(ECM_MODE_STATE_KEY)).toBe(ECMMode.OFF);
        expect(angel.states.has(ECM_MODE_STATE_KEY)).toBeFalse();
        expect(getEffectiveEcmMode(guardian)).toBe(ECMMode.OFF);
        expect(getEffectiveEcmMode(angel)).toBe(ECMMode.ECM);
    });

    it('hands ECM operation to the newly selected suite in the End Phase', () => {
        const test = fixture();
        const first = test.add('Guardian 1', ['F_ECM'], new Map([[ECM_MODE_STATE_KEY, ECMMode.ECM]]));
        const second = test.add('Guardian 2', ['F_ECM'], new Map([[ECM_MODE_STATE_KEY, ECMMode.OFF]]));
        const handler = new ECMHandler();
        const selection = { label: 'ECCM', value: ECMMode.ECCM } as PickerChoice;

        handler.handleSelection(second, selection, commandContext);

        expect(second.states.get(ECM_PENDING_MODE_STATE_KEY)).toBe(ECMMode.ECCM);
        expect(getEffectiveEcmMode(first)).toBe(ECMMode.ECM);
        expect(getEffectiveEcmMode(second)).toBe(ECMMode.OFF);

        handler.onEndTurn(second);

        expect(first.states.get(ECM_MODE_STATE_KEY)).toBe(ECMMode.OFF);
        expect(second.states.get(ECM_MODE_STATE_KEY)).toBe(ECMMode.ECCM);
        expect(second.states.has(ECM_PENDING_MODE_STATE_KEY)).toBeFalse();
        expect(getEffectiveEcmMode(second)).toBe(ECMMode.ECCM);
    });

    it('makes the last queued ECM suite win without changing current-turn effects', () => {
        const test = fixture();
        const current = test.add('Guardian 1', ['F_ECM'], new Map([[ECM_MODE_STATE_KEY, ECMMode.ECM]]));
        const second = test.add('Guardian 2', ['F_ECM'], new Map([[ECM_MODE_STATE_KEY, ECMMode.OFF]]));
        const third = test.add('Guardian 3', ['F_ECM'], new Map([[ECM_MODE_STATE_KEY, ECMMode.OFF]]));
        const handler = new ECMHandler();

        handler.handleSelection(second, { label: 'ECM', value: ECMMode.ECM }, commandContext);
        handler.handleSelection(third, { label: 'ECCM', value: ECMMode.ECCM }, commandContext);

        expect(second.states.has(ECM_PENDING_MODE_STATE_KEY)).toBeFalse();
        expect(third.states.get(ECM_PENDING_MODE_STATE_KEY)).toBe(ECMMode.ECCM);
        expect(getEffectiveEcmMode(current)).toBe(ECMMode.ECM);
        expect(getEffectiveEcmMode(third)).toBe(ECMMode.OFF);

        handler.onEndTurn(second);
        handler.onEndTurn(third);
        expect(current.states.get(ECM_MODE_STATE_KEY)).toBe(ECMMode.OFF);
        expect(second.states.get(ECM_MODE_STATE_KEY)).toBe(ECMMode.OFF);
        expect(third.states.get(ECM_MODE_STATE_KEY)).toBe(ECMMode.ECCM);
    });

    it('rejects ECM modes that the mounted suite does not support', () => {
        const test = fixture();
        const guardian = test.add('Guardian', ['F_ECM']);
        const handler = new ECMHandler();

        handler.handleSelection(
            guardian,
            { label: 'Synthetic Angel mode', value: ECMMode.ECM_ECCM },
            commandContext,
        );

        expect(guardian.states.has(ECM_PENDING_MODE_STATE_KEY)).toBeFalse();
        expect(test.markEquipmentStateChanged).not.toHaveBeenCalled();
    });

    it('hands active-probe operation to the newly selected standalone probe', () => {
        const test = fixture();
        const first = test.add('Probe 1', ['F_BAP'], new Map([
            [EQUIPMENT_POWER_STATE_KEY, EQUIPMENT_POWER_ON_STATE],
        ]));
        const second = test.add('Probe 2', ['F_BAP'], new Map([
            [EQUIPMENT_POWER_STATE_KEY, EQUIPMENT_POWER_OFF_STATE],
        ]));
        const handler = new BAPHandler();

        handler.handleSelection(second, handler.getChoices(second, queryContext)[0], commandContext);

        expect(isActiveProbeEffectivelyActive(first)).toBeTrue();
        expect(isActiveProbeEffectivelyActive(second)).toBeFalse();

        handler.onEndTurn(second);

        expect(first.states.get(EQUIPMENT_POWER_STATE_KEY)).toBe(EQUIPMENT_POWER_OFF_STATE);
        expect(second.states.get(EQUIPMENT_POWER_STATE_KEY)).toBe(EQUIPMENT_POWER_ON_STATE);
        expect(isActiveProbeEffectivelyActive(first)).toBeFalse();
        expect(isActiveProbeEffectivelyActive(second)).toBeTrue();
    });

    it('powers a combined suite fully down when a standalone probe takes over', () => {
        const test = fixture();
        const watchdog = test.add('Watchdog', ['F_WATCHDOG', 'F_ECM', 'F_BAP'], new Map([
            [ECM_MODE_STATE_KEY, ECMMode.ECM],
        ]));
        const probe = test.add('Bloodhound', ['F_BAP'], new Map([
            [EQUIPMENT_POWER_STATE_KEY, EQUIPMENT_POWER_OFF_STATE],
        ]));
        const handler = new BAPHandler();

        handler.handleSelection(probe, handler.getChoices(probe, queryContext)[0], commandContext);
        handler.onEndTurn(probe);

        expect(watchdog.states.get(ECM_MODE_STATE_KEY)).toBe(ECMMode.OFF);
        expect(probe.states.get(EQUIPMENT_POWER_STATE_KEY)).toBe(EQUIPMENT_POWER_ON_STATE);
    });

    it('powers competing ECM and probe systems down when Nova CEWS takes over', () => {
        const test = fixture();
        const nova = test.add('Nova CEWS', ['F_NOVA', 'F_ECM', 'F_BAP'], new Map([
            [NOVA_CEWS_STATE_KEY, NOVA_CEWS_OFF_STATE],
        ]));
        const guardian = test.add('Guardian', ['F_ECM'], new Map([
            [ECM_MODE_STATE_KEY, ECMMode.ECM],
        ]));
        const probe = test.add('Bloodhound', ['F_BAP'], new Map([
            [EQUIPMENT_POWER_STATE_KEY, EQUIPMENT_POWER_ON_STATE],
        ]));
        const handler = new NovaCewsHandler();

        handler.handleSelection(nova, handler.getChoices(nova, queryContext)[0], commandContext);
        handler.onEndTurn(nova);

        expect(nova.states.get(NOVA_CEWS_STATE_KEY)).toBe(NOVA_CEWS_ON_STATE);
        expect(guardian.states.get(ECM_MODE_STATE_KEY)).toBe(ECMMode.OFF);
        expect(probe.states.get(EQUIPMENT_POWER_STATE_KEY)).toBe(EQUIPMENT_POWER_OFF_STATE);
    });
});
