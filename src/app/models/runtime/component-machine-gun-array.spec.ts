// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { EquipmentInteractionRegistry } from '../../services/equipment-interaction-registry.service';
import type {
    EquipmentInteractionDialogsService,
    EquipmentInteractionNotifications,
} from './equipment-interaction';
import { emptyCBTEncounterSnapshot } from './encounter-runtime';
import { projectMekEquipmentPanel } from './equipment-panel';
import {
    MachineGunArrayHandler,
    MGA_LINKED_MODE,
    MGA_LINKING_MODE,
    MGA_OFF_MODE,
    MGA_UNLINKING_MODE,
} from './component-machine-gun-array';
import { createDirectMachineGunArrayRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('direct machine-gun-array runtime', () => {
    it('projects immutable controller/member topology from the Entity and keeps linking in runtime state', () => {
        const fixture = createDirectMachineGunArrayRuntimeFixture();
        const entityBay = fixture.entity.equipmentBays()
            .find(candidate => candidate.kind === 'machine-gun-array');
        const indexedBay = machineGunArrayBay(fixture);
        if (!entityBay?.controller) throw new Error('Entity machine-gun-array bay is missing');

        const indexedController = fixture.index.components.get(indexedBay.controllerId!);
        expect(indexedController?.kind).toBe('equipment');
        expect(indexedController?.kind === 'equipment' ? indexedController.mount : undefined)
            .toBe(entityBay.controller);
        expect(indexedBay.memberIds.map(id => {
            const component = fixture.index.components.get(id);
            return component?.kind === 'equipment' ? component.mount : undefined;
        })).toEqual(entityBay.mounts);

        const topologyBefore = fixture.entity.equipmentBays()[0];
        expect(fixture.instance.dispatch({
            type: 'set-component-mode',
            
            
            componentId: indexedBay.controllerId!,
            mode: MGA_UNLINKING_MODE,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-phase',
            
            
        }).accepted).toBeTrue();

        expect(fixture.entity.equipmentBays()[0]).toBe(topologyBefore);
        expect(machineGunArrayBay(fixture)).toBe(indexedBay);
        expect(fixture.instance.query().componentMode(indexedBay.controllerId!)).toBe(MGA_OFF_MODE);
    });

    it('owns one explicit Entity bay and starts with only its controller selectable', () => {
        const fixture = createDirectMachineGunArrayRuntimeFixture();
        const bay = machineGunArrayBay(fixture);
        const panel = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );

        expect(bay.memberIds.length).toBe(3);
        expect(fixture.instance.query().componentMode(bay.controllerId!)).toBe(MGA_LINKED_MODE);
        expect(panel().components.find(row => row.componentId === bay.controllerId)?.weapon?.selectable)
            .toBeTrue();
        expect(bay.memberIds.map(id => panel().components.find(row => row.componentId === id)?.weapon?.selectable))
            .toEqual([false, false, false]);
    });

    it('keeps transitions effective until End Phase and allows cancelling them', async () => {
        const fixture = createDirectMachineGunArrayRuntimeFixture();
        const controllerId = machineGunArrayBay(fixture).controllerId!;
        const registry = new EquipmentInteractionRegistry();
        registry.register(new MachineGunArrayHandler());
        const owner = { instanceId: fixture.instance.id, encounter: emptyCBTEncounterSnapshot };
        const queryContext = {};
        const commandContext = {
            toastService: toastService(),
            dialogsService: dialogsService(),
        };
        const choice = () => registry.choices(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            owner,
            queryContext,
        ).find(candidate => candidate.componentId === controllerId)!;

        expect(choice().choice).toEqual(jasmine.objectContaining({
            label: 'Array linked',
            value: MGA_UNLINKING_MODE,
            active: true,
        }));
        expect(await registry.select(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            owner,
            choice(),
            queryContext,
            commandContext,
        )).toBeTrue();
        expect(fixture.instance.snapshot().components.get(controllerId)?.mode).toBe(MGA_UNLINKING_MODE);
        expect(fixture.instance.query().componentMode(controllerId)).toBe(MGA_LINKED_MODE);
        expect(fixture.instance.query().turnState().phaseStateChanged).toBeTrue();

        expect(choice().choice).toEqual(jasmine.objectContaining({
            label: 'Unlinks at End Phase…',
            value: MGA_LINKED_MODE,
            active: true,
        }));
        expect(await registry.select(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            owner,
            choice(),
            queryContext,
            commandContext,
        )).toBeTrue();
        expect(fixture.instance.snapshot().components.get(controllerId)?.mode).toBeUndefined();

        expect(await registry.select(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            owner,
            choice(),
            queryContext,
            commandContext,
        )).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-phase',
            
            
        }).accepted).toBeTrue();
        expect(fixture.instance.snapshot().components.get(controllerId)?.mode).toBe(MGA_OFF_MODE);
        expect(fixture.instance.query().componentMode(controllerId)).toBe(MGA_OFF_MODE);

        expect(choice().choice.value).toBe(MGA_LINKING_MODE);
        expect(await registry.select(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            owner,
            choice(),
            queryContext,
            commandContext,
        )).toBeTrue();
        expect(fixture.instance.query().componentMode(controllerId)).toBe(MGA_OFF_MODE);
        expect(fixture.instance.dispatch({
            type: 'end-phase',
            
            
        }).accepted).toBeTrue();
        expect(fixture.instance.query().componentMode(controllerId)).toBe(MGA_LINKED_MODE);
        expect(fixture.instance.snapshot().components.get(controllerId)?.mode).toBeUndefined();
    });

    it('fires every working member atomically and releases members when unlinked', () => {
        const fixture = createDirectMachineGunArrayRuntimeFixture();
        const bay = machineGunArrayBay(fixture);
        const controllerId = bay.controllerId!;
        const ammo = fixture.equipmentComponent('Test MG Ammo');
        const munitionKey = fixture.instance.query().ammoLoadout(ammo.id).munitionKey;

        expect(fixture.instance.dispatch({
            type: 'fire-weapons',
            
            
            heatPolicy: 'manual',
            selections: [{
                weaponId: controllerId,
                ammoSourceId: ammo.id,
                expectedMunitionKey: munitionKey,
            }],
        }).accepted).toBeTrue();
        expect(fixture.instance.query().remainingAmmo(ammo.id)).toBe(17);

        expect(fixture.instance.dispatch({
            type: 'configure-ammo-source',
            
            
            componentId: ammo.id,
            munitionKey,
            remaining: 2,
        }).accepted).toBeTrue();
        const beforeRevision = fixture.instance.revision();
        expect(fixture.instance.dispatch({
            type: 'fire-weapons',
            
            
            heatPolicy: 'manual',
            selections: [{
                weaponId: controllerId,
                ammoSourceId: ammo.id,
                expectedMunitionKey: munitionKey,
            }],
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(fixture.instance.revision()).toBe(beforeRevision);
        expect(fixture.instance.query().remainingAmmo(ammo.id)).toBe(2);

        expect(fixture.instance.dispatch({
            type: 'set-component-mode',
            
            
            componentId: controllerId,
            mode: MGA_UNLINKING_MODE,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-phase',
            
            
        }).accepted).toBeTrue();
        const panel = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        expect(panel.components.find(row => row.componentId === controllerId)?.weapon?.selectable).toBeFalse();
        expect(bay.memberIds.map(id => panel.components.find(row => row.componentId === id)?.weapon?.selectable))
            .toEqual([true, true, true]);
    });
});

function machineGunArrayBay(fixture: ReturnType<typeof createDirectMachineGunArrayRuntimeFixture>) {
    const bay = fixture.index.relationships.bays.find(candidate => candidate.kind === 'machine-gun-array');
    if (!bay?.controllerId) throw new Error('Fixture machine-gun-array bay is missing');
    return bay;
}

function toastService(): EquipmentInteractionNotifications {
    return {
        showToast: jasmine.createSpy('showToast'),
    };
}

function dialogsService(): EquipmentInteractionDialogsService {
    return {
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    };
}
