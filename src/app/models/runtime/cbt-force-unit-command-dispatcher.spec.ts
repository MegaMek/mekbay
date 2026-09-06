// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Injector } from '@angular/core';
import type { CBTUnitCommand } from './unit-command';

import { DirectMekAutomationService } from '../../services/direct-mek-automation.service';
import { DirectNonMekAutomationService } from '../../services/direct-non-mek-automation.service';
import type { CBTForce } from '../cbt-force.model';
import type { CBTUnitSnapshot } from '../cbt-unit-snapshot';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';

import { CBTForceUnitCommandDispatcher,type CBTForceUnitCommandBoundary } from './cbt-force-unit-command-dispatcher';

describe('CBTForceUnitCommandDispatcher automation boundaries', () => {
    it('continues a second critical roll from the state reached by nested automatic crew effects', async () => {
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => ({ command, deferredPilotHits: 0 }),
            afterCommand: async (_force, _instanceId, before, prepared, _result, dispatch) => {
                if (prepared.command.type === 'apply-mek-critical-roll') {
                    const positionId = before!.crewAssignment.positions[0]!.positionId;
                    return (await dispatch({
                        type: 'set-crew-state',
                        positionId,
                        wounds: before!.query.crewState(positionId).wounds + 1,
                        unconscious: false,
                        ejected: false,
                    })).accepted;
                }
                if (prepared.command.type === 'set-crew-state') {
                    return (await dispatch({ type: 'set-heat', heat: prepared.command.wounds }, false)).accepted;
                }
                return true;
            },
        });
        const { instance, index } = harness.fixture;
        const location = [...index.locations.values()].find(row => row.code.toLowerCase() === 'll')!;
        const critical = (): CBTUnitCommand => ({
            type: 'apply-mek-critical-roll', locationId: location.id, target: 'committed',
            results: instance.query().mekCriticalRollProfile(location.id, 'committed').validRolls[0]!,
        });
        const first = await harness.dispatcher.dispatch(harness.instanceId, critical(), {
            owner: instance, state: instance.snapshot(),
        });
        expect(first.accepted).toBeTrue();
        expect(first.changed).toBeTrue();
        expect(first.state).toBe(instance.snapshot());
        expect(instance.snapshot().heat.current).toBe(1);

        const second = await harness.dispatcher.dispatch(harness.instanceId, critical(), {
            owner: instance, state: first.state!,
        });
        expect(second.accepted).toBeTrue();
        expect(second.changed).toBeTrue();
        expect(second.state).toBe(instance.snapshot());
        expect(instance.snapshot().heat.current).toBe(2);
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type)).toEqual([
            'apply-mek-critical-roll', 'set-crew-state', 'set-heat',
            'apply-mek-critical-roll', 'set-crew-state', 'set-heat',
        ]);
    });

    for (const editTiming of ['before-effects', 'after-effects'] as const) {
        it(`rejects an unrelated edit ${editTiming} without adopting its state for continuation`, async () => {
            let started!: () => void;
            let release!: () => void;
            const reviewing = new Promise<void>(resolve => started = resolve);
            const gate = new Promise<void>(resolve => release = resolve);
            let effectAccepted: boolean | undefined;
            const harness = createHarness({
                prepareCommand: async (_force, _instanceId, command) => ({ command, deferredPilotHits: 0 }),
                afterCommand: async (_force, _instanceId, _before, _prepared, _result, dispatch) => {
                    if (editTiming === 'before-effects') { started(); await gate; }
                    effectAccepted = (await dispatch({ type: 'set-heat', heat: 2 }, false)).accepted;
                    if (editTiming === 'after-effects') { started(); await gate; }
                    // Even an effect runner that ignores rejection cannot bless unrelated state.
                    return true;
                },
            });
            const pending = harness.dispatcher.dispatch(harness.instanceId, { type: 'set-heat', heat: 1 });
            await reviewing;
            const lastOwnState = harness.fixture.instance.snapshot();
            expect(harness.fixture.instance.dispatch({ type: 'set-heat', heat: 9 }).changed).toBeTrue();
            release();
            const result = await pending;
            expect(result.accepted).toBeFalse();
            expect(result.changed).toBeTrue();
            expect(result.state).toBe(lastOwnState);
            expect(result.state).not.toBe(harness.fixture.instance.snapshot());
            expect(harness.fixture.instance.snapshot().heat.current).toBe(9);
            expect(effectAccepted).toBe(editTiming === 'after-effects');
            expect(harness.dispatchCore).toHaveBeenCalledTimes(editTiming === 'after-effects' ? 2 : 1);
        });
    }

    it('does not adopt an unrelated edit while a generated effect awaits its own settlement', async () => {
        let started!: () => void;
        let release!: () => void;
        const reviewing = new Promise<void>(resolve => started = resolve);
        const gate = new Promise<void>(resolve => release = resolve);
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => ({ command, deferredPilotHits: 0 }),
            settleBeforeCommand: async (_force, _instanceId, prepared) => {
                if (prepared.command.type === 'set-heat' && prepared.command.heat === 2) {
                    started(); await gate;
                }
                return prepared;
            },
            afterCommand: async (_force, _instanceId, _before, prepared, _result, dispatch) => {
                if (prepared.command.type === 'set-heat' && prepared.command.heat === 1) {
                    return (await dispatch({ type: 'set-heat', heat: 2 })).accepted;
                }
                return true;
            },
        });
        const pending = harness.dispatcher.dispatch(harness.instanceId, { type: 'set-heat', heat: 1 });
        await reviewing;
        const lastOwnState = harness.fixture.instance.snapshot();
        harness.fixture.instance.dispatch({ type: 'set-heat', heat: 9 });
        release();
        const result = await pending;
        expect(result.accepted).toBeFalse();
        expect(result.changed).toBeTrue();
        expect(result.state).toBe(lastOwnState);
        expect(harness.fixture.instance.snapshot().heat.current).toBe(9);
        expect(harness.dispatchCore).toHaveBeenCalledTimes(1);
    });

    for (const boundary of ['end-phase', 'end-turn', 'pending-end-turn'] as const) {
        it(`rejects an unrelated edit during a pending critical review at ${boundary}`, async () => {
            let started!: () => void;
            let release!: () => void;
            const reviewing = new Promise<void>(resolve => started = resolve);
            const gate = new Promise<void>(resolve => release = resolve);
            let generatedAccepted: boolean | undefined;
            const harness = createHarness({
                prepareCommand: async (_force, _instanceId, command) => ({ command, deferredPilotHits: 0 }),
                afterCommand: async () => true,
                resumePendingAutomation: async (_force, _instanceId, dispatch) => {
                    started(); await gate;
                    generatedAccepted = (await dispatch({ type: 'set-heat', heat: 2 }, false)).accepted;
                    return generatedAccepted;
                },
            });
            if (boundary !== 'end-phase') {
                harness.fixture.instance.dispatch({ type: 'end-phase', endTurnBoundary: true });
                harness.fixture.instance.dispatch({ type: 'mark-end-turn-heat-staged' });
            }
            const pending = boundary === 'pending-end-turn'
                ? harness.dispatcher.resolvePendingAutomation(harness.instanceId)
                : harness.dispatcher.dispatch(harness.instanceId, boundary === 'end-phase'
                    ? { type: 'end-phase' } : { type: 'end-turn', policy: 'automatic' });
            await reviewing;
            harness.fixture.instance.dispatch({ type: 'set-heat', heat: 9 });
            release();
            const result = await pending;
            expect(typeof result === 'boolean' ? result : result.accepted).toBeFalse();
            expect(generatedAccepted).toBeFalse();
            expect(harness.fixture.instance.snapshot().heat.current).toBe(9);
            expect(harness.fixture.instance.snapshot().turn.turnCounter).toBe(0);
            expect(harness.dispatchCore).not.toHaveBeenCalled();
        });
    }

    it('does not mistake an ordinary completed phase for the End Turn prerequisite', async () => {
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
            }),
            afterCommand: async () => true,
        });

        expect((await harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-phase',

        })).accepted).toBeTrue();
        expect(harness.dispatcher.hasPendingEndTurn(harness.instanceId)).toBeFalse();

        expect((await harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        })).accepted).toBeTrue();
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
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

        const result = await harness.dispatcher.dispatch(harness.instanceId, command);

        expect(result).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
            state: harness.fixture.instance.snapshot(),
        }));
        expect(harness.dispatchCore).toHaveBeenCalledTimes(1);
        expect(harness.dispatchCore.calls.mostRecent().args[1].type).toBe('end-phase');
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

        const first = await harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });
        expect(first).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(harness.dispatcher.hasPendingEndTurn(harness.instanceId)).toBeTrue();

        const second = await harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });

        expect(second.accepted).toBeTrue();
        expect(harness.dispatcher.hasPendingEndTurn(harness.instanceId)).toBeFalse();
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
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

        expect((await harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        }))).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const restoredDispatcher = harness.createDispatcher();
        expect(restoredDispatcher.hasPendingEndTurn(harness.instanceId)).toBeTrue();
        expect((await restoredDispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        })).accepted).toBeTrue();

        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
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
        expect((await restoredDispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        })).accepted).toBeTrue();

        expect(prepareCommand).not.toHaveBeenCalled();
        expect(settleBeforeCommand).not.toHaveBeenCalled();
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-turn']);
        const endTurn = harness.dispatchCore.calls.mostRecent().args[1];
        expect(endTurn.type === 'end-turn' ? endTurn.policy : null).toBe('manual');
    });

    it('does not reset a heat-staged turn while its durable critical chain is unresolved', async () => {
        const resumePendingAutomation = jasmine.createSpy('resumePendingAutomation')
            .and.resolveTo(false);
        const harness = createHarness({
            prepareCommand: jasmine.createSpy('prepareCommand'),
            resumePendingAutomation,
            afterCommand: async () => true,
        });
        expect(harness.fixture.instance.dispatch({
            type: 'end-phase',
            endTurnBoundary: true,
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'mark-end-turn-heat-staged',
        }).accepted).toBeTrue();

        const result = await harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',
            policy: 'automatic',
        });

        expect(result).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(resumePendingAutomation).toHaveBeenCalledTimes(1);
        expect(harness.dispatchCore).not.toHaveBeenCalled();
        expect(harness.fixture.instance.query().turnState()).toEqual(jasmine.objectContaining({
            turnCounter: 0,
            endTurnCheckpoint: 'heat-staged',
        }));
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

        expect((await harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        }))).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 1,
        }).accepted).toBeTrue();
        expect(harness.dispatcher.hasPendingEndTurn(harness.instanceId)).toBeTrue();

        expect((await harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        })).accepted).toBeTrue();
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'mark-end-turn-heat-staged', 'end-turn']);
    });

    it('resumes a cancelled consequence from the reviewed plan without reviewing heat twice', async () => {
        const prepareCommand = jasmine.createSpy('prepareCommand')
            .and.callFake(async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
            }));
        let settlementAttempts = 0;
        const settleBeforeCommand = jasmine.createSpy('settleBeforeCommand')
            .and.callFake(async (_force, _instanceId, prepared, dispatch) => {
                if (prepared.command.type !== 'end-turn') return prepared;
                if (++settlementAttempts === 1) {
                    expect((await dispatch({ type: 'set-heat', heat: 1 }, false)).accepted).toBeTrue();
                    return null;
                }
                return prepared;
            });
        const harness = createHarness({
            prepareCommand,
            settleBeforeCommand,
            afterCommand: async () => true,
        });
        const endTurn = () => harness.dispatcher.dispatch(harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });

        expect(await endTurn())
            .toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect((await endTurn()).accepted).toBeTrue();

        expect(prepareCommand.calls.allArgs().map(([, , command]) => command.type))
            .toEqual(['end-phase', 'end-phase', 'end-turn']);
        expect(settleBeforeCommand.calls.allArgs().map(([, , prepared]) => prepared.command.type))
            .toEqual(['end-phase', 'end-phase', 'end-turn', 'end-turn']);
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual(['end-phase', 'set-heat', 'mark-end-turn-heat-staged', 'end-turn']);
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

        const result = await harness.dispatcher.dispatch(harness.instanceId, command);

        expect(result).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
            state: harness.fixture.instance.snapshot(),
        }));
        expect(harness.dispatchCore).not.toHaveBeenCalled();
    });

    it('resumes badge work interactively without committing the phase', async () => {
        const order: string[] = [];
        const resumePendingFallAutomation = jasmine.createSpy('resumePendingFallAutomation')
            .and.callFake(async () => {
                order.push('fall');
                return true;
            });
        const resumePendingAutomation = jasmine.createSpy('resumePendingAutomation')
            .and.callFake(async () => {
                order.push('critical');
                return true;
            });
        const prepareEndPhaseCommands = jasmine.createSpy('prepareEndPhaseCommands')
            .and.callFake(async (_force: CBTForce, requests: readonly Readonly<{
                instanceId: string;
                command: Extract<CBTUnitCommand, { readonly type: 'end-phase' }>;
            }>[], review: Readonly<{ phaseWork?: string }>) => {
                order.push(`prepare:${review.phaseWork}`);
                return Object.freeze(requests.map(request =>
                Object.freeze({
                    instanceId: request.instanceId,
                    prepared: Object.freeze({
                        command: request.command,
                        deferredPilotHits: 0,
                    }),
                })));
            });
        const settleBeforeCommand = jasmine.createSpy('settleBeforeCommand')
            .and.callFake(async (_force, _instanceId, prepared) => {
                order.push('settle');
                return prepared;
            });
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
            }),
            prepareEndPhaseCommands,
            settleBeforeCommand,
            resumePendingFallAutomation,
            resumePendingAutomation,
            afterCommand: async () => true,
        });

        expect(await harness.dispatcher.resolvePendingAutomation(harness.instanceId)).toBeTrue();

        expect(prepareEndPhaseCommands.calls.allArgs().map(args => args[2])).toEqual([
            { interactive: true, phaseWork: 'unit-checks' },
            { interactive: true, phaseWork: 'pilot-checks' },
        ]);
        expect(prepareEndPhaseCommands.calls.allArgs().every(args =>
            args[1][0]?.instanceId === harness.instanceId
            && args[1][0]?.command.type === 'end-phase')).toBeTrue();
        expect(settleBeforeCommand).toHaveBeenCalledTimes(2);
        expect(order).toEqual([
            'fall',
            'prepare:unit-checks',
            'settle',
            'critical',
            'prepare:pilot-checks',
            'settle',
        ]);
        expect(harness.dispatchCore).not.toHaveBeenCalled();
        expect(harness.fixture.instance.query().turnState().endTurnCheckpoint).toBeUndefined();
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
        expect(prepareCommand).toHaveBeenCalledTimes(4);
        expect(prepareEndTurnCommands).not.toHaveBeenCalled();
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
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
        expect(harness.dispatchCore).not.toHaveBeenCalled();
        expect(harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().stateRevision))
            .toEqual(revisions);
    });

    it('reports mutations completed before a later force-wide phase review closes', async () => {
        let settlements = 0;
        let harness!: ReturnType<typeof createBatchHarness>;
        const settleBeforeCommand = jasmine.createSpy('settleBeforeCommand')
            .and.callFake(async (_force, instanceId, prepared) => {
                settlements++;
                if (settlements === 1) {
                    const fixture = harness.fixtures.get(instanceId)!;
                    const turn = fixture.instance.query().turnState();
                    expect(fixture.instance.dispatch({
                        type: 'replace-turn-state',
                        turn: { ...turn, spotting: true },
                    }).accepted).toBeTrue();
                }
                return settlements === 3 ? null : prepared;
            });
        harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
            }),
            settleBeforeCommand,
            afterCommand: async () => true,
            prepareEndTurnCommands: jasmine.createSpy('prepareEndTurnCommands'),
        });

        const result = await harness.dispatcher.endPhaseForAll();

        expect(result.accepted).toBeFalse();
        expect(result.changed).toBeTrue();
        expect(result.results.map(row => row.changed)).toEqual([true, false]);
        expect(result.results.map(row => row.reason))
            .toEqual(['AUTOMATION_CANCELLED', 'AUTOMATION_CANCELLED']);
        expect(harness.dispatchCore).not.toHaveBeenCalled();
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
        expect(harness.dispatchCore).toHaveBeenCalledTimes(2);
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
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
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
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
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
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
        expect(harness.dispatchCore).not.toHaveBeenCalled();
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
        for (let turn = 0; turn < 20 && !prepareCommand.calls.any(); turn++) {
            await Promise.resolve();
        }

        expect(prepareCommand).toHaveBeenCalledTimes(1);
        expect(harness.dispatchCore).not.toHaveBeenCalled();

        const delayedCommand = prepareCommand.calls.first().args[2] as CBTUnitCommand;
        releaseFirstPhase(Object.freeze({ command: delayedCommand, deferredPilotHits: 0 }));
        const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

        expect(firstResult.accepted).toBeTrue();
        expect(firstResult.changed).toBeTrue();
        expect(duplicateResult.accepted).toBeTrue();
        expect(duplicateResult.changed).toBeFalse();
        expect(prepareEndTurnCommands).toHaveBeenCalledTimes(1);
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual([
                'end-phase', 'end-phase',
                'mark-end-turn-heat-staged', 'mark-end-turn-heat-staged',
                'end-turn', 'end-turn',
            ]);
        expect(harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().turnState().turnCounter))
            .toEqual([1, 1]);
    });

    it('skips a queued duplicate phase while allowing the queued turn after phase settlement', async () => {
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) => Object.freeze({
                command,
                deferredPilotHits: 0,
            }),
            afterCommand: async () => true,
            prepareEndTurnCommands: async (_force, requests) => Object.freeze(requests.map(request =>
                Object.freeze({
                    instanceId: request.instanceId,
                    prepared: Object.freeze({ command: request.command, deferredPilotHits: 0 }),
                }))),
        });

        const phase = harness.dispatcher.endPhaseForAll();
        const duplicatePhase = harness.dispatcher.endPhaseForAll();
        const turn = harness.dispatcher.endTurnForAll();
        const [phaseResult, duplicateResult, turnResult] = await Promise.all([phase, duplicatePhase, turn]);

        expect(phaseResult.accepted).toBeTrue();
        expect(phaseResult.changed).toBeTrue();
        expect(duplicateResult.accepted).toBeTrue();
        expect(duplicateResult.changed).toBeFalse();
        expect(duplicateResult.results.map(row => row.instanceId)).toEqual([...harness.ids]);
        expect(turnResult.accepted).toBeTrue();
        expect(turnResult.changed).toBeTrue();
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type))
            .toEqual([
                'end-phase', 'end-phase',
                'end-phase', 'end-phase',
                'mark-end-turn-heat-staged', 'mark-end-turn-heat-staged',
                'end-turn', 'end-turn',
            ]);
        expect(harness.ids.map(instanceId =>
            harness.fixtures.get(instanceId)!.instance.query().turnState().turnCounter))
            .toEqual([1, 1]);
    });
});

describe('CBTForceUnitCommandDispatcher owner fences', () => {
    it('captures the requested command before an asynchronous review can observe caller mutation', async () => {
        let started!: () => void;
        let release!: () => void;
        const reviewing = new Promise<void>(resolve => started = resolve);
        const gate = new Promise<void>(resolve => release = resolve);
        const harness = createHarness({
            prepareCommand: async (_force, _instanceId, command) => {
                started(); await gate;
                return { command, deferredPilotHits: 0 };
            },
            afterCommand: async () => true,
        });
        const command: { type: 'set-heat'; heat: number } = { type: 'set-heat', heat: 3 };
        const dispatched = harness.dispatcher.dispatch(harness.instanceId, command);
        await reviewing;
        command.heat = 19;
        release();
        expect((await dispatched).accepted).toBeTrue();
        expect(harness.fixture.instance.snapshot().heat.current).toBe(3);
    });

    it('rejects queued batch work when replacement owners have the same turn and revision', async () => {
        let started!: () => void;
        let release!: () => void;
        const reviewing = new Promise<void>(resolve => started = resolve);
        const gate = new Promise<void>(resolve => release = resolve);
        let first = true;
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) => {
                if (first) { first = false; started(); await gate; }
                return { command, deferredPilotHits: 0 };
            },
            prepareEndTurnCommands: async (_force, requests) => requests.map(request => ({
                instanceId: request.instanceId, prepared: { command: request.command, deferredPilotHits: 0 },
            })),
            afterCommand: async () => true,
        });
        const phase = harness.dispatcher.endPhaseForAll();
        const queuedTurn = harness.dispatcher.endTurnForAll();
        await reviewing;
        for (const id of harness.ids) harness.fixtures.set(id, createDirectMekRuntimeFixture('core-2026', id));
        release();
        expect((await phase).accepted).toBeFalse();
        expect((await queuedTurn).accepted).toBeFalse();
        expect(harness.dispatchCore).not.toHaveBeenCalled();
    });

    it('rejects a phase review after another edit changes the same owner', async () => {
        let started!: () => void;
        let release!: () => void;
        const reviewing = new Promise<void>(resolve => started = resolve);
        const gate = new Promise<void>(resolve => release = resolve);
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) => {
                started(); await gate;
                return { command, deferredPilotHits: 0 };
            },
            prepareEndTurnCommands: async () => [],
            afterCommand: async () => true,
        });
        const phase = harness.dispatcher.endPhaseForAll();
        await reviewing;
        expect(harness.fixtures.get(ids[1])!.instance.dispatch({ type: 'set-heat', heat: 5 }).changed).toBeTrue();
        release();
        expect((await phase).accepted).toBeFalse();
        expect(harness.dispatchCore).not.toHaveBeenCalled();
    });

    it('rejects a turn heat review changed after its own prerequisite phase completed', async () => {
        let started!: () => void;
        let release!: () => void;
        const reviewing = new Promise<void>(resolve => started = resolve);
        const gate = new Promise<void>(resolve => release = resolve);
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) => ({ command, deferredPilotHits: 0 }),
            prepareEndTurnCommands: async (_force, requests) => {
                started(); await gate;
                return requests.map(request => ({ instanceId: request.instanceId,
                    prepared: { command: request.command, deferredPilotHits: 0 } }));
            },
            afterCommand: async () => true,
        });
        const turn = harness.dispatcher.endTurnForAll();
        await reviewing;
        expect(harness.dispatchCore.calls.allArgs().map(([, command]) => command.type)).toEqual(['end-phase', 'end-phase']);
        harness.fixtures.get(ids[1])!.instance.dispatch({ type: 'set-heat', heat: 5 });
        release();
        expect((await turn).accepted).toBeFalse();
        expect(harness.dispatchCore.calls.count()).toBe(2);
    });

    it('does not apply settlement-generated edits to an owner installed while settlement waits', async () => {
        let started!: () => void;
        let release!: () => void;
        const reviewing = new Promise<void>(resolve => started = resolve);
        const gate = new Promise<void>(resolve => release = resolve);
        let attempted: { accepted: boolean } | undefined;
        const harness = createBatchHarness({
            prepareCommand: async (_force, _instanceId, command) => ({ command, deferredPilotHits: 0 }),
            prepareEndTurnCommands: async () => [],
            afterCommand: async () => true,
            settleBeforeCommand: async (_force, _instanceId, prepared, dispatch) => {
                started(); await gate;
                attempted = await dispatch({ type: 'set-heat', heat: 5 }, false);
                return prepared;
            },
        });
        const phase = harness.dispatcher.endPhaseForAll();
        await reviewing;
        harness.fixtures.set(ids[0], createDirectMekRuntimeFixture('core-2026', ids[0]));
        release();
        expect((await phase).accepted).toBeFalse();
        expect(attempted?.accepted).toBeFalse();
        expect(harness.dispatchCore).not.toHaveBeenCalled();
    });
});

const ids: readonly string[] = [
    'unit:dispatcher:batch:left',
    'unit:dispatcher:batch:right',
];

function createBatchHarness(
    automation: Pick<DirectMekAutomationService,
        'prepareCommand' | 'afterCommand' | 'prepareEndTurnCommands'>
        & Partial<Pick<DirectMekAutomationService, 'settleBeforeCommand'>>,
) {
    const completeAutomation = {
        resumePendingFallAutomation: async () => true,
        resumePendingAutomation: async () => true,
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
            uuid: fixture.identity,
            ruleset: 'core-2026' as const,
            crewAssignment: fixture.instance.query().crewAssignment(),
            editContext: { owner: fixture.instance, state: fixture.instance.snapshot() },
            state: fixture.instance.snapshot(),
            query: fixture.instance.query(),
        }) : null;
    };
    const dispatchCore = jasmine.createSpy('dispatchCore')
        .and.callFake(async (instanceId: typeof ids[number], command: CBTUnitCommand) =>
            fixtures.get(instanceId)!.instance.dispatch(command));
    const boundary: CBTForceUnitCommandBoundary = {
        readOnly: () => false,
        instanceIds: () => ids,
        snapshot,
        heatPolicy: () => 'automatic',
        dispatchCore,
        endTurnForAllCore: jasmine.createSpy('endTurnForAllCore'),
    };
    const injector = {
        get: (token: unknown) => token === DirectMekAutomationService ? completeAutomation : null,
    } as unknown as Injector;
    const force = { getUnitSnapshot: snapshot } as unknown as CBTForce;
    return {
        dispatcher: new CBTForceUnitCommandDispatcher(force, injector, boundary),
        dispatchCore,
        fixtures,
        ids,
    };
}

function createHarness(
    automation: Pick<DirectMekAutomationService, 'prepareCommand' | 'afterCommand'>
        & Partial<Pick<DirectMekAutomationService,
            'settleBeforeCommand' | 'prepareEndPhaseCommands' | 'prepareEndTurnCommands'
                | 'resumePendingFallAutomation' | 'resumePendingAutomation'>>,
) {
    const instanceId = 'unit:dispatcher:automation';
    const fixture = createDirectMekRuntimeFixture('core-2026', instanceId);
    const snapshot = (): CBTUnitSnapshot => Object.freeze({
        instanceId,
        entity: fixture.entity,
        index: fixture.index,
        uuid: fixture.identity,
        ruleset: 'core-2026',
        crewAssignment: fixture.instance.query().crewAssignment(),
        editContext: { owner: fixture.instance, state: fixture.instance.snapshot() },
        state: fixture.instance.snapshot(),
        query: fixture.instance.query(),
    });
    const dispatchCore = jasmine.createSpy('dispatchCore')
        .and.callFake(async (_instanceId, command: CBTUnitCommand) => fixture.instance.dispatch(command));
    const boundary: CBTForceUnitCommandBoundary = {
        readOnly: () => false,
        instanceIds: () => [instanceId],
        snapshot: requested => requested === instanceId ? snapshot() : null,
        heatPolicy: () => 'automatic',
        dispatchCore,
        endTurnForAllCore: jasmine.createSpy('endTurnForAllCore'),
    };
    const injector = {
        get: (token: unknown) => token === DirectMekAutomationService
            ? {
                resumePendingFallAutomation: async () => true,
                resumePendingAutomation: async () => true,
                prepareEndPhaseCommands: async (
                    force: CBTForce,
                    requests: readonly {
                        readonly instanceId: typeof instanceId;
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
    return { dispatcher, createDispatcher, fixture, instanceId, dispatchCore };
}
