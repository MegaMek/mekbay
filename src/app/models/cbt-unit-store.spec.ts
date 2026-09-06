// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { EquipmentInteractionRegistry } from '../services/equipment-interaction-registry.service';
import { CBTUnitStore } from './cbt-unit-store';
import { BoobyTrapHandler } from './runtime/component-booby-trap';
import type { SerializedCBTForceV2 } from './runtime/persistence-v2';
import { createDirectBoobyTrapRuntimeFixture, emptyCBTEncounterSnapshot } from './runtime/testing/direct-mek-runtime-fixture';

describe('equipment confirmation authority at the unit store', () => {
    for (const change of ['read-only', 'replacement', 'state', 'retirement'] as const) {
        it(`rejects detonation after ${change} changes during confirmation without mutating either owner`, async () => {
            const setup = confirmationFixture();
            const before = setup.runtime.snapshot();
            const pending = setup.select();
            const replacement = createDirectBoobyTrapRuntimeFixture().instance;
            if (change === 'read-only') setup.readOnly = true;
            if (change === 'replacement') setup.units.set(setup.runtime.instanceId, replacement);
            if (change === 'state') setup.runtime.dispatch({ type: 'set-heat', heat: 3 });
            if (change === 'retirement') setup.ownerCurrent = false;
            const expectedState = setup.runtime.snapshot();
            setup.confirm(true);

            expect(await pending).toEqual({ accepted: false, changed: false,
                reason: change === 'read-only' ? 'READ_ONLY' : 'OWNER_CHANGED' });
            expect(setup.runtime.snapshot()).toBe(expectedState);
            if (change !== 'state') expect(expectedState).toBe(before);
            expect(setup.runtime.query().destroyed()).toBeFalse();
            expect(replacement.query().destroyed()).toBeFalse();
            expect(setup.publish).not.toHaveBeenCalled();
            expect(setup.dialogs.showNoticeHtml).not.toHaveBeenCalled();
        });
    }

    for (const failNotice of [false, true]) {
        it(`publishes a valid detonation before its notice ${failNotice ? 'fails' : 'finishes'}`, async () => {
            const setup = confirmationFixture();
            let closeNotice!: () => void;
            let fail!: (reason: Error) => void;
            setup.dialogs.showNoticeHtml.and.returnValue(new Promise<void>((resolve, reject) => {
                closeNotice = resolve;
                fail = reject;
            }));
            const pending = setup.select();
            setup.confirm(true);
            await Promise.resolve();

            expect(setup.runtime.query().destroyed()).toBeTrue();
            expect(setup.publish).toHaveBeenCalledTimes(1);
            const committed = setup.runtime.snapshot();
            setup.runtime.dispatch({ type: 'set-heat', heat: 3 });
            setup.readOnly = true;
            if (failNotice) fail(new Error('notice failed'));
            else closeNotice();

            expect(await pending).toEqual({ accepted: true, changed: true,
                context: { owner: setup.runtime, state: committed } });
            expect(setup.publish).toHaveBeenCalledTimes(1);
        });
    }

    it('leaves cancellation unchanged and unpublished', async () => {
        const setup = confirmationFixture();
        const before = setup.runtime.snapshot();
        const pending = setup.select();
        setup.confirm(false);
        expect(await pending).toEqual({ accepted: true, changed: false,
            context: { owner: setup.runtime, state: before } });
        expect(setup.runtime.snapshot()).toBe(before);
        expect(setup.publish).not.toHaveBeenCalled();
    });

    it('does not publish an unrelated edit when a stale confirmation is cancelled', async () => {
        const setup = confirmationFixture();
        const pending = setup.select();
        setup.runtime.dispatch({ type: 'set-heat', heat: 3 });
        const edited = setup.runtime.snapshot();
        setup.confirm(false);
        expect(await pending).toEqual({ accepted: false, changed: false, reason: 'OWNER_CHANGED' });
        expect(setup.runtime.snapshot()).toBe(edited);
        expect(setup.publish).not.toHaveBeenCalled();
    });
});

function confirmationFixture() {
    const fixture = createDirectBoobyTrapRuntimeFixture();
    const runtime = fixture.instance;
    const units = new Map([[runtime.instanceId, runtime]]);
    const store = new CBTUnitStore();
    const envelope = {} as SerializedCBTForceV2;
    store.install({ envelope, binding: { envelope, units, scenarioRules: { id: 'test' } }, warnings: [] });
    const registry = new EquipmentInteractionRegistry();
    registry.register(new BoobyTrapHandler());
    let confirm!: (accepted: boolean) => void;
    const dialogs = {
        requestConfirmation: jasmine.createSpy('requestConfirmation').and.callFake(() =>
            new Promise<boolean>(resolve => confirm = resolve)),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml').and.resolveTo(),
    };
    const choice = store.equipmentInteractions(runtime.instanceId, registry, {}, emptyCBTEncounterSnapshot, false)[0]!.choices[0]!.command;
    const setup = {
        runtime, units, dialogs,
        readOnly: false,
        ownerCurrent: true,
        publish: jasmine.createSpy('publishChanged'),
        confirm: (accepted: boolean) => confirm(accepted),
        select: () => store.dispatchEquipmentChoice(choice, registry, {}, {
            dialogsService: dialogs, toastService: { showToast: jasmine.createSpy('showToast') },
        }, emptyCBTEncounterSnapshot, () => setup.readOnly, () => setup.ownerCurrent, setup.publish),
    };
    return setup;
}
