// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { EquipmentInteractionRegistry } from '../../services/equipment-interaction-registry.service';
import type {
    EquipmentInteractionDialogsService,
    EquipmentInteractionNotifications,
} from './equipment-interaction';
import {
    BOOBY_TRAP_ARMED_MODE,
    BOOBY_TRAP_DETONATED_MODE,
    BoobyTrapHandler,
} from './component-booby-trap';
import {
    createDirectBoobyTrapRuntimeFixture,
    emptyCBTEncounterSnapshot,
} from './testing/direct-mek-runtime-fixture';

describe('direct Booby Trap runtime', () => {
    it('rejects generic mode mutation and leaves cancellation completely unchanged', async () => {
        const fixture = createDirectBoobyTrapRuntimeFixture();
        const trap = fixture.equipmentComponent('Test Booby Trap');
        const revision = fixture.instance.revision();

        expect(fixture.instance.query().componentMode(trap.id)).toBe(BOOBY_TRAP_ARMED_MODE);
        expect(fixture.instance.dispatch({
            type: 'set-component-mode',
            
            
            componentId: trap.id,
            mode: BOOBY_TRAP_DETONATED_MODE,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(fixture.instance.revision()).toBe(revision);

        const interaction = interactionFixture(fixture, false);
        expect(interaction.choice().choice).toEqual(jasmine.objectContaining({
            label: 'Detonate Booby Trap',
            disabled: false,
        }));
        expect(await interaction.select()).toBeTrue();
        expect(fixture.instance.revision()).toBe(revision);
        expect(fixture.instance.query().destroyed()).toBeFalse();
        expect(fixture.instance.query().componentMode(trap.id)).toBe(BOOBY_TRAP_ARMED_MODE);
        expect(interaction.dialogs.showNoticeHtml).not.toHaveBeenCalled();
    });

    it('atomically marks the trap detonated and destroys its carrier after confirmation', async () => {
        const fixture = createDirectBoobyTrapRuntimeFixture();
        const trap = fixture.equipmentComponent('Test Booby Trap');
        const interaction = interactionFixture(fixture, true);

        expect(await interaction.select()).toBeTrue();

        expect(fixture.instance.query().componentMode(trap.id)).toBe(BOOBY_TRAP_DETONATED_MODE);
        expect(fixture.instance.snapshot().explicitlyDestroyed).toBeFalse();
        expect(fixture.instance.snapshot().destroyed).toBeTrue();
        expect(fixture.instance.query().destroyed()).toBeTrue();
        expect(interaction.dialogs.showNoticeHtml).toHaveBeenCalledOnceWith(
            jasmine.stringContaining('Resolve the Booby Trap blast'),
            'Booby Trap Detonated',
        );
        expect(interaction.choice().choice).toEqual(jasmine.objectContaining({
            label: 'Booby Trap Detonated',
            active: true,
            disabled: true,
        }));
    });
});

function interactionFixture(
    fixture: ReturnType<typeof createDirectBoobyTrapRuntimeFixture>,
    confirmed: boolean,
) {
    const registry = new EquipmentInteractionRegistry();
    registry.register(new BoobyTrapHandler());
    const owner = { instanceId: fixture.instance.id, encounter: emptyCBTEncounterSnapshot };
    const queryContext = {};
    const dialogs = dialogsService(confirmed);
    const commandContext = { toastService: toastService(), dialogsService: dialogs };
    const trap = fixture.equipmentComponent('Test Booby Trap');
    const choice = () => registry.choices(
        fixture.instance,
        fixture.entity,
        fixture.index,
        fixture.instance.ruleset(),
        owner,
        queryContext,
    ).find(candidate => candidate.componentId === trap.id)!;
    return {
        dialogs,
        choice,
        select: () => registry.select(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            owner,
            choice(),
            queryContext,
            commandContext,
        ),
    };
}

function toastService(): EquipmentInteractionNotifications {
    return {
        showToast: jasmine.createSpy('showToast'),
    };
}

function dialogsService(confirmed: boolean): EquipmentInteractionDialogsService & {
    readonly showNoticeHtml: jasmine.Spy;
} {
    return {
        requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(confirmed),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml').and.resolveTo(),
    };
}
