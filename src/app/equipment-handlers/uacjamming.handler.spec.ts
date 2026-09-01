// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../models/cbt-ruleset.model';
import {
    type ComponentJamDefinition,
    rapidFireAutocannonSupportsJamming,
    UAC_JAMMED_CHOICE_VALUE,
} from '../models/runtime/component-rapid-fire-autocannon';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import type {
    EquipmentInteractionDialogsService,
    EquipmentInteractionNotifications,
} from '../models/runtime/equipment-interaction';
import { UACJammingHandler } from '../models/runtime/component-rapid-fire-autocannon';

describe('direct UAC jamming handler', () => {
    it('jams and unjams an Ultra AC under Total Warfare', () => {
        const fixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        const component = fixture.equipmentComponent('Test AC');
        const equipment = component.mount.equipment;
        if (!equipment) throw new Error('Test AC equipment is missing');
        const runtime = fixture.instance;
        const handler = new UACJammingHandler();
        const definition: ComponentJamDefinition = Object.freeze({
            componentId: component.id,
            displayName: equipment.name,
            supportsJamming: rapidFireAutocannonSupportsJamming(fixture.index, component.id, TOTAL_WARFARE_RULESET),
        });
        const toast: EquipmentInteractionNotifications = {
            showToast: jasmine.createSpy('showToast'),
        };
        const dialogs = {
            showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
        } as EquipmentInteractionDialogsService;
        const queryContext = {};
        const commandContext = { toastService: toast, dialogsService: dialogs };

        expect(handler.applicableToComponentJam(definition)).toBeTrue();
        const jam = handler.getComponentJamChoices(runtime, definition, queryContext)[0]!;
        expect(jam).toEqual(jasmine.objectContaining({
            label: 'Jam',
            shortLabel: 'Jam',
            value: UAC_JAMMED_CHOICE_VALUE,
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

    it('ignores Ultra AC jamming under Core rules', () => {
        const fixture = createDirectMekRuntimeFixture(CORE_2026_RULESET);
        const component = fixture.equipmentComponent('Test AC');
        const equipment = component.mount.equipment;
        if (!equipment) throw new Error('Test AC equipment is missing');
        const runtime = fixture.instance;
        const handler = new UACJammingHandler();
        const definition: ComponentJamDefinition = Object.freeze({
            componentId: component.id,
            displayName: equipment.name,
            supportsJamming: rapidFireAutocannonSupportsJamming(fixture.index, component.id, CORE_2026_RULESET),
        });

        expect(handler.applicableToComponentJam(definition)).toBeFalse();
        expect(runtime.dispatch({
            type: 'set-component-jammed',
            
            
            componentId: component.id,
            jammed: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
    });
});
