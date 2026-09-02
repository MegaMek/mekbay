// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../models/cbt-ruleset.model';
import { componentModeDefinition } from '../models/runtime/component-mode';
import {
    FlamerHandler,
} from '../models/runtime/component-flamer';
import { FLAMER_DAMAGE_MODE, FLAMER_HEAT_MODE } from '../models/flamer-mode.model';
import { projectMekEquipmentPanel } from '../models/runtime/equipment-panel';
import {
    createDirectFlamerRuntimeFixture,
    createDirectMekRuntimeFixture,
    emptyCBTEncounterSnapshot,
    type DirectMekRuntimeFixture,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import type {
    EquipmentInteractionDialogsService,
    EquipmentInteractionNotifications,
} from '../models/runtime/equipment-interaction';
import { UACFiringModeHandler } from '../models/runtime/component-rapid-fire-autocannon';

describe('direct weapon mode handlers', () => {
    it('ports the Total Warfare Flamer Damage/Heat selector', () => {
        const setup = handlerSetup(createDirectFlamerRuntimeFixture(TOTAL_WARFARE_RULESET), 'Test Flamer');
        const handler = new FlamerHandler();

        expect(setup.definition.modes).toEqual([FLAMER_DAMAGE_MODE, FLAMER_HEAT_MODE]);
        expect(handler.applicableToComponent(setup.definition)).toBeTrue();
        expect(handler.getComponentModeChoices(setup.runtime, setup.definition, setup.queryContext)).toEqual([{
            label: 'Mode',
            value: FLAMER_DAMAGE_MODE,
            displayType: 'dropdown',
            choices: [
                { label: FLAMER_DAMAGE_MODE, value: FLAMER_DAMAGE_MODE },
                { label: FLAMER_HEAT_MODE, value: FLAMER_HEAT_MODE },
            ],
            keepOpen: true,
        }]);
        expect(handler.handleComponentModeSelection(
            setup.runtime,
            setup.definition,
            { label: FLAMER_HEAT_MODE, value: FLAMER_HEAT_MODE },
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe(FLAMER_HEAT_MODE);
        expect(setup.row().label).toBe('Test Flamer (Heat)');
    });

    it('does not offer Flamer modes under Core rules', () => {
        const setup = handlerSetup(createDirectFlamerRuntimeFixture(CORE_2026_RULESET), 'Test Flamer');
        expect(new FlamerHandler().applicableToComponent(setup.definition)).toBeFalse();
        expect(setup.definition.modes).toEqual([]);
    });

    it('ports the UAC/RAC firing-mode selector to sparse component mode', () => {
        const setup = handlerSetup(createDirectMekRuntimeFixture(), 'Test AC');
        const handler = new UACFiringModeHandler();

        expect(handler.applicableToComponent(setup.definition)).toBeTrue();
        expect(handler.getComponentModeChoices(setup.runtime, setup.definition, setup.queryContext)[0])
            .toEqual(jasmine.objectContaining({
                label: 'Mode',
                value: 'Single',
                choices: [{ label: 'Single', value: 'Single' }, { label: 'Rapid', value: 'Rapid' }],
            }));
        expect(handler.handleComponentModeSelection(
            setup.runtime,
            setup.definition,
            { label: 'Rapid', value: 'Rapid' },
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.query().componentMode(setup.component.id)).toBe('Rapid');
        expect(setup.row()).toEqual(jasmine.objectContaining({
            label: 'Test AC (Rapid)',
            weapon: jasmine.objectContaining({ heat: 1, firingHeat: 2 }),
        }));
    });
});

function handlerSetup(fixture: DirectMekRuntimeFixture, equipmentId: string) {
    const component = fixture.equipmentComponent(equipmentId);
    const runtime = fixture.instance;
    const definition = componentModeDefinition(
        fixture.entity,
        fixture.index,
        component.id,
        fixture.instance.ruleset(),
    );
    const toast: EquipmentInteractionNotifications = {
        showToast: jasmine.createSpy('showToast'),
    };
    const dialogs = {
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    } as EquipmentInteractionDialogsService;
    return {
        fixture,
        component,
        runtime,
        definition,
        queryContext: {},
        commandContext: { toastService: toast, dialogsService: dialogs },
        row: () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            runtime.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(candidate => candidate.componentId === component.id)!,
    };
}
