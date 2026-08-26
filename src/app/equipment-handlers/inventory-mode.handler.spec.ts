// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { componentInventoryModeDefinition } from '../models/runtime/component-inventory-mode';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import { InventoryModeHandler } from '../models/runtime/component-inventory-mode';

describe('InventoryModeHandler direct V2 runtime', () => {
    it('defaults a parsed MML to SRM and persists a selected LRM mode in sparse state', () => {
        const setup = directModeSetup('Test MML');

        expect(setup.runtime.query().componentMode(setup.definition.componentId)).toBe('SRM');
        expect(setup.handler.getComponentInventoryModeChoices(
            setup.runtime,
            setup.definition,
            setup.queryContext,
        ))
            .toEqual([jasmine.objectContaining({
                label: 'Mode', value: 'SRM', displayType: 'dropdown', keepOpen: true,
                choices: [
                    { label: 'LRM', value: 'LRM', disabled: false },
                    { label: 'SRM', value: 'SRM', disabled: false },
                ],
            })]);

        expect(setup.handler.handleComponentInventoryModeSelection(
            setup.runtime,
            setup.definition,
            { label: 'LRM', value: 'LRM' },
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.query().componentMode(setup.definition.componentId)).toBe('LRM');
        expect(setup.fixture.index.components.get(setup.definition.componentId)).toBe(setup.component);
        expect(setup.component.mount.equipmentId).toBe('Test MML');
    });

    it('uses the closed ATM modes and rejects values outside them', () => {
        const setup = directModeSetup('Test ATM');

        expect(setup.runtime.query().componentMode(setup.definition.componentId)).toBe('Standard');
        expect(setup.handler.getComponentInventoryModeChoices(
            setup.runtime,
            setup.definition,
            setup.queryContext,
        )[0].choices)
            .toEqual(jasmine.arrayWithExactContents([
                { label: 'STD', value: 'Standard', disabled: false },
                { label: 'HE', value: 'High Explosive', disabled: false },
                { label: 'ER', value: 'Extended Range', disabled: false },
            ]));
        expect(setup.handler.handleComponentInventoryModeSelection(
            setup.runtime,
            setup.definition,
            { label: 'High Explosive', value: 'High Explosive' },
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.query().componentMode(setup.definition.componentId)).toBe('High Explosive');
        expect(setup.handler.handleComponentInventoryModeSelection(
            setup.runtime,
            setup.definition,
            { label: 'Invalid', value: 'Invalid' },
            setup.commandContext,
        )).toBeFalse();
        expect(setup.runtime.query().componentMode(setup.definition.componentId)).toBe('High Explosive');
    });
});

function directModeSetup(equipmentId: 'Test MML' | 'Test ATM') {
    const fixture = createDirectMekRuntimeFixture();
    const component = [...fixture.index.components.values()].find(candidate =>
        candidate.kind === 'equipment' && candidate.mount.equipmentId === equipmentId);
    if (!component || component.kind !== 'equipment') throw new Error(`Missing ${equipmentId} fixture component`);
    const runtime = fixture.instance;
    return {
        fixture,
        component,
        runtime,
        definition: componentInventoryModeDefinition(fixture.index, component.id),
        handler: new InventoryModeHandler(),
        queryContext: createHandlerQueryContext(fixture.equipment),
        commandContext: createHandlerCommandContext(
            fixture.equipment,
            toastService(),
            dialogsService(),
        ),
    };
}

function toastService(): HandlerToastService {
    return { showToast: jasmine.createSpy('showToast'), toasts: () => [] };
}

function dialogsService(): HandlerDialogsService {
    return {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    };
}
