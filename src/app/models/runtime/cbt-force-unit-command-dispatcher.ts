// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import {
    DirectMekAutomationService,
    type DirectMekEndTurnAutomationRequest,
    type PreparedDirectMekAutomationCommand,
} from '../../services/direct-mek-automation.service';
import {
    DirectNonMekAutomationService,
    type DirectNonMekEndTurnAutomationRequest,
    type PreparedDirectNonMekAutomationCommand,
} from '../../services/direct-non-mek-automation.service';
import type { CBTForce } from '../cbt-force.model';
import type {
    CBTForceEndTurnAllResult,
    CBTForceEndTurnUnitResult,
    CBTMekUnitCommandResult,
    CBTNonMekUnitCommandResult,
} from '../cbt-force-api';
import {
    hasMekRuntime,
    hasNonMekRuntime,
    type CBTUnitSnapshot,
} from '../cbt-unit-snapshot';
import type { NonMekUnitCommand } from './non-mek-unit-instance';
import { createCommandId, type UnitInstanceId } from './runtime-state';
import type { CBTUnitCommand } from './unit-instance';
import type { MekHeatAutomationPolicyV2 } from './mek-heat-state-v2';

type PreparedForcePhaseBoundary =
    | Readonly<{
        readonly kind: 'mek';
        readonly instanceId: UnitInstanceId;
        readonly before: CBTUnitSnapshot;
        readonly prepared: PreparedDirectMekAutomationCommand;
    }>
    | Readonly<{
        readonly kind: 'non-mek';
        readonly instanceId: UnitInstanceId;
        readonly prepared: PreparedDirectNonMekAutomationCommand;
    }>;

function turnCounter(snapshot: CBTUnitSnapshot | null): number | null {
    if (snapshot && hasMekRuntime(snapshot)) return snapshot.state.turn.turnCounter;
    if (snapshot && hasNonMekRuntime(snapshot)) return snapshot.state.turn.turnCounter;
    return null;
}

export interface CBTForceUnitCommandBoundary {
    readonly readOnly: () => boolean;
    readonly instanceIds: () => readonly UnitInstanceId[];
    readonly snapshot: (instanceId: UnitInstanceId) => CBTUnitSnapshot | null;
    readonly heatPolicy: () => MekHeatAutomationPolicyV2;
    readonly dispatchMekCore: (
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
    ) => Promise<CBTMekUnitCommandResult>;
    readonly dispatchNonMekCore: (
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ) => Promise<CBTNonMekUnitCommandResult>;
    readonly endTurnForAllCore: () => Promise<CBTForceEndTurnAllResult>;
}

/**
 * Coordinates optional UI automation around force-owned command reduction.
 * It never owns Entity or runtime state; every accepted mutation crosses one
 * of the authoritative callbacks supplied by CBTForce.
 */
export class CBTForceUnitCommandDispatcher {
    private endTurnQueue: Promise<void> = Promise.resolve();

    constructor(
        private readonly force: CBTForce,
        private readonly injector: Injector,
        private readonly boundary: CBTForceUnitCommandBoundary,
    ) {}

    dispatchNonMek(
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ): Promise<CBTNonMekUnitCommandResult> {
        if (command.kind === 'end-turn' && this.nonMekAutomation()) {
            const requested = this.boundary.snapshot(instanceId);
            if (requested && hasNonMekRuntime(requested)) {
                const turnCounter = requested.state.turn.turnCounter;
                return this.enqueueEndTurn(async () => {
                    const current = this.boundary.snapshot(instanceId);
                    if (current && hasNonMekRuntime(current)
                        && current.state.turn.turnCounter !== turnCounter) {
                        return Object.freeze({
                            accepted: true as const,
                            changed: false as const,
                            state: current.state,
                        });
                    }
                    return this.dispatchNonMekWithAutomation(instanceId, command, true);
                });
            }
        }
        return this.dispatchNonMekWithAutomation(instanceId, command, true);
    }

    dispatchMek(
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
    ): Promise<CBTMekUnitCommandResult> {
        if (command.type === 'end-turn' && this.mekAutomation()) {
            const requested = this.boundary.snapshot(instanceId);
            if (requested && hasMekRuntime(requested)) {
                const turnCounter = requested.state.turn.turnCounter;
                return this.enqueueEndTurn(async () => {
                    const current = this.boundary.snapshot(instanceId);
                    if (current && hasMekRuntime(current)
                        && current.state.turn.turnCounter !== turnCounter) {
                        return Object.freeze({
                            accepted: true as const,
                            idempotent: true as const,
                            previousRevision: current.query.stateRevision,
                            state: current.state,
                            events: Object.freeze([]),
                        });
                    }
                    return this.dispatchMekWithAutomation(instanceId, command, true);
                });
            }
        }
        return this.dispatchMekWithAutomation(instanceId, command, true);
    }

    endTurnForAll(): Promise<CBTForceEndTurnAllResult> {
        if (!this.mekAutomation() && !this.nonMekAutomation()) {
            return this.boundary.endTurnForAllCore();
        }
        const requested = this.boundary.instanceIds().map(instanceId => {
            const snapshot = this.boundary.snapshot(instanceId);
            return Object.freeze({
                instanceId,
                turnCounter: turnCounter(snapshot),
            });
        });
        return this.enqueueEndTurn(async () => {
            const activeIds = requested.flatMap(row => {
                const current = this.boundary.snapshot(row.instanceId);
                return current && row.turnCounter !== null
                    && turnCounter(current) === row.turnCounter
                    ? [row.instanceId]
                    : [];
            });
            const active = activeIds.length === 0
                ? Object.freeze({
                    accepted: true,
                    changed: false,
                    atomic: false as const,
                    results: Object.freeze([]),
                })
                : await this.endTurnForAllWithAutomation(activeIds);
            const activeResults = new Map(active.results.map(row => [row.instanceId, row] as const));
            const results = requested.map(row => {
                const result = activeResults.get(row.instanceId);
                if (result) return result;
                const current = this.boundary.snapshot(row.instanceId);
                return current && row.turnCounter !== null
                    && turnCounter(current) !== row.turnCounter
                    ? Object.freeze({
                        instanceId: row.instanceId,
                        accepted: true,
                        changed: false,
                    })
                    : Object.freeze({
                        instanceId: row.instanceId,
                        accepted: false,
                        changed: false,
                        reason: 'NOT_ADMITTED',
                    });
            });
            return Object.freeze({
                accepted: results.every(result => result.accepted),
                changed: results.some(result => result.changed),
                atomic: false as const,
                results: Object.freeze(results),
            });
        });
    }

    private enqueueEndTurn<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.endTurnQueue.then(operation);
        this.endTurnQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async dispatchNonMekWithAutomation(
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
        automate: boolean,
    ): Promise<CBTNonMekUnitCommandResult> {
        const automation = automate ? this.nonMekAutomation() : null;
        let effectiveCommand = command;
        if (automation && command.kind === 'end-turn') {
            const initial = this.boundary.snapshot(instanceId);
            if (initial && hasNonMekRuntime(initial)
                && command.expectedRevision === initial.query.stateRevision) {
                const phase = await this.dispatchNonMekWithAutomation(instanceId, {
                    kind: 'end-phase',
                    expectedRevision: initial.query.stateRevision,
                }, true);
                if (!phase.accepted) return phase;
                const refreshed = this.boundary.snapshot(instanceId);
                if (!refreshed || !hasNonMekRuntime(refreshed)) {
                    return Object.freeze({
                        accepted: false,
                        changed: false,
                        reason: 'NOT_ADMITTED',
                        currentRevision: null,
                    });
                }
                effectiveCommand = {
                    ...command,
                    expectedRevision: refreshed.query.stateRevision,
                };
            }
        }
        if (!automation) return this.boundary.dispatchNonMekCore(instanceId, effectiveCommand);
        const prepared = await automation.prepareCommand(this.force, instanceId, effectiveCommand);
        if (prepared.cancelled) return this.cancelledNonMek(instanceId);
        const settled = await automation.settleBeforeCommand(
            this.force,
            instanceId,
            prepared,
            (generated, generatedAutomate = true) =>
                this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
        );
        if (settled === null) return this.cancelledNonMek(instanceId);
        const result = await this.boundary.dispatchNonMekCore(instanceId, settled.command);
        const completed = await automation.afterCommand(
            this.force,
            instanceId,
            settled,
            result,
            (generated, generatedAutomate = true) =>
                this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
        );
        return completed ? result : this.cancelledNonMek(instanceId);
    }

    private async dispatchMekWithAutomation(
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
        automate: boolean,
    ): Promise<CBTMekUnitCommandResult> {
        const automation = automate ? this.mekAutomation() : null;
        let effectiveCommand = command;
        if (automation && command.type === 'end-turn') {
            const initial = this.boundary.snapshot(instanceId);
            if (initial && hasMekRuntime(initial)
                && command.expectedRevision === initial.query.stateRevision) {
                const phase = await this.dispatchMekWithAutomation(instanceId, {
                    type: 'end-phase',
                    commandId: createCommandId(),
                    expectedRevision: initial.query.stateRevision,
                }, true);
                if (!phase.accepted) return phase;
                const refreshed = this.boundary.snapshot(instanceId);
                if (!refreshed || !hasMekRuntime(refreshed)) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'NOT_ADMITTED',
                        currentRevision: null,
                    });
                }
                effectiveCommand = { ...command, expectedRevision: refreshed.query.stateRevision };
            }
        }
        if (!automation) return this.boundary.dispatchMekCore(instanceId, effectiveCommand);
        const before = this.boundary.snapshot(instanceId);
        const prepared = await automation.prepareCommand(this.force, instanceId, effectiveCommand);
        if (prepared.cancelled) return this.cancelledMek(instanceId);
        const settled = await automation.settleBeforeCommand(
            this.force,
            instanceId,
            prepared,
            (generated, generatedAutomate = true) =>
                this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
        );
        if (settled === null) return this.cancelledMek(instanceId);
        const result = await this.boundary.dispatchMekCore(instanceId, settled.command);
        const completed = await automation.afterCommand(
            this.force,
            instanceId,
            before,
            settled,
            result,
            (generated, generatedAutomate = true) =>
                this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
        );
        return completed ? result : this.cancelledMek(instanceId);
    }

    private async endTurnForAllWithAutomation(
        instanceIds: readonly UnitInstanceId[],
    ): Promise<CBTForceEndTurnAllResult> {
        if (this.boundary.readOnly()) {
            return Object.freeze({
                accepted: false,
                changed: false,
                atomic: false as const,
                results: Object.freeze(instanceIds.map(instanceId => Object.freeze({
                    instanceId,
                    accepted: false,
                    changed: false,
                    reason: 'READ_ONLY',
                }))),
            });
        }

        const mekAutomation = this.mekAutomation();
        const nonMekAutomation = this.nonMekAutomation();

        // Review every phase before committing the first one. A cancellation
        // anywhere in a mixed force therefore leaves every unit untouched.
        const preparedPhases: PreparedForcePhaseBoundary[] = [];
        for (const instanceId of instanceIds) {
            const snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot) continue;
            if (hasMekRuntime(snapshot)) {
                const command = Object.freeze({
                    type: 'end-phase' as const,
                    commandId: createCommandId(),
                    expectedRevision: snapshot.query.stateRevision,
                });
                const prepared: PreparedDirectMekAutomationCommand = mekAutomation
                    ? await mekAutomation.prepareCommand(this.force, instanceId, command)
                    : Object.freeze({ command, deferredPilotHits: 0 });
                if (prepared.cancelled) return this.cancelledEndTurnBatch(instanceIds);
                preparedPhases.push(Object.freeze({
                    kind: 'mek',
                    instanceId,
                    before: snapshot,
                    prepared,
                }));
                continue;
            }
            if (!hasNonMekRuntime(snapshot)) continue;
            const command = Object.freeze({
                kind: 'end-phase' as const,
                expectedRevision: snapshot.query.stateRevision,
            });
            const prepared: PreparedDirectNonMekAutomationCommand = nonMekAutomation
                ? await nonMekAutomation.prepareCommand(this.force, instanceId, command)
                : Object.freeze({ command });
            if (prepared.cancelled) return this.cancelledEndTurnBatch(instanceIds);
            preparedPhases.push(Object.freeze({
                kind: 'non-mek',
                instanceId,
                prepared,
            }));
        }

        for (const phase of preparedPhases) {
            if (phase.kind === 'mek') {
                const result = await this.boundary.dispatchMekCore(
                    phase.instanceId,
                    phase.prepared.command,
                );
                if (!result.accepted) {
                    return this.failedEndTurnBatch(
                        instanceIds,
                        phase.instanceId,
                        result.reason,
                    );
                }
                const completed = !mekAutomation || await mekAutomation.afterCommand(
                    this.force,
                    phase.instanceId,
                    phase.before,
                    phase.prepared,
                    result,
                    (generated, generatedAutomate = true) =>
                        this.dispatchMekWithAutomation(
                            phase.instanceId,
                            generated,
                            generatedAutomate,
                        ),
                );
                if (!completed) return this.failedEndTurnBatch(
                    instanceIds,
                    phase.instanceId,
                    'AUTOMATION_CANCELLED',
                );
                continue;
            }
            const result = await this.boundary.dispatchNonMekCore(
                phase.instanceId,
                phase.prepared.command,
            );
            if (!result.accepted) {
                return this.failedEndTurnBatch(
                    instanceIds,
                    phase.instanceId,
                    result.reason,
                );
            }
            const completed = !nonMekAutomation || await nonMekAutomation.afterCommand(
                this.force,
                phase.instanceId,
                phase.prepared,
                result,
                (generated, generatedAutomate = true) =>
                    this.dispatchNonMekWithAutomation(
                        phase.instanceId,
                        generated,
                        generatedAutomate,
                    ),
            );
            if (!completed) return this.failedEndTurnBatch(
                instanceIds,
                phase.instanceId,
                'AUTOMATION_CANCELLED',
            );
        }

        const mekRequests: DirectMekEndTurnAutomationRequest[] = [];
        const nonMekRequests: DirectNonMekEndTurnAutomationRequest[] = [];
        for (const instanceId of instanceIds) {
            const snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot) continue;
            if (hasMekRuntime(snapshot)) {
                mekRequests.push(Object.freeze({
                    instanceId,
                    command: Object.freeze({
                        type: 'end-turn' as const,
                        commandId: createCommandId(),
                        expectedRevision: snapshot.query.stateRevision,
                        policy: this.boundary.heatPolicy(),
                    }),
                }));
            } else {
                nonMekRequests.push(Object.freeze({
                    instanceId,
                    command: Object.freeze({
                        kind: 'end-turn' as const,
                        expectedRevision: snapshot.query.stateRevision,
                    }),
                }));
            }
        }

        // Both reviews complete before the first turn mutation. This preserves
        // origin/next's cancel semantics even for a mixed force.
        const preparedMeks = mekAutomation
            ? await mekAutomation.prepareEndTurnCommands(this.force, mekRequests)
            : Object.freeze(mekRequests.map(request => Object.freeze({
                instanceId: request.instanceId,
                prepared: Object.freeze({ command: request.command, deferredPilotHits: 0 }),
            })));
        if (preparedMeks === null) return this.cancelledEndTurnBatch(instanceIds);
        const preparedNonMeks = nonMekAutomation
            ? await nonMekAutomation.prepareEndTurnCommands(this.force, nonMekRequests)
            : Object.freeze(nonMekRequests.map(request => Object.freeze({
                instanceId: request.instanceId,
                prepared: Object.freeze({ command: request.command }),
            })));
        if (preparedNonMeks === null) return this.cancelledEndTurnBatch(instanceIds);

        const preparedMekById = new Map(preparedMeks.map(row => [row.instanceId, row.prepared] as const));
        const preparedNonMekById = new Map(preparedNonMeks.map(row => [row.instanceId, row.prepared] as const));
        const settledMekById = new Map<UnitInstanceId, PreparedDirectMekAutomationCommand>();
        for (const [instanceId, prepared] of preparedMekById) {
            const settled = mekAutomation
                ? await mekAutomation.settleBeforeCommand(
                    this.force,
                    instanceId,
                    prepared,
                    (generated, generatedAutomate = true) =>
                        this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
                )
                : prepared;
            if (settled === null) {
                return this.failedEndTurnBatch(instanceIds, instanceId, 'AUTOMATION_CANCELLED');
            }
            settledMekById.set(instanceId, settled);
        }
        const settledNonMekById = new Map<UnitInstanceId, PreparedDirectNonMekAutomationCommand>();
        for (const [instanceId, prepared] of preparedNonMekById) {
            const settled = nonMekAutomation
                ? await nonMekAutomation.settleBeforeCommand(
                    this.force,
                    instanceId,
                    prepared,
                    (generated, generatedAutomate = true) =>
                        this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
                )
                : prepared;
            if (settled === null) {
                return this.failedEndTurnBatch(instanceIds, instanceId, 'AUTOMATION_CANCELLED');
            }
            settledNonMekById.set(instanceId, settled);
        }
        const results: CBTForceEndTurnUnitResult[] = [];
        for (const instanceId of instanceIds) {
            const snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot) {
                results.push(Object.freeze({
                    instanceId,
                    accepted: false,
                    changed: false,
                    reason: 'NOT_ADMITTED',
                }));
                continue;
            }
            if (hasMekRuntime(snapshot)) {
                const prepared = settledMekById.get(instanceId);
                if (!prepared) {
                    results.push(Object.freeze({
                        instanceId, accepted: false, changed: false, reason: 'NOT_ADMITTED',
                    }));
                    continue;
                }
                const result = await this.boundary.dispatchMekCore(instanceId, prepared.command);
                const completed = !mekAutomation || await mekAutomation.afterCommand(
                    this.force,
                    instanceId,
                    snapshot,
                    prepared,
                    result,
                    (generated, generatedAutomate = true) =>
                        this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
                );
                results.push(Object.freeze({
                    instanceId,
                    accepted: completed && result.accepted,
                    changed: result.accepted && !result.idempotent,
                    ...(!completed
                        ? { reason: 'AUTOMATION_CANCELLED' }
                        : !result.accepted ? { reason: result.reason } : {}),
                }));
                if (!completed) break;
                continue;
            }
            const prepared = settledNonMekById.get(instanceId);
            if (!prepared) {
                results.push(Object.freeze({
                    instanceId, accepted: false, changed: false, reason: 'NOT_ADMITTED',
                }));
                continue;
            }
            const result = await this.boundary.dispatchNonMekCore(instanceId, prepared.command);
            const completed = !nonMekAutomation || await nonMekAutomation.afterCommand(
                this.force,
                instanceId,
                prepared,
                result,
                (generated, generatedAutomate = true) =>
                    this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
            );
            results.push(Object.freeze({
                instanceId,
                accepted: completed && result.accepted,
                changed: result.accepted && result.changed,
                ...(!completed
                    ? { reason: 'AUTOMATION_CANCELLED' }
                    : !result.accepted ? { reason: result.reason } : {}),
            }));
            if (!completed) break;
        }
        const completedIds = new Set(results.map(result => result.instanceId));
        results.push(...instanceIds
            .filter(instanceId => !completedIds.has(instanceId))
            .map(instanceId => Object.freeze({
                instanceId,
                accepted: false,
                changed: false,
                reason: 'AUTOMATION_CANCELLED',
            })));
        return Object.freeze({
            accepted: results.every(result => result.accepted),
            changed: results.some(result => result.changed),
            atomic: false as const,
            results: Object.freeze(results),
        });
    }

    private cancelledEndTurnBatch(
        instanceIds: readonly UnitInstanceId[],
    ): CBTForceEndTurnAllResult {
        return Object.freeze({
            accepted: false,
            changed: false,
            atomic: false as const,
            results: Object.freeze(instanceIds.map(instanceId => Object.freeze({
                instanceId,
                accepted: false,
                changed: false,
                reason: 'AUTOMATION_CANCELLED',
            }))),
        });
    }

    private failedEndTurnBatch(
        instanceIds: readonly UnitInstanceId[],
        failedInstanceId: UnitInstanceId,
        reason: string,
    ): CBTForceEndTurnAllResult {
        return Object.freeze({
            accepted: false,
            changed: false,
            atomic: false as const,
            results: Object.freeze(instanceIds.map(instanceId => Object.freeze({
                instanceId,
                accepted: false,
                changed: false,
                reason: instanceId === failedInstanceId ? reason : 'AUTOMATION_CANCELLED',
            }))),
        });
    }

    private mekAutomation(): DirectMekAutomationService | null {
        const candidate = this.injector.get(DirectMekAutomationService, null, { optional: true });
        return candidate
            && typeof candidate.prepareCommand === 'function'
            && typeof candidate.settleBeforeCommand === 'function'
            && typeof candidate.afterCommand === 'function'
            ? candidate
            : null;
    }

    private nonMekAutomation(): DirectNonMekAutomationService | null {
        const candidate = this.injector.get(DirectNonMekAutomationService, null, { optional: true });
        return candidate
            && typeof candidate.prepareCommand === 'function'
            && typeof candidate.settleBeforeCommand === 'function'
            && typeof candidate.afterCommand === 'function'
            ? candidate
            : null;
    }

    private cancelledMek(instanceId: UnitInstanceId): CBTMekUnitCommandResult {
        const snapshot = this.boundary.snapshot(instanceId);
        return snapshot
            ? Object.freeze({
                accepted: false as const,
                reason: 'AUTOMATION_CANCELLED' as const,
                currentRevision: snapshot.query.stateRevision,
            })
            : Object.freeze({
                accepted: false as const,
                reason: 'NOT_ADMITTED' as const,
                currentRevision: null,
            });
    }

    private cancelledNonMek(instanceId: UnitInstanceId): CBTNonMekUnitCommandResult {
        const snapshot = this.boundary.snapshot(instanceId);
        return Object.freeze({
            accepted: false as const,
            changed: false as const,
            reason: snapshot ? 'AUTOMATION_CANCELLED' as const : 'NOT_ADMITTED' as const,
            currentRevision: snapshot?.query.stateRevision ?? null,
        });
    }
}
