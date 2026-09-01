// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import { resolveAutomaticFallingDamage } from '../components/falling-damage-dialog/falling-damage-dialog.component';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import type { CBTUnitCommand } from '../models/runtime/unit-instance';
import {
    createDirectExplosionRuntimeFixture,
    createDirectMekRuntimeFixture,
    createDirectTripodRuntimeFixture,
    type DirectMekRuntimeFixture,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import { CBTAutomationService } from './cbt-automation.service';
import { CBTAutomationCheckService, resolveAutomationChecksAutomatically } from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { DirectMekAutomationService, type DirectMekAutomationDispatch } from './direct-mek-automation.service';
import { OptionsService } from './options.service';
import { MekFallingAutomationService } from './mek-falling-automation.service';

describe('DirectMekAutomationService', () => {
    let resolveAutomation: jasmine.Spy;
    let resolveChecksAutomation: jasmine.Spy;
    let resolveFalling: jasmine.Spy;
    let showAutomationToast: jasmine.Spy;
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
        resolveChecksAutomation = jasmine.createSpy('resolveChecks').and.callFake(
            async (_key: string, checks: Parameters<typeof resolveAutomationChecksAutomatically>[0], options: {
                readonly initiallyFailedGroups?: ReadonlySet<string>;
            }) => resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups),
        );
        resolveFalling = jasmine.createSpy('resolveFalling').and.callFake(
            async data => resolveAutomaticFallingDamage(data),
        );
        showAutomationToast = jasmine.createSpy('show');
        TestBed.configureTestingModule({
            providers: [
                DirectMekAutomationService,
                { provide: CBTAutomationService, useValue: { resolve: resolveAutomation } },
                { provide: CBTAutomationCheckService, useValue: { resolve: resolveChecksAutomation } },
                { provide: MekFallingAutomationService, useValue: { resolve: resolveFalling } },
                { provide: CBTAutomationToastService, useValue: { show: showAutomationToast } },
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

    it('reports automatically resolved heat through the shared automation notifier', async () => {
        const harness = createHarness();
        setPendingHeat(harness, 10);
        const projection = harness.fixture.instance.query().heatProjection('automatic');
        expect(projection.kind).toBe('supported');
        const projectedHeat = projection.kind === 'supported'
            ? projection.projection.projected
            : 0;
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


            policy: 'manual',
        });

        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();
        expect(showAutomationToast).toHaveBeenCalledOnceWith(
            String(harness.instanceId),
            jasmine.any(String),
            `Heat and dissipation: Heat 0 → ${projectedHeat}`,
            'info',
        );
    });

    it('selects automatic or manual heat settlement from the configured review result', async () => {
        const harness = createHarness();
        setPendingHeat(harness, 10);
        const automatic = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


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


            policy: 'automatic',
        });
        expect(manual.command).toEqual(jasmine.objectContaining({
            type: 'end-turn',
            policy: 'manual',
        }));
    });

    it('discards a skipped heat arrow but commits it when heat automation is disabled', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        resolveAutomation.and.resolveTo(new Set<string>());
        const skippedHarness = createHarness();
        setPendingHeat(skippedHarness, 10);
        const skipped = await service.prepareCommand(skippedHarness.force, skippedHarness.instanceId, {
            type: 'end-turn',


            policy: 'manual',
        });

        expect(await service.settleBeforeCommand(
            skippedHarness.force,
            skippedHarness.instanceId,
            skipped,
            skippedHarness.dispatch,
        )).not.toBeNull();
        expect(skippedHarness.fixture.instance.query().heatState().current).toBe(0);
        expect(skippedHarness.fixture.instance.query().heatState().pendingOverride).toBeUndefined();

        automationModes['heatAndDissipationResolution'] = 'no';
        const manualHarness = createHarness();
        setPendingHeat(manualHarness, 10);
        const manual = await service.prepareCommand(manualHarness.force, manualHarness.instanceId, {
            type: 'end-turn',


            policy: 'manual',
        });

        expect(await service.settleBeforeCommand(
            manualHarness.force,
            manualHarness.instanceId,
            manual,
            manualHarness.dispatch,
        )).not.toBeNull();
        expect(manualHarness.fixture.instance.query().heatState().current).toBe(10);
        expect(manualHarness.fixture.instance.query().heatState().pendingOverride).toBeUndefined();
    });

    it('completes a heatless end turn when heat settlement is already a no-op', async () => {
        const harness = createHarness();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });

        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(settled).not.toBeNull();
        const result = harness.fixture.instance.dispatch(settled!.command);

        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(1);
        const heatReview = resolveAutomation.calls.allArgs()
            .find(args => args[0] === 'heatAndDissipationResolution');
        expect(heatReview?.[1]).toEqual([]);
    });

    it('cancels end turn instead of silently converting a closed heat review to manual', async () => {
        const harness = createHarness();
        resolveAutomation.and.resolveTo(null);
        const command: CBTUnitCommand = {
            type: 'end-turn',


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


            heat: 40,
        }).accepted).toBeTrue();
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) =>
            key === 'heatEffectsCheck' ? null : new Set(events.map(event => event.id)));
        const command: CBTUnitCommand = {
            type: 'end-turn',


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

    it('cancels the dedicated heat checks without mutating the turn', async () => {
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',


            heat: 40,
        }).accepted).toBeTrue();
        resolveChecksAutomation.and.callFake(async (key: string) =>
            key === 'heatEffectsCheck' ? null : []);
        const command: CBTUnitCommand = {
            type: 'end-turn',


            policy: 'automatic',
        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(resolveChecksAutomation).toHaveBeenCalledWith(
            'heatEffectsCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ title: 'Resolve Pending Checks' }),
        );
    });

    it('does not turn a manual shutdown toggle into a Piloting Skill Roll', async () => {
        const harness = createHarness('total-warfare');
        const command: CBTUnitCommand = {
            type: 'set-mek-shutdown-state',


            shutdown: true,
        };
        const before = harness.snapshot();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);
        const result = harness.fixture.instance.dispatch(prepared.command);
        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        );

        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveAutomation).not.toHaveBeenCalled();
    });

    it('does not invent a shutdown PSR at the next phase after a manual shutdown', async () => {
        const harness = createHarness('total-warfare');
        const shutdown: CBTUnitCommand = {
            type: 'set-mek-shutdown-state',


            shutdown: true,
        };
        expect(harness.fixture.instance.dispatch(shutdown).accepted).toBeTrue();

        await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });

        const pilotSkillEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotSkillCheck')
            .flatMap(args => args[1] as readonly { readonly event: string }[]);
        expect(pilotSkillEvents).toEqual([]);
    });

    it('cancels a failed manual PSR before changing the check or applying a fall', async () => {
        const harness = createHarness('total-warfare');
        const foot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: foot.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        const check = harness.fixture.instance.query().mekPilotChecks()[0]!;
        const command: CBTUnitCommand = {
            type: 'resolve-mek-pilot-check',


            checkId: check.checkId,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;
        resolveFalling.and.resolveTo(null);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared.cancelled).toBeTrue();
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(harness.fixture.instance.query().mekPilotChecks()[0]?.status).toBe('pending');
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeFalse();
    });

    it('applies fall consequences after a failed manual PSR is accepted', async () => {
        const harness = createHarness('total-warfare');
        const foot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: foot.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        const check = harness.fixture.instance.query().mekPilotChecks()[0]!;
        const durability = () => [...harness.fixture.index.locations.values()]
            .reduce((total, location) => total
                + harness.fixture.instance.query().remainingInternal(location.id)
                + location.armorFaceIds.reduce((armor, faceId) =>
                    armor + harness.fixture.instance.query().remainingArmor(faceId), 0), 0);
        const beforeDamage = durability();
        const command: CBTUnitCommand = {
            type: 'resolve-mek-pilot-check',


            checkId: check.checkId,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        };
        spyOn(Math, 'random').and.returnValue(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);
        const result = harness.fixture.instance.dispatch(prepared.command);
        expect(await service.afterCommand(
            harness.force,
            harness.instanceId,
            harness.snapshot(),
            prepared,
            result,
            harness.dispatch,
        )).toBeTrue();

        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()[0]?.status).toBe('failed');
        expect(durability()).toBeLessThan(beforeDamage);
    });

    it('does run the Total Warfare shutdown PSR for an automatic heat shutdown', async () => {
        const harness = createHarness('total-warfare');
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',


            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });

        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeTrue();
        const pilotSkillChecks = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotSkillCheck')
            .flatMap(args => args[1] as readonly { readonly label: string; readonly description: string }[]);
        expect(pilotSkillChecks).toContain(jasmine.objectContaining({
            label: 'Piloting Skill Check',
            description: 'Involuntary shutdown.',
        }));
    });

    it('leaves automatic shutdown unapplied when its Total Warfare PSR chain is cancelled', async () => {
        const harness = createHarness('total-warfare');
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',


            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        resolveChecksAutomation.and.callFake(async (
            key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => key === 'pilotSkillCheck'
            ? null
            : resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups));
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });
        const turn = harness.fixture.instance.query().turnState().turnCounter;

        const cancelled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(cancelled).toBeNull();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeFalse();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn);

        resolveChecksAutomation.and.callFake(async (
            _key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups));
        const resumed = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(resumed).not.toBeNull();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeTrue();
    });

    it('uses the heat check as the only explosion gate and resumes a closed crew check', async () => {
        const instanceId = 'unit:automation:heat-ammo-cancel';
        const harness = createHarnessForFixture(
            createDirectExplosionRuntimeFixture('core-2026', {}, instanceId),
            'core-2026',
            instanceId,
        );
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',


            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) => {
            if (key === 'heatAndDissipationResolution') return new Set<string>();
            return new Set(events.map(event => event.id));
        });
        let consciousnessReviews = 0;
        resolveChecksAutomation.and.callFake(async (
            _key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => {
            if (checks.some(check => check.label === 'Consciousness check')
                && ++consciousnessReviews === 1) return null;
            return resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups);
        });
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });
        const turn = harness.fixture.instance.query().turnState().turnCounter;
        const ammoComponentId = prepared.heatEffects?.staged.ammoComponentId;
        expect(ammoComponentId).toBeDefined();

        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).toBeNull();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn);
        expect(harness.fixture.instance.query().componentStatus(
            ammoComponentId!,
            'committed',
        )).toBe('available');

        const resumed = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(resumed).not.toBeNull();
        expect(consciousnessReviews).toBe(2);
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('internalExplosionsCheck');
        const result = harness.fixture.instance.dispatch(resumed!.command);
        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn + 1);
    });

    it('uses one force-wide review when heat, effects, and pilot hits all ask', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',


            heat: 40,
        }).accepted).toBeTrue();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


            policy: 'manual',
        });

        expect(prepared.cancelled).toBeUndefined();
        expect(resolveAutomation).toHaveBeenCalledTimes(1);
        expect(resolveAutomation.calls.argsFor(0)[0]).toBe('heatAndDissipationResolution');
        const event = resolveAutomation.calls.argsFor(0)[1][0] as {
            readonly event: string;
            readonly effects: readonly string[];
            readonly breakdown: readonly { readonly label: string }[];
        };
        expect(event).toEqual(jasmine.objectContaining({
            event: 'Heat, dissipation, effects, and pilot hits',
            effects: jasmine.arrayContaining([jasmine.stringMatching(/^(Automatic shutdown!|Shutdown check \d+\+)$/)]),
        }));
        expect(event.breakdown.map(row => row.label)).toContain('Sink');
        expect(event.breakdown.map(row => row.label)).not.toContain('Dissipation');
    });

    it('reviews every Mek in one end-turn heat batch before committing any turn', async () => {
        const leftId = 'unit:automation:batch:left';
        const rightId = 'unit:automation:batch:right';
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
        setPendingHeat(left, 10);
        setPendingHeat(right, 10);
        const force = {
            getUnitSnapshot: (instanceId: typeof leftId) => instanceId === leftId
                ? left.snapshot()
                : instanceId === rightId ? right.snapshot() : null,
        } as unknown as CBTForce;
        const requests = [left, right].map(harness => ({
            instanceId: harness.instanceId,
            command: {
                type: 'end-turn' as const,
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

    it('groups End Phase consciousness recoveries for every Mek in one review', async () => {
        const leftId = 'unit:automation:phase:left';
        const rightId = 'unit:automation:phase:right';
        const psrId = 'unit:automation:phase:psr';
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
        const psr = createHarnessForFixture(
            createDirectMekRuntimeFixture('total-warfare', psrId),
            'total-warfare',
            psrId,
        );
        const actuator = [...psr.fixture.index.slots.values()].find(candidate =>
            psr.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = psr.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(psr.fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: actuator.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        for (const harness of [left, right]) {
            const positionId = [...harness.fixture.index.crewPositions.keys()][0]!;
            expect(harness.fixture.instance.dispatch({
                type: 'set-crew-state',


                positionId,
                wounds: 1,
                unconscious: true,
                ejected: false,
            }).accepted).toBeTrue();
        }
        const force = {
            getUnitSnapshot: (instanceId: typeof leftId) => instanceId === leftId
                ? left.snapshot()
                : instanceId === rightId ? right.snapshot()
                    : instanceId === psrId ? psr.snapshot() : null,
        } as unknown as CBTForce;
        const requests = [left, right, psr].map(harness => ({
            instanceId: harness.instanceId,
            command: {
                type: 'end-phase' as const,
            },
        }));

        const prepared = await service.prepareEndPhaseCommands(force, requests);

        expect(prepared).toHaveSize(3);
        const recoveryCalls = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck');
        expect(recoveryCalls).toHaveSize(1);
        expect(recoveryCalls[0][1]).toHaveSize(2);
        const reviewedStages = resolveChecksAutomation.calls.allArgs()
            .filter(([, checks]) => checks.length > 0)
            .map(([key]) => key);
        expect(reviewedStages.indexOf('pilotHitsAndConsciousnessCheck'))
            .toBeLessThan(reviewedStages.indexOf('pilotSkillCheck'));
    });

    it('applies a successful consciousness recovery before resolving phase PSRs', async () => {
        const harness = createHarness('total-warfare');
        const positionId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const actuator = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'set-crew-state',


            positionId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: actuator.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        const commands: string[] = [];
        const dispatch: DirectMekAutomationDispatch = async command => {
            commands.push(command.type);
            return harness.dispatch(command);
        };

        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            dispatch,
        )).not.toBeNull();

        expect(commands.indexOf('set-crew-state'))
            .toBeLessThan(commands.indexOf('resolve-mek-pilot-check'));
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeFalse();
    });

    it('does not offer a manually-created Mek recovery until the following turn', async () => {
        const harness = createHarness();
        const positionId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'set-crew-state',


            positionId,
            wounds: 1,
            unconscious: true,
            ejected: false,
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

        const sameTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            sameTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeTrue();
        expect(resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck')
            .flatMap(args => args[1] as readonly unknown[])).toEqual([]);

        expect(harness.fixture.instance.dispatch({
            type: 'end-turn',


            policy: 'manual',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const nextTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            nextTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeFalse();
    });

    it('defers a failed Mek consciousness recovery until the following turn', async () => {
        const harness = createHarness();
        const positionId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'set-crew-state',


            positionId,
            wounds: 1,
            unconscious: true,
            ejected: false,
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
        expect(harness.fixture.instance.dispatch({
            type: 'end-turn',


            policy: 'manual',
        }).accepted).toBeTrue();
        const random = spyOn(Math, 'random').and.returnValue(0);

        const failed = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            failed,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeTrue();

        resolveChecksAutomation.calls.reset();
        const sameTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            sameTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck')
            .flatMap(args => args[1] as readonly unknown[])).toEqual([]);

        expect(harness.fixture.instance.dispatch({
            type: 'end-turn',


            policy: 'manual',
        }).accepted).toBeTrue();
        random.and.returnValue(0.99);
        const retried = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            retried,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeFalse();
    });

    it('uses a healthy alternate Mek crew member for heat shutdown checks', async () => {
        const instanceId = 'unit:automation:alternate-pilot';
        const harness = createHarnessForFixture(
            createDirectTripodRuntimeFixture('total-warfare', instanceId),
            'total-warfare',
            instanceId,
        );
        const [primary] = [...harness.fixture.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        expect(harness.fixture.instance.dispatch({
            type: 'set-crew-state',


            positionId: primary.id,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        setPendingHeat(harness, 14);
        spyOn(Math, 'random').and.returnValue(0.99);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();

        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeFalse();
        const shutdown = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly label: string; readonly automaticOutcome?: string }[])
            .find(check => check.label === 'Shutdown');
        expect(shutdown?.automaticOutcome).toBeUndefined();
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


            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const command: CBTUnitCommand = {
            type: 'end-turn',


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
        expect(events[0].effects).toContain(
            jasmine.stringMatching(/^(Automatic shutdown!|Shutdown check \d+\+)$/),
        );
    });

    it('keeps heat and submerged Life Support damage as separate silent damage groups', async () => {
        const harness = createHarness();
        const lifeSupport = [...harness.fixture.index.slots.values()].find(slot =>
            slot.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Life Support';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: lifeSupport.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'replace-turn-state',


            turn: {
                ...harness.fixture.instance.query().turnState(),
                cover: 'underwater-depth-2',
            },
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',


            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();

        const reviewedEffects = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly effects?: readonly string[] }[])
            .flatMap(event => event.effects ?? []);
        expect(reviewedEffects).toContain('Damaged life support (2 pilot hits)');
        expect(reviewedEffects).toContain('Damaged life support (1 pilot hit)');
        const pendingRows = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly label: string }[]);
        expect(pendingRows.some(row => row.label.includes('Life Support'))).toBeFalse();
        const consciousnessCalls = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck');
        expect(consciousnessCalls).toHaveSize(2);
        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        expect(harness.fixture.instance.query().crewState(pilotId).wounds).toBe(3);
    });

    it('settles reviewed heat consequences before resetting the turn', async () => {
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',


            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const turn = harness.fixture.instance.query().turnState().turnCounter;
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',


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
        const instanceId = 'unit:automation:case-ii';
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
        resolveChecksAutomation.and.resolveTo([]);
        const slot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const phaseCommand: CBTUnitCommand = {
            type: 'end-phase',


        };
        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            phaseCommand,
        );
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(settled).not.toBeNull();
        const phaseResult = harness.fixture.instance.dispatch(settled!.command);

        expect(phaseResult.accepted).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveChecksAutomation.calls.allArgs().map(args => args[0])).toContain('pilotSkillCheck');
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


            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const phaseCommand: CBTUnitCommand = {
            type: 'end-phase',


        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;
        const pendingBefore = harness.fixture.instance.query().hasPendingCombat();
        expect(pendingBefore).toBeTrue();
        resolveChecksAutomation.and.callFake(async (
            key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => key === 'pilotSkillCheck'
            ? null
            : resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups));

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            phaseCommand,
        );

        expect(prepared.cancelled).toBeTrue();
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(harness.fixture.instance.query().hasPendingCombat()).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveChecksAutomation).toHaveBeenCalledWith(
            'pilotSkillCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ title: 'Piloting Skill Rolls' }),
        );
    });

    it('resolves a post-fall seatbelt check from the damaged runtime before ending the phase', async () => {
        const harness = createHarness('total-warfare');
        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const actuator = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: actuator.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(resolveChecksAutomation.calls.allArgs()
            .flatMap(args => args[1] as readonly { readonly label: string }[]))
            .toContain(jasmine.objectContaining({
                label: 'Seatbelt check · Falling',
                description: 'Reason: Falling. Avoid pilot damage.',
                failedLabel: 'PILOT HIT',
            }));
        expect(harness.fixture.instance.query().crewState(pilotId).wounds).toBe(1);
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        expect(harness.fixture.instance.dispatch(settled!.command).accepted).toBeTrue();
    });

    it('resumes a closed post-fall check without applying the fall damage twice', async () => {
        const harness = createHarness('total-warfare');
        const actuator = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: actuator.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const durability = () => [...harness.fixture.index.locations.values()]
            .reduce((total, location) => total
                + harness.fixture.instance.query().remainingInternal(location.id)
                + location.armorFaceIds.reduce((armor, faceId) =>
                    armor + harness.fixture.instance.query().remainingArmor(faceId), 0), 0);
        const beforeFall = durability();
        let seatbeltAttempts = 0;
        resolveChecksAutomation.and.callFake(async (
            key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => {
            if (key === 'pilotHitsAndConsciousnessCheck'
                && checks.some(check => check.label === 'Seatbelt check · Falling')
                && seatbeltAttempts++ === 0) return null;
            return resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups);
        });
        spyOn(Math, 'random').and.returnValue(0);

        const first = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            first,
            harness.dispatch,
        )).toBeNull();
        const afterClosedCheck = durability();
        expect(afterClosedCheck).toBeLessThan(beforeFall);
        expect(harness.fixture.instance.query().turnState().pendingFallConsequences)
            .toEqual(jasmine.objectContaining({
                stage: 'seatbelts',
                totalDamage: jasmine.any(Number),
            }));

        const retry = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',


        });
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            retry,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(seatbeltAttempts).toBe(2);
        expect(durability()).toBe(afterClosedCheck);
        expect(harness.fixture.instance.query().turnState().pendingFallConsequences)
            .toBeUndefined();
        expect(harness.fixture.instance.dispatch(settled!.command).accepted).toBeTrue();
    });

    it('adds pilot damage without rerolling consciousness for an already-unconscious crew member', async () => {
        const harness = createHarness('total-warfare');
        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        expect(harness.fixture.instance.dispatch({
            type: 'set-crew-state',


            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        const command = explosiveCriticalCommand(harness.fixture);
        const before = harness.snapshot();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);
        const result = harness.fixture.instance.dispatch(prepared.command);
        expect(result.accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);

        expect(await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        )).toBeTrue();
        expect(harness.fixture.instance.query().crewState(pilotId)).toEqual(jasmine.objectContaining({
            wounds: 1 + prepared.deferredPilotHits,
            unconscious: true,
        }));
    });

    it('reviews and resolves the durable Core torso check at the phase boundary', async () => {
        const harness = createHarness('core-2026');
        const torso = [...harness.fixture.index.locations.values()]
            .find(location => location.code === 'LT')!;
        expect(harness.fixture.instance.dispatch({
            type: 'damage-internal',


            locationId: torso.id,
            amount: torso.internalPoints,
            target: 'committed',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const command: CBTUnitCommand = {
            type: 'end-phase',


        };

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            command,
        );
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(settled).not.toBeNull();
        const result = harness.fixture.instance.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();

        expect(harness.fixture.instance.query().hasCondition('crippled')).toBeTrue();
        const events = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotSkillCheck')
            .flatMap(args => args[1] as readonly { readonly label: string }[]);
        expect(events).toContain(jasmine.objectContaining({
            label: 'Crippling Destruction Check',
        }));
    });

    it('skips a destroyed-location critical chance when no explosive slot remains', async () => {
        const harness = createHarness();
        const location = [...harness.fixture.index.locations.values()]
            .find(candidate => candidate.code === 'LL')!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-internal',


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
        const instanceId = 'unit:automation:destroyed-explosive-location';
        const fixture = createDirectExplosionRuntimeFixture('core-2026', {}, instanceId);
        const harness = createHarnessForFixture(fixture, 'core-2026', instanceId);
        const location = [...fixture.index.locations.values()]
            .find(candidate => candidate.code === 'RT')!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-internal',


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
    const instanceId = `unit:automation:${ruleset}`;
    const fixture = createDirectMekRuntimeFixture(ruleset, instanceId);
    return createHarnessForFixture(fixture, ruleset, instanceId);
}

function createHarnessForFixture(
    fixture: DirectMekRuntimeFixture,
    ruleset: 'core-2026' | 'total-warfare',
    instanceId: string,
) {
    const snapshot = (): CBTUnitSnapshot => Object.freeze({
        instanceId,
        entity: fixture.entity,
        index: fixture.index,
        sourceRef: fixture.identity,
        ruleset,
        crewAssignment: fixture.instance.query().crewAssignment(),
        state: fixture.instance.snapshot(),
        query: fixture.instance.query(),
    });
    const force = { getUnitSnapshot: () => snapshot() } as unknown as CBTForce;
    const dispatch = async (command: CBTUnitCommand) => fixture.instance.dispatch(command);
    return { fixture, force, instanceId, snapshot, dispatch };
}

function setPendingHeat(
    harness: ReturnType<typeof createHarnessForFixture>,
    heat: number,
): void {
    const result = harness.fixture.instance.dispatch({
        type: 'set-pending-heat',


        heat,
    });
    if (!result.accepted) throw new Error('Failed to seed pending Mek heat');
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
