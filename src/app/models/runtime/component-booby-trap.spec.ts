// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../../services/equipment-interaction-registry.service';
import {
    BOOBY_TRAP_ARMED_MODE,
    BOOBY_TRAP_DETONATED_MODE,
    BoobyTrapHandler,
} from './component-booby-trap';
import { emptyCBTEncounterSnapshot } from './encounter-runtime';
import { asCommandId } from './runtime-state';
import { createDirectBoobyTrapRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('direct Booby Trap runtime', () => {
    it('rejects generic mode mutation and leaves cancellation completely unchanged', async () => {
        const fixture = createDirectBoobyTrapRuntimeFixture();
        const trap = fixture.equipmentComponent('Test Booby Trap');
        const revision = fixture.instance.revision();

        expect(fixture.instance.query().componentMode(trap.id)).toBe(BOOBY_TRAP_ARMED_MODE);
        expect(fixture.instance.dispatch({
            type: 'set-component-mode',
            commandId: asCommandId('booby-trap:invalid-mode'),
            expectedRevision: revision,
            componentId: trap.id,
            mode: BOOBY_TRAP_DETONATED_MODE,
        })).toEqual(jasmine.objectContaining({ accepted: false }));
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
    const queryContext = createHandlerQueryContext(fixture.equipment);
    const dialogs = dialogsService(confirmed);
    const commandContext = createHandlerCommandContext(
        fixture.equipment,
        toastService(),
        dialogs,
    );
    const trap = fixture.equipmentComponent('Test Booby Trap');
    const choice = () => registry.getV2EquipmentInteractionChoices(
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
        select: () => registry.handleV2EquipmentInteractionChoice(
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

function toastService(): HandlerToastService {
    return {
        showToast: jasmine.createSpy('showToast'),
        toasts: () => [],
    };
}

function dialogsService(confirmed: boolean): HandlerDialogsService & {
    readonly showNoticeHtml: jasmine.Spy;
} {
    return {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
        requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(confirmed),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml').and.resolveTo(),
    };
}
