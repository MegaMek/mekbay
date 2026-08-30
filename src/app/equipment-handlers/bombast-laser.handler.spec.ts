// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    BOMBAST_LASER_DAMAGE_12_MODE,
    BOMBAST_LASER_DAMAGE_16_MODE,
    BOMBAST_LASER_DAMAGE_8_MODE,
} from '../models/bombast-laser-mode.model';
import {
    BOMBAST_LASER_CHARGED_STATE,
    BOMBAST_LASER_CHARGING_STATE,
    componentBombastLaserDefinition,
    componentBombastLaserLifecycle,
    setComponentBombastLaserCharge,
    setComponentBombastLaserMode,
} from '../models/runtime/component-bombast-laser';
import { canPerformMekAction } from '../models/runtime/mek-action-availability';
import {
    equipmentWeaponToHitModifier,
    projectMekEquipmentComponents,
} from '../models/runtime/equipment-panel';
import { asCommandId } from '../models/runtime/runtime-state';
import { createDirectBombastRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import type { CBTUnitInstance } from '../models/runtime/unit-instance';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import { BombastLaserHandler } from '../models/runtime/component-bombast-laser';

describe('BombastLaserHandler direct V2 runtime', () => {
    it('offers the three Core modes and projects the selected profile', () => {
        const setup = directBombastSetup();

        expect(setup.handler.getComponentBombastLaserChoices(
            setup.runtime, setup.definition, setup.queryContext,
        )[0])
            .toEqual(jasmine.objectContaining({
                label: 'Mode',
                value: BOMBAST_LASER_DAMAGE_12_MODE,
                choices: [
                    { label: '8 DMG', value: BOMBAST_LASER_DAMAGE_8_MODE },
                    { label: '12 DMG', value: BOMBAST_LASER_DAMAGE_12_MODE },
                    { label: '16 DMG', value: BOMBAST_LASER_DAMAGE_16_MODE },
                ],
            }));
        expect(projectedWeapon(setup)).toEqual(jasmine.objectContaining({
            damage: 12,
            heat: 9,
            toHitModifier: 1,
        }));

        expect(setup.handler.handleComponentBombastLaserSelection(
            setup.runtime,
            setup.definition,
            { label: '16 DMG', value: BOMBAST_LASER_DAMAGE_16_MODE },
            setup.commandContext,
        )).toBeTrue();
        const row = projectedRow(setup);
        expect(row.weapon).toEqual(jasmine.objectContaining({
            damage: 16,
            heat: 12,
            toHitModifier: 2,
        }));
        expect(equipmentWeaponToHitModifier(row)).toBe(2);
    });

    it('charges for one turn, blocks firing while charging, and suppresses its TN when charged', () => {
        const setup = directBombastSetup();

        expect(setup.handler.handleComponentBombastLaserSelection(
            setup.runtime,
            setup.definition,
            { label: 'Charge', value: BOMBAST_LASER_CHARGING_STATE },
            setup.commandContext,
        )).toBeTrue();
        expect(componentBombastLaserLifecycle(setup.runtime, setup.definition))
            .toEqual({ chargeState: BOMBAST_LASER_CHARGING_STATE, fired: false });
        expect(canFire(setup)).toBeFalse();

        endTurn(setup.runtime, 'bombast:finish-charge');

        expect(componentBombastLaserLifecycle(setup.runtime, setup.definition))
            .toEqual({ chargeState: BOMBAST_LASER_CHARGED_STATE, fired: false });
        expect(canFire(setup)).toBeTrue();
        expect(projectedWeapon(setup).toHitModifier).toBe(0);
        expect(setup.handler.getComponentBombastLaserChoices(
            setup.runtime, setup.definition, setup.queryContext,
        )[1])
            .toEqual(jasmine.objectContaining({ label: 'Laser Charged!', active: true }));
    });

    it('fires atomically with profile heat and cannot recharge until the next turn', () => {
        const setup = directBombastSetup();
        expect(setComponentBombastLaserMode(
            setup.runtime, setup.definition, BOMBAST_LASER_DAMAGE_16_MODE,
        ).accepted).toBeTrue();
        expect(setComponentBombastLaserCharge(
            setup.runtime, setup.definition, BOMBAST_LASER_CHARGING_STATE,
        ).accepted).toBeTrue();
        endTurn(setup.runtime, 'bombast:charged');

        const fired = setup.runtime.dispatch({
            type: 'fire-weapons',
            commandId: asCommandId('bombast:fire'),
            expectedRevision: setup.runtime.revision(),
            selections: [{ weaponId: setup.component.id }],
            heatPolicy: 'automatic',
        });

        expect(fired.accepted).toBeTrue();
        expect(componentBombastLaserLifecycle(setup.runtime, setup.definition))
            .toEqual({ chargeState: null, fired: true });
        expect(setup.runtime.query().turnState().weaponsHeat).toBe(12);
        expect(setup.handler.handleComponentBombastLaserSelection(
            setup.runtime,
            setup.definition,
            { label: 'Charge', value: BOMBAST_LASER_CHARGING_STATE },
            setup.commandContext,
        )).toBeTrue();
        expect(componentBombastLaserLifecycle(setup.runtime, setup.definition))
            .toEqual({ chargeState: null, fired: true });
        expect(setup.toast.showToast).toHaveBeenCalledWith(
            'A fired Bombast Laser cannot charge this turn.',
            'error',
        );

        endTurn(setup.runtime, 'bombast:clear-fired');
        expect(componentBombastLaserLifecycle(setup.runtime, setup.definition))
            .toEqual({ chargeState: null, fired: false });
    });

    it('allows a charged laser to be manually discharged', () => {
        const setup = directBombastSetup();
        expect(setComponentBombastLaserCharge(
            setup.runtime, setup.definition, BOMBAST_LASER_CHARGING_STATE,
        ).accepted).toBeTrue();
        endTurn(setup.runtime, 'bombast:manual-discharge-ready');

        expect(setup.handler.handleComponentBombastLaserSelection(
            setup.runtime,
            setup.definition,
            { label: 'Discharge', value: 'discharged' },
            setup.commandContext,
        )).toBeTrue();
        expect(componentBombastLaserLifecycle(setup.runtime, setup.definition))
            .toEqual({ chargeState: null, fired: false });
        expect(setup.toast.showToast).toHaveBeenCalledWith('Bombast Laser discharged', 'info');
    });
});

function directBombastSetup() {
    const fixture = createDirectBombastRuntimeFixture();
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
        handler: new BombastLaserHandler(),
        toast,
        queryContext: createHandlerQueryContext(fixture.equipment),
        commandContext: createHandlerCommandContext(fixture.equipment, toast, dialogs),
    };
}

type DirectBombastSetup = ReturnType<typeof directBombastSetup>;

function projectedRow(setup: DirectBombastSetup) {
    const row = projectMekEquipmentComponents(
        setup.fixture.entity,
        setup.fixture.index,
        setup.fixture.instance.ruleset(),
        setup.runtime.query(),
    ).find(candidate => candidate.componentId === setup.component.id);
    if (row?.weapon === undefined) throw new Error('Missing projected Bombast weapon');
    return row;
}

function projectedWeapon(setup: DirectBombastSetup) {
    return projectedRow(setup).weapon!;
}

function canFire(setup: DirectBombastSetup): boolean {
    return canPerformMekAction(
        setup.fixture.entity,
        setup.fixture.index,
        setup.runtime.query(),
        { kind: 'component', componentId: setup.component.id },
        'fire',
        setup.fixture.instance.ruleset(),
    );
}

function endTurn(runtime: CBTUnitInstance, commandId: string): void {
    expect(runtime.dispatch({
        type: 'end-turn',
        commandId: asCommandId(commandId),
        expectedRevision: runtime.revision(),
        policy: 'automatic',
    }).accepted).toBeTrue();
}
