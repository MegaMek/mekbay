// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    GAUSS_POWERED_DOWN,
    GAUSS_POWERED_UP,
    GAUSS_POWERING_DOWN,
    GAUSS_POWERING_UP,
    mekGaussPowerDefinition,
} from '../models/runtime/mek-gauss-power';
import { projectMekEquipmentPanel } from '../models/runtime/equipment-panel';
import {
    createDirectMekRuntimeFixture,
    emptyCBTEncounterSnapshot,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import type { CBTUnitInstance } from '../models/runtime/unit-instance';
import type {
    EquipmentInteractionDialogsService,
    EquipmentInteractionNotifications,
} from '../models/runtime/equipment-interaction';
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
            
            
            selections: [{ weaponId: setup.component.id }],
            heatPolicy: 'automatic',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
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
            
            
            componentId: setup.component.id,
            mode: HAG_FLAK_MODE,
        }).accepted).toBeTrue();

        setup.select();
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe(HAG_FLAK_MODE);
        expect(setup.runtime.query().componentGaussPower(setup.component.id)).toBe(GAUSS_POWERING_DOWN);

        expect(setup.runtime.dispatch({
            type: 'set-component-mode',
            
            
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
    const toast: EquipmentInteractionNotifications = {
        showToast: jasmine.createSpy('showToast'),
    };
    const dialogs = {
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    } as EquipmentInteractionDialogsService;
    const queryContext = {};
    const commandContext = { toastService: toast, dialogsService: dialogs };
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
        
        
        policy: 'automatic',
    }).accepted).toBeTrue();
}
