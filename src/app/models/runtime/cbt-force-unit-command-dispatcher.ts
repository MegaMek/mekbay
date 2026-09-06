// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { HeatAutomationPolicy } from './cbt-unit-runtime';

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
import type { CBTForceEndTurnAllResult,CBTForceEndTurnUnitResult,CBTForceUnitCommandResult } from '../cbt-force.types';
import { hasMekRuntime,hasNonMekRuntime,type CBTUnitSnapshot } from '../cbt-unit-snapshot';
import { captureUnitCommand,type CBTUnitCommand } from './unit-command';
import { isUnitEditContextCurrent,type UnitEditContext } from './unit-edit-context';

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
        readonly owner: object;
        readonly revision: number;
        readonly prepared: PreparedDirectMekAutomationCommand;
        readonly settled: boolean;
    }>
    | Readonly<{
        readonly kind: 'non-mek';
        readonly turn: number;
        readonly owner: object;
        readonly revision: number;
        readonly prepared: PreparedDirectNonMekAutomationCommand;
        readonly settled: boolean;
    }>;

type AutomatedCommandCompletion = Readonly<{ completed: boolean; result: CBTForceUnitCommandResult }>;

function turnCounter(snapshot: CBTUnitSnapshot | null): number | null {
    return snapshot?.state.turn.turnCounter ?? null;
}

function stateRevision(snapshot: CBTUnitSnapshot | null): number | null {
    return snapshot?.query.stateRevision ?? null;
}

export interface CBTForceUnitCommandBoundary {
    readonly readOnly: () => boolean;
    readonly instanceIds: () => readonly string[];
    readonly snapshot: (instanceId: string) => CBTUnitSnapshot | null;
    readonly heatPolicy: () => HeatAutomationPolicy;
    readonly dispatchCore: (
        instanceId: string,
        command: CBTUnitCommand,
    ) => Promise<CBTForceUnitCommandResult>;
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

    dispatch(
        instanceId: string,
        command: CBTUnitCommand,
        context?: UnitEditContext,
    ): Promise<CBTForceUnitCommandResult> {
        command = captureUnitCommand(command);
        const requested = this.boundary.snapshot(instanceId);
        if (!requested) return Promise.resolve(Object.freeze({ accepted: true, changed: false, state: null }));
        const expected = context ?? requested.editContext;
        const run = (): Promise<CBTForceUnitCommandResult> => {
            const current = this.boundary.snapshot(instanceId);
            if (!current || !isUnitEditContextCurrent(expected, current.editContext)) {
                return Promise.resolve(Object.freeze({ accepted: false, changed: false, state: current?.state ?? null }));
            }
            return hasMekRuntime(current)
                ? this.dispatchMekWithAutomation(instanceId, command, true)
                : this.dispatchNonMekWithAutomation(instanceId, command, true);
        };
        return command.type === 'end-turn' ? this.enqueueBoundary(run) : run();
    }

    endTurnForAll(): Promise<CBTForceEndTurnAllResult> {
        if (!this.mekAutomation() && !this.nonMekAutomation()) {
            return this.boundary.endTurnForAllCore();
        }
        return this.enqueueBoundaryForAll('turn');
    }

    endPhaseForAll(): Promise<CBTForceEndTurnAllResult> {
        return this.enqueueBoundaryForAll('phase');
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
        const owner = this.boundary.snapshot(instanceId)?.editContext.owner;
        return this.enqueueBoundary(async () => {
            if (this.boundary.readOnly()) return false;
            const snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot || snapshot.editContext.owner !== owner) return false;
            return this.phaseAlreadyEnded(snapshot)
                ? this.resolvePendingEndTurnAutomation(instanceId, snapshot)
                : this.resolvePendingPhaseAutomation(instanceId, snapshot);
        });
    }

    private enqueueBoundaryForAll(kind: 'phase' | 'turn'): Promise<CBTForceEndTurnAllResult> {
        // A phase request expires on any state edit; a turn request survives phase settlement.
        const versionOf = kind === 'turn' ? turnCounter : stateRevision;
        const requested = this.boundary.instanceIds().map(instanceId => Object.freeze({
            instanceId,
            owner: this.boundary.snapshot(instanceId)?.editContext.owner,
            version: versionOf(this.boundary.snapshot(instanceId)),
        }));
        return this.enqueueBoundary(async () => {
            const activeIds = requested.flatMap(row => {
                const current = this.boundary.snapshot(row.instanceId);
                return current && row.version !== null
                    && current.editContext.owner === row.owner
                    && versionOf(current) === row.version
                    ? [row.instanceId]
                    : [];
            });
            const activeResults = new Map<string, CBTForceEndTurnUnitResult>();
            if (activeIds.length > 0) {
                const active = kind === 'turn'
                    ? await this.endTurnForAllWithAutomation(activeIds)
                    : await this.endPhaseForAllWithAutomation(activeIds);
                for (const result of active.results) activeResults.set(result.instanceId, result);
            }
            const results = requested.map(row => {
                const result = activeResults.get(row.instanceId);
                if (result) return result;
                const current = this.boundary.snapshot(row.instanceId);
                return current && row.version !== null
                    && current.editContext.owner === row.owner
                    && versionOf(current) !== row.version
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

    private enqueueBoundary<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.boundaryQueue.then(operation);
        this.boundaryQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private boundaryContexts(instanceIds: readonly string[]): ReadonlyMap<string, UnitEditContext> {
        return new Map(instanceIds.flatMap(instanceId => {
            const snapshot = this.boundary.snapshot(instanceId);
            return snapshot ? [[instanceId, snapshot.editContext] as const] : [];
        }));
    }

    private boundaryContextsCurrent(contexts: ReadonlyMap<string, UnitEditContext>, ownersOnly = false): boolean {
        return [...contexts].every(([instanceId, expected]) => {
            const current = this.boundary.snapshot(instanceId)?.editContext;
            return current !== undefined && (ownersOnly
                ? expected.owner === current.owner : isUnitEditContextCurrent(expected, current));
        });
    }

    /** Settlement may advance its own state, but it must never move to another owner. */
    private dispatchForOwner(instanceId: string, owner: object | undefined, command: CBTUnitCommand,
        automate: boolean): Promise<CBTForceUnitCommandResult> {
        const current = this.boundary.snapshot(instanceId);
        if (!current || current.editContext.owner !== owner) {
            return Promise.resolve(Object.freeze({ accepted: false, changed: false, state: current?.state ?? null }));
        }
        return hasMekRuntime(current) ? this.dispatchMekWithAutomation(instanceId, command, automate)
            : this.dispatchNonMekWithAutomation(instanceId, command, automate);
    }

    /** Only accepted effects may advance the context returned to a continuing UI action. */
    private async completeAutomatedCommand(
        instanceId: string,
        owner: object | undefined,
        result: CBTForceUnitCommandResult,
        applyEffects: (dispatch: (
            command: CBTUnitCommand, automate?: boolean,
        ) => Promise<CBTForceUnitCommandResult>) => Promise<boolean>,
    ): Promise<AutomatedCommandCompletion> {
        if (!result.accepted || !result.state || !owner) return { completed: true, result };
        let expected: UnitEditContext = { owner, state: result.state };
        let changed = result.changed;
        let interrupted = false;
        const isCurrent = (): boolean => {
            const current = this.boundary.snapshot(instanceId)?.editContext;
            return !interrupted && current !== undefined && isUnitEditContextCurrent(expected, current);
        };
        const reject = (): CBTForceUnitCommandResult => {
            interrupted = true;
            return Object.freeze({ accepted: false, changed, state: expected.state });
        };
        if (!isCurrent()) return { completed: false, result: reject() };
        const completed = await applyEffects(async (command, automate = true) => {
            if (!isCurrent()) return reject();
            const effect = await this.dispatchForOwner(instanceId, owner, command, automate);
            changed ||= effect.changed;
            if (!effect.accepted || !effect.state
                || (!effect.changed && effect.state !== expected.state)) return reject();
            expected = { owner, state: effect.state };
            return isCurrent() ? effect : reject();
        });
        if (!isCurrent()) return { completed: false, result: reject() };
        return Object.freeze({
            completed,
            result: Object.freeze({ accepted: true, changed: completed && changed, state: expected.state }),
        });
    }

    private async resolvePendingPhaseAutomation(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
    ): Promise<boolean> {
        if (hasMekRuntime(snapshot)) {
            return (await this.resolveMekPhaseAutomationWork(
                instanceId,
                Object.freeze({ type: 'end-phase' as const }),
                true,
            )).completed;
        }
        if (!hasNonMekRuntime(snapshot)) return false;
        const automation = this.nonMekAutomation();
        if (!automation) return false;
        const rows = await automation.prepareEndPhaseCommands(
            this.force,
            [Object.freeze({
                instanceId,
                command: Object.freeze({ type: 'end-phase' as const }),
            })],
            { interactive: true },
        );
        const prepared = rows?.[0]?.prepared;
        const afterReview = this.boundary.snapshot(instanceId);
        if (!prepared || !afterReview || !isUnitEditContextCurrent(snapshot.editContext, afterReview.editContext)) return false;
        return await automation.settleBeforeCommand(
            this.force,
            instanceId,
            prepared,
            (generated, generatedAutomate = true) =>
                this.dispatchForOwner(instanceId, snapshot.editContext.owner, generated, generatedAutomate),
        ) !== null && this.boundary.snapshot(instanceId)?.editContext.owner === snapshot.editContext.owner;
    }

    /** Mirrors origin/next's fall → unit checks → criticals → PSRs order. */
    private async resolveMekPhaseAutomationWork(
        instanceId: string,
        command: Extract<CBTUnitCommand, { readonly type: 'end-phase' }>,
        interactive: boolean,
    ): Promise<AutomatedCommandCompletion> {
        const automation = this.mekAutomation();
        const snapshot = this.boundary.snapshot(instanceId);
        if (!automation || !snapshot) return { completed: false, result: this.cancelledMek(instanceId) };
        return this.completeAutomatedCommand(
            instanceId, snapshot.editContext.owner, { accepted: true, changed: false, state: snapshot.state },
            async dispatch => {
                if (!await automation.resumePendingFallAutomation(
                    this.force,
                    instanceId,
                    dispatch,
                    interactive,
                )) return false;
                if (!await this.settleMekPhaseWork(
                    automation,
                    instanceId,
                    command,
                    'unit-checks',
                    interactive,
                    dispatch,
                )) return false;
                if (!await automation.resumePendingAutomation(
                    this.force,
                    instanceId,
                    dispatch,
                    interactive,
                )) return false;
                return this.settleMekPhaseWork(
                    automation,
                    instanceId,
                    command,
                    'pilot-checks',
                    interactive,
                    dispatch,
                );
            },
        );
    }

    private async settleMekPhaseWork(
        automation: DirectMekAutomationService,
        instanceId: string,
        command: Extract<CBTUnitCommand, { readonly type: 'end-phase' }>,
        phaseWork: 'unit-checks' | 'pilot-checks',
        interactive: boolean,
        dispatch: (command: CBTUnitCommand, automate?: boolean) => Promise<CBTForceUnitCommandResult>,
    ): Promise<boolean> {
        const beforeReview = this.boundaryContexts([instanceId]);
        const rows = await automation.prepareEndPhaseCommands(
            this.force,
            [Object.freeze({ instanceId, command })],
            { interactive, phaseWork },
        );
        const prepared = rows?.[0]?.prepared;
        return prepared !== undefined
            && this.boundaryContextsCurrent(beforeReview)
            && await automation.settleBeforeCommand(
                this.force,
                instanceId,
                prepared,
                dispatch,
            ) !== null
            && this.boundaryContextsCurrent(beforeReview, true);
    }

    private async resolvePendingEndTurnAutomation(
        instanceId: string,
        snapshot: CBTUnitSnapshot,
    ): Promise<boolean> {
        const completion = await this.completeAutomatedCommand(
            instanceId, snapshot.editContext.owner, { accepted: true, changed: false, state: snapshot.state },
            async dispatch => {
                if (hasMekRuntime(snapshot)) {
                    const automation = this.mekAutomation();
                    if (!automation) return false;
                    if (!await automation.resumePendingAutomation(
                        this.force,
                        instanceId,
                        dispatch,
                        true,
                    )) return false;
                    const refreshed = this.boundary.snapshot(instanceId);
                    if (!refreshed || refreshed.editContext.owner !== snapshot.editContext.owner) return false;
                    if (this.endTurnHeatAlreadyStaged(refreshed)) return true;
                    const endTurnSnapshot = refreshed ?? snapshot;
                    const pending = this.pendingMekSettlement(instanceId, endTurnSnapshot);
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
                    const afterReview = this.boundary.snapshot(instanceId);
                    if (!prepared || !afterReview || !isUnitEditContextCurrent(endTurnSnapshot.editContext, afterReview.editContext)) return false;
                    if (!pending) this.saveMekSettlement(instanceId, endTurnSnapshot, prepared, false);
                    const settled = pending?.settled
                        ? prepared
                        : await automation.settleBeforeCommand(
                            this.force,
                            instanceId,
                            prepared,
                            dispatch,
                        );
                    if (!settled || this.boundary.snapshot(instanceId)?.editContext.owner !== snapshot.editContext.owner) {
                        this.refreshEndTurnWorkflowRevision(instanceId);
                        return false;
                    }
                    const staged = await this.markMekEndTurnHeatStaged(instanceId, settled, command => dispatch(command, false));
                    if (!staged || this.boundary.snapshot(instanceId)?.editContext.owner !== snapshot.editContext.owner) return false;
                    const current = this.boundary.snapshot(instanceId);
                    if (current) this.saveMekSettlement(instanceId, current, staged, true);
                    return automation.resumePendingAutomation(
                        this.force,
                        instanceId,
                        dispatch,
                        true,
                    );
                }
                if (!hasNonMekRuntime(snapshot) || this.endTurnHeatAlreadyStaged(snapshot)) return true;
                const automation = this.nonMekAutomation();
                if (!automation) return false;
                const pending = this.pendingNonMekSettlement(instanceId, snapshot);
                const prepared = pending?.prepared ?? (await automation.prepareEndTurnCommands(
                    this.force,
                    [Object.freeze({
                        instanceId,
                        command: Object.freeze({ type: 'end-turn' as const, policy: 'automatic' }),
                    })],
                    { interactive: true },
                ))?.[0]?.prepared;
                const afterReview = this.boundary.snapshot(instanceId);
                if (!prepared || !afterReview || !isUnitEditContextCurrent(snapshot.editContext, afterReview.editContext)) return false;
                if (!pending) this.saveNonMekSettlement(instanceId, snapshot, prepared, false);
                const settled = pending?.settled
                    ? prepared
                    : await automation.settleBeforeCommand(
                        this.force,
                        instanceId,
                        prepared,
                        dispatch,
                    );
                if (!settled || this.boundary.snapshot(instanceId)?.editContext.owner !== snapshot.editContext.owner) {
                    this.refreshEndTurnWorkflowRevision(instanceId);
                    return false;
                }
                const staged = await this.markNonMekEndTurnHeatStaged(instanceId, settled, command => dispatch(command, false));
                if (!staged || this.boundary.snapshot(instanceId)?.editContext.owner !== snapshot.editContext.owner) return false;
                const current = this.boundary.snapshot(instanceId);
                if (current) this.saveNonMekSettlement(instanceId, current, staged, true);
                return true;
            },
        );
        return completion.completed;
    }

    private async dispatchNonMekWithAutomation(
        instanceId: string,
        command: CBTUnitCommand,
        automate: boolean,
    ): Promise<CBTForceUnitCommandResult> {
        const owner = this.boundary.snapshot(instanceId)?.editContext.owner;
        const automation = automate ? this.nonMekAutomation() : null;
        const effectiveCommand = command;
        if (automation && command.type === 'end-turn') {
            const initial = this.boundary.snapshot(instanceId);
            if (initial && hasNonMekRuntime(initial)
                && !this.phaseAlreadyEnded(initial)) {
                const phase = await this.dispatchNonMekWithAutomation(instanceId, {
                    type: 'end-phase',
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
        if (this.boundary.snapshot(instanceId)?.editContext.owner !== owner) {
            return Object.freeze({ accepted: false, changed: false, state: this.boundary.snapshot(instanceId)?.state ?? null });
        }
        if (!automation) return this.boundary.dispatchCore(instanceId, effectiveCommand);
        const current = this.boundary.snapshot(instanceId);
        const heatAlreadyStaged = effectiveCommand.type === 'end-turn'
            && current !== null
            && this.endTurnHeatAlreadyStaged(current);
        const pending = effectiveCommand.type === 'end-turn' && current
            ? this.pendingNonMekSettlement(instanceId, current)
            : null;
        const prepared: PreparedDirectNonMekAutomationCommand = heatAlreadyStaged
            ? Object.freeze({
                command: Object.freeze({ ...effectiveCommand, policy: 'manual' as const }),
            })
            : pending?.prepared
                ?? await automation.prepareCommand(this.force, instanceId, effectiveCommand);
        const afterPreparation = this.boundary.snapshot(instanceId);
        if (!current || !afterPreparation
            || !isUnitEditContextCurrent(current.editContext, afterPreparation.editContext)) {
            return Object.freeze({ ...this.cancelledNonMek(instanceId), accepted: false });
        }
        if (prepared.cancelled) return this.cancelledNonMek(instanceId);
        if (effectiveCommand.type === 'end-turn' && current && pending === null && !heatAlreadyStaged) {
            this.saveNonMekSettlement(instanceId, current, prepared, false);
        }
        let ready: PreparedDirectNonMekAutomationCommand = prepared;
        const settlement = await this.completeAutomatedCommand(
            instanceId, owner, { accepted: true, changed: false, state: current.state },
            async dispatch => {
                const settled = heatAlreadyStaged || pending?.settled
                    ? prepared
                    : await automation.settleBeforeCommand(this.force, instanceId, prepared, dispatch);
                if (!settled) return false;
                ready = settled;
                if (effectiveCommand.type === 'end-turn') {
                    const staged = await this.markNonMekEndTurnHeatStaged(
                        instanceId, settled, command => dispatch(command, false),
                    );
                    if (!staged) return false;
                    ready = staged;
                    const afterSettlement = this.boundary.snapshot(instanceId);
                    if (afterSettlement) this.saveNonMekSettlement(instanceId, afterSettlement, ready, true);
                }
                return true;
            },
        );
        if (!settlement.completed) {
            this.refreshEndTurnWorkflowRevision(instanceId);
            return settlement.result;
        }
        const completion = await this.completeAutomatedCommand(instanceId, owner, settlement.result, async dispatch => {
            const result = await dispatch(ready.command, false);
            return automation.afterCommand(this.force, instanceId, current, ready, result, dispatch);
        });
        if (completion.completed && completion.result.accepted && effectiveCommand.type === 'end-turn') {
            this.clearEndTurnWorkflow(instanceId);
        }
        return completion.result;
    }

    private async dispatchMekWithAutomation(
        instanceId: string,
        command: CBTUnitCommand,
        automate: boolean,
    ): Promise<CBTForceUnitCommandResult> {
        const owner = this.boundary.snapshot(instanceId)?.editContext.owner;
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
        if (this.boundary.snapshot(instanceId)?.editContext.owner !== owner) {
            return Object.freeze({ accepted: false, changed: false, state: this.boundary.snapshot(instanceId)?.state ?? null });
        }
        if (!automation) return this.boundary.dispatchCore(instanceId, effectiveCommand);
        if (effectiveCommand.type === 'end-phase') {
            const before = this.boundary.snapshot(instanceId);
            const work = await this.resolveMekPhaseAutomationWork(
                instanceId,
                effectiveCommand,
                false,
            );
            if (!work.completed) return work.result;
            const prepared = Object.freeze({
                command: effectiveCommand,
                deferredPilotHits: 0,
            });
            const completion = await this.completeAutomatedCommand(instanceId, owner, work.result, async dispatch => {
                const result = await dispatch(effectiveCommand, false);
                return automation.afterCommand(this.force, instanceId, before, prepared, result, dispatch);
            });
            return completion.result;
        }
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
        const afterPreparation = this.boundary.snapshot(instanceId);
        if (!before || !afterPreparation
            || !isUnitEditContextCurrent(before.editContext, afterPreparation.editContext)) {
            return Object.freeze({ ...this.cancelledMek(instanceId), accepted: false });
        }
        if (prepared.cancelled) return this.cancelledMek(instanceId);
        if (effectiveCommand.type === 'end-turn' && before && pending === null && !heatAlreadyStaged) {
            this.saveMekSettlement(instanceId, before, prepared, false);
        }
        let ready: PreparedDirectMekAutomationCommand = prepared;
        const settlement = await this.completeAutomatedCommand(
            instanceId, owner, { accepted: true, changed: false, state: before.state },
            async dispatch => {
                const settled = heatAlreadyStaged || pending?.settled
                    ? prepared
                    : await automation.settleBeforeCommand(this.force, instanceId, prepared, dispatch);
                if (!settled) return false;
                ready = settled;
                if (effectiveCommand.type === 'end-turn') {
                    const staged = await this.markMekEndTurnHeatStaged(
                        instanceId, settled, command => dispatch(command, false),
                    );
                    if (!staged) return false;
                    ready = staged;
                    const afterSettlement = this.boundary.snapshot(instanceId);
                    if (afterSettlement) this.saveMekSettlement(instanceId, afterSettlement, ready, true);
                    return automation.resumePendingAutomation(this.force, instanceId, dispatch, false);
                }
                return true;
            },
        );
        if (!settlement.completed) {
            this.refreshEndTurnWorkflowRevision(instanceId);
            return settlement.result;
        }
        const completion = await this.completeAutomatedCommand(instanceId, owner, settlement.result, async dispatch => {
            const result = await dispatch(ready.command, false);
            return automation.afterCommand(this.force, instanceId, before, ready, result, dispatch);
        });
        if (completion.completed && completion.result.accepted && effectiveCommand.type === 'end-turn') {
            this.clearEndTurnWorkflow(instanceId);
        }
        return completion.result;
    }

    private async endPhaseForAllWithAutomation(
        instanceIds: readonly string[],
        endTurnBoundary = false,
    ): Promise<CBTForceEndTurnAllResult> {
        if (this.boundary.readOnly()) {
            return this.rejectedBoundaryBatch(instanceIds, 'READ_ONLY');
        }

        const owners = this.boundaryContexts(instanceIds);
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
                    type: 'end-phase' as const,
                    ...(endTurnBoundary ? { endTurnBoundary: true as const } : {}),
                }),
            }));
        }

        const mekDispatch = (instanceId: string) => (
            generated: CBTUnitCommand,
            generatedAutomate = true,
        ) => this.dispatchForOwner(instanceId, owners.get(instanceId)?.owner, generated, generatedAutomate);
        const nonMekDispatch = (instanceId: string) => (
            generated: CBTUnitCommand,
            generatedAutomate = true,
        ) => this.dispatchForOwner(instanceId, owners.get(instanceId)?.owner, generated, generatedAutomate);

        // Origin/next drains falls before opening any lower-priority review.
        if (mekAutomation) {
            for (const request of mekRequests) {
                if (!await mekAutomation.resumePendingFallAutomation(
                    this.force,
                    request.instanceId,
                    mekDispatch(request.instanceId),
                    false,
                )) {
                    return this.failedPhasePreparationBatch(instanceIds, snapshots);
                }
            }
        }

        // Unit checks are force-wide and precede criticals and PSRs. Non-Mek
        // phase work consists only of this stage.
        if (!this.boundaryContextsCurrent(owners, true)) return this.failedPhasePreparationBatch(instanceIds, snapshots);
        const reviewContexts = this.boundaryContexts(instanceIds);
        const [preparedMekUnitChecks, preparedNonMeks] = await Promise.all([
            mekRequests.length === 0
                ? Promise.resolve(Object.freeze([]))
                : mekAutomation
                    ? mekAutomation.prepareEndPhaseCommands(
                        this.force,
                        mekRequests,
                        { phaseWork: 'unit-checks' },
                    )
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
        if (preparedMekUnitChecks === null || preparedNonMeks === null
            || !this.boundaryContextsCurrent(reviewContexts)) {
            return this.failedPhasePreparationBatch(instanceIds, snapshots);
        }
        const mekById = new Map<string, PreparedDirectMekAutomationCommand>();
        const nonMekById = new Map<string, PreparedDirectNonMekAutomationCommand>();
        for (const row of preparedMekUnitChecks) {
            const settled = mekAutomation
                ? await mekAutomation.settleBeforeCommand(
                    this.force,
                    row.instanceId,
                    row.prepared,
                    mekDispatch(row.instanceId),
                )
                : row.prepared;
            if (!settled || !this.boundaryContextsCurrent(owners, true)) {
                return this.failedPhasePreparationBatch(instanceIds, snapshots);
            }
            mekById.set(row.instanceId, settled);
        }
        for (const row of preparedNonMeks) {
            const settled = nonMekAutomation
                ? await nonMekAutomation.settleBeforeCommand(
                    this.force,
                    row.instanceId,
                    row.prepared,
                    nonMekDispatch(row.instanceId),
                )
                : row.prepared;
            if (!settled || !this.boundaryContextsCurrent(owners, true)) {
                return this.failedPhasePreparationBatch(instanceIds, snapshots);
            }
            nonMekById.set(row.instanceId, settled);
        }

        if (mekAutomation) {
            for (const request of mekRequests) {
                if (!await mekAutomation.resumePendingAutomation(
                    this.force,
                    request.instanceId,
                    mekDispatch(request.instanceId),
                    false,
                )) {
                    return this.failedPhasePreparationBatch(instanceIds, snapshots);
                }
            }
            if (!this.boundaryContextsCurrent(owners, true)) return this.failedPhasePreparationBatch(instanceIds, snapshots);
            const pilotReviewContexts = this.boundaryContexts(instanceIds);
            const preparedPilotChecks = await mekAutomation.prepareEndPhaseCommands(
                this.force,
                mekRequests,
                { phaseWork: 'pilot-checks' },
            );
            if (!preparedPilotChecks || !this.boundaryContextsCurrent(pilotReviewContexts)) {
                return this.failedPhasePreparationBatch(instanceIds, snapshots);
            }
            for (const row of preparedPilotChecks) {
                const settled = await mekAutomation.settleBeforeCommand(
                    this.force,
                    row.instanceId,
                    row.prepared,
                    mekDispatch(row.instanceId),
                );
                if (!settled || !this.boundaryContextsCurrent(owners, true)) {
                    return this.failedPhasePreparationBatch(instanceIds, snapshots);
                }
                mekById.set(row.instanceId, settled);
            }
        }

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
            if (!this.boundaryContextsCurrent(owners, true)) {
                return this.failedBoundaryBatch(instanceIds, results, phase.instanceId, 'NOT_ADMITTED', false);
            }
            const beforeRevision = stateRevision(phase.before);
            if (phase.kind === 'mek') {
                const settled = phase.prepared;
                const result = await this.boundary.dispatchCore(
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
                const { completed } = await this.completeAutomatedCommand(
                    phase.instanceId, owners.get(phase.instanceId)?.owner, result,
                    dispatch => mekAutomation ? mekAutomation.afterCommand(
                        this.force,
                        phase.instanceId,
                        phase.before,
                        settled,
                        result,
                        dispatch,
                    ) : Promise.resolve(true),
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

            const settled = phase.prepared;
            const result = await this.boundary.dispatchCore(
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
            const { completed } = await this.completeAutomatedCommand(
                phase.instanceId, owners.get(phase.instanceId)?.owner, result,
                dispatch => nonMekAutomation ? nonMekAutomation.afterCommand(
                    this.force,
                    phase.instanceId,
                    phase.before,
                    settled,
                    result,
                    dispatch,
                ) : Promise.resolve(true),
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
        const owners = this.boundaryContexts(instanceIds);
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
        if (!this.boundaryContextsCurrent(owners, true)) return this.failedEndTurnBatch(instanceIds, initialRevisions);
        const mekAutomation = this.mekAutomation();
        const nonMekAutomation = this.nonMekAutomation();

        const mekRequests: DirectMekEndTurnAutomationRequest[] = [];
        const nonMekRequests: DirectNonMekEndTurnAutomationRequest[] = [];
        const preparedMekById = new Map<string, PreparedDirectMekAutomationCommand>();
        const preparedNonMekById = new Map<string, PreparedDirectNonMekAutomationCommand>();
        for (const instanceId of instanceIds) {
            if (!this.boundaryContextsCurrent(owners, true)) return this.failedEndTurnBatch(instanceIds, initialRevisions);
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
                            type: 'end-turn' as const,
                            policy: 'manual' as const,
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
                        type: 'end-turn' as const, policy: 'automatic',
                    }),
                }));
            }
        }

        // Both reviews complete before the first turn mutation. This preserves
        // origin/next's cancel semantics even for a mixed force.
        const reviewContexts = this.boundaryContexts(instanceIds);
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
        if (preparedMeks === null || preparedNonMeks === null || !this.boundaryContextsCurrent(reviewContexts)) {
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
                        this.dispatchForOwner(instanceId, owners.get(instanceId)?.owner, generated, generatedAutomate),
                )
                : prepared;
            if (settled === null || !this.boundaryContextsCurrent(owners, true)) {
                this.refreshEndTurnWorkflowRevision(instanceId);
                return this.failedEndTurnBatch(instanceIds, initialRevisions);
            }
            const ready = await this.markMekEndTurnHeatStaged(instanceId, settled);
            if (ready === null || !this.boundaryContextsCurrent(owners, true)) {
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
                        this.dispatchForOwner(instanceId, owners.get(instanceId)?.owner, generated, generatedAutomate),
                )
                : prepared;
            if (settled === null || !this.boundaryContextsCurrent(owners, true)) {
                this.refreshEndTurnWorkflowRevision(instanceId);
                return this.failedEndTurnBatch(instanceIds, initialRevisions);
            }
            const ready = await this.markNonMekEndTurnHeatStaged(instanceId, settled);
            if (ready === null || !this.boundaryContextsCurrent(owners, true)) {
                this.refreshEndTurnWorkflowRevision(instanceId);
                return this.failedEndTurnBatch(instanceIds, initialRevisions);
            }
            settledNonMekById.set(instanceId, ready);
            const afterSettlement = this.boundary.snapshot(instanceId);
            if (afterSettlement) {
                this.saveNonMekSettlement(instanceId, afterSettlement, ready, true);
            }
        }
        // Heat and fall consequences can enqueue critical work after the
        // opening preflight. Drain every such cursor before any turn reset;
        // a closed review leaves all units at their durable heat checkpoint.
        if (mekAutomation) {
            for (const instanceId of settledMekById.keys()) {
                if (!await mekAutomation.resumePendingAutomation(
                    this.force,
                    instanceId,
                    (generated, generatedAutomate = true) =>
                        this.dispatchForOwner(instanceId, owners.get(instanceId)?.owner, generated, generatedAutomate),
                    false,
                )) {
                    this.refreshEndTurnWorkflowRevision(instanceId);
                    return this.failedEndTurnBatch(instanceIds, initialRevisions);
                }
            }
        }
        const results: CBTForceEndTurnUnitResult[] = [];
        for (const instanceId of instanceIds) {
            if (!this.boundaryContextsCurrent(owners, true)) return this.failedEndTurnBatch(instanceIds, initialRevisions);
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
                const result = await this.boundary.dispatchCore(instanceId, prepared.command);
                const { completed } = await this.completeAutomatedCommand(
                    instanceId, owners.get(instanceId)?.owner, result,
                    dispatch => mekAutomation ? mekAutomation.afterCommand(
                        this.force,
                        instanceId,
                        snapshot,
                        prepared,
                        result,
                        dispatch,
                    ) : Promise.resolve(true),
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
            const result = await this.boundary.dispatchCore(instanceId, prepared.command);
            const { completed } = await this.completeAutomatedCommand(
                instanceId, owners.get(instanceId)?.owner, result,
                dispatch => nonMekAutomation ? nonMekAutomation.afterCommand(
                    this.force,
                    instanceId,
                    snapshot,
                    prepared,
                    result,
                    dispatch,
                ) : Promise.resolve(true),
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

    private failedPhasePreparationBatch(
        instanceIds: readonly string[],
        initialSnapshots: ReadonlyMap<string, CBTUnitSnapshot>,
    ): CBTForceEndTurnAllResult {
        const results = instanceIds.map(instanceId => Object.freeze({
            instanceId,
            accepted: false,
            changed: stateRevision(this.boundary.snapshot(instanceId))
                !== stateRevision(initialSnapshots.get(instanceId) ?? null),
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
        dispatch = (command: CBTUnitCommand) => this.boundary.dispatchCore(instanceId, command),
    ): Promise<PreparedDirectMekAutomationCommand | null> {
        if (prepared.command.type !== 'end-turn') return null;
        let snapshot = this.boundary.snapshot(instanceId);
        if (!snapshot || !hasMekRuntime(snapshot)) return null;
        if (!this.endTurnHeatAlreadyStaged(snapshot)) {
            const marked = await dispatch({
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
        dispatch = (command: CBTUnitCommand) => this.boundary.dispatchCore(instanceId, command),
    ): Promise<PreparedDirectNonMekAutomationCommand | null> {
        if (prepared.command.type !== 'end-turn') return null;
        let snapshot = this.boundary.snapshot(instanceId);
        if (!snapshot || !hasNonMekRuntime(snapshot)) return null;
        if (!this.endTurnHeatAlreadyStaged(snapshot)) {
            const marked = await dispatch({
                type: 'mark-end-turn-heat-staged',
            });
            if (!marked.accepted) return null;
            snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot || !hasNonMekRuntime(snapshot)) return null;
        }
        return Object.freeze({
            ...prepared,
            command: Object.freeze({
                ...prepared.command,
                policy: 'manual' as const,
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
        if (snapshot.editContext.owner === pending.owner && turn === pending.turn && revision === pending.revision) return pending;
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
            kind: 'mek', owner: snapshot.editContext.owner, turn, revision, prepared, settled,
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
            kind: 'non-mek', owner: snapshot.editContext.owner, turn, revision, prepared, settled,
        }));
    }

    /** Keeps a reviewed plan resumable after its own partial settlement only. */
    private refreshEndTurnWorkflowRevision(instanceId: string): void {
        const snapshot = this.boundary.snapshot(instanceId);
        const pending = this.pendingEndTurnSettlements.get(instanceId);
        const turn = turnCounter(snapshot);
        const revision = stateRevision(snapshot);
        if (!snapshot || !pending || snapshot.editContext.owner !== pending.owner || turn !== pending.turn || revision === null) {
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
        return this.injector.get(DirectMekAutomationService, null, { optional: true });
    }

    private nonMekAutomation(): DirectNonMekAutomationService | null {
        return this.injector.get(DirectNonMekAutomationService, null, { optional: true });
    }

    private cancelledMek(instanceId: string): CBTForceUnitCommandResult {
        const snapshot = this.boundary.snapshot(instanceId);
        return Object.freeze({
            accepted: true,
            changed: false,
            state: snapshot && hasMekRuntime(snapshot) ? snapshot.state : null,
        });
    }

    private cancelledNonMek(instanceId: string): CBTForceUnitCommandResult {
        const snapshot = this.boundary.snapshot(instanceId);
        return Object.freeze({
            accepted: true,
            changed: false,
            state: snapshot && hasNonMekRuntime(snapshot) ? snapshot.state : null,
        });
    }
}
