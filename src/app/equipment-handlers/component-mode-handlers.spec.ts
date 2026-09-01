// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ECMMode } from '../models/common.model';
import {
    componentEcmActive,
    componentEcmModeDefinition,
} from '../models/runtime/component-ecm-mode';
import {
    applyHagWeaponTypes,
    componentHagModeDefinition,
    createComponentHagModeDefinition,
    hagToHitAdjustments,
} from '../models/runtime/component-hag-mode';
import { componentModeDefinition, createComponentModeDefinition } from '../models/runtime/component-mode';
import {
    createDirectBapRuntimeFixture,
    createDirectMekRuntimeFixture,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import type { WeaponType } from '../models/weapon-types.model';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import { ECMHandler } from '../models/runtime/component-ecm-mode';
import { HAG_FLAK_MODE, HAG_STANDARD_MODE, HagHandler } from '../models/runtime/component-hag-mode';
import { StealthHandler } from '../models/runtime/component-stealth';
import { EquipmentPowerHandler } from '../models/runtime/component-equipment-power';

describe('direct V2 component-mode handlers', () => {
    it('keeps an active probe effective until its End-Turn power transition settles', () => {
        const fixture = createDirectBapRuntimeFixture();
        const component = fixture.equipmentComponent('Test BAP');
        const setup = directModeSetup('Test BAP', fixture);
        const handler = new EquipmentPowerHandler();
        const input = interactionInput(setup);

        expect(fixture.instance.query().componentMode(component.id)).toBe('enabled');
        expect(handler.choices(input)).toEqual([{
            label: 'Active Probe is ON',
            value: 'disabling',
            active: true,
            displayType: 'toggle',
        }]);
        expect(handler.select(
            input,
            { label: 'Active Probe is ON', value: 'disabling' },
            setup.commandContext,
        )).toBeTrue();
        expect(fixture.instance.query().componentMode(component.id)).toBe('disabling');
        expect(handler.choices(input)[0]).toEqual(jasmine.objectContaining({
            label: 'Turning active probe off…',
            value: 'enabled',
            active: true,
        }));
        expect(fixture.instance.dispatch({
            type: 'end-turn',
            
            
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().componentMode(component.id)).toBe('disabled');
        expect(handler.choices(input)[0]).toEqual(jasmine.objectContaining({
            label: 'Active Probe is OFF',
            value: 'enabling',
            active: false,
        }));
    });

    it('settles stealth at End Turn and accepts every signature-system family', () => {
        const setup = directModeSetup('Test Stealth');
        const definition = componentModeDefinition(
            setup.fixture.entity,
            setup.fixture.index,
            setup.component.id,
            setup.fixture.instance.ruleset(),
        );
        const handler = new StealthHandler();

        expect(setup.runtime.query().componentMode(setup.component.id)).toBe('Off');
        expect(handler.getComponentModeChoices(setup.runtime, definition, setup.queryContext)).toEqual([{
            label: 'Stealth Deactivated', value: 'enabling', active: false, displayType: 'toggle',
        }]);
        expect(handler.handleComponentModeSelection(
            setup.runtime,
            definition,
            { label: 'Stealth Deactivated', value: 'enabling' },
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.query().componentStealthState(setup.component.id)).toBe('enabling');
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe('Off');
        expect(setup.runtime.dispatch({
            type: 'end-turn',
            
            
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(setup.runtime.query().componentStealthState(setup.component.id)).toBe('enabled');
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe('On');
        expect(setup.runtime.query().c3DisruptedByStealth()).toBeTrue();
        const heat = setup.runtime.query().heatProjection('automatic');
        expect(heat.kind).toBe('supported');
        if (heat.kind === 'supported') {
            expect(heat.projection.committedSources).toContain(jasmine.objectContaining({
                id: `equipment:${setup.component.id}`,
                label: 'Stealth',
                value: 10,
                group: 'Equipment',
            }));
        }
        expect(handler.handleComponentModeSelection(
            setup.runtime,
            definition,
            handler.getComponentModeChoices(setup.runtime, definition, setup.queryContext)[0],
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.query().componentStealthState(setup.component.id)).toBe('disabling');
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe('On');
        expect(setup.runtime.query().c3DisruptedByStealth()).toBeTrue();
        expect(setup.runtime.dispatch({
            type: 'end-turn',
            
            
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(setup.runtime.query().componentStealthState(setup.component.id)).toBe('disabled');
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe('Off');
        expect(setup.runtime.query().c3DisruptedByStealth()).toBeFalse();

        const chameleon = createComponentModeDefinition({
            componentId: setup.component.id,
            displayName: 'Chameleon LPS',
            flags: ['F_CHAMELEON_SHIELD'],
            modes: ['On', 'Off'],
        });
        const nullSignature = createComponentModeDefinition({
            componentId: setup.component.id,
            displayName: 'Null Signature',
            flags: ['F_NULL_SIG'],
            modes: ['On', 'Off'],
        });
        const passiveVisualCamo = createComponentModeDefinition({
            componentId: setup.component.id,
            displayName: 'Visual Camo',
            flags: ['F_VISUAL_CAMO'],
        });
        const ordinaryEcm = createComponentModeDefinition({
            componentId: setup.component.id,
            displayName: 'ECM',
            flags: ['F_ECM'],
            modes: ['On', 'Off'],
        });
        expect(handler.applicableToComponent(chameleon)).toBeTrue();
        expect(handler.applicableToComponent(nullSignature)).toBeTrue();
        expect(handler.getComponentModeChoices(
            setup.runtime, passiveVisualCamo, setup.queryContext,
        )).toEqual([]);
        expect(handler.applicableToComponent(ordinaryEcm)).toBeFalse();
    });

    it('requires an ECM-bearing suite and drops active stealth on pending ECM loss', () => {
        const setup = directModeSetup('Test Stealth');
        const definition = componentModeDefinition(
            setup.fixture.entity,
            setup.fixture.index,
            setup.component.id,
            setup.fixture.instance.ruleset(),
        );
        const handler = new StealthHandler();
        const ecmIds = ['Test Angel ECM', 'Test ECM'].map(id => setup.fixture.equipmentComponent(id).id);
        for (const componentId of ecmIds) {
            expect(setup.runtime.dispatch({
                type: 'set-component-mode',
                
                
                componentId,
                mode: ECMMode.OFF,
            }).accepted).toBeTrue();
        }
        expect(handler.getComponentModeChoices(
            setup.runtime, definition, setup.queryContext,
        )[0].disabled).toBeTrue();

        expect(setup.runtime.dispatch({
            type: 'set-component-mode',
            
            
            componentId: ecmIds[0],
            mode: ECMMode.ECM,
        }).accepted).toBeTrue();
        expect(handler.handleComponentModeSelection(
            setup.runtime,
            definition,
            handler.getComponentModeChoices(setup.runtime, definition, setup.queryContext)[0],
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.dispatch({
            type: 'end-turn',
            
            
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(setup.runtime.query().componentStealthState(setup.component.id)).toBe('enabled');

        expect(setup.runtime.dispatch({
            type: 'set-component-status',
            
            
            componentId: ecmIds[0],
            status: 'destroyed',
            target: 'pending',
        }).accepted).toBeTrue();
        expect(setup.runtime.query().functionalEcmForStealth()).toBeFalse();
        expect(setup.runtime.query().c3DisruptedByStealth()).toBeFalse();
        const heat = setup.runtime.query().heatProjection('automatic');
        if (heat.kind === 'supported') {
            expect(heat.projection.committedSources.some(source => (
                source.id === `equipment:${setup.component.id}`
            ))).toBeFalse();
        }
        expect(setup.runtime.dispatch({
            type: 'end-phase',
            
            
        }).accepted).toBeTrue();
        expect(setup.runtime.query().componentStealthState(setup.component.id)).toBe('disabled');
    });

    it('uses the closed HAG modes and persists Flak in sparse state', () => {
        const setup = directModeSetup('Test HAG');
        const definition = componentHagModeDefinition(setup.fixture.index, setup.component.id);
        const handler = new HagHandler();

        expect(setup.runtime.query().componentMode(setup.component.id)).toBe(HAG_STANDARD_MODE);
        expect(handler.getComponentHagModeChoices(setup.runtime, definition, setup.queryContext)).toEqual([{
            label: 'Mode', value: HAG_STANDARD_MODE, displayType: 'dropdown', keepOpen: true,
            choices: [
                { label: 'STD', value: HAG_STANDARD_MODE },
                { label: 'FLAK', value: HAG_FLAK_MODE },
            ],
        }]);
        expect(handler.handleComponentHagModeSelection(
            setup.runtime,
            definition,
            { label: 'FLAK', value: HAG_FLAK_MODE },
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe(HAG_FLAK_MODE);
    });

    it('replaces DB with F and adds the HAG Flak modifier without mutating inputs', () => {
        const setup = directModeSetup('Test HAG');
        const definition = componentHagModeDefinition(setup.fixture.index, setup.component.id);
        const handler = new HagHandler();
        const types = new Set<WeaponType>(['C', 'DB', 'F', 'X']);

        expect([...applyHagWeaponTypes(HAG_STANDARD_MODE, types)]).toEqual(['C', 'DB', 'X']);
        expect(hagToHitAdjustments(definition, HAG_STANDARD_MODE)).toEqual([]);
        expect(handler.handleComponentHagModeSelection(
            setup.runtime,
            definition,
            { label: 'FLAK', value: HAG_FLAK_MODE },
            setup.commandContext,
        )).toBeTrue();
        expect([...applyHagWeaponTypes(HAG_FLAK_MODE, types)]).toEqual(['C', 'F', 'X']);
        expect(hagToHitAdjustments(definition, HAG_FLAK_MODE)).toEqual([{
            kind: 'add', label: 'Test HAG (FLAK)', modifier: -1,
        }]);
        expect([...types]).toEqual(['C', 'DB', 'F', 'X']);

        expect(handler.applicableToComponentHagMode(createComponentHagModeDefinition({
            componentId: setup.component.id,
            displayName: 'Misc HAG',
            flags: ['F_HAG'],
            weapon: false,
        }))).toBeFalse();
    });

    it('uses ordinary ECM modes and settles the selected mode at End Turn', () => {
        const setup = directModeSetup('Test ECM');
        const definition = componentEcmModeDefinition(setup.fixture.index, setup.component.id);
        const handler = new ECMHandler();
        const angelId = setup.fixture.equipmentComponent('Test Angel ECM').id;

        expect(definition.modes).toEqual([
            ECMMode.ECM, ECMMode.ECCM, ECMMode.GHOST, ECMMode.OFF,
        ]);
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe(ECMMode.ECM);
        expect(componentEcmActive(ECMMode.ECM)).toBeTrue();
        expect(setup.runtime.dispatch({
            type: 'set-component-mode',
            
            
            componentId: angelId,
            mode: ECMMode.OFF,
        }).accepted).toBeTrue();
        expect(handler.handleComponentEcmModeSelection(
            setup.runtime,
            definition,
            { label: 'Off', value: ECMMode.OFF },
            setup.commandContext,
        )).toBeTrue();
        expect(handler.choices(interactionInput(setup))[0].value).toBe(ECMMode.OFF);
        expect(setup.runtime.query().componentMode(setup.component.id)).not.toBe(ECMMode.OFF);
        expect(setup.runtime.dispatch({
            type: 'end-turn',
            
            
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe(ECMMode.OFF);
        expect(componentEcmActive(ECMMode.OFF)).toBeFalse();
    });

    it('exposes the three additional simultaneous Angel ECM modes', () => {
        const setup = directModeSetup('Test Angel ECM');
        const definition = componentEcmModeDefinition(setup.fixture.index, setup.component.id);
        const handler = new ECMHandler();

        expect(definition.modes).toEqual([
            ECMMode.ECM,
            ECMMode.ECCM,
            ECMMode.GHOST,
            ECMMode.ECM_ECCM,
            ECMMode.ECM_GHOST,
            ECMMode.ECCM_GHOST,
            ECMMode.OFF,
        ]);
        expect(handler.getComponentEcmModeChoices(setup.runtime, definition, setup.queryContext)[0].choices)
            .toContain(jasmine.objectContaining({ label: 'ECM+ECCM', value: ECMMode.ECM_ECCM }));
    });
});

function directModeSetup(
    equipmentId: string,
    fixture = createDirectMekRuntimeFixture(),
) {
    const component = fixture.equipmentComponent(equipmentId);
    const runtime = fixture.instance;
    const toast: HandlerToastService = {
        showToast: jasmine.createSpy('showToast'),
        toasts: () => [],
    };
    const dialogs = {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    } as HandlerDialogsService;
    return {
        fixture,
        component,
        runtime,
        queryContext: createHandlerQueryContext(fixture.equipment),
        commandContext: createHandlerCommandContext(fixture.equipment, toast, dialogs),
    };
}

function interactionInput(setup: ReturnType<typeof directModeSetup>) {
    return {
        runtime: setup.runtime,
        entity: setup.fixture.entity,
        index: setup.fixture.index,
        ruleset: setup.runtime.ruleset(),
        owner: {
            instanceId: setup.runtime.id,
            encounter: () => ({}) as never,
        },
        componentId: setup.component.id,
        context: setup.queryContext,
    };
}
