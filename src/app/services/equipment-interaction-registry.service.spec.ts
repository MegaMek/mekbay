// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InventoryModeHandler } from '../models/runtime/component-inventory-mode';
import { UACJammingHandler } from '../models/runtime/component-rapid-fire-autocannon';
import { emptyCBTEncounterSnapshot } from '../models/runtime/encounter-runtime';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { TOTAL_WARFARE_RULESET } from '../models/cbt-ruleset.model';
import {
    EquipmentInteractionRegistry,
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
    type V2EquipmentInteractionChoiceBinding,
} from './equipment-interaction-registry.service';

describe('EquipmentInteractionRegistry direct V2 boundary', () => {
    it('enumerates and applies real handler choices against one parsed entity runtime', async () => {
        const fixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        const runtime = fixture.instance;
        const registry = new EquipmentInteractionRegistry();
        registry.register(new InventoryModeHandler());
        registry.register(new UACJammingHandler());
        const queryContext = createHandlerQueryContext(fixture.equipment);
        const commandContext = createHandlerCommandContext(
            fixture.equipment,
            toastService(),
            dialogsService(),
        );
        const owner = {
            instanceId: fixture.instance.id,
            encounter: emptyCBTEncounterSnapshot,
        };
        const choices = registry.getV2EquipmentInteractionChoices(
            runtime, fixture.entity, fixture.index, fixture.instance.ruleset(), owner, queryContext,
        );
        const forEquipment = (kind: V2EquipmentInteractionChoiceBinding['kind'], equipmentId: string) =>
            choices.find(choice => {
                const component = fixture.index.components.get(choice.componentId);
                return choice.kind === kind
                    && component?.kind === 'equipment'
                    && component.mount.equipmentId === equipmentId;
            })!;

        const jam = forEquipment('jam', 'Test AC');
        expect(await registry.handleV2EquipmentInteractionChoice(
            runtime, fixture.entity, fixture.index, fixture.instance.ruleset(), owner,
            jam, queryContext, commandContext,
        )).toBeTrue();
        expect(runtime.query().componentJammed(jam.componentId)).toBeTrue();

        const inventory = forEquipment('inventory-mode', 'Test MML');
        const alternative = inventory.choice.choices?.find(option => option.value !== inventory.choice.value);
        if (!alternative) throw new Error('MML fixture needs an alternate inventory mode');
        const selection: V2EquipmentInteractionChoiceBinding = {
            ...inventory,
            choice: { ...alternative, _handler: inventory.handler },
        };
        expect(await registry.handleV2EquipmentInteractionChoice(
            runtime, fixture.entity, fixture.index, fixture.instance.ruleset(), owner,
            selection, queryContext, commandContext,
        )).toBeTrue();
        expect(runtime.query().componentMode(inventory.componentId)).toBe(String(alternative.value));
    });

    it('rejects duplicate handler IDs', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(new UACJammingHandler());
        spyOn(console, 'error');
        expect(() => registry.register(new UACJammingHandler())).toThrowError(/already registered/u);
    });
});

function toastService(): HandlerToastService {
    return {
        showToast: jasmine.createSpy('showToast'),
        toasts: () => [],
    };
}

function dialogsService(): HandlerDialogsService {
    return {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    };
}
