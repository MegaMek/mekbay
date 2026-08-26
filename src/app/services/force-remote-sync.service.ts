// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable, DestroyRef, type WritableSignal } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

import { ConfirmDialogComponent, type ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { Force, ForceOwnerAuthorityFingerprint } from '../models/force.model';
import { isCBTForceMember, type ForceMember } from '../models/force-member.model';
import type { ForceAlignment, ForceSlot } from '../models/force-slot.model';
import type { SerializedForce } from '../models/force-serialization';
import {
    decodeForceFromStorage,
    isCompactStoredForce,
} from '../models/runtime/force-storage-codec';
import {
    DataService,
    type PreparedRemoteForceAcceptance,
    type StagedRemoteForceSnapshot,
} from './data.service';
import { DialogsService } from './dialogs.service';
import { ForceUrlStateService } from './force-url-state.service';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import type { ForceUpdateSource } from './ws.service';

type ForceAuthorityComparison = 'incoming-older' | 'incoming-newer' | 'same' | 'diverged';

interface RemoteForceCommitFence {
    readonly timestamp: string | null;
    readonly cbtRevision: number | undefined;
    readonly authorityFingerprint: ForceOwnerAuthorityFingerprint;
}

interface PreparedRemoteForceSwapPlan {
    readonly expectedSlots: readonly ForceSlot[];
    readonly replacementSlot: ForceSlot;
    readonly publishedSlots: ForceSlot[];
    readonly expectedAlignment: ForceAlignment;
    readonly selectionByPreviousUnit: ReadonlyMap<ForceMember, ForceMember | null>;
    readonly latestReplacementUnit: ASForceUnit | undefined;
}

export interface ForceRemoteWorkspace {
    readonly loadedForces: WritableSignal<ForceSlot[]>;
    readonly selectedUnit: WritableSignal<ForceMember | null>;
    readonly followLastModifiedUnit: () => boolean;
    readonly getForceSlot: (force: Force) => ForceSlot | undefined;
    readonly setupForceSlot: (force: Force, alignment: ForceAlignment, activate: boolean) => ForceSlot;
    readonly activateForceSlot: (slot: ForceSlot) => void;
    readonly teardownForceSlot: (slot: ForceSlot) => void;
    readonly disposeDetachedForceSlot: (slot: ForceSlot) => void;
    readonly destroyDetachedForceUnits: (force: Force) => void;
    readonly selectUnit: (unit: ForceMember | null) => void;
}

function parseForceTimestamp(timestamp: string | null | undefined): number | null {
    if (!timestamp) return null;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
}

function captureRemoteForceCommitFence(force: Force): RemoteForceCommitFence {
    return Object.freeze({
        timestamp: force.timestamp,
        cbtRevision: force.gameSystem === GameSystem.CLASSIC
            ? force.getCBTForceV2Revision()
            : undefined,
        authorityFingerprint: force.captureWholeOwnerAuthorityFingerprint(),
    });
}

function matchesRemoteForceCommitFence(force: Force, fence: RemoteForceCommitFence): boolean {
    try {
        return force.timestamp === fence.timestamp
            && force.isWholeOwnerAuthorityFingerprintCurrent(fence.authorityFingerprint)
            && (force.gameSystem !== GameSystem.CLASSIC
                || force.getCBTForceV2Revision() === fence.cbtRevision);
    } catch {
        return false;
    }
}

function compareForceAuthority(targetForce: Force, incomingForce: Force): ForceAuthorityComparison | null {
    const currentTimestamp = parseForceTimestamp(targetForce.timestamp);
    const incomingTimestamp = parseForceTimestamp(incomingForce.timestamp);
    if (currentTimestamp === null || incomingTimestamp === null) return null;
    if (incomingTimestamp < currentTimestamp) return 'incoming-older';
    if (incomingTimestamp > currentTimestamp) return 'incoming-newer';
    try {
        return targetForce.getWholeOwnerPersistentAuthoritySnapshotJson()
            === incomingForce.getWholeOwnerPersistentAuthoritySnapshotJson()
            ? 'same'
            : 'diverged';
    } catch {
        return null;
    }
}

/** Owns remote snapshot arbitration, conflict handling, and atomic owner replacement. */
@Injectable({ providedIn: 'root' })
export class ForceRemoteSyncService {
    private readonly dataService = inject(DataService);
    private readonly dialogsService = inject(DialogsService);
    private readonly forceUrl = inject(ForceUrlStateService);
    private readonly logger = inject(LoggerService);
    private readonly optionsService = inject(OptionsService);
    private readonly toastService = inject(ToastService);
    private configuredWorkspace: ForceRemoteWorkspace | null = null;
    private conflictDialogRef: { close(): void; readonly closed: import('rxjs').Observable<unknown> } | undefined;
    private remoteConflictQueue: Promise<void> = Promise.resolve();
    private readonly remoteForceReceiptGeneration = new Map<string, number>();
    private readonly remoteForcePublicationQueue = new Map<string, Promise<void>>();
    readonly remoteForceUpdated$ = new Subject<{ force: Force; alignment: ForceAlignment }>();

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.conflictDialogRef?.close();
            this.conflictDialogRef = undefined;
        });
    }

    configure(workspace: ForceRemoteWorkspace): void {
        if (this.configuredWorkspace && this.configuredWorkspace !== workspace) {
            throw new Error('ForceRemoteSyncService is already configured.');
        }
        this.configuredWorkspace = workspace;
    }

    private get workspace(): ForceRemoteWorkspace {
        if (!this.configuredWorkspace) throw new Error('ForceRemoteSyncService has not been configured.');
        return this.configuredWorkspace;
    }

    private resolveUniqueRemoteForceTarget(
        capturedForce: Force,
        instanceId: string,
    ): { readonly force: Force; readonly slot: ForceSlot } | null {
        const capturedSlot = this.workspace.getForceSlot(capturedForce);
        if (capturedSlot?.force === capturedForce
            && capturedForce.instanceId() === instanceId) {
            return Object.freeze({ force: capturedForce, slot: capturedSlot });
        }
        const matches = this.workspace.loadedForces().filter(slot => slot.force.instanceId() === instanceId);
        return matches.length === 1
            ? Object.freeze({ force: matches[0].force, slot: matches[0] })
            : null;
    }

    private enqueueRemoteForcePublication<T>(
        instanceId: string,
        publish: () => Promise<T>,
    ): Promise<T> {
        const predecessor = this.remoteForcePublicationQueue.get(instanceId) ?? Promise.resolve();
        const task = predecessor.then(publish, publish);
        const tail = task.then(() => undefined, () => undefined);
        this.remoteForcePublicationQueue.set(instanceId, tail);
        void tail.then(() => {
            if (this.remoteForcePublicationQueue.get(instanceId) === tail) {
                this.remoteForcePublicationQueue.delete(instanceId);
            }
        });
        return task;
    }

    async reconcileRemoteForce(
        targetForce: Force,
        serializedForce: SerializedForce,
        source: ForceUpdateSource = 'live',
        conflictAlreadyQueued: boolean = false,
        retainedReceiptGeneration?: number,
    ) {
        if (!targetForce) return;
        let incomingSnapshot: SerializedForce;
        try {
            // Conflict arbitration may outlive the transport callback. Retain
            // the exact bytes observed at receipt, never its caller-owned graph.
            incomingSnapshot = isCompactStoredForce(serializedForce)
                ? decodeForceFromStorage(serializedForce)
                : structuredClone(serializedForce);
        } catch (error) {
            this.logger.error(`Ignoring unclonable remote force update for ${targetForce.instanceId()}: ${error}`);
            return;
        }
        const receiptGeneration = retainedReceiptGeneration ?? (
            (this.remoteForceReceiptGeneration.get(incomingSnapshot.instanceId) ?? 0) + 1
        );
        if (retainedReceiptGeneration === undefined) {
            this.remoteForceReceiptGeneration.set(incomingSnapshot.instanceId, receiptGeneration);
        } else if (this.remoteForceReceiptGeneration.get(incomingSnapshot.instanceId) !== receiptGeneration) {
            return;
        }
        const initialTarget = this.resolveUniqueRemoteForceTarget(
            targetForce,
            incomingSnapshot.instanceId,
        );
        if (!initialTarget) return;
        let currentTarget = initialTarget.force;
        let expectedSlot = initialTarget.slot;
        let commitFence = captureRemoteForceCommitFence(currentTarget);

        let staged: StagedRemoteForceSnapshot;
        try {
            staged = await this.dataService.stageRemoteForceSnapshot(incomingSnapshot);
        } catch (error) {
            this.logger.error(`Ignoring unsafe remote force update for ${currentTarget.instanceId()}: ${error}`);
            return;
        }
        try {
            if (this.remoteForceReceiptGeneration.get(incomingSnapshot.instanceId) !== receiptGeneration) return;
            // The async materialization above is deliberately off-live. Re-resolve
            // the unique durable owner and arbitrate against current authority
            // only now. A prior update may have replaced the object captured by
            // this subscription while a newer callback was already queued.
            const resolvedTarget = this.resolveUniqueRemoteForceTarget(
                currentTarget,
                incomingSnapshot.instanceId,
            );
            if (!resolvedTarget) return;
            if (resolvedTarget.force === currentTarget) {
                if (resolvedTarget.slot !== expectedSlot
                    || !matchesRemoteForceCommitFence(currentTarget, commitFence)) {
                    this.logger.warn(`Ignoring remote force update for instance ${currentTarget.instanceId()}: local authority changed while staging.`);
                    return;
                }
            } else {
                currentTarget = resolvedTarget.force;
                expectedSlot = resolvedTarget.slot;
                commitFence = captureRemoteForceCommitFence(currentTarget);
            }
            if (!this.isCompatibleStagedRemoteSnapshot(currentTarget, staged.force)) return;
            const authorityComparison = compareForceAuthority(currentTarget, staged.force);
            if (authorityComparison === null) {
                this.logger.warn(`Ignoring remote force update for instance ${currentTarget.instanceId()}: unable to compare persistent authority.`);
                return;
            }
            if (authorityComparison === 'incoming-older') {
                if (source === 'reconnect' && currentTarget.owned()) {
                    try {
                        await this.dataService.saveForceAndWaitForCloud(currentTarget);
                    } catch (error) {
                        this.logger.error(`Failed to push local force ${currentTarget.instanceId()} after reconnect: ${error}`);
                    }
                }
                return;
            }
            if (authorityComparison === 'same') return;
            if (source === 'reconnect'
                && currentTarget.owned()
                && this.optionsService.options().enableForceSyncConflictDialog) {
                if (conflictAlreadyQueued) {
                    await this.handleRemoteForceConflict(
                        currentTarget,
                        incomingSnapshot,
                        receiptGeneration,
                    );
                } else {
                    await this.enqueueRemoteForceConflict(currentTarget, incomingSnapshot, receiptGeneration);
                }
                return;
            }
            try {
                this.forceUrl.setSynchronizationEnabled(false);
                await this.enqueueRemoteForcePublication(incomingSnapshot.instanceId, async () => {
                    const isReceiptCurrent = () => this.remoteForceReceiptGeneration.get(incomingSnapshot.instanceId)
                        === receiptGeneration;
                    if (!isReceiptCurrent()) return null;
                    const finalTarget = this.resolveUniqueRemoteForceTarget(
                        currentTarget,
                        incomingSnapshot.instanceId,
                    );
                    if (!finalTarget) return null;
                    currentTarget = finalTarget.force;
                    expectedSlot = finalTarget.slot;
                    commitFence = captureRemoteForceCommitFence(currentTarget);
                    if (!this.isCompatibleStagedRemoteSnapshot(currentTarget, staged.force)) return null;
                    const finalComparison = compareForceAuthority(currentTarget, staged.force);
                    if (finalComparison === null
                        || finalComparison === 'incoming-older'
                        || finalComparison === 'same') return null;
                    return this.swapInStagedRemoteSnapshot(
                        currentTarget,
                        expectedSlot,
                        staged,
                        commitFence,
                        isReceiptCurrent,
                    );
                });
            } finally {
                this.forceUrl.setSynchronizationEnabled(true);
            }
        } finally {
            // A successful accept already consumed the token. Every ignored,
            // superseded, or conflict-queued snapshot is torn down here.
            this.dataService.discardRemoteForceSnapshot(staged);
        }
    }

    private isCompatibleStagedRemoteSnapshot(targetForce: Force, stagedForce: Force): boolean {
        if (targetForce.instanceId() !== stagedForce.instanceId()
            || targetForce.gameSystem !== stagedForce.gameSystem) {
            this.logger.error(`Ignoring remote force update for ${targetForce.instanceId()}: force identity or game system changed.`);
            return false;
        }
        if (targetForce.gameSystem === GameSystem.CLASSIC
            && targetForce.hasCBTForceV2()
            && !stagedForce.hasCBTForceV2()) {
            this.logger.error(`Ignoring unsafe remote CBT persistence update for ${targetForce.instanceId()}: missing-v2`);
            return false;
        }
        return true;
    }

    private async swapInStagedRemoteSnapshot(
        targetForce: Force,
        expectedSlot: ForceSlot,
        staged: StagedRemoteForceSnapshot,
        commitFence: RemoteForceCommitFence,
        isPublicationCurrent: () => boolean = () => true,
    ): Promise<Force | null> {
        if (!isPublicationCurrent()
            || this.workspace.getForceSlot(targetForce) !== expectedSlot
            || expectedSlot.force !== targetForce
            || !matchesRemoteForceCommitFence(targetForce, commitFence)) {
            return null;
        }
        let plan: PreparedRemoteForceSwapPlan;
        let selectionBeforeCommit: ForceMember | null;
        let selectionAfterCommit: ForceMember | null | undefined;
        try {
            plan = this.prepareRemoteForceSwapPlan(targetForce, expectedSlot, staged.force);
        } catch (error) {
            this.logger.error(`Could not prepare remote force replacement ${targetForce.instanceId()}: ${error}`);
            return null;
        }

        let acceptance: PreparedRemoteForceAcceptance;
        try {
            acceptance = this.dataService.prepareRemoteForceSnapshotAcceptance(staged);
        } catch (error) {
            this.disposePreparedRemoteForceSwapPlan(plan);
            throw error;
        }
        const maxRetirementAttempts = 3;
        let retirement: ReturnType<Force['beginWholeOwnerRetirement']> = null;
        let published = false;
        try {
            for (let attempt = 0; attempt < maxRetirementAttempts; attempt += 1) {
                if (!isPublicationCurrent()) return null;
                retirement = targetForce.beginWholeOwnerRetirement();
                if (!retirement) return null;
                const ready = await retirement.ready;
                if (!isPublicationCurrent()) return null;
                let persistenceDrained = false;
                if (ready) {
                    try {
                        persistenceDrained = await this.dataService.drainForceAuthorityPersistence(
                            targetForce,
                            commitFence.authorityFingerprint,
                        );
                    } catch (error) {
                        this.logger.error(`Could not drain persistence before replacing ${targetForce.instanceId()}: ${error}`);
                        return null;
                    }
                    if (persistenceDrained) break;
                }

                // Work submitted before this swap is allowed to finish. Its
                // authority change (including an acknowledged pre-existing
                // cloud save) invalidates the begin-time witness, so reopen this
                // exact token, rebuild every detached plan from the settled graph,
                // and make a fresh bounded retirement attempt.
                targetForce.cancelWholeOwnerRetirement(retirement.token);
                retirement = null;
                if (attempt + 1 >= maxRetirementAttempts
                    || !isPublicationCurrent()
                    || this.workspace.getForceSlot(targetForce) !== expectedSlot
                    || expectedSlot.force !== targetForce) return null;
                this.disposePreparedRemoteForceSwapPlan(plan);
                try {
                    plan = this.prepareRemoteForceSwapPlan(targetForce, expectedSlot, staged.force);
                    commitFence = captureRemoteForceCommitFence(targetForce);
                } catch (error) {
                    this.logger.error(`Could not rebuild remote force replacement ${targetForce.instanceId()}: ${error}`);
                    return null;
                }
            }
            if (!retirement
                || !isPublicationCurrent()
                || this.workspace.loadedForces() !== plan.expectedSlots
                || this.workspace.getForceSlot(targetForce) !== expectedSlot
                || expectedSlot.force !== targetForce
                || expectedSlot.alignment !== plan.expectedAlignment
                || !matchesRemoteForceCommitFence(targetForce, commitFence)) {
                return null;
            }

            // formationHistory is deliberately transient and does not advance
            // force authority. Capture its final, drained value immediately
            // before retiring the old graph.
            try {
                this.transferFormationHistory(targetForce, staged.force);
                selectionBeforeCommit = this.workspace.selectedUnit();
                const mappedSelection = selectionBeforeCommit === null
                    ? undefined
                    : plan.selectionByPreviousUnit.has(selectionBeforeCommit)
                        ? plan.selectionByPreviousUnit.get(selectionBeforeCommit)
                        : selectionBeforeCommit;
                selectionAfterCommit = this.workspace.followLastModifiedUnit()
                    ? plan.latestReplacementUnit
                        ?? mappedSelection
                    : mappedSelection;
            } catch (error) {
                this.logger.error(`Could not preserve transient force session state for ${targetForce.instanceId()}: ${error}`);
                return null;
            }

            // Everything below is prevalidated, synchronous, and callback-free
            // through the one slot publication. No fallible teardown/setup is
            // allowed to separate retiring the old owner from exposing the new.
            let committedAcceptance: Extract<
                ReturnType<DataService['commitPreparedRemoteForceReplacement']>,
                { readonly accepted: true }
            > | undefined;
            const retired = targetForce.commitWholeOwnerRetirement(retirement.token, authority => {
                if (!isPublicationCurrent()
                    || this.workspace.loadedForces() !== plan.expectedSlots
                    || this.workspace.getForceSlot(targetForce) !== expectedSlot) return null;
                const result = this.dataService.commitPreparedRemoteForceReplacement(
                    acceptance,
                    targetForce,
                    authority,
                );
                if (!result.accepted) {
                    this.logger.error(`Prepared remote force acceptance was lost for ${targetForce.instanceId()}: ${result.reason}`);
                    return null;
                }
                committedAcceptance = result;
                return () => {
                    // Force has rechecked and retired the predecessor before
                    // either authority map or slot publication moves.
                    result.finalize();
                    this.workspace.loadedForces.set(plan.publishedSlots);
                    published = true;
                };
            });
            if (!retired || !published || !committedAcceptance) return null;

            // Publication wins before any old cleanup or external subscription
            // work. Each post-publication action is independently best-effort.
            try {
                this.workspace.activateForceSlot(plan.replacementSlot);
            } catch (error) {
                this.logger.error(`Could not activate replacement force slot ${staged.force.instanceId()}: ${error}`);
            }
            try {
                this.workspace.teardownForceSlot(expectedSlot);
            } catch (error) {
                this.logger.warn(`Could not tear down retired force slot ${targetForce.instanceId()}: ${error}`);
            }
            if (this.workspace.selectedUnit() === selectionBeforeCommit
                && selectionAfterCommit !== undefined) {
                try {
                    this.workspace.selectUnit(selectionAfterCommit);
                } catch (error) {
                    this.logger.warn(`Could not restore selection after remote force replacement: ${error}`);
                }
            }
            try {
                this.remoteForceUpdated$.next({
                    force: staged.force,
                    alignment: plan.replacementSlot.alignment,
                });
            } catch (error) {
                this.logger.warn(`Could not notify remote force replacement observers: ${error}`);
            }
            try {
                await committedAcceptance.persistence();
            } catch (error) {
                this.logger.error(`Could not persist accepted remote force ${staged.force.instanceId()}: ${error}`);
            }
            return staged.force;
        } finally {
            if (!published) {
                if (retirement) targetForce.cancelWholeOwnerRetirement(retirement.token);
                this.dataService.discardPreparedRemoteForceAcceptance(acceptance);
                this.disposePreparedRemoteForceSwapPlan(plan);
            }
        }
    }

    private prepareRemoteForceSwapPlan(
        targetForce: Force,
        expectedSlot: ForceSlot,
        replacement: Force,
    ): PreparedRemoteForceSwapPlan {
        this.assertUniqueDurableForceIds(targetForce, 'live');
        this.assertUniqueDurableForceIds(replacement, 'replacement');
        const replacementSlot = this.workspace.setupForceSlot(replacement, expectedSlot.alignment, false);
        try {
            const expectedSlots = this.workspace.loadedForces();
            const slotIndex = expectedSlots.indexOf(expectedSlot);
            if (slotIndex < 0 || expectedSlot.force !== targetForce) {
                throw new Error('The target force slot changed while preparing its replacement');
            }
            const publishedSlots = [...expectedSlots];
            publishedSlots[slotIndex] = replacementSlot;

            const previousUnits = targetForce.members();
            const replacementUnits = replacement.members();
            const replacementById = new Map(replacementUnits.map(unit => [unit.id, unit]));
            const selectionByPreviousUnit = new Map<ForceMember, ForceMember | null>(
                previousUnits.map((unit, index) => [
                    unit,
                    replacementById.get(unit.id)
                        ?? replacementUnits[index]
                        ?? replacementUnits[0]
                        ?? null,
                ]),
            );
            const timestampedUnits = replacementUnits.filter(
                (unit): unit is ASForceUnit => !isCBTForceMember(unit),
            );
            const latestCandidate = timestampedUnits.length === 0
                ? undefined
                : timestampedUnits.reduce((best, unit) =>
                    (unit.updatedTs ?? 0) > (best.updatedTs ?? 0) ? unit : best,
                timestampedUnits[0]);
            const latestReplacementUnit = latestCandidate !== undefined
                && (latestCandidate.updatedTs ?? 0) > 0
                ? latestCandidate
                : undefined;
            return Object.freeze({
                expectedSlots,
                replacementSlot,
                publishedSlots,
                expectedAlignment: expectedSlot.alignment,
                selectionByPreviousUnit,
                latestReplacementUnit,
            });
        } catch (error) {
            this.workspace.disposeDetachedForceSlot(replacementSlot);
            throw error;
        }
    }

    private disposePreparedRemoteForceSwapPlan(plan: PreparedRemoteForceSwapPlan): void {
        this.workspace.disposeDetachedForceSlot(plan.replacementSlot);
    }

    private transferFormationHistory(previous: Force, replacement: Force): void {
        const previousById = new Map<string, Set<string>>();
        for (const group of previous.groups()) {
            if (typeof group.id !== 'string' || group.id.trim().length === 0 || previousById.has(group.id)) {
                throw new Error(`The live force has a missing or duplicate durable group ID: ${String(group.id)}`);
            }
            if (!(group.formationHistory instanceof Set)) {
                throw new Error(`The live force group ${group.id} has malformed formation history`);
            }
            const detached = new Set<string>();
            for (const formationId of group.formationHistory) {
                if (typeof formationId !== 'string') {
                    throw new Error(`The live force group ${group.id} has cyclic or malformed formation history`);
                }
                detached.add(formationId);
            }
            previousById.set(group.id, detached);
        }

        const replacementIds = new Set<string>();
        for (const group of replacement.groups()) {
            if (typeof group.id !== 'string' || group.id.trim().length === 0 || replacementIds.has(group.id)) {
                throw new Error(`The replacement force has a missing or duplicate durable group ID: ${String(group.id)}`);
            }
            replacementIds.add(group.id);
            const previousHistory = previousById.get(group.id);
            group.formationHistory = new Set(previousHistory ?? group.formationHistory);
        }
    }

    private assertUniqueDurableForceIds(force: Force, label: string): void {
        if (force instanceof CBTForce) {
            if (force.queryCanonicalRoster().kind !== 'available') {
                throw new Error(`The ${label} force has no canonical roster`);
            }
            return;
        }
        const groupIds = new Set<string>();
        const unitIds = new Set<string>();
        for (const group of force.groups()) {
            if (typeof group.id !== 'string' || group.id.trim().length === 0 || groupIds.has(group.id)) {
                throw new Error(`The ${label} force has a missing or duplicate durable group ID: ${String(group.id)}`);
            }
            groupIds.add(group.id);
            for (const unit of group.units()) {
                if (typeof unit.id !== 'string' || unit.id.trim().length === 0 || unitIds.has(unit.id)) {
                    throw new Error(`The ${label} force has a missing or duplicate durable unit ID: ${String(unit.id)}`);
                }
                unitIds.add(unit.id);
            }
        }
    }

    private async applyRemotePersistenceSnapshot(
        targetForce: Force,
        serializedForce: SerializedForce,
        isPublicationCurrent: () => boolean = () => true,
    ): Promise<Force | null> {
        const expectedSlot = this.workspace.getForceSlot(targetForce);
        if (!expectedSlot || expectedSlot.force !== targetForce) return null;
        // The user chose this exact local authority in the conflict dialog.
        // An edit while off-live staging awaits must invalidate that choice,
        // not become part of a later fence and then be overwritten.
        const commitFence = captureRemoteForceCommitFence(targetForce);
        let staged: StagedRemoteForceSnapshot;
        try {
            staged = await this.dataService.stageRemoteForceSnapshot(serializedForce);
        } catch (error) {
            this.logger.error(`Ignoring unsafe remote force update for ${targetForce.instanceId()}: ${error}`);
            return null;
        }
        try {
            if (!this.isCompatibleStagedRemoteSnapshot(targetForce, staged.force)) return null;
            return this.swapInStagedRemoteSnapshot(
                targetForce,
                expectedSlot,
                staged,
                commitFence,
                isPublicationCurrent,
            );
        } finally {
            this.dataService.discardRemoteForceSnapshot(staged);
        }
    }

    private enqueueRemoteForceConflict(
        localForce: Force,
        remoteForce: SerializedForce,
        receiptGeneration: number,
    ): Promise<void> {
        let retainedSnapshot: SerializedForce;
        try {
            retainedSnapshot = structuredClone(remoteForce);
        } catch (error) {
            this.logger.error(`Could not retain remote force conflict bytes: ${error}`);
            return Promise.resolve();
        }
        const previousConflict = this.remoteConflictQueue ?? Promise.resolve();
        this.remoteConflictQueue = previousConflict
            .then(async () => {
                const instanceId = retainedSnapshot.instanceId;
                const resolved = this.resolveUniqueRemoteForceTarget(localForce, instanceId);
                if (!resolved) return;
                // A queued dialog is not itself authority. Re-stage and
                // re-arbitrate its retained bytes against the owner that is
                // uniquely live when the queue entry actually executes.
                await this.reconcileRemoteForce(
                    resolved.force,
                    retainedSnapshot,
                    'reconnect',
                    true,
                    receiptGeneration,
                );
            })
            .catch(error => {
                this.logger.error(`Failed to resolve force sync conflict: ${error}`);
            });
        return this.remoteConflictQueue;
    }

    private async replaceConflictForceWithClone(
        localForce: Force,
        expectedSlot: ForceSlot,
        expectedAlignment: ForceAlignment,
        localFingerprint: ForceOwnerAuthorityFingerprint,
        isPublicationCurrent: () => boolean,
    ): Promise<Force | null> {
        if (!isPublicationCurrent()
            || this.workspace.getForceSlot(localForce) !== expectedSlot
            || expectedSlot.force !== localForce
            || expectedSlot.alignment !== expectedAlignment
            || !localForce.isWholeOwnerAuthorityFingerprintCurrent(localFingerprint)) return null;

        const cloned = await localForce.cloneForPersistence();
        let replacementSlot: ForceSlot | null = null;
        let published = false;
        let retirement: ReturnType<Force['beginWholeOwnerRetirement']> = null;
        let retirementFingerprint = localFingerprint;
        try {
            // cloneForPersistence is an owner-tail operation. A later local edit
            // invalidates the dialog choice instead of being silently folded
            // into the detached clone.
            if (!isPublicationCurrent()
                || this.workspace.getForceSlot(localForce) !== expectedSlot
                || expectedSlot.force !== localForce
                || expectedSlot.alignment !== expectedAlignment
                || !localForce.isWholeOwnerAuthorityFingerprintCurrent(localFingerprint)) return null;

            cloned.setName(localForce.displayName() + ' (Cloned)', false);
            replacementSlot = this.workspace.setupForceSlot(cloned, expectedAlignment, false);
            const expectedSlots = this.workspace.loadedForces();
            const slotIndex = expectedSlots.indexOf(expectedSlot);
            if (slotIndex < 0) return null;
            const publishedSlots = [...expectedSlots];
            publishedSlots[slotIndex] = replacementSlot;
            const persistentDigest = localForce.getWholeOwnerPersistentAuthoritySnapshotJson();
            const maxRetirementAttempts = 3;
            for (let attempt = 0; attempt < maxRetirementAttempts; attempt += 1) {
                if (!isPublicationCurrent()
                    || this.workspace.loadedForces() !== expectedSlots
                    || this.workspace.getForceSlot(localForce) !== expectedSlot
                    || expectedSlot.force !== localForce
                    || expectedSlot.alignment !== expectedAlignment
                    || localForce.getWholeOwnerPersistentAuthoritySnapshotJson() !== persistentDigest) return null;
                retirementFingerprint = localForce.captureWholeOwnerAuthorityFingerprint();
                retirement = localForce.beginWholeOwnerRetirement();
                if (!retirement) return null;
                const ready = await retirement.ready;
                let persistenceDrained = false;
                if (ready) {
                    try {
                        persistenceDrained = await this.dataService.drainForceAuthorityPersistence(
                            localForce,
                            retirementFingerprint,
                        );
                    } catch (error) {
                        this.logger.error(`Could not drain persistence before cloning conflict source ${localForce.instanceId()}: ${error}`);
                        return null;
                    }
                }
                if (persistenceDrained
                    && isPublicationCurrent()
                    && this.workspace.loadedForces() === expectedSlots
                    && this.workspace.getForceSlot(localForce) === expectedSlot
                    && expectedSlot.force === localForce
                    && expectedSlot.alignment === expectedAlignment
                    && localForce.getWholeOwnerPersistentAuthoritySnapshotJson() === persistentDigest
                    && localForce.isWholeOwnerAuthorityFingerprintCurrent(retirementFingerprint)) break;
                localForce.cancelWholeOwnerRetirement(retirement.token);
                retirement = null;
                if (attempt + 1 >= maxRetirementAttempts) return null;
            }
            if (!retirement) return null;

            const selectionBeforeCommit = this.workspace.selectedUnit();
            const selectedIndex = selectionBeforeCommit === null
                ? -1
                : localForce.members().indexOf(selectionBeforeCommit);
            const clonedUnits = cloned.members();
            const selectionAfterCommit = selectedIndex >= 0
                ? clonedUnits[selectedIndex] ?? clonedUnits[0] ?? null
                : selectionBeforeCommit;

            const retired = localForce.commitWholeOwnerRetirement(retirement.token, authority => {
                if (!isPublicationCurrent()
                    || this.workspace.loadedForces() !== expectedSlots
                    || this.workspace.getForceSlot(localForce) !== expectedSlot
                    || expectedSlot.alignment !== expectedAlignment
                    || localForce.getWholeOwnerPersistentAuthoritySnapshotJson() !== persistentDigest
                    || !localForce.isWholeOwnerAuthorityFingerprintCurrent(retirementFingerprint)) return null;
                const finalizeDataRemoval = this.dataService.prepareForceAuthorityRemoval(localForce, authority);
                if (!finalizeDataRemoval) return null;
                return () => {
                    finalizeDataRemoval();
                    this.workspace.loadedForces.set(publishedSlots);
                    published = true;
                };
            });
            if (!retired || !published) return null;

            try {
                this.workspace.activateForceSlot(replacementSlot);
            } catch (error) {
                this.logger.error(`Could not activate cloned force ${cloned.instanceId()}: ${error}`);
            }
            try {
                this.workspace.teardownForceSlot(expectedSlot);
            } catch (error) {
                this.logger.warn(`Could not tear down cloned conflict source ${localForce.instanceId()}: ${error}`);
            }
            if (this.workspace.selectedUnit() === selectionBeforeCommit) {
                this.workspace.selectUnit(selectionAfterCommit);
            }
            return cloned;
        } finally {
            if (!published) {
                if (retirement) localForce.cancelWholeOwnerRetirement(retirement.token);
                if (replacementSlot) this.workspace.disposeDetachedForceSlot(replacementSlot);
                this.workspace.destroyDetachedForceUnits(cloned);
            }
        }
    }

    private async handleRemoteForceConflict(
        localForce: Force,
        remoteForce: SerializedForce,
        receiptGeneration: number,
    ): Promise<void> {
        const expectedSlot = this.workspace.getForceSlot(localForce);
        if (!expectedSlot || expectedSlot.force !== localForce) return;
        const expectedAlignment = expectedSlot.alignment;
        const localFingerprint = localForce.captureWholeOwnerAuthorityFingerprint();
        const localTimestamp = parseForceTimestamp(localForce.timestamp) ?? 0;
        const remoteTimestamp = parseForceTimestamp(remoteForce.timestamp) ?? 0;
        const formatDate = (timestamp: number) => timestamp ? new Date(timestamp).toLocaleString() : 'Unknown';

        if (this.conflictDialogRef) {
            this.conflictDialogRef.close();
            this.conflictDialogRef = undefined;
        }
        this.conflictDialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
            panelClass: 'info',
            disableClose: true,
            data: <ConfirmDialogData<string>>{
                title: 'Sync Conflict Detected',
                message: `"${localForce.displayName()}" was modified on another device while you were offline. The cloud version is newer. (${formatDate(remoteTimestamp)} > ${formatDate(localTimestamp)})`,
                buttons: [
                    { label: 'LOAD CLOUD', value: 'cloud', class: 'primary' },
                    { label: 'KEEP LOCAL', value: 'local' },
                    { label: 'CLONE LOCAL', value: 'cloneLocal' }
                ]
            }
        });

        const result = await firstValueFrom(this.conflictDialogRef.closed);
        const isReceiptCurrent = () => this.remoteForceReceiptGeneration.get(remoteForce.instanceId)
            === receiptGeneration;
        if (!isReceiptCurrent()
            || this.workspace.getForceSlot(localForce) !== expectedSlot
            || expectedSlot.force !== localForce
            || expectedSlot.alignment !== expectedAlignment
            || !localForce.isWholeOwnerAuthorityFingerprintCurrent(localFingerprint)) {
            this.logger.warn(`Ignoring stale sync-conflict choice for force ${remoteForce.instanceId}.`);
            return;
        }
        if (result === 'cloud') {
            if (!isReceiptCurrent()) return;
            const replacement = await this.applyRemotePersistenceSnapshot(
                localForce,
                remoteForce,
                isReceiptCurrent,
            );
            if (!replacement) return;
            this.toastService.showToast(`Cloud version of "${replacement.displayName()}" loaded.`, 'success');
        } else if (result === 'local') {
            try {
                if (!isReceiptCurrent()) return;
                await this.dataService.saveForceOverRemoteConflict(
                    localForce,
                    remoteForce,
                    localFingerprint,
                    isReceiptCurrent,
                );
                this.toastService.showToast(`Local version of "${localForce.displayName()}" kept and synced.`, 'success');
            } catch (error) {
                this.logger.error(`Could not keep local force ${localForce.instanceId()} after sync conflict: ${error}`);
                this.toastService.showToast('The local version could not be synced because the force or cloud authority changed.', 'error');
            }
        } else if (result === 'cloneLocal') {
            try {
                if (!isReceiptCurrent()) return;
                const cloned = await this.replaceConflictForceWithClone(
                    localForce,
                    expectedSlot,
                    expectedAlignment,
                    localFingerprint,
                    isReceiptCurrent,
                );
                if (!cloned) return;
                await this.dataService.saveForceAndWaitForCloud(cloned);
                this.toastService.showToast('Local version has been cloned', 'success');
            } catch (error) {
                this.logger.error(`Could not clone local force ${localForce.instanceId()} after sync conflict: ${error}`);
                this.toastService.showToast('The local version could not be cloned because the force changed.', 'error');
            }
        }
    }
}
