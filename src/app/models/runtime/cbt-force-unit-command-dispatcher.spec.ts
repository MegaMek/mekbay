// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Injector } from '@angular/core';

import type { CBTForce } from '../cbt-force.model';
import type { CBTUnitSnapshot } from '../cbt-unit-snapshot';
import { DirectMekAutomationService } from '../../services/direct-mek-automation.service';
import { DirectNonMekAutomationService } from '../../services/direct-non-mek-automation.service';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { asUnitInstanceId } from './runtime-state';
import type { CBTUnitCommand } from './unit-instance';
import {
    CBTForceUnitCommandDispatcher,
    type CBTForceUnitCommandBoundary,
} from './cbt-force-unit-command-dispatcher';

describe('CBTForceUnitCommandDispatcher automation boundaries', () => {
    it('does not mistake an ordinary completed phase for the End Turn prerequisite', async () => {
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
            }),
            afterCommand: async () => true,
        });

        expect((await harness.dispatcher.dispatchMek(harness.instanceId, {
            type: 'end-phase',


        })).accepted).toBeTrue();
        expect(harness.dispatcher.hasPendingEndTurn(harness.instanceId)).toBeFalse();

        expect((await harness.dispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        })).accepted).toBeTrue();
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'end-phase', 'mark-end-turn-heat-staged', 'end-turn']);
    });

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


            policy: 'automatic',
        };

        const result = await harness.dispatcher.dispatchMek(harness.instanceId, command);

        expect(result).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
            state: harness.fixture.instance.snapshot(),
        }));
        expect(harness.dispatchMekCore).toHaveBeenCalledTimes(1);
        expect(harness.dispatchMekCore.calls.mostRecent().args[1].type).toBe('end-phase');
    });

    it('resumes a cancelled single-unit end turn without ending its phase twice', async () => {
        let endTurnReviews = 0;
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
                ...(command.type === 'end-turn' && ++endTurnReviews === 1
                    ? { cancelled: true as const }
                    : {}),
            }),
            afterCommand: async () => true,
        });

        const first = await harness.dispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });
        expect(first).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(harness.dispatcher.hasPendingEndTurn(harness.instanceId)).toBeTrue();

        const second = await harness.dispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });

        expect(second.accepted).toBeTrue();
        expect(harness.dispatcher.hasPendingEndTurn(harness.instanceId)).toBeFalse();
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'mark-end-turn-heat-staged', 'end-turn']);
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(1);
    });

    it('persists the completed phase boundary when the dispatcher is reconstructed', async () => {
        let endTurnReviews = 0;
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
                ...(command.type === 'end-turn' && ++endTurnReviews === 1
                    ? { cancelled: true as const }
                    : {}),
            }),
            afterCommand: async () => true,
        });

        expect((await harness.dispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        }))).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const restoredDispatcher = harness.createDispatcher();
        expect(restoredDispatcher.hasPendingEndTurn(harness.instanceId)).toBeTrue();
        expect((await restoredDispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        })).accepted).toBeTrue();

        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'mark-end-turn-heat-staged', 'end-turn']);
    });

    it('commits a restored heat-staged turn without reviewing or settling heat again', async () => {
        const prepareCommand = jasmine.createSpy('prepareCommand');
        const settleBeforeCommand = jasmine.createSpy('settleBeforeCommand');
        const harness = createHarness({
            prepareCommand,
            settleBeforeCommand,
            afterCommand: async () => true,
        });
        expect(harness.fixture.instance.dispatch({
            type: 'end-phase',


            endTurnBoundary: true,
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'mark-end-turn-heat-staged',


        }).accepted).toBeTrue();

        const restoredDispatcher = harness.createDispatcher();
        expect((await restoredDispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        })).accepted).toBeTrue();

        expect(prepareCommand).not.toHaveBeenCalled();
        expect(settleBeforeCommand).not.toHaveBeenCalled();
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-turn']);
        const endTurn = harness.dispatchMekCore.calls.mostRecent().args[1];
        expect(endTurn.type === 'end-turn' ? endTurn.policy : null).toBe('manual');
    });

    it('keeps the phase checkpoint while invalidating a reviewed plan after unrelated runtime changes', async () => {
        let endTurnReviews = 0;
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
                ...(command.type === 'end-turn' && ++endTurnReviews === 1
                    ? { cancelled: true as const }
                    : {}),
            }),
            afterCommand: async () => true,
        });

        expect((await harness.dispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        }))).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',


            heat: 1,
        }).accepted).toBeTrue();
        expect(harness.dispatcher.hasPendingEndTurn(harness.instanceId)).toBeTrue();

        expect((await harness.dispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        })).accepted).toBeTrue();
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'mark-end-turn-heat-staged', 'end-turn']);
    });

    it('resumes a cancelled consequence from the reviewed plan without reviewing heat twice', async () => {
        const prepareCommand = jasmine.createSpy('prepareCommand')
            .and.callFake(async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
            }));
        let settlementAttempts = 0;
        let mutateRuntime = (): number => 0;
        const settleBeforeCommand = jasmine.createSpy('settleBeforeCommand')
            .and.callFake(async (_force, _instanceId, prepared) => {
                if (prepared.command.type !== 'end-turn') return prepared;
                if (++settlementAttempts === 1) {
                    mutateRuntime();
                    return null;
                }
                return prepared;
            });
        const harness = createHarness({
            prepareCommand,
            settleBeforeCommand,
            afterCommand: async () => true,
        });
        mutateRuntime = () => {
            if (settlementAttempts === 1) {
                expect(harness.fixture.instance.dispatch({
                    type: 'set-heat',


                    heat: 1,
                }).accepted).toBeTrue();
            }
            return harness.fixture.instance.query().stateRevision;
        };

        const endTurn = () => harness.dispatcher.dispatchMek(harness.instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });

        expect(await endTurn())
            .toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect((await endTurn()).accepted).toBeTrue();

        expect(prepareCommand.calls.allArgs().map(([, , command]) => command.type))
            .toEqual(['end-phase', 'end-turn']);
        expect(settleBeforeCommand.calls.allArgs().map(([, , prepared]) => prepared.command.type))
            .toEqual(['end-phase', 'end-turn', 'end-turn']);
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'mark-end-turn-heat-staged', 'end-turn']);
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


        };

        const result = await harness.dispatcher.dispatchMek(harness.instanceId, command);

        expect(result).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
            state: harness.fixture.instance.snapshot(),
        }));
        expect(harness.dispatchMekCore).not.toHaveBeenCalled();
    });

    it('ends the phase for every unit without entering end-turn heat work', async () => {
        const prepareCommand = jasmine.createSpy('prepareCommand')
            .and.callFake(async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0 as const,
            }));
        const prepareEndTurnCommands = jasmine.createSpy('prepareEndTurnCommands');
        const harness = createBatchHarness({
            prepareCommand,
            afterCommand: async () => true,
            prepareEndTurnCommands,
        });

        const result = await harness.dispatcher.endPhaseForAll();

        expect(result.accepted).toBeTrue();
        expect(result.changed).toBeTrue();
        expect(result.results.map(row => row.instanceId)).toEqual([...harness.ids]);
        expect(result.results.every(row => row.accepted && row.changed)).toBeTrue();
        expect(prepareCommand).toHaveBeenCalledTimes(2);
        expect(prepareEndTurnCommands).not.toHaveBeenCalled();
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'end-phase']);
        expect(harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().turnState().turnCounter))
            .toEqual([0, 0]);
    });

    it('preflights every all-unit phase before committing the first unit', async () => {
        let reviewed = 0;
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
                ...(++reviewed === 2 ? { cancelled: true as const } : {}),
            }),
            afterCommand: async () => true,
            prepareEndTurnCommands: jasmine.createSpy('prepareEndTurnCommands'),
        });
        const revisions = harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().stateRevision);

        const result = await harness.dispatcher.endPhaseForAll();

        expect(result.accepted).toBeFalse();
        expect(result.changed).toBeFalse();
        expect(result.results.map(row => row.reason))
            .toEqual(['AUTOMATION_CANCELLED', 'AUTOMATION_CANCELLED']);
        expect(harness.dispatchMekCore).not.toHaveBeenCalled();
        expect(harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().stateRevision))
            .toEqual(revisions);
    });

    it('cancels force-wide heat before any turn reset and reports the committed phases', async () => {
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
        expect(result.changed).toBeTrue();
        expect(result.results.every(row => row.changed)).toBeTrue();
        expect(result.results.map(row => row.reason))
            .toEqual(['AUTOMATION_CANCELLED', 'AUTOMATION_CANCELLED']);
        expect(prepareEndTurnCommands).toHaveBeenCalledTimes(1);
        expect(prepareEndTurnCommands.calls.mostRecent().args[1]).toHaveSize(2);
        expect(harness.dispatchMekCore).toHaveBeenCalledTimes(2);
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'end-phase']);
    });

    it('resumes force-wide end turn after a closed heat review without repeating phases', async () => {
        let attempts = 0;
        const prepareEndTurnCommands = jasmine.createSpy('prepareEndTurnCommands')
            .and.callFake(async (_force: CBTForce, requests: readonly {
                readonly instanceId: typeof ids[number];
                readonly command: Extract<CBTUnitCommand, { readonly type: 'end-turn' }>;
            }[]) => ++attempts === 1 ? null : Object.freeze(requests.map(request => Object.freeze({
                instanceId: request.instanceId,
                prepared: Object.freeze({ command: request.command, deferredPilotHits: 0 as const }),
            }))));
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) =>
                Object.freeze({ command, deferredPilotHits: 0 }),
            afterCommand: async () => true,
            prepareEndTurnCommands,
        });

        const first = await harness.dispatcher.endTurnForAll();
        expect(first.accepted).toBeFalse();
        expect(harness.ids.every(instanceId =>
            harness.dispatcher.hasPendingEndTurn(instanceId))).toBeTrue();

        const second = await harness.dispatcher.endTurnForAll();
        expect(second.accepted).toBeTrue();
        expect(harness.ids.some(instanceId =>
            harness.dispatcher.hasPendingEndTurn(instanceId))).toBeFalse();
        expect(prepareEndTurnCommands).toHaveBeenCalledTimes(2);
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual([
                'end-phase', 'end-phase',
                'mark-end-turn-heat-staged', 'mark-end-turn-heat-staged',
                'end-turn', 'end-turn',
            ]);
        expect(harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().turnState().turnCounter))
            .toEqual([1, 1]);
    });

    it('does not settle an earlier unit twice when a later force consequence is cancelled', async () => {
        const prepareEndTurnCommands = jasmine.createSpy('prepareEndTurnCommands')
            .and.callFake(async (_force: CBTForce, requests: readonly {
                readonly instanceId: typeof ids[number];
                readonly command: Extract<CBTUnitCommand, { readonly type: 'end-turn' }>;
            }[]) => Object.freeze(requests.map(request => Object.freeze({
                instanceId: request.instanceId,
                prepared: Object.freeze({ command: request.command, deferredPilotHits: 0 as const }),
            }))));
        let rightAttempts = 0;
        const settleBeforeCommand = jasmine.createSpy('settleBeforeCommand')
            .and.callFake(async (_force, instanceId, prepared) => {
                if (prepared.command.type !== 'end-turn' || instanceId !== ids[1]) return prepared;
                return ++rightAttempts === 1 ? null : prepared;
            });
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) =>
                Object.freeze({ command, deferredPilotHits: 0 }),
            prepareEndTurnCommands,
            settleBeforeCommand,
            afterCommand: async () => true,
        });

        expect((await harness.dispatcher.endTurnForAll()).accepted).toBeFalse();
        expect((await harness.dispatcher.endTurnForAll()).accepted).toBeTrue();

        expect(prepareEndTurnCommands).toHaveBeenCalledTimes(1);
        expect(settleBeforeCommand.calls.allArgs()
            .filter(([, instanceId, prepared]) => prepared.command.type === 'end-turn'
                && instanceId === ids[0])).toHaveSize(1);
        expect(settleBeforeCommand.calls.allArgs()
            .filter(([, instanceId, prepared]) => prepared.command.type === 'end-turn'
                && instanceId === ids[1])).toHaveSize(2);
        expect(harness.dispatchMekCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual([
                'end-phase', 'end-phase',
                'mark-end-turn-heat-staged', 'mark-end-turn-heat-staged',
                'end-turn', 'end-turn',
            ]);
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
            .toEqual([
                'end-phase', 'end-phase',
                'mark-end-turn-heat-staged', 'mark-end-turn-heat-staged',
                'end-turn', 'end-turn',
            ]);
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
        'prepareCommand' | 'afterCommand' | 'prepareEndTurnCommands'>
        & Partial<Pick<DirectMekAutomationService, 'settleBeforeCommand'>>,
) {
    const completeAutomation = {
        prepareEndPhaseCommands: async (
            force: CBTForce,
            requests: readonly {
                readonly instanceId: typeof ids[number];
                readonly command: Extract<CBTUnitCommand, { readonly type: 'end-phase' }>;
            }[],
        ) => {
            const rows = [];
            for (const request of requests) {
                const prepared = await automation.prepareCommand(
                    force,
                    request.instanceId,
                    request.command,
                );
                if (prepared.cancelled) return null;
                rows.push(Object.freeze({ instanceId: request.instanceId, prepared }));
            }
            return Object.freeze(rows);
        },
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
            crewAssignment: fixture.instance.query().crewAssignment(),
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

function createHarness(
    automation: Pick<DirectMekAutomationService, 'prepareCommand' | 'afterCommand'>
        & Partial<Pick<DirectMekAutomationService, 'settleBeforeCommand'>>,
) {
    const instanceId = asUnitInstanceId('unit:dispatcher:automation');
    const fixture = createDirectMekRuntimeFixture('core-2026', instanceId);
    const snapshot = (): CBTUnitSnapshot => Object.freeze({
        instanceId,
        entity: fixture.entity,
        index: fixture.index,
        sourceRef: fixture.identity,
        ruleset: 'core-2026',
        crewAssignment: fixture.instance.query().crewAssignment(),
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
    const createDispatcher = () => new CBTForceUnitCommandDispatcher(force, injector, boundary);
    const dispatcher = createDispatcher();
    return { dispatcher, createDispatcher, fixture, instanceId, dispatchMekCore };
}
