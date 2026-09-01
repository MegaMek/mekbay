// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    BOMBAST_LASER_DAMAGE_7_MODE,
    BOMBAST_LASER_DAMAGE_8_MODE,
    BOMBAST_LASER_DAMAGE_9_MODE,
    BOMBAST_LASER_DAMAGE_10_MODE,
    BOMBAST_LASER_DAMAGE_11_MODE,
    BOMBAST_LASER_DAMAGE_12_MODE,
    TW_BOMBAST_LASER_MODES,
    bombastLaserProfile,
} from '../models/bombast-laser-mode.model';
import {
    BOMBAST_LASER_CHARGING_STATE,
    componentBombastLaserDefinition,
    componentBombastLaserLifecycle,
    setComponentBombastLaserCharge,
} from '../models/runtime/component-bombast-laser';
import {
    equipmentWeaponToHitModifier,
    projectMekEquipmentComponents,
} from '../models/runtime/equipment-panel';
import { createDirectBombastRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import {
    BombastLaserHandler,
    TwBombastLaserHandler,
} from '../models/runtime/component-bombast-laser';

describe('TwBombastLaserHandler direct V2 runtime', () => {
    it('offers all six TW modes, no charge control, and exactly one ruleset handler', () => {
        const setup = directTwBombastSetup();
        const choices = setup.handler.getComponentBombastLaserChoices(
            setup.runtime,
            setup.definition,
            setup.queryContext,
        );
        const coreHandler = new BombastLaserHandler();

        expect(choices).toEqual([jasmine.objectContaining({
            label: 'Mode',
            value: BOMBAST_LASER_DAMAGE_12_MODE,
            choices: [
                { label: '7 DMG', value: BOMBAST_LASER_DAMAGE_7_MODE },
                { label: '8 DMG', value: BOMBAST_LASER_DAMAGE_8_MODE },
                { label: '9 DMG', value: BOMBAST_LASER_DAMAGE_9_MODE },
                { label: '10 DMG', value: BOMBAST_LASER_DAMAGE_10_MODE },
                { label: '11 DMG', value: BOMBAST_LASER_DAMAGE_11_MODE },
                { label: '12 DMG', value: BOMBAST_LASER_DAMAGE_12_MODE },
            ],
        })]);
        expect(coreHandler.applicableToComponentBombastLaser(setup.definition)).toBeFalse();
        expect(setup.handler.applicableToComponentBombastLaser(setup.definition)).toBeTrue();
        expect(setComponentBombastLaserCharge(
            setup.runtime, setup.definition, BOMBAST_LASER_CHARGING_STATE,
        ).accepted).toBeFalse();
        expect(componentBombastLaserLifecycle(setup.runtime, setup.definition))
            .toEqual({ chargeState: null, fired: false });
    });

    it('uses the selected TW damage, heat, and TN for every mode and for firing', () => {
        for (const mode of TW_BOMBAST_LASER_MODES) {
            const setup = directTwBombastSetup();
            const profile = bombastLaserProfile('total-warfare', mode)!;

            expect(setup.handler.handleComponentBombastLaserSelection(
                setup.runtime,
                setup.definition,
                { label: mode, value: mode },
                setup.commandContext,
            )).toBeTrue();
            const row = projectedRow(setup);
            expect(row.weapon).toEqual(jasmine.objectContaining({
                damage: profile.damage,
                heat: profile.heat,
                toHitModifier: profile.toHitModifier,
            }));
            expect(equipmentWeaponToHitModifier(row)).toBe(profile.toHitModifier);

            const fired = setup.runtime.dispatch({
                type: 'fire-weapons',
                
                
                selections: [{ weaponId: setup.component.id }],
                heatPolicy: 'automatic',
            });
            expect(fired.accepted).toBeTrue();
            expect(setup.runtime.query().turnState().weaponsHeat).toBe(profile.heat);
            expect(setup.runtime.query().componentBombastLaser(setup.component.id)).toBeUndefined();
        }
    });
});

function directTwBombastSetup() {
    const fixture = createDirectBombastRuntimeFixture('total-warfare');
    const component = fixture.equipmentComponent('Test Bombast Laser');
    const runtime = fixture.instance;
    const definition = componentBombastLaserDefinition(
        fixture.index,
        component.id,
        fixture.instance.ruleset(),
    );
    const toast = {
        showToast: jasmine.createSpy('showToast'),
        toasts: () => [],
    } as HandlerToastService & { showToast: jasmine.Spy };
    const dialogs = {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    } as HandlerDialogsService;
    return {
        fixture,
        component,
        runtime,
        definition,
        handler: new TwBombastLaserHandler(),
        toast,
        queryContext: createHandlerQueryContext(fixture.equipment),
        commandContext: createHandlerCommandContext(fixture.equipment, toast, dialogs),
    };
}

type DirectTwBombastSetup = ReturnType<typeof directTwBombastSetup>;

function projectedRow(setup: DirectTwBombastSetup) {
    const row = projectMekEquipmentComponents(
        setup.fixture.entity,
        setup.fixture.index,
        setup.fixture.instance.ruleset(),
        setup.runtime.query(),
    ).find(candidate => candidate.componentId === setup.component.id);
    if (row?.weapon === undefined) throw new Error('Missing projected Bombast weapon');
    return row;
}
