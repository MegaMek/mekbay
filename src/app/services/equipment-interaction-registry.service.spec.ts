// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InventoryModeHandler } from '../models/runtime/component-inventory-mode';
import { UACJammingHandler } from '../models/runtime/component-rapid-fire-autocannon';
import { EscalatingFailureHandler } from '../models/runtime/component-escalating-failure';
import { emptyCBTEncounterSnapshot } from '../models/runtime/encounter-runtime';
import {
    createDirectEscalatingFailureRuntimeFixture,
    createDirectMekRuntimeFixture,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import { TOTAL_WARFARE_RULESET } from '../models/cbt-ruleset.model';
import { EquipmentInteractionRegistry } from './equipment-interaction-registry.service';
import type {
    EquipmentInteractionChoiceBinding,
    EquipmentInteractionDialogsService,
    EquipmentInteractionNotifications,
} from '../models/runtime/equipment-interaction';

describe('EquipmentInteractionRegistry direct V2 boundary', () => {
    it('enumerates and applies real handler choices against one parsed entity runtime', async () => {
        const fixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        const runtime = fixture.instance;
        const registry = new EquipmentInteractionRegistry();
        registry.register(new InventoryModeHandler());
        registry.register(new UACJammingHandler());
        const queryContext = {};
        const commandContext = {
            toastService: toastService(),
            dialogsService: dialogsService(),
        };
        const owner = {
            instanceId: fixture.instance.id,
            encounter: emptyCBTEncounterSnapshot,
        };
        const choices = registry.choices(
            runtime, fixture.entity, fixture.index, fixture.instance.ruleset(), owner, queryContext,
        );
        const forEquipment = (kind: EquipmentInteractionChoiceBinding['kind'], equipmentId: string) =>
            choices.find(choice => {
                const component = fixture.index.components.get(choice.componentId);
                return choice.kind === kind
                    && component?.kind === 'equipment'
                    && component.mount.equipmentId === equipmentId;
            })!;

        const jam = forEquipment('jam', 'Test AC');
        expect(await registry.select(
            runtime, fixture.entity, fixture.index, fixture.instance.ruleset(), owner,
            jam, queryContext, commandContext,
        )).toBeTrue();
        expect(runtime.query().componentJammed(jam.componentId)).toBeTrue();

        const inventory = forEquipment('inventory-mode', 'Test MML');
        const alternative = inventory.choice.choices?.find(option => option.value !== inventory.choice.value);
        if (!alternative) throw new Error('MML fixture needs an alternate inventory mode');
        const selection: EquipmentInteractionChoiceBinding = {
            ...inventory,
            choice: alternative,
        };
        expect(await registry.select(
            runtime, fixture.entity, fixture.index, fixture.instance.ruleset(), owner,
            selection, queryContext, commandContext,
        )).toBeTrue();
        expect(runtime.query().componentMode(inventory.componentId)).toBe(String(alternative.value));
    });

    it('rejects duplicate handler IDs', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(new UACJammingHandler());
        expect(() => registry.register(new UACJammingHandler())).toThrowError(/already registered/u);
    });

    it('offers every escalating-failure family through one registered behavior', () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture(TOTAL_WARFARE_RULESET);
        const registry = new EquipmentInteractionRegistry();
        registry.register(new EscalatingFailureHandler());

        const choices = registry.choices(
            fixture.instance,
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            { instanceId: fixture.instance.id, encounter: emptyCBTEncounterSnapshot },
            {},
        );

        const equipmentIds = new Set(choices.flatMap(choice => {
            const component = fixture.index.components.get(choice.componentId);
            return component?.kind === 'equipment' ? [component.mount.equipmentId] : [];
        }));
        expect(equipmentIds).toEqual(new Set([
            'Test MASC',
            'Test Radical Heat Sink',
            'Test Blue Shield',
            'Test RISC Emergency Coolant',
            'Test RISC Viral Jammer',
        ]));
    });
});

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
