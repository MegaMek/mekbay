// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import {
    DirectMekAutomationService,
    type DirectMekEndPhaseAutomationRequest,
    type DirectMekEndTurnAutomationRequest,
    type PreparedDirectMekAutomationCommand,
} from '../../services/direct-mek-automation.service';
import {
    DirectNonMekAutomationService,
    type DirectNonMekEndPhaseAutomationRequest,
    type DirectNonMekEndTurnAutomationRequest,
    type PreparedDirectNonMekAutomationCommand,
} from '../../services/direct-non-mek-automation.service';
import type { CBTForce } from '../cbt-force.model';
import type {
    CBTForceEndTurnAllResult,
    CBTForceEndTurnUnitResult,
    CBTMekUnitCommandResult,
    CBTNonMekUnitCommandResult,
} from '../cbt-force.types';
import { hasMekRuntime, hasNonMekRuntime, type CBTUnitSnapshot } from '../cbt-unit-snapshot';
import type { NonMekUnitCommand } from './non-mek-unit-instance';
import type { CBTUnitCommand } from './unit-instance';
import type { MekHeatAutomationPolicyV2 } from './mek-heat-state-v2';

type PreparedForcePhaseBoundary =
    | Readonly<{
        readonly kind: 'mek';
        readonly instanceId: string;
        readonly before: CBTUnitSnapshot;
        readonly prepared: PreparedDirectMekAutomationCommand;
    }>
    | Readonly<{
        readonly kind: 'non-mek';
        readonly instanceId: string;
        readonly before: CBTUnitSnapshot;
        readonly prepared: PreparedDirectNonMekAutomationCommand;
    }>;

type PendingEndTurnSettlement =
    | Readonly<{
        readonly kind: 'mek';
        readonly turn: number;
        readonly revision: number;
        readonly prepared: PreparedDirectMekAutomationCommand;
        readonly settled: boolean;
    }>
    | Readonly<{
        readonly kind: 'non-mek';
        readonly turn: number;
        readonly revision: number;
        readonly prepared: PreparedDirectNonMekAutomationCommand;
        readonly settled: boolean;
    }>;

function turnCounter(snapshot: CBTUnitSnapshot | null): number | null {
    if (snapshot && hasMekRuntime(snapshot)) return snapshot.state.turn.turnCounter;
    if (snapshot && hasNonMekRuntime(snapshot)) return snapshot.state.turn.turnCounter;
    return null;
}

function stateRevision(snapshot: CBTUnitSnapshot | null): number | null {
    return snapshot?.query.stateRevision ?? null;
}

export interface CBTForceUnitCommandBoundary {
    readonly readOnly: () => boolean;
    readonly instanceIds: () => readonly string[];
    readonly snapshot: (instanceId: string) => CBTUnitSnapshot | null;
    readonly heatPolicy: () => MekHeatAutomationPolicyV2;
    readonly dispatchMekCore: (
        instanceId: string,
        command: CBTUnitCommand,
    ) => Promise<CBTMekUnitCommandResult>;
    readonly dispatchNonMekCore: (
        instanceId: string,
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
    private boundaryQueue: Promise<void> = Promise.resolve();
    /** Reviewed/partially-applied work retained only until this End Turn completes. */
    private readonly pendingEndTurnSettlements = new Map<string, PendingEndTurnSettlement>();

    constructor(
        private readonly force: CBTForce,
        private readonly injector: Injector,
        private readonly boundary: CBTForceUnitCommandBoundary,
    ) {}

    dispatchNonMek(
        instanceId: string,
        command: NonMekUnitCommand,
    ): Promise<CBTNonMekUnitCommandResult> {
        if (command.kind === 'end-turn' && this.nonMekAutomation()) {
            const requested = this.boundary.snapshot(instanceId);
            if (requested && hasNonMekRuntime(requested)) {
                const turnCounter = requested.state.turn.turnCounter;
                return this.enqueueBoundary(async () => {
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
        instanceId: string,
        command: CBTUnitCommand,
    ): Promise<CBTMekUnitCommandResult> {
        if (command.type === 'end-turn' && this.mekAutomation()) {
            const requested = this.boundary.snapshot(instanceId);
            if (requested && hasMekRuntime(requested)) {
                const turnCounter = requested.state.turn.turnCounter;
                return this.enqueueBoundary(async () => {
                    const current = this.boundary.snapshot(instanceId);
                    if (current && hasMekRuntime(current)
                        && current.state.turn.turnCounter !== turnCounter) {
                        return Object.freeze({
                            accepted: true,
                            changed: false,
                            state: current.state,
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
        return this.enqueueBoundary(async () => {
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

    endPhaseForAll(): Promise<CBTForceEndTurnAllResult> {
        const requested = this.boundary.instanceIds().map(instanceId => Object.freeze({
            instanceId,
            stateRevision: stateRevision(this.boundary.snapshot(instanceId)),
        }));
        return this.enqueueBoundary(async () => {
            const activeIds = requested.flatMap(row => {
                const current = this.boundary.snapshot(row.instanceId);
                return current && row.stateRevision !== null
                    && stateRevision(current) === row.stateRevision
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
                : await this.endPhaseForAllWithAutomation(activeIds);
            const activeResults = new Map(active.results.map(row => [row.instanceId, row] as const));
            const results = requested.map(row => {
                const result = activeResults.get(row.instanceId);
                if (result) return result;
                const current = this.boundary.snapshot(row.instanceId);
                return current && row.stateRevision !== null
                    && stateRevision(current) !== row.stateRevision
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

    hasPendingEndTurn(instanceId: string): boolean {
        const snapshot = this.boundary.snapshot(instanceId);
        return snapshot !== null && this.phaseAlreadyEnded(snapshot);
    }

    /**
     * Origin/next badge semantics: drain the currently advertised automation
     * work, but do not commit the phase or reset the turn itself.
     */
    resolvePendingAutomation(instanceId: string): Promise<boolean> {
        return this.enqueueBoundary(async () => {
            if (this.boundary.readOnly()) return false;
            const snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot) return false;
            return this.phaseAlreadyEnded(snapshot)
                ? this.resolvePendingEndTurnAutomation(instanceId, snapshot)
                : this.resolvePendingPhaseAutomation(instanceId, snapshot);
        });
    }

    private enqueueBoundary<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.boundaryQueue.then(operation);
        this.boundaryQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async resolvePendingPhaseAutomation(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
    ): Promise<boolean> {
        if (hasMekRuntime(snapshot)) {
            const automation = this.mekAutomation();
            if (!automation) return false;
            if (!await automation.resumePendingAutomation(
                this.force,
                instanceId,
                (generated, generatedAutomate = true) =>
                    this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
                true,
            )) return false;
            const rows = await automation.prepareEndPhaseCommands(
                this.force,
                [Object.freeze({
                    instanceId,
                    command: Object.freeze({ type: 'end-phase' as const }),
                })],
                { interactive: true },
            );
            const prepared = rows?.[0]?.prepared;
            if (!prepared) return false;
            return await automation.settleBeforeCommand(
                this.force,
                instanceId,
                prepared,
                (generated, generatedAutomate = true) =>
                    this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
            ) !== null;
        }
        if (!hasNonMekRuntime(snapshot)) return false;
        const automation = this.nonMekAutomation();
        if (!automation) return false;
        const rows = await automation.prepareEndPhaseCommands(
            this.force,
            [Object.freeze({
                instanceId,
                command: Object.freeze({ kind: 'end-phase' as const }),
            })],
            { interactive: true },
        );
        const prepared = rows?.[0]?.prepared;
        if (!prepared) return false;
        return await automation.settleBeforeCommand(
            this.force,
            instanceId,
            prepared,
            (generated, generatedAutomate = true) =>
                this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
        ) !== null;
    }

    private async resolvePendingEndTurnAutomation(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
    ): Promise<boolean> {
        if (hasMekRuntime(snapshot)) {
            if (this.endTurnHeatAlreadyStaged(snapshot)) return true;
            const automation = this.mekAutomation();
            if (!automation) return false;
            if (!await automation.resumePendingAutomation(
                this.force,
                instanceId,
                (generated, generatedAutomate = true) =>
                    this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
                true,
            )) return false;
            const pending = this.pendingMekSettlement(instanceId, snapshot);
            const prepared = pending?.prepared ?? (await automation.prepareEndTurnCommands(
                this.force,
                [Object.freeze({
                    instanceId,
                    command: Object.freeze({
                        type: 'end-turn' as const,
                        policy: this.boundary.heatPolicy(),
                    }),
                })],
                { interactive: true },
            ))?.[0]?.prepared;
            if (!prepared) return false;
            if (!pending) this.saveMekSettlement(instanceId, snapshot, prepared, false);
            const settled = pending?.settled
                ? prepared
                : await automation.settleBeforeCommand(
                    this.force,
                    instanceId,
                    prepared,
                    (generated, generatedAutomate = true) =>
                        this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
                );
            if (!settled) {
                this.refreshEndTurnWorkflowRevision(instanceId);
                return false;
            }
            const staged = await this.markMekEndTurnHeatStaged(instanceId, settled);
            if (!staged) return false;
            const current = this.boundary.snapshot(instanceId);
            if (current) this.saveMekSettlement(instanceId, current, staged, true);
            return true;
        }
        if (!hasNonMekRuntime(snapshot) || this.endTurnHeatAlreadyStaged(snapshot)) return true;
        const automation = this.nonMekAutomation();
        if (!automation) return false;
        const pending = this.pendingNonMekSettlement(instanceId, snapshot);
        const prepared = pending?.prepared ?? (await automation.prepareEndTurnCommands(
            this.force,
            [Object.freeze({
                instanceId,
                command: Object.freeze({ kind: 'end-turn' as const }),
            })],
            { interactive: true },
        ))?.[0]?.prepared;
        if (!prepared) return false;
        if (!pending) this.saveNonMekSettlement(instanceId, snapshot, prepared, false);
        const settled = pending?.settled
            ? prepared
            : await automation.settleBeforeCommand(
                this.force,
                instanceId,
                prepared,
                (generated, generatedAutomate = true) =>
                    this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
            );
        if (!settled) {
            this.refreshEndTurnWorkflowRevision(instanceId);
            return false;
        }
        const staged = await this.markNonMekEndTurnHeatStaged(instanceId, settled);
        if (!staged) return false;
        const current = this.boundary.snapshot(instanceId);
        if (current) this.saveNonMekSettlement(instanceId, current, staged, true);
        return true;
    }

    private async dispatchNonMekWithAutomation(
        instanceId: string,
        command: NonMekUnitCommand,
        automate: boolean,
    ): Promise<CBTNonMekUnitCommandResult> {
        const automation = automate ? this.nonMekAutomation() : null;
        const effectiveCommand = command;
        if (automation && command.kind === 'end-turn') {
            const initial = this.boundary.snapshot(instanceId);
            if (initial && hasNonMekRuntime(initial)
                && !this.phaseAlreadyEnded(initial)) {
                const phase = await this.dispatchNonMekWithAutomation(instanceId, {
                    kind: 'end-phase',
                    endTurnBoundary: true,
                }, true);
                if (!phase.accepted) return phase;
                const refreshed = this.boundary.snapshot(instanceId);
                if (!refreshed || !hasNonMekRuntime(refreshed)) {
                    return Object.freeze({
                        accepted: true,
                        changed: false,
                        state: null,
                    });
                }
            }
        }
        if (!automation) return this.boundary.dispatchNonMekCore(instanceId, effectiveCommand);
        const current = this.boundary.snapshot(instanceId);
        const heatAlreadyStaged = effectiveCommand.kind === 'end-turn'
            && current !== null
            && this.endTurnHeatAlreadyStaged(current);
        const pending = effectiveCommand.kind === 'end-turn' && current
            ? this.pendingNonMekSettlement(instanceId, current)
            : null;
        const prepared: PreparedDirectNonMekAutomationCommand = heatAlreadyStaged
            ? Object.freeze({
                command: Object.freeze({ ...effectiveCommand, heatPolicy: 'manual' as const }),
            })
            : pending?.prepared
                ?? await automation.prepareCommand(this.force, instanceId, effectiveCommand);
        if (prepared.cancelled) return this.cancelledNonMek(instanceId);
        if (effectiveCommand.kind === 'end-turn' && current && pending === null && !heatAlreadyStaged) {
            this.saveNonMekSettlement(instanceId, current, prepared, false);
        }
        const settled = heatAlreadyStaged || pending?.settled
            ? prepared
            : await automation.settleBeforeCommand(
                this.force,
                instanceId,
                prepared,
                (generated, generatedAutomate = true) =>
                    this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
            );
        if (settled === null) {
            this.refreshEndTurnWorkflowRevision(instanceId);
            return this.cancelledNonMek(instanceId);
        }
        let ready: PreparedDirectNonMekAutomationCommand = settled;
        if (effectiveCommand.kind === 'end-turn') {
            const staged = await this.markNonMekEndTurnHeatStaged(instanceId, settled);
            if (staged === null) return this.cancelledNonMek(instanceId);
            ready = staged;
            const afterSettlement = this.boundary.snapshot(instanceId);
            if (afterSettlement) {
                this.saveNonMekSettlement(instanceId, afterSettlement, ready, true);
            }
        }
        const result = await this.boundary.dispatchNonMekCore(instanceId, ready.command);
        const completed = await automation.afterCommand(
            this.force,
            instanceId,
            current,
            ready,
            result,
            (generated, generatedAutomate = true) =>
                this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
        );
        if (completed && result.accepted && effectiveCommand.kind === 'end-turn') {
            this.clearEndTurnWorkflow(instanceId);
        }
        return completed ? result : this.cancelledNonMek(instanceId);
    }

    private async dispatchMekWithAutomation(
        instanceId: string,
        command: CBTUnitCommand,
        automate: boolean,
    ): Promise<CBTMekUnitCommandResult> {
        const automation = automate ? this.mekAutomation() : null;
        const effectiveCommand = command;
        if (automation && command.type === 'end-turn') {
            const initial = this.boundary.snapshot(instanceId);
            if (initial && hasMekRuntime(initial)
                && !this.phaseAlreadyEnded(initial)) {
                const phase = await this.dispatchMekWithAutomation(instanceId, {
                    type: 'end-phase',
                    endTurnBoundary: true,
                }, true);
                if (!phase.accepted) return phase;
                const refreshed = this.boundary.snapshot(instanceId);
                if (!refreshed || !hasMekRuntime(refreshed)) {
                    return Object.freeze({
                        accepted: true,
                        changed: false,
                        state: null,
                    });
                }
            }
        }
        if (!automation) return this.boundary.dispatchMekCore(instanceId, effectiveCommand);
        const before = this.boundary.snapshot(instanceId);
        const heatAlreadyStaged = effectiveCommand.type === 'end-turn'
            && before !== null
            && this.endTurnHeatAlreadyStaged(before);
        const pending = effectiveCommand.type === 'end-turn' && before
            ? this.pendingMekSettlement(instanceId, before)
            : null;
        const prepared: PreparedDirectMekAutomationCommand = heatAlreadyStaged
            ? Object.freeze({
                command: Object.freeze({ ...effectiveCommand, policy: 'manual' as const }),
                deferredPilotHits: 0,
            })
            : pending?.prepared
                ?? await automation.prepareCommand(this.force, instanceId, effectiveCommand);
        if (prepared.cancelled) return this.cancelledMek(instanceId);
        if (effectiveCommand.type === 'end-turn' && before && pending === null && !heatAlreadyStaged) {
            this.saveMekSettlement(instanceId, before, prepared, false);
        }
        const settled = heatAlreadyStaged || pending?.settled
            ? prepared
            : await automation.settleBeforeCommand(
                this.force,
                instanceId,
                prepared,
                (generated, generatedAutomate = true) =>
                    this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
            );
        if (settled === null) {
            this.refreshEndTurnWorkflowRevision(instanceId);
            return this.cancelledMek(instanceId);
        }
        let ready: PreparedDirectMekAutomationCommand = settled;
        if (effectiveCommand.type === 'end-turn') {
            const staged = await this.markMekEndTurnHeatStaged(instanceId, settled);
            if (staged === null) return this.cancelledMek(instanceId);
            ready = staged;
            const afterSettlement = this.boundary.snapshot(instanceId);
            if (afterSettlement) this.saveMekSettlement(instanceId, afterSettlement, ready, true);
        }
        const result = await this.boundary.dispatchMekCore(instanceId, ready.command);
        const completed = await automation.afterCommand(
            this.force,
            instanceId,
            before,
            ready,
            result,
            (generated, generatedAutomate = true) =>
                this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
        );
        if (completed && result.accepted && effectiveCommand.type === 'end-turn') {
            this.clearEndTurnWorkflow(instanceId);
        }
        return completed ? result : this.cancelledMek(instanceId);
    }

    private async endPhaseForAllWithAutomation(
        instanceIds: readonly string[],
        endTurnBoundary = false,
    ): Promise<CBTForceEndTurnAllResult> {
        if (this.boundary.readOnly()) {
            return this.rejectedBoundaryBatch(instanceIds, 'READ_ONLY');
        }

        const mekAutomation = this.mekAutomation();
        const nonMekAutomation = this.nonMekAutomation();
        const preparedPhases: PreparedForcePhaseBoundary[] = [];
        const mekRequests: DirectMekEndPhaseAutomationRequest[] = [];
        const nonMekRequests: DirectNonMekEndPhaseAutomationRequest[] = [];
        const snapshots = new Map<string, CBTUnitSnapshot>();

        // Complete every review before committing the first unit. Closing any
        // review therefore leaves the entire force at its current phase.
        for (const instanceId of instanceIds) {
            const snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot) continue;
            snapshots.set(instanceId, snapshot);
            if (hasMekRuntime(snapshot)) {
                mekRequests.push(Object.freeze({
                    instanceId,
                    command: Object.freeze({
                        type: 'end-phase' as const,
                        ...(endTurnBoundary ? { endTurnBoundary: true as const } : {}),
                    }),
                }));
                continue;
            }
            if (!hasNonMekRuntime(snapshot)) continue;
            nonMekRequests.push(Object.freeze({
                instanceId,
                command: Object.freeze({
                    kind: 'end-phase' as const,
                    ...(endTurnBoundary ? { endTurnBoundary: true as const } : {}),
                }),
            }));
        }

        // Family-specific runtime projection stays separate, but compatible
        // reviews start together so the shared automation services can present
        // the same one force-wide dialog used by origin/next.
        const [preparedMeks, preparedNonMeks] = await Promise.all([
            mekRequests.length === 0
                ? Promise.resolve(Object.freeze([]))
                : mekAutomation
                    ? mekAutomation.prepareEndPhaseCommands(this.force, mekRequests)
                    : Promise.resolve(Object.freeze(mekRequests.map(request => Object.freeze({
                        instanceId: request.instanceId,
                        prepared: Object.freeze({ command: request.command, deferredPilotHits: 0 }),
                    })))),
            nonMekRequests.length === 0
                ? Promise.resolve(Object.freeze([]))
                : nonMekAutomation
                    ? nonMekAutomation.prepareEndPhaseCommands(this.force, nonMekRequests)
                    : Promise.resolve(Object.freeze(nonMekRequests.map(request => Object.freeze({
                        instanceId: request.instanceId,
                        prepared: Object.freeze({ command: request.command }),
                    })))),
        ]);
        if (preparedMeks === null || preparedNonMeks === null) {
            return this.rejectedBoundaryBatch(instanceIds, 'AUTOMATION_CANCELLED');
        }
        const mekById = new Map(preparedMeks.map(row => [row.instanceId, row.prepared] as const));
        const nonMekById = new Map(preparedNonMeks.map(row => [row.instanceId, row.prepared] as const));
        for (const instanceId of instanceIds) {
            const before = snapshots.get(instanceId);
            if (!before) continue;
            if (hasMekRuntime(before)) {
                const prepared = mekById.get(instanceId);
                if (prepared) preparedPhases.push(Object.freeze({
                    kind: 'mek', instanceId, before, prepared,
                }));
                continue;
            }
            const prepared = nonMekById.get(instanceId);
            if (prepared) preparedPhases.push(Object.freeze({
                kind: 'non-mek', instanceId, before, prepared,
            }));
        }

        const results: CBTForceEndTurnUnitResult[] = [];
        for (const phase of preparedPhases) {
            const beforeRevision = stateRevision(phase.before);
            if (phase.kind === 'mek') {
                const settled = mekAutomation
                    ? await mekAutomation.settleBeforeCommand(
                        this.force,
                        phase.instanceId,
                        phase.prepared,
                        (generated, generatedAutomate = true) =>
                            this.dispatchMekWithAutomation(
                                phase.instanceId,
                                generated,
                                generatedAutomate,
                            ),
                    )
                    : phase.prepared;
                if (settled === null) {
                    return this.failedBoundaryBatch(
                        instanceIds,
                        results,
                        phase.instanceId,
                        'AUTOMATION_CANCELLED',
                        stateRevision(this.boundary.snapshot(phase.instanceId)) !== beforeRevision,
                    );
                }
                const result = await this.boundary.dispatchMekCore(
                    phase.instanceId,
                    settled.command,
                );
                if (!result.accepted) {
                    return this.failedBoundaryBatch(
                        instanceIds,
                        results,
                        phase.instanceId,
                        'READ_ONLY',
                        false,
                    );
                }
                const completed = !mekAutomation || await mekAutomation.afterCommand(
                    this.force,
                    phase.instanceId,
                    phase.before,
                    settled,
                    result,
                    (generated, generatedAutomate = true) =>
                        this.dispatchMekWithAutomation(
                            phase.instanceId,
                            generated,
                            generatedAutomate,
                        ),
                );
                const changed = stateRevision(this.boundary.snapshot(phase.instanceId))
                    !== beforeRevision;
                if (!completed) {
                    return this.failedBoundaryBatch(
                        instanceIds,
                        results,
                        phase.instanceId,
                        'AUTOMATION_CANCELLED',
                        changed,
                    );
                }
                results.push(Object.freeze({
                    instanceId: phase.instanceId,
                    accepted: true,
                    changed,
                }));
                continue;
            }

            const settled = nonMekAutomation
                ? await nonMekAutomation.settleBeforeCommand(
                    this.force,
                    phase.instanceId,
                    phase.prepared,
                    (generated, generatedAutomate = true) =>
                        this.dispatchNonMekWithAutomation(
                            phase.instanceId,
                            generated,
                            generatedAutomate,
                        ),
                )
                : phase.prepared;
            if (settled === null) {
                return this.failedBoundaryBatch(
                    instanceIds,
                    results,
                    phase.instanceId,
                    'AUTOMATION_CANCELLED',
                    stateRevision(this.boundary.snapshot(phase.instanceId)) !== beforeRevision,
                );
            }
            const result = await this.boundary.dispatchNonMekCore(
                phase.instanceId,
                settled.command,
            );
            if (!result.accepted) {
                return this.failedBoundaryBatch(
                    instanceIds,
                    results,
                    phase.instanceId,
                    'READ_ONLY',
                    false,
                );
            }
            const completed = !nonMekAutomation || await nonMekAutomation.afterCommand(
                this.force,
                phase.instanceId,
                phase.before,
                settled,
                result,
                (generated, generatedAutomate = true) =>
                    this.dispatchNonMekWithAutomation(
                        phase.instanceId,
                        generated,
                        generatedAutomate,
                    ),
            );
            const changed = stateRevision(this.boundary.snapshot(phase.instanceId))
                !== beforeRevision;
            if (!completed) {
                return this.failedBoundaryBatch(
                    instanceIds,
                    results,
                    phase.instanceId,
                    'AUTOMATION_CANCELLED',
                    changed,
                );
            }
            results.push(Object.freeze({
                instanceId: phase.instanceId,
                accepted: true,
                changed,
            }));
        }

        return this.completedBoundaryBatch(instanceIds, results);
    }

    private async endTurnForAllWithAutomation(
        instanceIds: readonly string[],
    ): Promise<CBTForceEndTurnAllResult> {
        const initialRevisions = new Map(instanceIds.map(instanceId => [
            instanceId,
            stateRevision(this.boundary.snapshot(instanceId)),
        ] as const));
        const phaseInstanceIds = instanceIds.filter(instanceId => {
            const snapshot = this.boundary.snapshot(instanceId);
            return snapshot !== null && !this.phaseAlreadyEnded(snapshot);
        });
        if (phaseInstanceIds.length > 0) {
            const phaseResult = await this.endPhaseForAllWithAutomation(phaseInstanceIds, true);
            const phaseResultById = new Map(phaseResult.results.map(row => [row.instanceId, row] as const));
            if (!phaseResult.accepted) {
                const results = instanceIds.map(instanceId => phaseResultById.get(instanceId)
                    ?? Object.freeze({
                        instanceId,
                        accepted: true,
                        changed: false,
                    }));
                return Object.freeze({
                    accepted: false,
                    changed: results.some(result => result.changed),
                    atomic: false as const,
                    results: Object.freeze(results),
                });
            }
        }
        const mekAutomation = this.mekAutomation();
        const nonMekAutomation = this.nonMekAutomation();

        const mekRequests: DirectMekEndTurnAutomationRequest[] = [];
        const nonMekRequests: DirectNonMekEndTurnAutomationRequest[] = [];
        const preparedMekById = new Map<string, PreparedDirectMekAutomationCommand>();
        const preparedNonMekById = new Map<string, PreparedDirectNonMekAutomationCommand>();
        for (const instanceId of instanceIds) {
            const snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot) continue;
            if (hasMekRuntime(snapshot)) {
                if (this.endTurnHeatAlreadyStaged(snapshot)) {
                    preparedMekById.set(instanceId, Object.freeze({
                        command: Object.freeze({
                            type: 'end-turn' as const,
                            policy: 'manual' as const,
                        }),
                        deferredPilotHits: 0,
                    }));
                    continue;
                }
                const pending = this.pendingMekSettlement(instanceId, snapshot);
                if (pending) {
                    preparedMekById.set(instanceId, pending.prepared);
                    continue;
                }
                mekRequests.push(Object.freeze({
                    instanceId,
                    command: Object.freeze({
                        type: 'end-turn' as const,
                        policy: this.boundary.heatPolicy(),
                    }),
                }));
            } else {
                if (this.endTurnHeatAlreadyStaged(snapshot)) {
                    preparedNonMekById.set(instanceId, Object.freeze({
                        command: Object.freeze({
                            kind: 'end-turn' as const,
                            heatPolicy: 'manual' as const,
                        }),
                    }));
                    continue;
                }
                const pending = this.pendingNonMekSettlement(instanceId, snapshot);
                if (pending) {
                    preparedNonMekById.set(instanceId, pending.prepared);
                    continue;
                }
                nonMekRequests.push(Object.freeze({
                    instanceId,
                    command: Object.freeze({
                        kind: 'end-turn' as const,
                    }),
                }));
            }
        }

        // Both reviews complete before the first turn mutation. This preserves
        // origin/next's cancel semantics even for a mixed force.
        const [preparedMeks, preparedNonMeks] = await Promise.all([
            mekRequests.length === 0
                ? Promise.resolve(Object.freeze([]))
                : mekAutomation
                    ? mekAutomation.prepareEndTurnCommands(this.force, mekRequests)
                    : Promise.resolve(Object.freeze(mekRequests.map(request => Object.freeze({
                        instanceId: request.instanceId,
                        prepared: Object.freeze({ command: request.command, deferredPilotHits: 0 }),
                    })))),
            nonMekRequests.length === 0
                ? Promise.resolve(Object.freeze([]))
                : nonMekAutomation
                    ? nonMekAutomation.prepareEndTurnCommands(this.force, nonMekRequests)
                    : Promise.resolve(Object.freeze(nonMekRequests.map(request => Object.freeze({
                        instanceId: request.instanceId,
                        prepared: Object.freeze({ command: request.command }),
                    })))),
        ]);
        if (preparedMeks === null || preparedNonMeks === null) {
            return this.failedEndTurnBatch(instanceIds, initialRevisions);
        }
        for (const row of preparedMeks) {
            const snapshot = this.boundary.snapshot(row.instanceId);
            if (!snapshot) continue;
            preparedMekById.set(row.instanceId, row.prepared);
            this.saveMekSettlement(row.instanceId, snapshot, row.prepared, false);
        }
        for (const row of preparedNonMeks) {
            const snapshot = this.boundary.snapshot(row.instanceId);
            if (!snapshot) continue;
            preparedNonMekById.set(row.instanceId, row.prepared);
            this.saveNonMekSettlement(row.instanceId, snapshot, row.prepared, false);
        }

        const settledMekById = new Map<string, PreparedDirectMekAutomationCommand>();
        for (const [instanceId, prepared] of preparedMekById) {
            const snapshot = this.boundary.snapshot(instanceId);
            const pending = snapshot ? this.pendingMekSettlement(instanceId, snapshot) : null;
            const heatAlreadyStaged = snapshot !== null && this.endTurnHeatAlreadyStaged(snapshot);
            const settled = heatAlreadyStaged || pending?.settled
                ? pending?.prepared ?? prepared
                : mekAutomation
                ? await mekAutomation.settleBeforeCommand(
                    this.force,
                    instanceId,
                    prepared,
                    (generated, generatedAutomate = true) =>
                        this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
                )
                : prepared;
            if (settled === null) {
                this.refreshEndTurnWorkflowRevision(instanceId);
                return this.failedEndTurnBatch(instanceIds, initialRevisions);
            }
            const ready = await this.markMekEndTurnHeatStaged(instanceId, settled);
            if (ready === null) {
                this.refreshEndTurnWorkflowRevision(instanceId);
                return this.failedEndTurnBatch(instanceIds, initialRevisions);
            }
            settledMekById.set(instanceId, ready);
            const afterSettlement = this.boundary.snapshot(instanceId);
            if (afterSettlement) this.saveMekSettlement(instanceId, afterSettlement, ready, true);
        }
        const settledNonMekById = new Map<string, PreparedDirectNonMekAutomationCommand>();
        for (const [instanceId, prepared] of preparedNonMekById) {
            const snapshot = this.boundary.snapshot(instanceId);
            const pending = snapshot ? this.pendingNonMekSettlement(instanceId, snapshot) : null;
            const heatAlreadyStaged = snapshot !== null && this.endTurnHeatAlreadyStaged(snapshot);
            const settled = heatAlreadyStaged || pending?.settled
                ? pending?.prepared ?? prepared
                : nonMekAutomation
                ? await nonMekAutomation.settleBeforeCommand(
                    this.force,
                    instanceId,
                    prepared,
                    (generated, generatedAutomate = true) =>
                        this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
                )
                : prepared;
            if (settled === null) {
                this.refreshEndTurnWorkflowRevision(instanceId);
                return this.failedEndTurnBatch(instanceIds, initialRevisions);
            }
            const ready = await this.markNonMekEndTurnHeatStaged(instanceId, settled);
            if (ready === null) {
                this.refreshEndTurnWorkflowRevision(instanceId);
                return this.failedEndTurnBatch(instanceIds, initialRevisions);
            }
            settledNonMekById.set(instanceId, ready);
            const afterSettlement = this.boundary.snapshot(instanceId);
            if (afterSettlement) {
                this.saveNonMekSettlement(instanceId, afterSettlement, ready, true);
            }
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
                    changed: stateRevision(this.boundary.snapshot(instanceId))
                        !== initialRevisions.get(instanceId),
                    ...(!completed
                        ? { reason: 'AUTOMATION_CANCELLED' }
                        : !result.accepted ? { reason: 'READ_ONLY' } : {}),
                }));
                if (completed && result.accepted) this.clearEndTurnWorkflow(instanceId);
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
                snapshot,
                prepared,
                result,
                (generated, generatedAutomate = true) =>
                    this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
            );
            results.push(Object.freeze({
                instanceId,
                accepted: completed && result.accepted,
                changed: stateRevision(this.boundary.snapshot(instanceId))
                    !== initialRevisions.get(instanceId),
                ...(!completed
                    ? { reason: 'AUTOMATION_CANCELLED' }
                    : !result.accepted ? { reason: 'READ_ONLY' } : {}),
            }));
            if (completed && result.accepted) this.clearEndTurnWorkflow(instanceId);
            if (!completed) break;
        }
        const completedIds = new Set(results.map(result => result.instanceId));
        results.push(...instanceIds
            .filter(instanceId => !completedIds.has(instanceId))
            .map(instanceId => Object.freeze({
                instanceId,
                accepted: false,
                changed: stateRevision(this.boundary.snapshot(instanceId))
                    !== initialRevisions.get(instanceId),
                reason: 'AUTOMATION_CANCELLED',
            })));
        return Object.freeze({
            accepted: results.every(result => result.accepted),
            changed: results.some(result => result.changed),
            atomic: false as const,
            results: Object.freeze(results),
        });
    }

    private completedBoundaryBatch(
        instanceIds: readonly string[],
        completed: readonly CBTForceEndTurnUnitResult[],
    ): CBTForceEndTurnAllResult {
        const completedById = new Map(completed.map(row => [row.instanceId, row] as const));
        const results = instanceIds.map(instanceId => completedById.get(instanceId)
            ?? Object.freeze({
                instanceId,
                accepted: false,
                changed: false,
                reason: 'NOT_ADMITTED',
            }));
        return Object.freeze({
            accepted: results.every(result => result.accepted),
            changed: results.some(result => result.changed),
            atomic: false as const,
            results: Object.freeze(results),
        });
    }

    private rejectedBoundaryBatch(
        instanceIds: readonly string[],
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
                reason,
            }))),
        });
    }

    private failedBoundaryBatch(
        instanceIds: readonly string[],
        completed: readonly CBTForceEndTurnUnitResult[],
        failedInstanceId: string,
        reason: string,
        changed: boolean,
    ): CBTForceEndTurnAllResult {
        const completedById = new Map(completed.map(row => [row.instanceId, row] as const));
        completedById.set(failedInstanceId, Object.freeze({
            instanceId: failedInstanceId,
            accepted: false,
            changed,
            reason,
        }));
        const results = instanceIds.map(instanceId => completedById.get(instanceId)
            ?? Object.freeze({
                instanceId,
                accepted: false,
                changed: false,
                reason: 'AUTOMATION_CANCELLED',
            }));
        return Object.freeze({
            accepted: false,
            changed: results.some(result => result.changed),
            atomic: false as const,
            results: Object.freeze(results),
        });
    }

    private failedEndTurnBatch(
        instanceIds: readonly string[],
        initialRevisions: ReadonlyMap<string, number | null>,
    ): CBTForceEndTurnAllResult {
        const results = instanceIds.map(instanceId => Object.freeze({
            instanceId,
            accepted: false,
            changed: stateRevision(this.boundary.snapshot(instanceId))
                !== initialRevisions.get(instanceId),
            reason: 'AUTOMATION_CANCELLED',
        }));
        return Object.freeze({
            accepted: false,
            changed: results.some(result => result.changed),
            atomic: false as const,
            results: Object.freeze(results),
        });
    }

    private phaseAlreadyEnded(snapshot: CBTUnitSnapshot): boolean {
        return snapshot.state.turn.endTurnCheckpoint !== undefined;
    }

    private endTurnHeatAlreadyStaged(snapshot: CBTUnitSnapshot): boolean {
        return snapshot.state.turn.endTurnCheckpoint === 'heat-staged';
    }

    private async markMekEndTurnHeatStaged(
        instanceId: string,
        prepared: PreparedDirectMekAutomationCommand,
    ): Promise<PreparedDirectMekAutomationCommand | null> {
        if (prepared.command.type !== 'end-turn') return null;
        let snapshot = this.boundary.snapshot(instanceId);
        if (!snapshot || !hasMekRuntime(snapshot)) return null;
        if (!this.endTurnHeatAlreadyStaged(snapshot)) {
            const marked = await this.boundary.dispatchMekCore(instanceId, {
                type: 'mark-end-turn-heat-staged',
            });
            if (!marked.accepted) return null;
            snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot || !hasMekRuntime(snapshot)) return null;
        }
        return Object.freeze({
            ...prepared,
            command: Object.freeze({
                ...prepared.command,
                policy: 'manual' as const,
            }),
        });
    }

    private async markNonMekEndTurnHeatStaged(
        instanceId: string,
        prepared: PreparedDirectNonMekAutomationCommand,
    ): Promise<PreparedDirectNonMekAutomationCommand | null> {
        if (prepared.command.kind !== 'end-turn') return null;
        let snapshot = this.boundary.snapshot(instanceId);
        if (!snapshot || !hasNonMekRuntime(snapshot)) return null;
        if (!this.endTurnHeatAlreadyStaged(snapshot)) {
            const marked = await this.boundary.dispatchNonMekCore(instanceId, {
                kind: 'mark-end-turn-heat-staged',
            });
            if (!marked.accepted) return null;
            snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot || !hasNonMekRuntime(snapshot)) return null;
        }
        return Object.freeze({
            ...prepared,
            command: Object.freeze({
                ...prepared.command,
                heatPolicy: 'manual' as const,
            }),
        });
    }

    private pendingMekSettlement(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
    ): Extract<PendingEndTurnSettlement, { readonly kind: 'mek' }> | null {
        const pending = this.pendingSettlement(instanceId, snapshot);
        return pending?.kind === 'mek' ? pending : null;
    }

    private pendingNonMekSettlement(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
    ): Extract<PendingEndTurnSettlement, { readonly kind: 'non-mek' }> | null {
        const pending = this.pendingSettlement(instanceId, snapshot);
        return pending?.kind === 'non-mek' ? pending : null;
    }

    private pendingSettlement(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
    ): PendingEndTurnSettlement | null {
        const pending = this.pendingEndTurnSettlements.get(instanceId);
        const turn = turnCounter(snapshot);
        const revision = stateRevision(snapshot);
        if (!pending) return null;
        if (turn === pending.turn && revision === pending.revision) return pending;
        this.clearEndTurnWorkflow(instanceId);
        return null;
    }

    private saveMekSettlement(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
        prepared: PreparedDirectMekAutomationCommand,
        settled: boolean,
    ): void {
        const turn = turnCounter(snapshot);
        const revision = stateRevision(snapshot);
        if (turn === null || revision === null) return;
        this.pendingEndTurnSettlements.set(instanceId, Object.freeze({
            kind: 'mek', turn, revision, prepared, settled,
        }));
    }

    private saveNonMekSettlement(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
        prepared: PreparedDirectNonMekAutomationCommand,
        settled: boolean,
    ): void {
        const turn = turnCounter(snapshot);
        const revision = stateRevision(snapshot);
        if (turn === null || revision === null) return;
        this.pendingEndTurnSettlements.set(instanceId, Object.freeze({
            kind: 'non-mek', turn, revision, prepared, settled,
        }));
    }

    /** Keeps a reviewed plan resumable after its own partial settlement only. */
    private refreshEndTurnWorkflowRevision(instanceId: string): void {
        const snapshot = this.boundary.snapshot(instanceId);
        const pending = this.pendingEndTurnSettlements.get(instanceId);
        const turn = turnCounter(snapshot);
        const revision = stateRevision(snapshot);
        if (!snapshot || !pending || turn !== pending.turn || revision === null) {
            this.clearEndTurnWorkflow(instanceId);
            return;
        }
        this.pendingEndTurnSettlements.set(instanceId, Object.freeze({
            ...pending,
            revision,
        }));
    }

    private clearEndTurnWorkflow(instanceId: string): void {
        this.pendingEndTurnSettlements.delete(instanceId);
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

    private cancelledMek(instanceId: string): CBTMekUnitCommandResult {
        const snapshot = this.boundary.snapshot(instanceId);
        return Object.freeze({
            accepted: true,
            changed: false,
            state: snapshot && hasMekRuntime(snapshot) ? snapshot.state : null,
        });
    }

    private cancelledNonMek(instanceId: string): CBTNonMekUnitCommandResult {
        const snapshot = this.boundary.snapshot(instanceId);
        return Object.freeze({
            accepted: true,
            changed: false,
            state: snapshot && hasNonMekRuntime(snapshot) ? snapshot.state : null,
        });
    }
}
