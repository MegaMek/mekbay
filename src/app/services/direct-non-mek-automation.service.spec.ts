// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import type { CBTForce } from '../models/cbt-force.model';
import type { CBTNonMekUnitCommandResult } from '../models/cbt-force.types';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import type { UnitConditionKey } from '../models/unit-condition.model';
import { CORE_2026_RULESET } from '../models/cbt-ruleset.model';
import { AmmoEquipment } from '../models/equipment.model';
import { TestAeroSpaceFighterEntity } from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import {
    addTestEquipment,
    addTestEquipmentWithFlags,
} from '../models/entity/testing/test-mounted-equipment';
import { createDefaultCrewAssignment } from '../models/runtime/crew-assignment';
import {
    NonMekUnitInstance,
    type NonMekUnitCommand,
} from '../models/runtime/non-mek-unit-instance';
import { componentIdForMount } from '../models/runtime/non-mek-runtime-index';
import { type InstanceBaselineRef } from '../models/runtime/runtime-state';
import {
    asUnitUuid,
    MM_DATA_UNIT_PROVIDER_ID,
} from './unit-catalog/unit-catalog.types';
import { CBTAutomationService } from './cbt-automation.service';
import {
    CBTAutomationCheckService,
    resolveAutomationChecksAutomatically,
} from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { DirectNonMekAutomationService } from './direct-non-mek-automation.service';
import { OptionsService } from './options.service';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5f1');

describe('DirectNonMekAutomationService', () => {
    let resolveAutomation: jasmine.Spy;
    let resolveChecksAutomation: jasmine.Spy;
    let showAutomationToast: jasmine.Spy;
    let service: DirectNonMekAutomationService;
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
            async (_key: string, checks: Parameters<typeof resolveAutomationChecksAutomatically>[0]) =>
                resolveAutomationChecksAutomatically(checks),
        );
        showAutomationToast = jasmine.createSpy('show');
        TestBed.configureTestingModule({
            providers: [
                DirectNonMekAutomationService,
                { provide: CBTAutomationService, useValue: { resolve: resolveAutomation } },
                { provide: CBTAutomationCheckService, useValue: { resolve: resolveChecksAutomation } },
                { provide: CBTAutomationToastService, useValue: { show: showAutomationToast } },
                {
                    provide: OptionsService,
                    useValue: { cbtAutomationMode: (key: string) => automationModes[key] ?? 'ask' },
                },
            ],
        });
        service = TestBed.inject(DirectNonMekAutomationService);
    });

    it('reports automatically resolved aerospace heat through the shared notifier', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 10, 'pending');
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',

            heatPolicy: 'manual',
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
            'Heat and dissipation: Heat 0 → 10',
            'info',
        );
    });

    it('selects automatic or manual aerospace heat settlement from review', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 10, 'pending');
        const automatic = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',

            heatPolicy: 'manual',
        });
        expect(automatic.command).toEqual(jasmine.objectContaining({
            kind: 'end-turn',
            heatPolicy: 'automatic',
        }));

        resolveAutomation.and.callFake(async () => new Set<string>());
        const manual = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',

            heatPolicy: 'automatic',
        });
        expect(manual.command).toEqual(jasmine.objectContaining({
            kind: 'end-turn',
            heatPolicy: 'manual',
        }));
    });

    it('discards a skipped heat arrow but commits it when heat automation is disabled', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        resolveAutomation.and.resolveTo(new Set<string>());
        const skippedHarness = createHarness();
        setHeat(skippedHarness.runtime, 10, 'pending');
        const skipped = await service.prepareCommand(skippedHarness.force, skippedHarness.instanceId, {
            kind: 'end-turn',

            heatPolicy: 'manual',
        });

        expect(await service.settleBeforeCommand(
            skippedHarness.force,
            skippedHarness.instanceId,
            skipped,
            skippedHarness.dispatch,
        )).not.toBeNull();
        expect(skippedHarness.runtime.snapshot().heat.current).toBe(0);
        expect(skippedHarness.runtime.snapshot().heat.pendingOverride).toBeUndefined();

        automationModes['heatAndDissipationResolution'] = 'no';
        const manualHarness = createHarness();
        setHeat(manualHarness.runtime, 10, 'pending');
        const manual = await service.prepareCommand(manualHarness.force, manualHarness.instanceId, {
            kind: 'end-turn',

            heatPolicy: 'manual',
        });

        expect(await service.settleBeforeCommand(
            manualHarness.force,
            manualHarness.instanceId,
            manual,
            manualHarness.dispatch,
        )).not.toBeNull();
        expect(manualHarness.runtime.snapshot().heat.current).toBe(10);
        expect(manualHarness.runtime.snapshot().heat.pendingOverride).toBeUndefined();
    });

    it('does not create a heat review event for a pristine heatless aerospace unit', async () => {
        const harness = createHarness();

        await executeEndTurn(service, harness);

        const heatReview = resolveAutomation.calls.allArgs()
            .find(args => args[0] === 'heatAndDissipationResolution');
        expect(heatReview?.[1]).toEqual([]);
        expect(harness.runtime.turnState().turnCounter).toBe(1);
    });

    it('cancels end turn when the heat review is closed', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 10);
        resolveAutomation.and.resolveTo(null);
        const command: NonMekUnitCommand = {
            kind: 'end-turn',

            heatPolicy: 'automatic',
        };

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(resolveAutomation).toHaveBeenCalledWith(
            'heatAndDissipationResolution',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('cancels an aerospace heat-effect review before mutating the turn', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 30);
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) =>
            key === 'heatEffectsCheck' ? null : new Set(events.map(event => event.id)));
        const command: NonMekUnitCommand = {
            kind: 'end-turn',

            heatPolicy: 'automatic',
        };
        const revisionBefore = harness.runtime.revision();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(harness.runtime.revision()).toBe(revisionBefore);
        expect(harness.runtime.hasCondition('shutdown')).toBeFalse();
    });

    it('cancels the dedicated aerospace heat checks without mutating the turn', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 30);
        resolveChecksAutomation.and.callFake(async (key: string) =>
            key === 'heatEffectsCheck' ? null : []);
        const command: NonMekUnitCommand = {
            kind: 'end-turn',

            heatPolicy: 'automatic',
        };
        const revisionBefore = harness.runtime.revision();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(harness.runtime.revision()).toBe(revisionBefore);
        expect(resolveChecksAutomation).toHaveBeenCalledWith(
            'heatEffectsCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ title: 'Resolve Pending Checks' }),
        );
    });

    it('reviews non-Mek consciousness recovery before committing End Phase', async () => {
        const harness = createHarness();
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.dispatch({
            kind: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const command: NonMekUnitCommand = {
            kind: 'end-phase',

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
        const result = await harness.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();

        expect(harness.runtime.query().crewState(pilotId).unconscious).toBeFalse();
        expect(resolveChecksAutomation).toHaveBeenCalledWith(
            'pilotHitsAndConsciousnessCheck',
            [jasmine.objectContaining({
                label: 'Consciousness recovery',
                description: 'Restores consciousness; the unit may act next turn.',
                successLabel: 'WAKES UP',
                failedLabel: 'STAYS UNCONSCIOUS',
            })],
            jasmine.objectContaining({ title: 'Recover Consciousness' }),
        );
    });

    it('does not offer a manually-created consciousness recovery until the following turn', async () => {
        const harness = createHarness();
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        const before = harness.snapshot();
        const command: NonMekUnitCommand = {
            kind: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
        };
        const result = await harness.dispatch(command);
        expect(result.accepted).toBeTrue();
        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            { command },
            result,
            harness.dispatch,
        );
        expect(harness.runtime.query().crewState(pilotId).recoveryReadyTurn).toBe(1);

        const sameTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            sameTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.runtime.query().crewState(pilotId).unconscious).toBeTrue();
        expect(resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck')
            .flatMap(args => args[1] as readonly unknown[])).toEqual([]);

        expect((await harness.dispatch({
            kind: 'end-turn',

            heatPolicy: 'manual',
        })).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const nextTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            nextTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.runtime.query().crewState(pilotId).unconscious).toBeFalse();
    });

    it('defers a failed non-Mek consciousness recovery until the following turn', async () => {
        const harness = createHarness(false, 'recovery-retry');
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        const before = harness.snapshot();
        const command: NonMekUnitCommand = {
            kind: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
        };
        const result = await harness.dispatch(command);
        expect(result.accepted).toBeTrue();
        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            { command },
            result,
            harness.dispatch,
        );
        expect((await harness.dispatch({
            kind: 'end-turn',

            heatPolicy: 'manual',
        })).accepted).toBeTrue();
        const random = spyOn(Math, 'random').and.returnValue(0);

        const failed = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            failed,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.runtime.query().crewState(pilotId).unconscious).toBeTrue();
        expect(harness.runtime.query().crewState(pilotId).recoveryReadyTurn).toBe(2);

        resolveChecksAutomation.calls.reset();
        const sameTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

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

        expect((await harness.dispatch({
            kind: 'end-turn',

            heatPolicy: 'manual',
        })).accepted).toBeTrue();
        random.and.returnValue(0.99);
        const retried = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            retried,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.runtime.query().crewState(pilotId).unconscious).toBeFalse();
    });

    it('keeps a non-Mek phase uncommitted when recovery review closes', async () => {
        const harness = createHarness();
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.dispatch({
            kind: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
        }).accepted).toBeTrue();
        const revision = harness.runtime.revision();
        resolveChecksAutomation.and.resolveTo(null);
        const command: NonMekUnitCommand = {
            kind: 'end-phase',

        };

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            command,
        );

        expect(prepared.cancelled).toBeTrue();
        expect(harness.runtime.revision()).toBe(revision);
        expect(harness.runtime.query().crewState(pilotId).unconscious).toBeTrue();
    });

    it('groups End Phase consciousness recoveries across non-Mek units', async () => {
        const first = createHarness(false, 'phase-first');
        const second = createHarness(false, 'phase-second');
        for (const harness of [first, second]) {
            const positionId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
            expect(harness.runtime.dispatch({
                kind: 'set-crew-state',

                positionId,
                wounds: 1,
                unconscious: true,
                ejected: false,
                killed: false,
                stunned: false,
            }).accepted).toBeTrue();
        }
        const force = {
            getUnitSnapshot: (instanceId: typeof first.instanceId) => instanceId === first.instanceId
                ? first.snapshot()
                : instanceId === second.instanceId ? second.snapshot() : null,
        } as unknown as CBTForce;

        const prepared = await service.prepareEndPhaseCommands(force, [first, second].map(harness => ({
            instanceId: harness.instanceId,
            command: {
                kind: 'end-phase' as const,
            },
        })));

        expect(prepared).toHaveSize(2);
        const recoveryCalls = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck');
        expect(recoveryCalls).toHaveSize(1);
        expect(recoveryCalls[0][1]).toHaveSize(2);
    });

    it('uses one aerospace review when heat, effects, and pilot hits all ask', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        const harness = createHarness();
        setHeat(harness.runtime, 30);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',

            heatPolicy: 'manual',
        });

        expect(prepared.cancelled).toBeUndefined();
        expect(resolveAutomation).toHaveBeenCalledTimes(1);
        expect(resolveAutomation.calls.argsFor(0)[1][0]).toEqual(jasmine.objectContaining({
            event: 'Heat, dissipation, effects, and pilot hits',
            effects: jasmine.arrayContaining([jasmine.stringMatching(/^(Automatic shutdown!|Shutdown check \d+\+)$/)]),
        }));
    });

    it('applies aerospace shutdown, random movement, and pilot damage as typed commands', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 30);
        spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);

        expect(harness.runtime.hasCondition('shutdown')).toBeTrue();
        expect(harness.runtime.hasCondition('random-movement')).toBeTrue();
        expect(harness.runtime.hasCondition('out-of-control')).toBeTrue();
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.query().crewState(pilotId)).toEqual(jasmine.objectContaining({
            wounds: 1,
            unconscious: true,
        }));
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .toContain('heatEffectsCheck');
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('pilotHitsAndConsciousnessCheck');
        const heatEffectEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly event: string }[]);
        expect(heatEffectEvents).toHaveSize(1);
        expect(heatEffectEvents[0].event).toBe('Heat effects and pilot hits');
    });

    it('settles aerospace heat consequences before resetting the turn', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 30);
        spyOn(Math, 'random').and.returnValue(0);
        const turn = harness.runtime.snapshot().turn.turnCounter;
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',

        });

        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(harness.runtime.hasCondition('shutdown')).toBeTrue();
        expect(harness.runtime.snapshot().turn.turnCounter).toBe(turn);
        const result = await harness.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();
        expect(harness.runtime.snapshot().turn.turnCounter).toBe(turn + 1);
    });

    it('resolves a later aerospace Control Roll after heat-induced random movement', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 10);
        const random = spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);

        expect(harness.runtime.hasCondition('random-movement')).toBeTrue();
        expect(harness.runtime.hasCondition('out-of-control')).toBeTrue();
        expect(harness.runtime.turnState().controlRecovery).toEqual({
            readyTurn: harness.runtime.turnState().turnCounter,
            cause: 'heat-random-movement',
        });
        const endTurnChecks = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly description: string }[]);
        expect(endTurnChecks.map(check => check.description))
            .not.toContain('Regain control after heat-induced random movement.');

        random.and.returnValue(0.99);
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();

        expect(harness.runtime.hasCondition('random-movement')).toBeFalse();
        expect(harness.runtime.hasCondition('out-of-control')).toBeFalse();
        expect(harness.runtime.turnState().controlRecovery).toBeUndefined();
        const phaseChecks = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly description: string }[]);
        expect(phaseChecks.map(check => check.description))
            .toContain('Regain control after heat-induced random movement.');
    });

    it('uses another healthy aerospace crew member when the primary pilot is unconscious', async () => {
        const harness = createHarness(false, 'alternate-controller', true);
        const [primary] = [...harness.runtime.getIndex().crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        expect(harness.runtime.dispatch({
            kind: 'set-crew-state',

            positionId: primary.id,
            wounds: 1,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
        }).accepted).toBeTrue();
        setHeat(harness.runtime, 14);
        spyOn(Math, 'random').and.returnValue(0.99);

        await executeEndTurn(service, harness);

        expect(harness.runtime.hasCondition('shutdown')).toBeFalse();
        const shutdown = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly label: string; readonly automaticOutcome?: string }[])
            .find(check => check.label === 'Shutdown');
        expect(shutdown?.automaticOutcome).toBeUndefined();
    });

    it('keeps unrelated random movement while resolving control lost to unconsciousness', async () => {
        const harness = createHarness(false, 'controller-loss');
        setCondition(harness.runtime, 'random-movement', true);
        setHeat(harness.runtime, 21);
        spyOn(Math, 'random').and.returnValues(
            0.99, 0.99,
            0.99, 0.99,
            0, 0,
            0, 0,
        );

        await executeEndTurn(service, harness);

        expect(harness.runtime.hasCondition('out-of-control')).toBeTrue();
        expect(harness.runtime.hasCondition('random-movement')).toBeTrue();

        (Math.random as jasmine.Spy).and.returnValue(0.99);
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();

        expect(harness.runtime.hasCondition('out-of-control')).toBeFalse();
        expect(harness.runtime.hasCondition('random-movement')).toBeTrue();
        const phaseChecks = resolveChecksAutomation.calls.allArgs()
            .flatMap(args => args[1] as readonly { readonly description: string }[]);
        expect(phaseChecks.map(check => check.description))
            .toContain('Regain control after going out of control.');
    });

    it('does not treat manually-set control conditions as heat-created state', async () => {
        const harness = createHarness(false, 'unrelated-control-state');
        setCondition(harness.runtime, 'random-movement', true);
        setCondition(harness.runtime, 'out-of-control', true);

        await executeEndTurn(service, harness);

        expect(harness.runtime.hasCondition('random-movement')).toBeTrue();
        expect(harness.runtime.hasCondition('out-of-control')).toBeTrue();
    });

    it('retries a failed aerospace Control Roll only on the following turn', async () => {
        const harness = createHarness(false, 'control-retry');
        setHeat(harness.runtime, 10);
        const random = spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);
        const failed = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            failed,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.runtime.hasCondition('out-of-control')).toBeTrue();
        expect(harness.runtime.turnState().controlRecovery).toEqual({
            readyTurn: harness.runtime.turnState().turnCounter + 1,
            cause: 'heat-random-movement',
        });

        resolveChecksAutomation.calls.reset();
        const sameTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            sameTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(resolveChecksAutomation.calls.allArgs()
            .flatMap(args => args[1] as readonly { readonly label: string }[])
            .some(check => check.label === 'Regain aerospace control')).toBeFalse();

        expect((await harness.dispatch({
            kind: 'end-turn',

            heatPolicy: 'manual',
        })).accepted).toBeTrue();
        random.and.returnValue(0.99);
        const retried = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            retried,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.runtime.hasCondition('out-of-control')).toBeFalse();
        expect(harness.runtime.hasCondition('random-movement')).toBeFalse();
    });

    it('drops aerospace Control recovery when no controller can return', async () => {
        const harness = createHarness(false, 'control-no-controller');
        setHeat(harness.runtime, 10);
        spyOn(Math, 'random').and.returnValue(0);
        await executeEndTurn(service, harness);
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect((await harness.dispatch({
            kind: 'set-crew-state',

            positionId: pilotId,
            wounds: 0,
            unconscious: false,
            ejected: true,
            killed: false,
            stunned: false,
        })).accepted).toBeTrue();

        resolveChecksAutomation.calls.reset();
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
                kind: 'end-phase',

            });
            expect(await service.settleBeforeCommand(
                harness.force,
                harness.instanceId,
                prepared,
                harness.dispatch,
            )).not.toBeNull();
        }

        expect(resolveChecksAutomation.calls.allArgs()
            .flatMap(args => args[1] as readonly { readonly label: string }[])
            .some(check => check.label === 'Regain aerospace control')).toBeFalse();
    });

    it('uses operational CASE to reduce aerospace ammunition explosions to one SI per 20 damage', async () => {
        const harness = createHarness(true);
        expect(harness.ammoId).toBeDefined();
        expect(harness.runtime.query().remainingAmmo(harness.ammoId!)).toBe(10);
        setHeat(harness.runtime, 19);
        spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);

        const heatEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly effects?: readonly string[] }[]);
        expect(heatEvents).toHaveSize(1);
        expect(heatEvents.flatMap(event => event.effects ?? []))
            .toContain(jasmine.stringMatching(/^Ammunition explosion check \d+\+$/));
        expect(harness.runtime.query().componentStatus(harness.ammoId!, 'committed'))
            .toBe('destroyed');
        const si = [...harness.runtime.getIndex().locations.values()]
            .find(location => location.code === 'SI')!;
        expect(si.internalPoints - harness.runtime.query().remainingInternal(si.id, 'committed'))
            .toBe(5);
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.query().crewState(pilotId).wounds).toBe(1);
    });

    it('always applies an aerospace ammunition-explosion crew hit when consciousness automation is off', async () => {
        automationModes['pilotHitsAndConsciousnessCheck'] = 'no';
        const harness = createHarness(true, 'pilot-automation-off');
        setHeat(harness.runtime, 19);
        spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);

        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.query().crewState(pilotId).wounds).toBe(1);
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('pilotHitsAndConsciousnessCheck');
    });

    it('uses canonical origin/next labels for automatic aerospace heat results', async () => {
        automationModes['heatEffectsCheck'] = 'yes';
        automationModes['pilotHitsAndConsciousnessCheck'] = 'no';
        const harness = createHarness(false, 'automatic-labels');
        setHeat(harness.runtime, 14);
        spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);

        expect(showAutomationToast.calls.allArgs().map(args => args[2]))
            .toContain('Shutdown: FAILED (2 vs 4+) — unit shut down');
    });

    it('leaves an aerospace ammunition explosion wholly unapplied when consciousness is closed', async () => {
        const harness = createHarness(true, 'cancelled-consciousness');
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        const si = [...harness.runtime.getIndex().locations.values()]
            .find(location => location.code === 'SI')!;
        const initialSi = harness.runtime.query().remainingInternal(si.id, 'committed');
        setHeat(harness.runtime, 19);
        let consciousnessAttempts = 0;
        resolveChecksAutomation.and.callFake(async (
            key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
        ) => {
            if (key === 'pilotHitsAndConsciousnessCheck'
                && consciousnessAttempts++ === 0) return null;
            return resolveAutomationChecksAutomatically(checks);
        });
        spyOn(Math, 'random').and.returnValue(0);
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',

        });

        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).toBeNull();
        expect(harness.runtime.query().componentStatus(harness.ammoId!, 'committed'))
            .toBe('available');
        expect(harness.runtime.query().remainingInternal(si.id, 'committed')).toBe(initialSi);
        expect(harness.runtime.query().crewState(pilotId).wounds).toBe(0);

        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();
        expect(consciousnessAttempts).toBe(2);
        expect(harness.runtime.query().componentStatus(harness.ammoId!, 'committed'))
            .toBe('destroyed');
        expect(harness.runtime.query().remainingInternal(si.id, 'committed')).toBeLessThan(initialSi);
        expect(harness.runtime.query().crewState(pilotId).wounds).toBe(1);
    });

    it('applies aerospace pilot damage without rerolling an already-unconscious crew member', async () => {
        const harness = createHarness(true);
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.dispatch({
            kind: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
        }).accepted).toBeTrue();
        automationModes['pilotHitsAndConsciousnessCheck'] = 'yes';
        setHeat(harness.runtime, 19);
        spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);

        expect(harness.runtime.query().crewState(pilotId)).toEqual(jasmine.objectContaining({
            wounds: 2,
            unconscious: true,
        }));
        expect(showAutomationToast.calls.allArgs().some(args =>
            String(args[2]).startsWith('Consciousness check:'))).toBeFalse();
    });
});

function createHarness(withAmmo = false, suffix = '', commandConsole = false) {
    const ammo = new AmmoEquipment({
        id: 'Ammo_AC_10_Aero_Automation_Test',
        name: 'AC/10 Ammo',
        type: 'ammo',
        stats: { explosive: true },
        ammo: { type: 'AC', rackSize: 10, shots: 10, damagePerShot: 1 },
    });
    const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry(
        withAmmo ? { [ammo.id]: ammo } : {},
    ));
    if (commandConsole) entity.cockpitType.set('Command Console');
    entity.uuid.set(UUID);
    entity.structuralIntegrity.set(10);
    entity.heatSinkCount.set(0);
    let ammoId: ReturnType<typeof componentIdForMount> | undefined;
    if (withAmmo) {
        ammoId = componentIdForMount(addTestEquipment(entity, ammo, {
            location: 'Nose',
            shotsCount: 10,
        }));
        addTestEquipmentWithFlags(entity, 'F_CASE', { location: 'Nose' });
    }
    const instanceId = `${withAmmo
        ? 'unit:aero-automation-ammo'
        : 'unit:aero-automation'}${suffix ? `:${suffix}` : ''}`;
    const runtime = new NonMekUnitInstance(
        instanceId,
        baseline(),
        entity,
        CORE_2026_RULESET,
    );
    const crew = createDefaultCrewAssignment(runtime.getIndex().crewPositions);
    const snapshot = (): CBTUnitSnapshot => Object.freeze({
        instanceId,
        entity,
        index: runtime.getIndex(),
        sourceRef: baseline().entity,
        ruleset: CORE_2026_RULESET,
        crewAssignment: crew,
        state: runtime.snapshot(),
        query: runtime.query(),
    });
    const force = {
        getUnitSnapshot: () => snapshot(),
        getUnitCrewProfile: () => Object.freeze({ revision: 0, positions: crew.positions }),
    } as unknown as CBTForce;
    const dispatch = async (command: NonMekUnitCommand): Promise<CBTNonMekUnitCommandResult> => {
        return runtime.dispatch(command);
    };
    return { entity, runtime, instanceId, ammoId, force, snapshot, dispatch };
}

async function executeEndTurn(
    service: DirectNonMekAutomationService,
    harness: ReturnType<typeof createHarness>,
): Promise<void> {
    const before = harness.snapshot();
    const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
        kind: 'end-turn',

    });
    const settled = await service.settleBeforeCommand(
        harness.force,
        harness.instanceId,
        prepared,
        harness.dispatch,
    );
    if (settled === null) throw new Error('Failed to settle reviewed end-turn effects');
    const result = await harness.dispatch(settled.command);
    await service.afterCommand(
        harness.force,
        harness.instanceId,
        before,
        settled,
        result,
        harness.dispatch,
    );
}

function setHeat(
    runtime: NonMekUnitInstance,
    heat: number,
    target: 'committed' | 'pending' = 'committed',
): void {
    const result = runtime.dispatch({
        kind: 'set-heat',

        heat,
        target,
    });
    if (!result.accepted) throw new Error('Failed to seed test heat');
}

function setCondition(runtime: NonMekUnitInstance, condition: UnitConditionKey, active: boolean): void {
    const result = runtime.dispatch({
        kind: 'set-condition',

        condition,
        active,
    });
    if (!result.accepted) throw new Error('Failed to seed test condition');
}

function baseline(): InstanceBaselineRef {
    return Object.freeze({
        entity: Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        }),
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
