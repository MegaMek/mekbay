// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    createDirectMekRuntimeFixture,
    emptyCBTEncounterSnapshot,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import { EquipmentInteractionRegistry } from '../services/equipment-interaction-registry.service';
import type {
    EquipmentInteractionDialogsService,
    EquipmentInteractionNotifications,
} from '../models/runtime/equipment-interaction';
import {
    C3_CONFIGURATION_CHOICE,
    C3_HANDLER_ID,
    C3Handler,
} from '../models/runtime/component-c3-configuration';

describe('C3Handler direct V2 navigation', () => {
    it('offers the production Configure action only for canonical C3 equipment', () => {
        const fixture = createDirectMekRuntimeFixture();
        const c3 = fixture.equipmentComponent('Test C3 Emergency Master');
        const ordinary = fixture.equipmentComponent('Test AC');
        const handler = new C3Handler();
        const c3Equipment = c3.mount.equipment;
        const ordinaryEquipment = ordinary.mount.equipment;
        if (!c3Equipment || !ordinaryEquipment) throw new Error('Direct C3 fixture equipment is missing');

        expect(handler.applicableToComponentC3Configuration(c3Equipment.flags)).toBeTrue();
        expect(handler.applicableToComponentC3Configuration(ordinaryEquipment.flags)).toBeFalse();
        expect(handler.getComponentC3ConfigurationChoices(
            {},
        )).toEqual([jasmine.objectContaining({
            label: 'Configure',
            value: C3_CONFIGURATION_CHOICE,
            action: 'configure-network',
            readOnlySafe: true,
            displayType: 'button',
        })]);
    });

    it('routes navigation through the force callback without changing unit runtime', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const component = fixture.equipmentComponent('Test C3 Emergency Master');
        const registry = new EquipmentInteractionRegistry();
        const handler = new C3Handler();
        registry.register(handler);
        const queryContext = {};
        const configure = jasmine.createSpy('configureC3Network');
        const commandContext = {
            toastService: toastService(),
            dialogsService: dialogsService(),
            configureC3Network: configure,
        };
        const owner = {
            instanceId: fixture.instance.id,
            encounter: emptyCBTEncounterSnapshot,
        };
        const choice = registry.choices(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            owner,
            queryContext,
        ).find(candidate => candidate.kind === 'c3-configuration'
            && candidate.componentId === component.id);
        if (!choice) throw new Error('Direct C3 fixture did not expose Configure');
        const revision = fixture.instance.revision();

        expect(choice.handler.id).toBe(C3_HANDLER_ID);
        expect(await registry.select(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            owner,
            choice,
            queryContext,
            commandContext,
        )).toBeTrue();
        expect(configure).toHaveBeenCalledOnceWith();
        expect(fixture.instance.revision()).toBe(revision);
    });
});

function toastService(): EquipmentInteractionNotifications {
    return { showToast: jasmine.createSpy('showToast') };
}

function dialogsService(): EquipmentInteractionDialogsService {
    return {
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    };
}
