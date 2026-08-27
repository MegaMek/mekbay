// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { PendingEventInput, SerializedPendingUnitCheck } from '../models/force-serialization';
import { CBTAutomationService } from './cbt-automation.service';
import { CBTEndTurnService } from './cbt-end-turn.service';
import { CBTPhaseResolutionService } from './cbt-phase-resolution.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';

describe('CBTEndTurnService', () => {
    let resolveAutomation: jasmine.Spy;
    let resolvePhase: jasmine.Spy;
    let resolvePendingChain: jasmine.Spy;
    let showToast: jasmine.Spy;
    let service: CBTEndTurnService;
    let automationModes: Record<
        'heatAndDissipationResolution' | 'heatEffectsCheck' | 'pilotHitsAndConsciousnessCheck',
        'yes' | 'ask' | 'no'
    >;

    function createUnit(
        id: string,
        current: number,
        projected: number,
        pendingHeat = true,
        effects: {
            lifeSupportHits?: number;
            drowningHits?: number;
            shutdown?: boolean;
            activePilotCrewId?: number | null;
        } = {},
        automaticFall = false,
    ) {
        const queued: SerializedPendingUnitCheck[] = [];
        let activePilotCrewId = effects.activePilotCrewId === undefined ? 0 : effects.activePilotCrewId;
        let pendingFalls = 0;
        let checkpoint: 'phase-ended' | 'heat-staged' | undefined;
        let turnCounter = 0;
        const endTurn = jasmine.createSpy('endTurn').and.callFake(() => { turnCounter++; });
        const resolveEndTurnHeat = jasmine.createSpy('resolveEndTurnHeat');
        const endPhase = jasmine.createSpy('endPhase').and.callFake(() => {
            if (!automaticFall) return;
            queued.push({
                type: 'unit-check',
                id: `seatbelt:${id}`,
                kind: 'seatbelt',
                crewId: 0,
                target: 5,
            });
        });
        const advanceDeferredUnitChecks = jasmine.createSpy('advanceDeferredUnitChecks');
        const sourceHeat = Math.max(0, projected - current);
        const consumedDissipation = Math.max(0, current + sourceHeat - projected);
        const heatSources = sourceHeat > 0
            ? [{ id: 'weapons', label: 'Weapons', value: sourceHeat }]
            : [];
        const turnState = {
            heatProjection: () => ({ projected, consumedDissipation }),
            heatSources: () => heatSources,
            heatDissipationBalance: () => consumedDissipation,
            getEndTurnCheckpoint: () => checkpoint,
            getTurnCounter: () => turnCounter,
            markEndTurnPhaseEnded: () => { checkpoint ??= 'phase-ended'; },
            markEndTurnHeatStaged: () => { checkpoint = 'heat-staged'; },
            advanceDeferredUnitChecks,
            queuePendingUnitCheck: (check: PendingEventInput<SerializedPendingUnitCheck>) => {
                queued.push({ type: 'unit-check', ...check } as SerializedPendingUnitCheck);
                return true;
            },
            pendingUnitCheckCount: () => queued.length,
            getPendingUnitChecks: () => queued,
            pendingCriticalChanceCount: () => 0,
            pendingCriticalHitCount: () => 0,
            PSRRollsCount: () => automaticFall ? 1 : 0,
            actionablePSRRollsCount: () => 0,
            autoFall: () => automaticFall,
        };
        const unit = {
            id,
            getHeat: () => ({ current, previous: current }),
            turnState: () => turnState,
            rules: {
                heatScale: [
                    { heat: 5, move: -1 },
                    { heat: 8, fire: 1 },
                    { heat: 14, shutdown: 4 },
                    { heat: 18, shutdown: 6 },
                    { heat: 30, shutdown: 100 },
                ],
                hasDamagedLifeSupport: () => (effects.lifeSupportHits ?? 0) > 0,
                heatLifeSupportPilotHits: () => effects.lifeSupportHits ?? 0,
                submergedLifeSupportPilotHits: () => effects.drowningHits ?? 0,
                getActivePilotCrewId: () => activePilotCrewId,
            },
            getNotificationDisplayName: () => `Unit ${id}`,
            pendingFallCount: () => pendingFalls,
            hasPendingEndTurnHeat: () => pendingHeat,
            getCondition: (condition: string) => condition === 'shutdown' && effects.shutdown === true,
            getCrewMember: () => ({ getState: () => 'healthy' }),
            getCritSlots: () => [],
            getUnit: () => ({ type: 'Mek' }),
            resolveEndTurnHeat,
            endPhase,
            endTurn,
        } as unknown as CBTForceUnit;
        return {
            unit,
            endPhase,
            endTurn,
            queued,
            resolveEndTurnHeat,
            advanceDeferredUnitChecks,
            getCheckpoint: () => checkpoint,
            setCheckpoint: (value: typeof checkpoint) => { checkpoint = value; },
            setPendingFallCount: (count: number) => { pendingFalls = count; },
            setActivePilotCrewId: (crewId: number | null) => { activePilotCrewId = crewId; },
        };
    }

    beforeEach(() => {
        automationModes = {
            heatAndDissipationResolution: 'yes',
            heatEffectsCheck: 'yes',
            pilotHitsAndConsciousnessCheck: 'yes',
        };
        resolveAutomation = jasmine.createSpy('resolve');
        resolvePhase = jasmine.createSpy('resolve').and.resolveTo(true);
        resolvePendingChain = jasmine.createSpy('resolvePendingChain').and.resolveTo(true);
        showToast = jasmine.createSpy('showToast');
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                CBTEndTurnService,
                { provide: CBTAutomationService, useValue: { resolve: resolveAutomation } },
                {
                    provide: CBTPhaseResolutionService,
                    useValue: { endPhase: resolvePhase, resolvePendingChain },
                },
                { provide: OptionsService, useValue: {
                    cbtAutomationMode: (key: keyof typeof automationModes) => automationModes[key],
                } },
                { provide: ToastService, useValue: { showToast } },
            ],
        });
        service = TestBed.inject(CBTEndTurnService);
    });

    afterEach(() => TestBed.resetTestingModule());

    it('does not stage heat or commit a turn before both automation reviews complete', async () => {
        const first = createUnit('first', 4, 8);
        const second = createUnit('second', 2, 6);
        let finishHeatReview!: (result: ReadonlySet<string> | null) => void;
        resolveAutomation.and.callFake((key: string) => key === 'heatAndDissipationResolution'
            ? new Promise<ReadonlySet<string> | null>(resolve => finishHeatReview = resolve)
            : Promise.resolve(new Set<string>()));

        const completion = service.endTurn([first.unit, second.unit]);
        const duplicateCompletion = service.endTurn([first.unit, second.unit]);
        await Promise.resolve();
        await Promise.resolve();

        expect(first.endTurn).not.toHaveBeenCalled();
        expect(second.endTurn).not.toHaveBeenCalled();
        expect(first.resolveEndTurnHeat).not.toHaveBeenCalled();
        expect(second.resolveEndTurnHeat).not.toHaveBeenCalled();
        expect(resolveAutomation).toHaveBeenCalledTimes(1);

        finishHeatReview(new Set(['heat-and-dissipation:first']));
        expect(await completion).toBeTrue();
        expect(await duplicateCompletion).toBeTrue();
        expect(first.endTurn).toHaveBeenCalledOnceWith({ heatAndDissipationResolution: false, phaseAlreadyEnded: true });
        expect(second.endTurn).toHaveBeenCalledOnceWith({ heatAndDissipationResolution: false, phaseAlreadyEnded: true });
        expect(first.resolveEndTurnHeat).toHaveBeenCalledTimes(1);
        expect(second.resolveEndTurnHeat).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
            'Unit first — Heat and dissipation: Heat 4 → 8',
            'info',
        );
    });

    it('queues concurrent requests for different unit snapshots without retargeting them', async () => {
        const first = createUnit('first', 4, 8);
        const second = createUnit('second', 2, 6);
        let finishFirstPhase!: (result: boolean) => void;
        resolvePhase.and.callFake((units: readonly CBTForceUnit[]) => units[0] === first.unit
            ? new Promise<boolean>(resolve => finishFirstPhase = resolve)
            : Promise.resolve(true));
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));

        const firstCompletion = service.endTurn([first.unit]);
        const secondCompletion = service.endTurn([second.unit]);
        await Promise.resolve();

        expect(resolvePhase).toHaveBeenCalledOnceWith([first.unit]);
        expect(first.endTurn).not.toHaveBeenCalled();
        expect(second.endTurn).not.toHaveBeenCalled();

        finishFirstPhase(true);
        expect(await firstCompletion).toBeTrue();
        expect(await secondCompletion).toBeTrue();
        expect(resolvePhase.calls.allArgs()).toEqual([[[first.unit]], [[second.unit]]]);
        expect(first.endTurn).toHaveBeenCalledTimes(1);
        expect(second.endTurn).toHaveBeenCalledTimes(1);
    });

    it('skips units already committed by an overlapping queued request', async () => {
        const first = createUnit('first', 4, 8);
        const second = createUnit('second', 2, 6);
        let finishFirstPhase!: (result: boolean) => void;
        resolvePhase.and.callFake((units: readonly CBTForceUnit[]) => units[0] === first.unit
            ? new Promise<boolean>(resolve => finishFirstPhase = resolve)
            : Promise.resolve(true));
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));

        const firstCompletion = service.endTurn([first.unit]);
        const overlapCompletion = service.endTurn([first.unit, second.unit]);
        await Promise.resolve();
        finishFirstPhase(true);

        expect(await firstCompletion).toBeTrue();
        expect(await overlapCompletion).toBeTrue();
        expect(resolvePhase.calls.allArgs()).toEqual([[[first.unit]], [[second.unit]]]);
        expect(first.endTurn).toHaveBeenCalledTimes(1);
        expect(second.endTurn).toHaveBeenCalledTimes(1);
    });

    it('leaves the ended phase resumable when the heat review is cancelled', async () => {
        const first = createUnit('first', 4, 8);
        const second = createUnit('second', 2, 6);
        resolveAutomation.and.resolveTo(null);

        expect(await service.endTurn([first.unit, second.unit])).toBeFalse();

        expect(first.endTurn).not.toHaveBeenCalled();
        expect(second.endTurn).not.toHaveBeenCalled();
        expect(first.resolveEndTurnHeat).not.toHaveBeenCalled();
        expect(second.resolveEndTurnHeat).not.toHaveBeenCalled();
        expect(first.getCheckpoint()).toBe('phase-ended');
        expect(second.getCheckpoint()).toBe('phase-ended');
    });

    it('does not stage heat when the heat-effects review is cancelled', async () => {
        const harness = createUnit('atlas', 4, 18);
        resolveAutomation.and.callFake((key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(key === 'heatAndDissipationResolution'
                ? new Set(events.map(event => event.id))
                : null));

        expect(await service.endTurn([harness.unit])).toBeFalse();

        expect(harness.endTurn).not.toHaveBeenCalled();
        expect(harness.queued).toEqual([]);
        expect(harness.getCheckpoint()).toBe('phase-ended');
    });

    it('stages automatic heat-30 shutdown and opens the persistent checks panel', async () => {
        const harness = createUnit('atlas', 20, 30);
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));

        expect(await service.endTurn([harness.unit])).toBeTrue();

        expect(harness.queued.length).toBe(1);
        expect(harness.queued[0]).toEqual(jasmine.objectContaining({
            kind: 'heat-shutdown',
            pilotDamageGroup: jasmine.stringMatching(/^heat:end-turn:/),
            result: { kind: 'automatic', outcome: 'failed' },
        }));
        expect(harness.queued[0].target).toBeUndefined();
        expect(resolvePendingChain).toHaveBeenCalledOnceWith([harness.unit]);
    });

    it('describes pending heat and stages effects from the accepted final heat', async () => {
        const first = createUnit('first', 4, 18);
        const second = createUnit('second', 2, 6);
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));

        await service.endTurn([first.unit, second.unit]);

        expect(resolveAutomation.calls.argsFor(0)).toEqual([
            'heatAndDissipationResolution',
            [
                {
                    id: 'heat-and-dissipation:first',
                    subject: 'Unit first',
                    event: 'Heat and dissipation',
                    description: 'Heat 4 → 18',
                    delta: 14,
                    breakdown: [{ id: 'weapons', label: 'Weapons', value: 14 }],
                    effects: ['Shutdown check 6+'],
                },
                {
                    id: 'heat-and-dissipation:second',
                    subject: 'Unit second',
                    event: 'Heat and dissipation',
                    description: 'Heat 2 → 6',
                    delta: 4,
                    breakdown: [{ id: 'weapons', label: 'Weapons', value: 4 }],
                },
            ],
            {
                title: 'Review Heat and Dissipation',
                message: 'Choose which heat and dissipation results to apply.',
                allowCancel: true,
            },
        ]);
        expect(first.queued[0]).toEqual(jasmine.objectContaining({
            kind: 'heat-shutdown',
            target: 6,
        }));
        expect(second.queued).toEqual([]);
    });

    it('groups every heat effect for one unit into one review entry and includes Life Support hits', async () => {
        const harness = createUnit('atlas', 4, 20, true, { lifeSupportHits: 2 });
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));

        await service.endTurn([harness.unit]);

        expect(resolveAutomation.calls.argsFor(0)[1][0].effects).toEqual([
            'Shutdown check 6+',
            'Damaged life support (2 pilot hits)',
        ]);
        expect(resolveAutomation.calls.argsFor(1)).toEqual([
            'heatEffectsCheck',
            [{
                id: 'heat-effects:atlas',
                subject: 'Unit atlas',
                event: 'Heat effects',
                description: 'Heat 4 → 20',
                delta: 16,
                breakdown: [{ id: 'weapons', label: 'Weapons', value: 16 }],
                effects: [
                    'Shutdown check 6+',
                    'Damaged life support (2 pilot hits)',
                ],
            }],
            {
                title: 'Review End-Turn Heat Effects',
                message: 'Choose which units\' heat effects to resolve.',
                allowCancel: true,
            },
        ]);
        expect(harness.queued.map(check => check.kind)).toEqual(['heat-shutdown', 'heat-life-support']);
    });

    it('uses one grouped review when heat, heat effects, and pilot hits all ask', async () => {
        automationModes = {
            heatAndDissipationResolution: 'ask',
            heatEffectsCheck: 'ask',
            pilotHitsAndConsciousnessCheck: 'ask',
        };
        const harness = createUnit('atlas', 4, 18, true, { lifeSupportHits: 1 });
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));

        expect(await service.endTurn([harness.unit])).toBeTrue();

        expect(resolveAutomation).toHaveBeenCalledTimes(1);
        expect(resolveAutomation).toHaveBeenCalledOnceWith(
            'heatAndDissipationResolution',
            [{
                id: 'end-turn-heat:atlas',
                subject: 'Unit atlas',
                event: 'Heat, dissipation, effects, and pilot hits',
                description: 'Heat 4 → 18',
                delta: 14,
                breakdown: [{ id: 'weapons', label: 'Weapons', value: 14 }],
                effects: [
                    'Shutdown check 6+',
                    'Damaged life support (1 pilot hit)',
                ],
            }],
            {
                title: 'Review End-Turn Heat',
                message: 'Choose which units\' heat, dissipation, heat effects, and pilot hits to apply.',
                allowCancel: true,
            },
        );
        expect(harness.endTurn).toHaveBeenCalledOnceWith({ heatAndDissipationResolution: false, phaseAlreadyEnded: true });
        expect(harness.queued.map(check => check.kind)).toEqual(['heat-shutdown', 'heat-life-support']);
    });

    it('groups heat effects and pilot hits for every unit when both ask after automatic heat', async () => {
        automationModes.heatEffectsCheck = 'ask';
        automationModes.pilotHitsAndConsciousnessCheck = 'ask';
        const first = createUnit('first', 4, 18, true, { lifeSupportHits: 1 });
        const second = createUnit('second', 4, 20, true, { lifeSupportHits: 2 });
        resolveAutomation.and.callFake((key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(key === 'heatEffectsCheck'
                ? new Set(['heat-effects:first'])
                : new Set(events.map(event => event.id))));

        expect(await service.endTurn([first.unit, second.unit])).toBeTrue();

        expect(resolveAutomation).toHaveBeenCalledTimes(2);
        expect(resolveAutomation.calls.argsFor(1)).toEqual([
            'heatEffectsCheck',
            [
                jasmine.objectContaining({
                    id: 'heat-effects:first',
                    event: 'Heat effects and pilot hits',
                    effects: ['Shutdown check 6+', 'Damaged life support (1 pilot hit)'],
                }),
                jasmine.objectContaining({
                    id: 'heat-effects:second',
                    event: 'Heat effects and pilot hits',
                    effects: ['Shutdown check 6+', 'Damaged life support (2 pilot hits)'],
                }),
            ],
            {
                title: 'Review End-Turn Heat Effects',
                message: 'Choose which units\' heat effects and pilot hits to resolve.',
                allowCancel: true,
            },
        ]);
        expect(first.queued.map(check => check.kind)).toEqual(['heat-shutdown', 'heat-life-support']);
        expect(second.queued).toEqual([]);
    });

    it('asks once for Life Support pilot hits after automatic heat effects and skips rejected hits', async () => {
        automationModes.pilotHitsAndConsciousnessCheck = 'ask';
        const harness = createUnit('atlas', 4, 20, true, { lifeSupportHits: 2 });
        resolveAutomation.and.callFake((key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(key === 'pilotHitsAndConsciousnessCheck'
                ? new Set<string>()
                : new Set(events.map(event => event.id))));

        expect(await service.endTurn([harness.unit])).toBeTrue();

        expect(resolveAutomation.calls.argsFor(2)).toEqual([
            'pilotHitsAndConsciousnessCheck',
            [{
                id: 'pilot-hits:atlas',
                subject: 'Unit atlas',
                event: 'Pilot hits and consciousness',
                description: 'Heat 20',
                effects: ['Damaged life support (2 pilot hits)'],
            }],
            {
                title: 'Review Pilot Hits',
                message: 'Choose which units\' pilot-hit effects to apply. Accepted hits continue directly into any required Consciousness Rolls.',
                allowCancel: true,
            },
        ]);
        expect(harness.queued.map(check => check.kind)).toEqual(['heat-shutdown']);
    });

    it('omits Life Support pilot-hit automation entirely in no mode', async () => {
        automationModes.pilotHitsAndConsciousnessCheck = 'no';
        const harness = createUnit('atlas', 4, 20, true, { lifeSupportHits: 2 });
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));

        expect(await service.endTurn([harness.unit])).toBeTrue();

        expect(resolveAutomation.calls.argsFor(0)[1][0].effects).toEqual(['Shutdown check 6+']);
        expect(resolveAutomation.calls.argsFor(1)[1][0].effects).toEqual(['Shutdown check 6+']);
        expect(harness.queued.map(check => check.kind)).toEqual(['heat-shutdown']);
    });

    it('runs the shared phase resolver before starting end-turn heat work', async () => {
        const harness = createUnit('atlas', 0, 0, false);
        resolveAutomation.and.resolveTo(new Set<string>());

        expect(await service.endTurn([harness.unit])).toBeTrue();

        expect(resolvePhase).toHaveBeenCalledOnceWith([harness.unit]);
        expect(harness.endTurn).toHaveBeenCalledTimes(1);
    });

    it('offers shutdown recovery after End Phase consciousness recovery succeeds', async () => {
        const harness = createUnit('atlas', 4, 18, true, {
            shutdown: true,
            activePilotCrewId: null,
        });
        resolvePhase.and.callFake(async () => {
            harness.setActivePilotCrewId(0);
            return true;
        });
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));

        expect(await service.endTurn([harness.unit])).toBeTrue();

        expect(harness.queued).toEqual([
            jasmine.objectContaining({ kind: 'shutdown-recovery', target: 6 }),
        ]);
    });

    it('aborts END TURN when CLOSE interrupts the shared phase resolver', async () => {
        const harness = createUnit('atlas', 20, 10, true);
        resolvePhase.and.resolveTo(false);

        expect(await service.endTurn([harness.unit])).toBeFalse();

        expect(resolveAutomation).not.toHaveBeenCalled();
        expect(harness.endTurn).not.toHaveBeenCalled();
        expect(harness.getCheckpoint()).toBeUndefined();
    });

    it('does not reset the turn when CLOSE interrupts a staged heat consequence', async () => {
        const harness = createUnit('atlas', 4, 18);
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));
        resolvePendingChain.and.resolveTo(false);

        expect(await service.endTurn([harness.unit])).toBeFalse();

        expect(harness.resolveEndTurnHeat).toHaveBeenCalledTimes(1);
        expect(harness.getCheckpoint()).toBe('heat-staged');
        expect(harness.endTurn).not.toHaveBeenCalled();
    });

    it('resumes after CLOSE without ending the phase or staging heat twice', async () => {
        const harness = createUnit('atlas', 4, 18);
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));
        resolvePendingChain.and.returnValues(Promise.resolve(false), Promise.resolve(true));

        expect(await service.endTurn([harness.unit])).toBeFalse();
        expect(await service.endTurn([harness.unit])).toBeTrue();

        expect(resolvePhase).toHaveBeenCalledTimes(1);
        expect(resolveAutomation).toHaveBeenCalledTimes(2);
        expect(resolvePendingChain).toHaveBeenCalledTimes(2);
        expect(harness.resolveEndTurnHeat).toHaveBeenCalledTimes(1);
        expect(harness.queued.length).toBe(1);
        expect(harness.endTurn).toHaveBeenCalledOnceWith({
            heatAndDissipationResolution: false,
            phaseAlreadyEnded: true,
        });
    });

    it('awaits the complete staged consequence chain before resetting the turn', async () => {
        const harness = createUnit('atlas', 4, 18);
        resolveAutomation.and.callFake((_key: string, events: readonly AutomationReviewEvent[]) =>
            Promise.resolve(new Set(events.map(event => event.id))));
        let announceChainStarted!: () => void;
        let finishChain!: (result: boolean) => void;
        const chainStarted = new Promise<void>(resolve => announceChainStarted = resolve);
        resolvePendingChain.and.callFake(() => {
            announceChainStarted();
            return new Promise<boolean>(resolve => finishChain = resolve);
        });

        const completion = service.endTurn([harness.unit]);
        await chainStarted;

        expect(harness.endTurn).not.toHaveBeenCalled();
        finishChain(true);
        expect(await completion).toBeTrue();
        expect(harness.endTurn).toHaveBeenCalledTimes(1);
    });
});
