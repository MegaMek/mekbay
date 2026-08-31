// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Injector } from '@angular/core';

import type { CBTForce } from '../cbt-force.model';
import type { CBTUnitSnapshot } from '../cbt-unit-snapshot';
import { DirectMekAutomationService } from '../../services/direct-mek-automation.service';
import { DirectNonMekAutomationService } from '../../services/direct-non-mek-automation.service';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { asCommandId, asUnitInstanceId } from './runtime-state';
import type { CBTUnitCommand } from './unit-instance';
import {
    CBTForceUnitCommandDispatcher,
    type CBTForceUnitCommandBoundary,
} from './cbt-force-unit-command-dispatcher';

describe('CBTForceUnitCommandDispatcher automation boundaries', () => {
    it('does not dispatch an end turn whose heat review was cancelled', async () => {
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
                ...(command.type === 'end-turn' ? { cancelled: true as const } : {}),
            }),
            afterCommand: async () => true,
        });
        const command: CBTUnitCommand = {
            type: 'end-turn',
            commandId: asCommandId('dispatcher:cancelled:heat'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
            policy: 'automatic',
        };

        const result = await harness.dispatcher.dispatchMek(harness.instanceId, command);

        expect(result.accepted).toBeFalse();
        if (result.accepted) return;
        expect(result.reason).toBe('AUTOMATION_CANCELLED');
        expect(result.currentRevision).toBe(harness.fixture.instance.query().stateRevision);
        expect(Number(result.currentRevision)).toBe(Number(command.expectedRevision) + 1);
        expect(harness.dispatchMekCore).toHaveBeenCalledTimes(1);
        expect(harness.dispatchMekCore.calls.mostRecent().args[1].type).toBe('end-phase');
    });

    it('does not commit a phase whose preflight review closes', async () => {
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
                cancelled: true as const,
            }),
            afterCommand: async () => true,
        });
        const command: CBTUnitCommand = {
            type: 'end-phase',
            commandId: asCommandId('dispatcher:cancelled:phase'),
            expectedRevision: harness.fixture.instance.query().stateRevision,
        };

        const result = await harness.dispatcher.dispatchMek(harness.instanceId, command);

        expect(result.accepted).toBeFalse();
        if (result.accepted) return;
        expect(result.reason).toBe('AUTOMATION_CANCELLED');
        expect(result.currentRevision).toBe(harness.fixture.instance.query().stateRevision);
        expect(result.currentRevision).toBe(command.expectedRevision);
        expect(harness.dispatchMekCore).not.toHaveBeenCalled();
    });

    it('cancels a force-wide heat review before dispatching any unit end turn', async () => {
        const prepareEndTurnCommands = jasmine.createSpy('prepareEndTurnCommands')
            .and.resolveTo(null);
        const harness = createBatchHarness({
            prepareCommand: async (_force: CBTForce, _instanceId: typeof ids[number], command: CBTUnitCommand) =>
                Object.freeze({ command, deferredPilotHits: 0 }),
            afterCommand: async () => true,
            prepareEndTurnCommands,
        });

        const result = await harness.dispatcher.endTurnForAll();

        expect(result.accepted).toBeFalse();
        expect(result.changed).toBeFalse();
        expect(result.results.map(row => row.reason))
            .toEqual(['AUTOMATION_CANCELLED', 'AUTOMATION_CANCELLED']);
        expect(prepareEndTurnCommands).toHaveBeenCalledTimes(1);
        expect(prepareEndTurnCommands.calls.mostRecent().args[1]).toHaveSize(2);
        expect(harness.dispatchMekCore).toHaveBeenCalledTimes(2);
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'end-phase']);
    });

    it('reviews every force phase before mutating the first unit', async () => {
        let phaseReview = 0;
        const prepareEndTurnCommands = jasmine.createSpy('prepareEndTurnCommands');
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
                ...(command.type === 'end-phase' && ++phaseReview === 2
                    ? { cancelled: true as const }
                    : {}),
            }),
            afterCommand: async () => true,
            prepareEndTurnCommands,
        });
        const revisions = harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().stateRevision);

        const result = await harness.dispatcher.endTurnForAll();

        expect(result.accepted).toBeFalse();
        expect(result.changed).toBeFalse();
        expect(harness.dispatchMekCore).not.toHaveBeenCalled();
        expect(prepareEndTurnCommands).not.toHaveBeenCalled();
        expect(harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().stateRevision))
            .toEqual(revisions);
    });

    it('serializes duplicate force end turns and skips turns already committed by the first request', async () => {
        let releaseFirstPhase!: (prepared: Readonly<{
            readonly command: CBTUnitCommand;
            readonly deferredPilotHits: 0;
        }>) => void;
        let delayed = true;
        const prepareCommand = jasmine.createSpy('prepareCommand')
            .and.callFake(async (_force: CBTForce, _instanceId: typeof ids[number], command: CBTUnitCommand) => {
                if (command.type === 'end-phase' && delayed) {
                    delayed = false;
                    return new Promise<Readonly<{
                        readonly command: CBTUnitCommand;
                        readonly deferredPilotHits: 0;
                    }>>(resolve => releaseFirstPhase = resolve);
                }
                return Object.freeze({ command, deferredPilotHits: 0 as const });
            });
        const prepareEndTurnCommands = jasmine.createSpy('prepareEndTurnCommands')
            .and.callFake(async (_force: CBTForce, requests: readonly {
                readonly instanceId: typeof ids[number];
                readonly command: Extract<CBTUnitCommand, { readonly type: 'end-turn' }>;
            }[]) => Object.freeze(requests.map(request => Object.freeze({
                instanceId: request.instanceId,
                prepared: Object.freeze({ command: request.command, deferredPilotHits: 0 as const }),
            }))));
        const harness = createBatchHarness({
            prepareCommand,
            afterCommand: async () => true,
            prepareEndTurnCommands,
        });

        const first = harness.dispatcher.endTurnForAll();
        const duplicate = harness.dispatcher.endTurnForAll();
        await Promise.resolve();
        await Promise.resolve();

        expect(prepareCommand).toHaveBeenCalledTimes(1);
        expect(harness.dispatchMekCore).not.toHaveBeenCalled();

        const delayedCommand = prepareCommand.calls.first().args[2] as CBTUnitCommand;
        releaseFirstPhase(Object.freeze({ command: delayedCommand, deferredPilotHits: 0 }));
        const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

        expect(firstResult.accepted).toBeTrue();
        expect(firstResult.changed).toBeTrue();
        expect(duplicateResult.accepted).toBeTrue();
        expect(duplicateResult.changed).toBeFalse();
        expect(prepareEndTurnCommands).toHaveBeenCalledTimes(1);
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'end-phase', 'end-turn', 'end-turn']);
        expect(harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().turnState().turnCounter))
            .toEqual([1, 1]);
    });
});

const ids = [
    asUnitInstanceId('unit:dispatcher:batch:left'),
    asUnitInstanceId('unit:dispatcher:batch:right'),
] as const;

function createBatchHarness(
    automation: Pick<DirectMekAutomationService,
        'prepareCommand' | 'afterCommand' | 'prepareEndTurnCommands'>,
) {
    const completeAutomation = {
        settleBeforeCommand: async (
            _force: CBTForce,
            _instanceId: typeof ids[number],
            prepared: Awaited<ReturnType<DirectMekAutomationService['prepareCommand']>>,
        ) => prepared,
        ...automation,
    } as unknown as DirectMekAutomationService;
    const fixtures = new Map(ids.map(instanceId => [
        instanceId,
        createDirectMekRuntimeFixture('core-2026', instanceId),
    ] as const));
    const snapshot = (instanceId: typeof ids[number]): CBTUnitSnapshot | null => {
        const fixture = fixtures.get(instanceId);
        return fixture ? Object.freeze({
            instanceId,
            entity: fixture.entity,
            index: fixture.index,
            sourceRef: fixture.identity,
            ruleset: 'core-2026' as const,
            state: fixture.instance.snapshot(),
            query: fixture.instance.query(),
        }) : null;
    };
    const dispatchMekCore = jasmine.createSpy('dispatchMekCore')
        .and.callFake(async (instanceId: typeof ids[number], command: CBTUnitCommand) =>
            fixtures.get(instanceId)!.instance.dispatch(command));
    const boundary: CBTForceUnitCommandBoundary = {
        readOnly: () => false,
        instanceIds: () => ids,
        snapshot,
        heatPolicy: () => 'automatic',
        dispatchMekCore,
        dispatchNonMekCore: jasmine.createSpy('dispatchNonMekCore'),
        endTurnForAllCore: jasmine.createSpy('endTurnForAllCore'),
    };
    const injector = {
        get: (token: unknown) => token === DirectMekAutomationService ? completeAutomation : null,
    } as unknown as Injector;
    const force = { getUnitSnapshot: snapshot } as unknown as CBTForce;
    return {
        dispatcher: new CBTForceUnitCommandDispatcher(force, injector, boundary),
        dispatchMekCore,
        fixtures,
        ids,
    };
}

function createHarness(automation: Pick<DirectMekAutomationService, 'prepareCommand' | 'afterCommand'>) {
    const instanceId = asUnitInstanceId('unit:dispatcher:automation');
    const fixture = createDirectMekRuntimeFixture('core-2026', instanceId);
    const snapshot = (): CBTUnitSnapshot => Object.freeze({
        instanceId,
        entity: fixture.entity,
        index: fixture.index,
        sourceRef: fixture.identity,
        ruleset: 'core-2026',
        state: fixture.instance.snapshot(),
        query: fixture.instance.query(),
    });
    const dispatchMekCore = jasmine.createSpy('dispatchMekCore')
        .and.callFake(async (_instanceId, command: CBTUnitCommand) => fixture.instance.dispatch(command));
    const boundary: CBTForceUnitCommandBoundary = {
        readOnly: () => false,
        instanceIds: () => [instanceId],
        snapshot: requested => requested === instanceId ? snapshot() : null,
        heatPolicy: () => 'automatic',
        dispatchMekCore,
        dispatchNonMekCore: jasmine.createSpy('dispatchNonMekCore'),
        endTurnForAllCore: jasmine.createSpy('endTurnForAllCore'),
    };
    const injector = {
        get: (token: unknown) => token === DirectMekAutomationService
            ? {
                settleBeforeCommand: async (
                    _force: CBTForce,
                    _instanceId: typeof instanceId,
                    prepared: Awaited<ReturnType<DirectMekAutomationService['prepareCommand']>>,
                ) => prepared,
                ...automation,
            }
            : token === DirectNonMekAutomationService ? null : null,
    } as unknown as Injector;
    const force = { getUnitSnapshot: snapshot } as unknown as CBTForce;
    const dispatcher = new CBTForceUnitCommandDispatcher(force, injector, boundary);
    return { dispatcher, fixture, instanceId, dispatchMekCore };
}
