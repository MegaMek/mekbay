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
    let automationModes: Record<string, 'yes' | 'no' | 'ask'>;

    beforeEach(() => {
        automationModes = {
            heatAndDissipationResolution: 'yes',
            heatEffectsCheck: 'ask',
            pilotHitsAndConsciousnessCheck: 'ask',
        };
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
                        cbtAutomationMode: (key: string) => automationModes[key] ?? 'ask',
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

    it('cancels end turn instead of silently converting a closed heat review to manual', async () => {
        const harness = createHarness();
        resolveAutomation.and.resolveTo(null);
        const command: CBTUnitCommand = {
            type: 'end-turn',
            commandId: asCommandId('automation:heat:cancel'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            policy: 'automatic',
        };

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(resolveAutomation).toHaveBeenCalledWith(
            'heatAndDissipationResolution',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('cancels during heat-effect preflight before the turn reducer runs', async () => {
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',
            commandId: asCommandId('automation:effects:cancel:set'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            heat: 40,
        }).accepted).toBeTrue();
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) =>
            key === 'heatEffectsCheck' ? null : new Set(events.map(event => event.id)));
        const command: CBTUnitCommand = {
            type: 'end-turn',
            commandId: asCommandId('automation:effects:cancel:end'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            policy: 'automatic',
        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(resolveAutomation).toHaveBeenCalledWith(
            'heatEffectsCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('uses one force-wide review when heat, effects, and pilot hits all ask', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',
            commandId: asCommandId('automation:combined:set'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            heat: 40,
        }).accepted).toBeTrue();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',
            commandId: asCommandId('automation:combined:end'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            policy: 'manual',
        });

        expect(prepared.cancelled).toBeUndefined();
        expect(resolveAutomation).toHaveBeenCalledTimes(1);
        expect(resolveAutomation.calls.argsFor(0)[0]).toBe('heatAndDissipationResolution');
        expect(resolveAutomation.calls.argsFor(0)[1][0]).toEqual(jasmine.objectContaining({
            event: 'Heat, dissipation, effects, and pilot hits',
            effects: jasmine.arrayContaining([jasmine.stringMatching(/^Heat Shutdown Check:/)]),
        }));
    });

    it('reviews every Mek in one end-turn heat batch before committing any turn', async () => {
        const leftId = asUnitInstanceId('unit:automation:batch:left');
        const rightId = asUnitInstanceId('unit:automation:batch:right');
        const left = createHarnessForFixture(
            createDirectMekRuntimeFixture('core-2026', leftId),
            'core-2026',
            leftId,
        );
        const right = createHarnessForFixture(
            createDirectMekRuntimeFixture('core-2026', rightId),
            'core-2026',
            rightId,
        );
        const force = {
            getUnitSnapshot: (instanceId: typeof leftId) => instanceId === leftId
                ? left.snapshot()
                : instanceId === rightId ? right.snapshot() : null,
        } as unknown as CBTForce;
        const requests = [left, right].map(harness => ({
            instanceId: harness.instanceId,
            command: {
                type: 'end-turn' as const,
                commandId: asCommandId(`automation:batch:${harness.instanceId}`),
                expectedRevision: harness.fixture.instance.query().stateRevision,
                policy: 'manual' as const,
            },
        }));

        const prepared = await service.prepareEndTurnCommands(force, requests);

        expect(prepared).not.toBeNull();
        expect(prepared).toHaveSize(2);
        const calls = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatAndDissipationResolution');
        expect(calls).toHaveSize(1);
        expect(calls[0][1]).toHaveSize(2);
        expect(calls[0][2]).toEqual(jasmine.objectContaining({ allowCancel: true }));
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

    it('cancels an ammunition explosion review before applying the critical roll', async () => {
        const harness = createHarness('total-warfare');
        const critical = explosiveCriticalCommand(harness.fixture);
        const revisionBefore = harness.fixture.instance.query().stateRevision;
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) =>
            key === 'internalExplosionsCheck' ? null : new Set(events.map(event => event.id)));

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            critical,
        );

        expect(prepared.cancelled).toBeTrue();
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(resolveAutomation).toHaveBeenCalledWith(
            'internalExplosionsCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('groups a unit\'s end-turn heat checks into one review entry', async () => {
        const harness = createHarness('total-warfare');
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',
            commandId: asCommandId('automation:grouped-heat:set'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const command: CBTUnitCommand = {
            type: 'end-turn',
            commandId: asCommandId('automation:grouped-heat:end'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            policy: 'manual',
        };
        const before = harness.snapshot();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(settled).not.toBeNull();
        const result = harness.fixture.instance.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();

        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            settled!,
            result,
            harness.dispatch,
        );

        const heatEffectCalls = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck');
        expect(heatEffectCalls).toHaveSize(1);
        const events = heatEffectCalls[0][1] as readonly {
            readonly event: string;
            readonly effects?: readonly string[];
        }[];
        expect(events).toHaveSize(1);
        expect(events[0].event).toBe('Heat effects and pilot hits');
        expect(events[0].effects).toContain(jasmine.stringMatching(/^Heat Shutdown Check:/));
    });

    it('settles reviewed heat consequences before resetting the turn', async () => {
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',
            commandId: asCommandId('automation:ordered-heat:set'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const turn = harness.fixture.instance.query().turnState().turnCounter;
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',
            commandId: asCommandId('automation:ordered-heat:end'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            policy: 'manual',
        });

        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeTrue();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn);
        const result = harness.fixture.instance.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn + 1);
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
        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            phaseCommand,
        );
        const phaseResult = harness.fixture.instance.dispatch(prepared.command);
        expect(phaseResult.accepted).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks().some(check =>
            check.status === 'pending')).toBeTrue();

        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            prepared,
            phaseResult,
            harness.dispatch,
        );

        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveAutomation.calls.allArgs().map(args => args[0])).toContain('pilotSkillCheck');
    });

    it('keeps pending combat uncommitted when the phase PSR review is cancelled', async () => {
        const harness = createHarness('total-warfare');
        const slot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',
            commandId: asCommandId('automation:psr:cancel:hit'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const phaseCommand: CBTUnitCommand = {
            type: 'end-phase',
            commandId: asCommandId('automation:psr:cancel:phase'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;
        const pendingBefore = harness.fixture.instance.query().hasPendingCombat();
        expect(pendingBefore).toBeTrue();
        resolveAutomation.and.resolveTo(null);

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            phaseCommand,
        );

        expect(prepared.cancelled).toBeTrue();
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(harness.fixture.instance.query().hasPendingCombat()).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveAutomation).toHaveBeenCalledWith(
            'pilotSkillCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('reviews and resolves the durable Core torso check at the phase boundary', async () => {
        const harness = createHarness('core-2026');
        const torso = [...harness.fixture.index.locations.values()]
            .find(location => location.code === 'LT')!;
        expect(harness.fixture.instance.dispatch({
            type: 'damage-internal',
            commandId: asCommandId('automation:torso-check:damage'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            locationId: torso.id,
            amount: torso.internalPoints,
            target: 'committed',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'end-phase',
            commandId: asCommandId('automation:torso-check:phase'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
        };

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            command,
        );
        const result = harness.fixture.instance.dispatch(prepared.command);
        expect(result.accepted).toBeTrue();
        expect(await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        )).toBeTrue();

        expect(harness.fixture.instance.query().hasCondition('crippled')).toBeTrue();
        const events = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotSkillCheck')
            .flatMap(args => args[1] as readonly { readonly event: string }[]);
        expect(events).toContain(jasmine.objectContaining({
            event: 'Crippling Destruction Check',
        }));
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
