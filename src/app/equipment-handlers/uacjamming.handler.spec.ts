// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../models/cbt-ruleset.model';
import { EQUIPMENT_DISABLED_CHOICE_VALUE } from '../models/component-control-choice';
import { createComponentJamDefinition } from '../models/runtime/component-jam';
import { rapidFireAutocannonSupportsJamming } from '../models/runtime/component-rapid-fire-autocannon';
import { asCommandId } from '../models/runtime/runtime-state';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import { UACJammingHandler } from '../models/runtime/component-rapid-fire-autocannon';

describe('direct UAC jamming handler', () => {
    it('jams and unjams an Ultra AC under Total Warfare', () => {
        const fixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        const component = fixture.equipmentComponent('Test AC');
        const equipment = component.mount.equipment;
        if (!equipment) throw new Error('Test AC equipment is missing');
        const runtime = fixture.instance;
        const handler = new UACJammingHandler();
        const definition = createComponentJamDefinition({
            componentId: component.id,
            displayName: equipment.name,
            flags: equipment.flags,
            supportsJamming: rapidFireAutocannonSupportsJamming(fixture.index, component.id, TOTAL_WARFARE_RULESET),
        });
        const toast: HandlerToastService = {
            showToast: jasmine.createSpy('showToast'),
            toasts: () => [],
        };
        const dialogs = {
            createDialog: jasmine.createSpy('createDialog'),
            showError: jasmine.createSpy('showError'),
            showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
        } as HandlerDialogsService;
        const queryContext = createHandlerQueryContext(fixture.equipment);
        const commandContext = createHandlerCommandContext(fixture.equipment, toast, dialogs);

        expect(handler.applicableToComponentJam(definition)).toBeTrue();
        const jam = handler.getComponentJamChoices(runtime, definition, queryContext)[0]!;
        expect(jam).toEqual(jasmine.objectContaining({
            label: 'Jam',
            shortLabel: 'Jam',
            value: EQUIPMENT_DISABLED_CHOICE_VALUE,
            active: false,
        }));
        expect(handler.handleComponentJamSelection(runtime, definition, jam, commandContext)).toBeTrue();
        expect(runtime.query().componentJammed(component.id)).toBeTrue();
        expect(toast.showToast).toHaveBeenCalledWith('Test AC is jammed', 'error');

        const unjam = handler.getComponentJamChoices(runtime, definition, queryContext)[0]!;
        expect(unjam).toEqual(jasmine.objectContaining({
            label: 'Jammed',
            shortLabel: 'Unjam',
            value: 'false',
            active: true,
        }));
        expect(handler.handleComponentJamSelection(runtime, definition, unjam, commandContext)).toBeTrue();
        expect(runtime.query().componentJammed(component.id)).toBeFalse();
        expect(toast.showToast).toHaveBeenCalledWith('Test AC is unjammed', 'info');
    });

    it('rejects Ultra AC jamming under Core rules', () => {
        const fixture = createDirectMekRuntimeFixture(CORE_2026_RULESET);
        const component = fixture.equipmentComponent('Test AC');
        const equipment = component.mount.equipment;
        if (!equipment) throw new Error('Test AC equipment is missing');
        const runtime = fixture.instance;
        const handler = new UACJammingHandler();
        const definition = createComponentJamDefinition({
            componentId: component.id,
            displayName: equipment.name,
            flags: equipment.flags,
            supportsJamming: rapidFireAutocannonSupportsJamming(fixture.index, component.id, CORE_2026_RULESET),
        });

        expect(handler.applicableToComponentJam(definition)).toBeFalse();
        expect(runtime.dispatch({
            type: 'set-component-jammed',
            commandId: asCommandId('core:uac-jam'),
            expectedRevision: runtime.revision(),
            componentId: component.id,
            jammed: true,
        })).toEqual(jasmine.objectContaining({ accepted: false, reason: 'INVALID_TARGET' }));
    });
});
