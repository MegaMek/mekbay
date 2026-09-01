// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../models/cbt-ruleset.model';
import {
    componentEscalatingFailureFacts,
    componentEscalatingFailureDefinition,
    selectComponentEscalatingFailureSequence,
    setComponentEscalatingFailureStatus,
} from '../models/runtime/component-escalating-failure';
import {
    createDirectEscalatingFailureRuntimeFixture,
    type DirectMekRuntimeFixture,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import {
    BlueShieldHandler,
    EscalatingFailureHandler,
    RadicalHeatSinkHandler,
    RiscEmergencyCoolantSystemHandler,
    RiscViralJammerHandler,
} from '../models/runtime/component-escalating-failure';

describe('additional escalating-failure handlers with direct V2 runtime', () => {
    it('uses every ruleset-specific production sequence without a five-step cap', () => {
        const core = createDirectEscalatingFailureRuntimeFixture('core-2026');
        const tw = createDirectEscalatingFailureRuntimeFixture('total-warfare');

        expect(labels(core, 'Test Radical Heat Sink', new RadicalHeatSinkHandler()))
            .toEqual(['3+', '5+', '7+', '10+', '11+']);
        expect(labels(tw, 'Test Radical Heat Sink', new RadicalHeatSinkHandler()))
            .toEqual(['3+', '5+', '7+', '10+', '11+', '!!']);
        expect(labels(core, 'Test Blue Shield', new BlueShieldHandler()))
            .toEqual(['1', '2', '3', '4', '5', '3+', '5+', '7+', '10+', '11+']);
        expect(labels(tw, 'Test Blue Shield', new BlueShieldHandler()).length).toBe(17);
        expect(labels(tw, 'Test RISC Emergency Coolant', new RiscEmergencyCoolantSystemHandler()))
            .toEqual(['3+', '5+', '7+', '10+', '!!']);
        expect(labels(tw, 'Test RISC Viral Jammer', new RiscViralJammerHandler()))
            .toEqual(['4+', '5+', '6+', '7+', '8+', '9+', '10+', '11+', '12+', '!!']);
    });

    it('reuses the final target and applies recovery only to systems that recover', () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture();
        const blue = setup(fixture, 'Test Blue Shield', new BlueShieldHandler());
        for (let index = 0; index < blue.definition.targets.length; index += 1) {
            expect(selectComponentEscalatingFailureSequence(blue.runtime, blue.definition, index).accepted).toBeTrue();
        }
        expect(endTurn(blue, 'blue:first-end')).toBeTrue();
        expect(componentEscalatingFailureFacts(blue.runtime, blue.definition))
            .toEqual(jasmine.objectContaining({ sequence: 10, active: false }));
        expect(selectComponentEscalatingFailureSequence(blue.runtime, blue.definition, 9).accepted).toBeTrue();
        expect(componentEscalatingFailureFacts(blue.runtime, blue.definition))
            .toEqual(jasmine.objectContaining({ sequence: 10, active: true }));
        expect(endTurn(blue, 'blue:repeat-end')).toBeTrue();
        endTurn(blue, 'blue:no-recovery');
        expect(componentEscalatingFailureFacts(blue.runtime, blue.definition).sequence).toBe(10);

        const coolant = setup(fixture, 'Test RISC Emergency Coolant', new RiscEmergencyCoolantSystemHandler());
        expect(selectComponentEscalatingFailureSequence(coolant.runtime, coolant.definition, 0).accepted).toBeTrue();
        expect(selectComponentEscalatingFailureSequence(coolant.runtime, coolant.definition, 0).accepted).toBeTrue();
        expect(endTurn(coolant, 'coolant:recovery')).toBeTrue();
        expect(componentEscalatingFailureFacts(coolant.runtime, coolant.definition).sequence).toBe(0);
    });

    it('adds active Radical Heat Sink cooling in the heat kernel', () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture();
        const radical = setup(fixture, 'Test Radical Heat Sink', new RadicalHeatSinkHandler());
        const before = fixture.instance.query().heatProjection('automatic');
        expect(before.kind).toBe('supported');

        expect(selectComponentEscalatingFailureSequence(radical.runtime, radical.definition, 0).accepted).toBeTrue();
        const active = fixture.instance.query().heatProjection('automatic');
        expect(active.kind).toBe('supported');
        if (before.kind === 'supported' && active.kind === 'supported') {
            expect(active.projection.capacity - before.projection.capacity).toBe(10);
        }

        expect(setComponentEscalatingFailureStatus(radical.runtime, radical.definition, 'disabled').accepted).toBeTrue();
        const failed = fixture.instance.query().heatProjection('automatic');
        expect(failed.kind).toBe('supported');
        if (before.kind === 'supported' && failed.kind === 'supported') {
            expect(failed.projection.capacity).toBe(before.projection.capacity);
        }
    });

    it('adds committed coolant leaks for movement and selected weapons', () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture();
        const coolant = setup(fixture, 'Test RISC Emergency Coolant', new RiscEmergencyCoolantSystemHandler());
        expect(setComponentEscalatingFailureStatus(coolant.runtime, coolant.definition, 'disabled').accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement',
            
            
            declaration: {
                schemaVersion: 1,
                mode: 'walk',
                distance: 1,
                boosterComponentIds: [],
            },
        }).accepted).toBeTrue();
        const turn = fixture.instance.query().turnState();
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state',
            
            
            turn: { ...turn, weaponsHeat: 1 },
        }).accepted).toBeTrue();

        const projection = fixture.instance.query().heatProjection('automatic');
        expect(projection.kind).toBe('supported');
        if (projection.kind === 'supported') {
            expect(projection.projection.committedSources.filter(source =>
                source.id.includes('risc-emergency-coolant')).map(source => source.value)).toEqual([1, 1]);
        }
    });

    it('adds active Viral Jammer heat and retains its sequence when unused', () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture();
        const viral = setup(fixture, 'Test RISC Viral Jammer', new RiscViralJammerHandler());
        expect(selectComponentEscalatingFailureSequence(viral.runtime, viral.definition, 0).accepted).toBeTrue();

        const projection = fixture.instance.query().heatProjection('automatic');
        expect(projection.kind).toBe('supported');
        if (projection.kind === 'supported') {
            expect(projection.projection.committedSources).toContain(jasmine.objectContaining({
                label: 'RISC Viral Jammer',
                value: 12,
            }));
        }

        expect(endTurn(viral, 'viral:active-end')).toBeTrue();
        expect(endTurn(viral, 'viral:unused-end')).toBeTrue();
        expect(componentEscalatingFailureFacts(viral.runtime, viral.definition))
            .toEqual(jasmine.objectContaining({ sequence: 1, active: false }));
    });
});

function labels(
    fixture: DirectMekRuntimeFixture,
    equipmentId: string,
    handler: EscalatingFailureHandler,
): string[] {
    const context = setup(fixture, equipmentId, handler);
    return handler.getComponentEscalatingFailureChoices(
        context.runtime,
        context.definition,
        context.queryContext,
    )
        .filter(choice => choice.failureTarget !== undefined)
        .map(choice => choice.label);
}

function setup(
    fixture: DirectMekRuntimeFixture,
    equipmentId: string,
    handler: EscalatingFailureHandler,
) {
    const component = fixture.equipmentComponent(equipmentId);
    const runtime = fixture.instance;
    const definition = componentEscalatingFailureDefinition(
        fixture.index,
        component.id,
        fixture.instance.ruleset(),
    );
    return {
        definition,
        handler,
        runtime,
        queryContext: createHandlerQueryContext(fixture.equipment, 'turn-summary'),
        commandContext: createHandlerCommandContext(
            fixture.equipment,
            toastService(),
            dialogsService(),
        ),
    };
}

function endTurn(
    setupValue: ReturnType<typeof setup>,
    commandId: string,
): boolean {
    return setupValue.runtime.dispatch({
        type: 'end-turn',
        
        
        policy: 'automatic',
    }).accepted;
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
