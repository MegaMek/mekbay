// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { componentModeDefinition } from '../models/runtime/component-mode';
import { createDirectVibrobladeRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import {
    VibrobladeHandler,
} from '../models/runtime/component-vibroblade';
import { VIBROBLADE_OFF_MODE, VIBROBLADE_ON_MODE } from '../models/vibroblade-mode.model';

describe('direct Vibroblade handler', () => {
    it('selects the entity-defined mode through the whole-unit runtime', () => {
        const fixture = createDirectVibrobladeRuntimeFixture();
        const component = fixture.equipmentComponent('Test Small Vibroblade');
        const runtime = fixture.instance;
        const definition = componentModeDefinition(
            fixture.entity,
            fixture.index,
            component.id,
            fixture.instance.ruleset(),
        );
        const handler = new VibrobladeHandler();
        const toast: HandlerToastService = {
            showToast: jasmine.createSpy('showToast'),
            toasts: () => [],
        };
        const dialogs = {
            createDialog: jasmine.createSpy('createDialog'),
            showError: jasmine.createSpy('showError'),
            showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
        } as HandlerDialogsService;

        expect(handler.applicableToComponent(definition)).toBeTrue();
        expect(handler.getComponentModeChoices(
            runtime,
            definition,
            createHandlerQueryContext(fixture.equipment),
        )).toEqual([{
            label: 'Mode',
            value: VIBROBLADE_OFF_MODE,
            displayType: 'dropdown',
            choices: [
                { label: VIBROBLADE_ON_MODE, value: VIBROBLADE_ON_MODE },
                { label: VIBROBLADE_OFF_MODE, value: VIBROBLADE_OFF_MODE },
            ],
            keepOpen: true,
        }]);
        expect(handler.handleComponentModeSelection(
            runtime,
            definition,
            { label: VIBROBLADE_ON_MODE, value: VIBROBLADE_ON_MODE },
            createHandlerCommandContext(fixture.equipment, toast, dialogs),
        )).toBeTrue();
        expect(runtime.query().componentMode(component.id)).toBe(VIBROBLADE_ON_MODE);
    });
});
