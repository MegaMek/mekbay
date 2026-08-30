// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { canPerformMekAction } from './mek-action-availability';
import type { ComponentId } from '../entity/entity-identifiers';
import { evaluateMekMechanicsScenarioSupport } from './mek-mechanics-profile';
import { MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION } from './mek-movement-psr-v2';
import { projectMekTurnPanel } from './mek-turn-panel';
import { createCommandId } from './runtime-state';
import {
    createDirectMekRuntimeFixture,
    createDirectSprintingEngineHeatRuntimeFixture,
    createDirectSprintingQuadRuntimeFixture,
    createDirectSprintingRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('direct optional Sprint rules', () => {
    it('fails closed unless the force scenario enables Sprint', () => {
        const fixture = createDirectMekRuntimeFixture();
        const movement = supportedMovement(fixture);
        const sprint = movement.actions.find(action => action.kind === 'sprint')!;

        expect(sprint.maximumMp).toBe(0);
        expect(sprint.legal).toBeFalse();
        expect(sprint.reasons.map(reason => reason.code)).toContain('OPTION_DISABLED');
        expect(declareSprint(fixture, 10, [])).toBeFalse();

        expect(evaluateMekMechanicsScenarioSupport({
            id: 'megamek',
            options: { sprinting: true, forcedWithdrawal: false },
        })).toEqual({
            kind: 'supported',
            rules: { sprinting: true, forcedWithdrawal: false },
        });
    });

    it('projects Sprint distance, heat, modifiers, action restrictions, and atomic spotting cleanup', () => {
        const fixture = createDirectSprintingRuntimeFixture();
        const masc = fixture.equipmentComponent('Test MASC');
        const initial = supportedMovement(fixture);
        expect(initial).toEqual(jasmine.objectContaining({
            walkMp: 5,
            runMp: 8,
            sprintMp: 10,
            maximumSprintMp: 13,
        }));
        expect(initial.actions.find(action => action.kind === 'sprint')).toEqual(jasmine.objectContaining({
            legal: true,
            ordinaryMaximumMp: 10,
            maximumMp: 13,
        }));

        expect(fixture.instance.dispatch({
            type: 'replace-turn-state',
            commandId: createCommandId(),
            expectedRevision: fixture.instance.revision(),
            turn: { ...fixture.instance.query().turnState(), spotting: true },
        }).accepted).toBeTrue();
        expect(activate(fixture, masc.id)).toBeTrue();
        expect(declareSprint(fixture, 13, [masc.id])).toBeTrue();

        const movement = supportedMovement(fixture);
        expect(movement.pilotingTargetNumber).toBe(7);
        expect(movement.permanentPsrModifiers).toContain(jasmine.objectContaining({
            modifier: 2,
            reason: 'Sprinting',
        }));
        expect(fixture.instance.query().mekPilotChecks().map(check => check.reason)).toEqual([
            'Sprinting with MASC or supercharger',
        ]);
        expect(fixture.instance.query().turnState().spotting).toBeFalse();
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state',
            commandId: createCommandId(),
            expectedRevision: fixture.instance.revision(),
            turn: { ...fixture.instance.query().turnState(), spotting: true },
        }).accepted).toBeFalse();

        const heat = fixture.instance.query().heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.committedSources.find(source => source.id === 'movement')?.value).toBe(3);

        const panel = projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            'manual',
        );
        expect(panel.attackMovementModifiers.sprint).toBe(0);
        expect(panel.defenseModifierBreakdown).toContain({ label: 'Sprinting', modifier: -1 });

        const weapon = fixture.equipmentComponent('Test AC');
        expect(canPerformMekAction(
            fixture.entity,
            fixture.index,
            fixture.instance.query(),
            { kind: 'component', componentId: weapon.id },
            'fire',
            fixture.instance.ruleset(),
        )).toBeFalse();
        const physical = fixture.index.intrinsicActions[0]!;
        expect(canPerformMekAction(
            fixture.entity,
            fixture.index,
            fixture.instance.query(),
            { kind: 'intrinsic', actionId: physical.id },
            'physical-attack',
            fixture.instance.ruleset(),
        )).toBeFalse();
    });

    it('stacks MASC and Supercharger capacity and creates one PSR per enhancer family', () => {
        const fixture = createDirectSprintingRuntimeFixture('core-2026', true);
        const masc = fixture.equipmentComponent('Test MASC');
        const supercharger = fixture.equipmentComponent('Test Supercharger');

        expect(supportedMovement(fixture).maximumSprintMp).toBe(15);
        expect(activate(fixture, masc.id)).toBeTrue();
        expect(activate(fixture, supercharger.id)).toBeTrue();
        expect(declareSprint(fixture, 15, [masc.id, supercharger.id])).toBeTrue();
        expect(fixture.instance.query().mekPilotChecks().map(check => check.reason)).toEqual([
            'Sprinting with MASC',
            'Sprinting with supercharger',
        ]);
    });

    it('uses one-and-a-half times running heat, including XXL movement heat', () => {
        const fixture = createDirectSprintingEngineHeatRuntimeFixture('XXL');
        expect(declareSprint(fixture, 10, [])).toBeTrue();
        const heat = fixture.instance.query().heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.committedSources.find(source => source.id === 'movement')?.value).toBe(9);
    });

    it('requires a grounded, standing Mek with two working hips and ordinary Run MP', () => {
        const airborne = createDirectSprintingRuntimeFixture('core-2026', false, 'unit:sprint:airborne');
        expect(airborne.instance.dispatch({
            type: 'replace-turn-state',
            commandId: createCommandId(),
            expectedRevision: airborne.instance.revision(),
            turn: { ...airborne.instance.query().turnState(), airborne: true },
        }).accepted).toBeTrue();
        expect(sprintReasonCodes(airborne)).toContain('AIRBORNE');

        const prone = createDirectSprintingRuntimeFixture('core-2026', false, 'unit:sprint:prone');
        expect(prone.instance.dispatch({
            type: 'set-condition',
            commandId: createCommandId(),
            expectedRevision: prone.instance.revision(),
            condition: 'prone',
            active: true,
        }).accepted).toBeTrue();
        expect(sprintReasonCodes(prone)).toContain('PRONE');

        const hip = createDirectSprintingRuntimeFixture('core-2026', false, 'unit:sprint:hip');
        const leftHip = [...hip.index.slots.values()].find(slot =>
            hip.index.locations.get(slot.locationId)?.code === 'LL'
            && slot.componentIds.some(componentId => {
                const component = hip.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Hip';
            }))!;
        expect(hip.instance.dispatch({
            type: 'hit-critical',
            commandId: createCommandId(),
            expectedRevision: hip.instance.revision(),
            slotId: leftHip.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(sprintReasonCodes(hip)).toContain('INSUFFICIENT_HIPS');

        const quad = createDirectSprintingQuadRuntimeFixture();
        const legs = ['FLL', 'FRL'].map(code =>
            [...quad.index.locations.values()].find(location => location.code === code)!);
        for (const leg of legs) {
            expect(quad.instance.dispatch({
                type: 'damage-internal',
                commandId: createCommandId(),
                expectedRevision: quad.instance.revision(),
                locationId: leg.id,
                amount: leg.internalPoints,
                target: 'committed',
            }).accepted).toBeTrue();
        }
        const quadMovement = supportedMovement(quad);
        expect(quadMovement).toEqual(jasmine.objectContaining({ walkMp: 1, runMp: 0, sprintMp: 0 }));
        expect(sprintReasonCodes(quad)).toContain('RUN_UNAVAILABLE');
    });
});

function supportedMovement(fixture: DirectMekRuntimeFixture) {
    const movement = fixture.instance.query().mekMovementPsr();
    if (movement.kind !== 'supported') throw new Error('Sprint fixture movement is unsupported');
    return movement;
}

function sprintReasonCodes(fixture: DirectMekRuntimeFixture): readonly string[] {
    return supportedMovement(fixture).actions.find(action => action.kind === 'sprint')!
        .reasons.map(reason => reason.code);
}

function activate(fixture: DirectMekRuntimeFixture, componentId: ComponentId): boolean {
    return fixture.instance.dispatch({
        type: 'edit-escalating-failure',
        commandId: createCommandId(),
        expectedRevision: fixture.instance.revision(),
        componentId,
        edit: { kind: 'select-sequence', index: 0 },
    }).accepted;
}

function declareSprint(
    fixture: DirectMekRuntimeFixture,
    distance: number,
    boosterComponentIds: readonly ComponentId[],
): boolean {
    return fixture.instance.dispatch({
        type: 'declare-mek-movement',
        commandId: createCommandId(),
        expectedRevision: fixture.instance.revision(),
        declaration: {
            schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
            mode: 'sprint',
            distance,
            boosterComponentIds,
        },
    }).accepted;
}
