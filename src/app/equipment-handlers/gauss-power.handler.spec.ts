// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { emptyCBTEncounterSnapshot } from '../models/runtime/encounter-runtime';
import {
    GAUSS_POWERED_DOWN,
    GAUSS_POWERED_UP,
    GAUSS_POWERING_DOWN,
    GAUSS_POWERING_UP,
    mekGaussPowerDefinition,
} from '../models/runtime/mek-gauss-power';
import { projectMekEquipmentPanel } from '../models/runtime/equipment-panel';
import { asCommandId } from '../models/runtime/runtime-state';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import type { CBTUnitInstance } from '../models/runtime/unit-instance';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import { HAG_FLAK_MODE, HAG_STANDARD_MODE } from '../models/runtime/component-hag-mode';
import { GaussPowerHandler } from '../models/runtime/mek-gauss-power';

describe('direct V2 Gauss power handler', () => {
    it('ports the production transition labels and settles power down at end turn', () => {
        const setup = directGaussSetup();

        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERED_UP);
        expect(setup.choices()).toEqual([{
            label: 'Powered Up', value: GAUSS_POWERING_DOWN, active: true, displayType: 'toggle',
        }]);

        expect(setup.select()).toBeTrue();
        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERING_DOWN);
        expect(setup.choices()[0]).toEqual(jasmine.objectContaining({
            label: 'Powering Down…', value: GAUSS_POWERED_UP, active: true,
        }));
        expect(setup.toast.showToast).toHaveBeenCalledWith('Test HAG is powering down', 'info');
        expect(setup.weaponSelectable()).toBeTrue();

        endTurn(setup.runtime, 'gauss:power-down');

        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERED_DOWN);
        expect(setup.choices()[0]).toEqual(jasmine.objectContaining({
            label: 'Powered Down', value: GAUSS_POWERING_UP, active: false,
        }));
        expect(setup.weaponSelectable()).toBeFalse();
        expect(setup.runtime.dispatch({
            type: 'fire-weapons',
            commandId: asCommandId('gauss:fire-powered-down'),
            expectedRevision: setup.runtime.revision(),
            selections: [{ weaponId: setup.component.id }],
            heatPolicy: 'automatic',
        })).toEqual(jasmine.objectContaining({ accepted: false, reason: 'INVALID_TARGET' }));
    });

    it('remains powered down while powering up and becomes selectable after end turn', () => {
        const setup = directGaussSetup();
        setup.select();
        endTurn(setup.runtime, 'gauss:prepare-powered-down');

        expect(setup.select()).toBeTrue();
        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERING_UP);
        expect(setup.choices()[0]).toEqual(jasmine.objectContaining({
            label: 'Powering Up…', value: GAUSS_POWERED_DOWN, active: false,
        }));
        expect(setup.weaponSelectable()).toBeFalse();

        endTurn(setup.runtime, 'gauss:power-up');

        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERED_UP);
        expect(setup.weaponSelectable()).toBeTrue();
    });

    it('allows either pending transition to be cancelled before end turn', () => {
        const setup = directGaussSetup();
        setup.select();
        setup.select();
        endTurn(setup.runtime, 'gauss:cancel-down');
        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERED_UP);

        setup.select();
        endTurn(setup.runtime, 'gauss:settle-down');
        setup.select();
        setup.select();
        endTurn(setup.runtime, 'gauss:cancel-up');
        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERED_DOWN);
    });

    it('keeps HAG mode and Gauss power in independent sparse fields', () => {
        const setup = directGaussSetup();
        expect(setup.runtime.dispatch({
            type: 'set-component-mode',
            commandId: asCommandId('gauss:hag-flak'),
            expectedRevision: setup.runtime.revision(),
            componentId: setup.component.id,
            mode: HAG_FLAK_MODE,
        }).accepted).toBeTrue();

        setup.select();
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe(HAG_FLAK_MODE);
        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERING_DOWN);

        expect(setup.runtime.dispatch({
            type: 'set-component-mode',
            commandId: asCommandId('gauss:hag-standard'),
            expectedRevision: setup.runtime.revision(),
            componentId: setup.component.id,
            mode: HAG_STANDARD_MODE,
        }).accepted).toBeTrue();
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe(HAG_STANDARD_MODE);
        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERING_DOWN);
    });
});

function directGaussSetup() {
    const fixture = createDirectMekRuntimeFixture();
    const component = fixture.equipmentComponent('Test HAG');
    const runtime = fixture.instance;
    const definition = mekGaussPowerDefinition(fixture.index, component.id);
    const handler = new GaussPowerHandler();
    const toast: HandlerToastService = {
        showToast: jasmine.createSpy('showToast'),
        toasts: () => [],
    };
    const dialogs = {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    } as HandlerDialogsService;
    const queryContext = createHandlerQueryContext(fixture.equipment);
    const commandContext = createHandlerCommandContext(fixture.equipment, toast, dialogs);
    const choices = () => handler.getComponentGaussPowerChoices(runtime, definition, queryContext);
    return {
        fixture,
        component,
        runtime,
        toast,
        choices,
        select: () => handler.handleComponentGaussPowerSelection(
            runtime,
            definition,
            choices()[0]!,
            commandContext,
        ),
        weaponSelectable: () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(row => row.componentId === component.id)?.weapon?.selectable,
    };
}

function endTurn(runtime: CBTUnitInstance, commandId: string): void {
    expect(runtime.dispatch({
        type: 'end-turn',
        commandId: asCommandId(commandId),
        expectedRevision: runtime.revision(),
        policy: 'automatic',
    }).accepted).toBeTrue();
}
