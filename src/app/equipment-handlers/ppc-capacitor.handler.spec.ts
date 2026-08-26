// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    componentPpcCapacitorDefinition,
    componentPpcCapacitorFacts,
    ppcCapacitorChargedForWeapon,
    ppcCapacitorWeaponTypes,
    setComponentPpcCapacitorCharge,
} from '../models/runtime/component-ppc-capacitor';
import { canPerformMekAction } from '../models/runtime/mek-action-availability';
import { projectMekEquipmentComponents } from '../models/runtime/equipment-panel';
import { asCommandId } from '../models/runtime/runtime-state';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import type { CBTUnitInstance } from '../models/runtime/unit-instance';
import type { WeaponType } from '../models/weapon-types.model';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import {
    PPC_CAPACITOR_CHARGED_STATE,
    PPC_CAPACITOR_CHARGING_STATE,
    PpcCapacitorHandler,
} from '../models/runtime/component-ppc-capacitor';

describe('PpcCapacitorHandler direct V2 runtime', () => {
    it('charges for one turn, blocks firing, then applies the charged effects', () => {
        const setup = directPpcSetup();

        expect(setup.handler.getComponentPpcCapacitorChoices(
            setup.runtime, setup.definition, setup.queryContext,
        ))
            .toEqual([jasmine.objectContaining({
                label: 'Charge Capacitor', shortLabel: 'Charge',
                value: PPC_CAPACITOR_CHARGING_STATE, active: false, disabled: false,
            })]);
        expect(setup.handler.handleComponentPpcCapacitorSelection(
            setup.runtime,
            setup.definition,
            { label: 'Charge', value: PPC_CAPACITOR_CHARGING_STATE },
            setup.commandContext,
        )).toBeTrue();
        expect(componentPpcCapacitorFacts(setup.runtime, setup.definition).chargeState)
            .toBe(PPC_CAPACITOR_CHARGING_STATE);
        expect(canFire(setup)).toBeFalse();
        expect(projectedWeapon(setup)).toEqual(jasmine.objectContaining({ damage: 5, heat: 5 }));
        expect(heatSources(setup)).toContain(jasmine.objectContaining({
            id: `ppc-capacitor:${setup.weapon.id}`,
            label: 'PPC Capacitor', value: 5,
        }));

        endTurn(setup.runtime, 'ppc:end-charge');

        expect(componentPpcCapacitorFacts(setup.runtime, setup.definition).chargeState)
            .toBe(PPC_CAPACITOR_CHARGED_STATE);
        expect(canFire(setup)).toBeTrue();
        expect(projectedWeapon(setup)).toEqual(jasmine.objectContaining({ damage: 10, heat: 10 }));
        const baseTypes = new Set<WeaponType>(['DE']);
        expect([...ppcCapacitorWeaponTypes(baseTypes, ppcCapacitorChargedForWeapon(
            setup.fixture.entity,
            setup.fixture.index,
            setup.runtime.query(),
            setup.weapon.id,
        ))])
            .toEqual(['DE', 'X']);
        expect([...baseTypes]).toEqual(['DE']);
        expect(heatSources(setup)).toContain(jasmine.objectContaining({
            id: `ppc-capacitor:${setup.weapon.id}`,
            label: 'PPC Capacitor', value: 5,
            replacedByFiringEntryId: setup.weapon.id,
        }));
    });

    it('discharges atomically with accepted weapon fire and rejects charging again that turn', () => {
        const setup = directPpcSetup();
        expect(setComponentPpcCapacitorCharge(
            setup.runtime, setup.definition, PPC_CAPACITOR_CHARGING_STATE,
        ).accepted).toBeTrue();
        endTurn(setup.runtime, 'ppc:end-before-fire');

        const fired = setup.runtime.dispatch({
            type: 'fire-weapons',
            commandId: asCommandId('ppc:fire'),
            expectedRevision: setup.runtime.revision(),
            selections: [{ weaponId: setup.weapon.id }],
            heatPolicy: 'automatic',
        });

        expect(fired.accepted).toBeTrue();
        expect(componentPpcCapacitorFacts(setup.runtime, setup.definition))
            .toEqual(jasmine.objectContaining({
            chargeState: null,
            firedThisTurn: true,
        }));
        expect(setup.handler.handleComponentPpcCapacitorSelection(
            setup.runtime,
            setup.definition,
            { label: 'Charge', value: PPC_CAPACITOR_CHARGING_STATE },
            setup.commandContext,
        )).toBeTrue();
        expect(componentPpcCapacitorFacts(setup.runtime, setup.definition).chargeState).toBeNull();
        expect(setup.toast.showToast).toHaveBeenCalledWith(
            'A fired PPC cannot charge its capacitor this turn.',
            'error',
        );
    });

    it('does not apply charged effects when the capacitor becomes unavailable', () => {
        const setup = directPpcSetup();
        expect(setComponentPpcCapacitorCharge(
            setup.runtime, setup.definition, PPC_CAPACITOR_CHARGING_STATE,
        ).accepted).toBeTrue();
        endTurn(setup.runtime, 'ppc:end-before-destroy');
        expect(setup.runtime.dispatch({
            type: 'set-component-status',
            commandId: asCommandId('ppc:destroy-capacitor'),
            expectedRevision: setup.runtime.revision(),
            componentId: setup.capacitor.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();

        const types = new Set<WeaponType>(['DE']);
        expect(setup.handler.getComponentPpcCapacitorChoices(
            setup.runtime, setup.definition, setup.queryContext,
        )).toEqual([]);
        expect(projectedWeapon(setup)).toEqual(jasmine.objectContaining({ damage: 5, heat: 5 }));
        expect(ppcCapacitorWeaponTypes(types, ppcCapacitorChargedForWeapon(
            setup.fixture.entity,
            setup.fixture.index,
            setup.runtime.query(),
            setup.weapon.id,
        ))).toBe(types);
    });
});

function directPpcSetup() {
    const fixture = createDirectMekRuntimeFixture();
    const capacitor = [...fixture.index.components.values()].find(component =>
        component.kind === 'equipment' && component.mount.equipmentId === 'Test PPC Capacitor');
    const weapon = [...fixture.index.components.values()].find(component =>
        component.kind === 'equipment' && component.mount.equipmentId === 'Test PPC');
    if (!capacitor || capacitor.kind !== 'equipment' || !weapon || weapon.kind !== 'equipment') {
        throw new Error('Missing direct PPC fixture components');
    }
    const runtime = fixture.instance;
    const definition = componentPpcCapacitorDefinition(
        fixture.entity,
        fixture.index,
        capacitor.id,
        weapon.id,
    );
    const toast = toastService();
    return {
        fixture,
        capacitor,
        weapon,
        runtime,
        definition,
        handler: new PpcCapacitorHandler(),
        toast,
        queryContext: createHandlerQueryContext(fixture.equipment),
        commandContext: createHandlerCommandContext(fixture.equipment, toast, dialogsService()),
    };
}

type DirectPpcSetup = ReturnType<typeof directPpcSetup>;

function projectedWeapon(setup: DirectPpcSetup) {
    const row = projectMekEquipmentComponents(
        setup.fixture.entity,
        setup.fixture.index,
        setup.fixture.instance.ruleset(),
        setup.runtime.query(),
    ).find(candidate => candidate.componentId === setup.weapon.id);
    if (row?.weapon === undefined) throw new Error('Missing projected PPC weapon');
    return row.weapon;
}

function heatSources(setup: DirectPpcSetup) {
    const projection = setup.runtime.query().heatProjection('automatic');
    if (projection.kind !== 'supported') throw new Error('Missing PPC heat projection');
    return projection.projection.committedSources;
}

function canFire(setup: DirectPpcSetup): boolean {
    return canPerformMekAction(
        setup.fixture.entity,
        setup.fixture.index,
        setup.runtime.query(),
        { kind: 'component', componentId: setup.weapon.id },
        'fire',
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

function toastService(): HandlerToastService & { showToast: jasmine.Spy } {
    return { showToast: jasmine.createSpy('showToast'), toasts: () => [] };
}

function dialogsService(): HandlerDialogsService {
    return {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    };
}
