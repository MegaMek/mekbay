// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import type { CBTForce } from '../models/cbt-force.model';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { asCommandId, asUnitInstanceId } from '../models/runtime/runtime-state';
import type { CBTUnitCommand } from '../models/runtime/unit-instance';
import {
    createDirectExplosionRuntimeFixture,
    createDirectMekRuntimeFixture,
    type DirectMekRuntimeFixture,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import { CBTAutomationService } from './cbt-automation.service';
import { DirectMekAutomationService } from './direct-mek-automation.service';
import { OptionsService } from './options.service';

describe('DirectMekAutomationService', () => {
    let resolveAutomation: jasmine.Spy;
    let service: DirectMekAutomationService;

    beforeEach(() => {
        resolveAutomation = jasmine.createSpy('resolve').and.callFake(
            async (_key: string, events: readonly { readonly id: string }[]) =>
                new Set(events.map(event => event.id)),
        );
        TestBed.configureTestingModule({
            providers: [
                DirectMekAutomationService,
                { provide: CBTAutomationService, useValue: { resolve: resolveAutomation } },
                {
                    provide: OptionsService,
                    useValue: {
                        options: () => ({ CBTOptionalRules: { floatingCriticals: false } }),
                    },
                },
            ],
        });
        service = TestBed.inject(DirectMekAutomationService);
    });

    it('selects automatic or manual heat settlement from the configured review result', async () => {
        const harness = createHarness();
        const automatic = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',
            commandId: asCommandId('automation:heat:yes'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            policy: 'manual',
        });

        expect(automatic.command).toEqual(jasmine.objectContaining({
            type: 'end-turn',
            policy: 'automatic',
        }));
        expect(resolveAutomation).toHaveBeenCalledWith(
            'heatAndDissipationResolution',
            jasmine.any(Array),
            jasmine.any(Object),
        );

        resolveAutomation.and.callFake(async () => new Set<string>());
        const manual = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',
            commandId: asCommandId('automation:heat:no'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            policy: 'automatic',
        });
        expect(manual.command).toEqual(jasmine.objectContaining({
            type: 'end-turn',
            policy: 'manual',
        }));
    });

    it('reviews an ammunition explosion and applies pilot hits as separate typed commands', async () => {
        const harness = createHarness('total-warfare');
        const critical = explosiveCriticalCommand(harness.fixture);
        const before = harness.snapshot();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, critical);

        expect(prepared.command).toEqual(jasmine.objectContaining({
            type: 'apply-mek-critical-roll',
            applyExplosion: true,
            applyPilotHits: false,
            settlePendingExplosion: true,
        }));
        expect(prepared.deferredPilotHits).toBeGreaterThan(0);

        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const result = harness.fixture.instance.dispatch(prepared.command);
        expect(result.accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        );

        expect(harness.fixture.instance.query().crewState(pilotId).wounds)
            .toBe(prepared.deferredPilotHits);
        expect(resolveAutomation.calls.allArgs().map(args => args[0])).toContain('internalExplosionsCheck');
        expect(resolveAutomation.calls.allArgs().map(args => args[0])).toContain('pilotHitsAndConsciousnessCheck');
    });

    it('carries Total Warfare CASE II into each secondary explosion critical check', async () => {
        const instanceId = asUnitInstanceId('unit:automation:case-ii');
        const fixture = createDirectExplosionRuntimeFixture(
            'total-warfare',
            { protection: 'case-ii' },
            instanceId,
        );
        const harness = createHarnessForFixture(fixture, 'total-warfare', instanceId);
        const critical = explosiveCriticalCommand(fixture, 'case-ii');
        const before = harness.snapshot();
        const prepared = await service.prepareCommand(harness.force, instanceId, critical);
        const result = fixture.instance.dispatch(prepared.command);
        expect(result.accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);

        await service.afterCommand(
            harness.force,
            instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        );

        const chanceEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'criticalHitChanceCheck')
            .flatMap(args => args[1] as readonly { readonly effects?: readonly string[] }[]);
        expect(chanceEvents.length).toBeGreaterThan(0);
        expect(chanceEvents.some(event => event.effects?.some(effect =>
            effect.includes('CASE II check') && effect.includes('critical discarded')))).toBeTrue();
    });

    it('dismisses disabled phase PSRs and completes the boundary', async () => {
        const harness = createHarness('total-warfare');
        resolveAutomation.and.callFake(async () => new Set<string>());
        const slot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',
            commandId: asCommandId('automation:psr:hit'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const before = harness.snapshot();
        const phaseCommand: CBTUnitCommand = {
            type: 'end-phase',
            commandId: asCommandId('automation:psr:phase'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
        };
        const phaseResult = harness.fixture.instance.dispatch(phaseCommand);
        expect(phaseResult.accepted).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks().some(check =>
            check.status === 'pending')).toBeTrue();

        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            { command: phaseCommand, deferredPilotHits: 0 },
            phaseResult,
            harness.dispatch,
        );

        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveAutomation.calls.allArgs().map(args => args[0])).toContain('pilotSkillCheck');
    });

    it('skips a destroyed-location critical chance when no explosive slot remains', async () => {
        const harness = createHarness();
        const location = [...harness.fixture.index.locations.values()]
            .find(candidate => candidate.code === 'LL')!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-internal',
            commandId: asCommandId('automation:destroyed-inert-location'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            locationId: location.id,
            amount: harness.fixture.instance.query().remainingInternal(location.id, 'committed'),
            target: 'committed',
        };
        const result = harness.fixture.instance.dispatch(command);
        expect(result.accepted).toBeTrue();

        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            { command, deferredPilotHits: 0 },
            result,
            harness.dispatch,
        );

        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('criticalHitChanceCheck');
    });

    it('consumes a destroyed-location critical that rolls a non-explosive slot', async () => {
        const instanceId = asUnitInstanceId('unit:automation:destroyed-explosive-location');
        const fixture = createDirectExplosionRuntimeFixture('core-2026', {}, instanceId);
        const harness = createHarnessForFixture(fixture, 'core-2026', instanceId);
        const location = [...fixture.index.locations.values()]
            .find(candidate => candidate.code === 'RT')!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-internal',
            commandId: asCommandId('automation:destroyed-explosive-location'),
            expectedRevision: fixture.instance.query().stateRevision,
            locationId: location.id,
            amount: fixture.instance.query().remainingInternal(location.id, 'committed'),
            target: 'committed',
        };
        const result = fixture.instance.dispatch(command);
        expect(result.accepted).toBeTrue();

        const rolls = Array.from({ length: 6 }, (_unused, first) =>
            Array.from({ length: 6 }, (_ignored, second) => [first + 1, second + 1] as const))
            .flat();
        const explosive = rolls.filter(dice => {
            const plan = fixture.instance.query().mekCriticalRoll(location.id, dice, 'committed');
            return plan.kind === 'applied' && (plan.explosion !== undefined || plan.pendingExplosion !== undefined);
        });
        const inert = rolls.find(dice => {
            const plan = fixture.instance.query().mekCriticalRoll(location.id, dice, 'committed');
            return plan.kind !== 'applied' || (plan.explosion === undefined && plan.pendingExplosion === undefined);
        });
        expect(explosive.length).toBeGreaterThan(0);
        expect(inert).toBeDefined();
        const criticalHitsBefore = [...fixture.index.slots.values()].map(slot =>
            fixture.instance.query().criticalHits(slot.id, 'committed'));
        const random = [d6Random(4), d6Random(4), ...inert!.map(d6Random)];
        let randomIndex = 0;
        spyOn(Math, 'random').and.callFake(() => random[randomIndex++] ?? 0);

        await service.afterCommand(
            harness.force,
            instanceId,
            before,
            { command, deferredPilotHits: 0 },
            result,
            harness.dispatch,
        );

        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .toContain('criticalHitChanceCheck');
        expect([...fixture.index.slots.values()].map(slot =>
            fixture.instance.query().criticalHits(slot.id, 'committed')))
            .toEqual(criticalHitsBefore);
    });
});

function createHarness(ruleset: 'core-2026' | 'total-warfare' = 'core-2026') {
    const instanceId = asUnitInstanceId(`unit:automation:${ruleset}`);
    const fixture = createDirectMekRuntimeFixture(ruleset, instanceId);
    return createHarnessForFixture(fixture, ruleset, instanceId);
}

function createHarnessForFixture(
    fixture: DirectMekRuntimeFixture,
    ruleset: 'core-2026' | 'total-warfare',
    instanceId: ReturnType<typeof asUnitInstanceId>,
) {
    const snapshot = (): CBTUnitSnapshot => Object.freeze({
        instanceId,
        entity: fixture.entity,
        index: fixture.index,
        sourceRef: fixture.identity,
        ruleset,
        state: fixture.instance.snapshot(),
        query: fixture.instance.query(),
    });
    const force = { getUnitSnapshot: () => snapshot() } as unknown as CBTForce;
    const dispatch = async (command: CBTUnitCommand) => fixture.instance.dispatch(command);
    return { fixture, force, instanceId, snapshot, dispatch };
}

function explosiveCriticalCommand(
    fixture: DirectMekRuntimeFixture,
    protection?: 'case' | 'case-ii',
): CBTUnitCommand {
    for (const location of fixture.index.locations.values()) {
        const profile = fixture.instance.query().mekCriticalRollProfile(location.id, 'committed');
        for (const results of profile.validRolls) {
            const plan = fixture.instance.query().mekCriticalRoll(location.id, results, 'committed');
            if (plan.kind === 'applied'
                && (plan.explosion || plan.pendingExplosion)
                && (protection === undefined
                    || plan.explosion?.locations.some(locationDamage =>
                        locationDamage.protection === protection))) {
                return {
                    type: 'apply-mek-critical-roll',
                    commandId: asCommandId('automation:critical:explosion'),
                    expectedRevision: fixture.instance.query().stateRevision,
                    locationId: location.id,
                    results,
                    target: 'committed',
                };
            }
        }
    }
    throw new Error('The direct Mek fixture has no explosive critical slot');
}

function d6Random(result: number): number {
    return (result - 0.5) / 6;
}
