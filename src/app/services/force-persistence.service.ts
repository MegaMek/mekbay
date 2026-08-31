// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DestroyRef, inject, Injectable, Injector, signal } from '@angular/core';
import { Subject } from 'rxjs';

import { GameSystem } from '../models/common.model';
import { ASForce } from '../models/as-force.model';
import { CBTForce } from '../models/cbt-force.model';
import type { ForceUnit } from '../models/force-unit.model';
import {
    Force,
    type ForceOwnerAuthorityFingerprint,
    type ForceOwnerRevisionFence,
    type ForceOwnerReplacementCommitAuthority,
} from '../models/force.model';
import {
    sanitizeForceTags,
    type ASSerializedForce,
    type SerializedClassicForce,
    type SerializedForce,
} from '../models/force-serialization';
import {
    createLoadForceEntry,
    createLoadForceEntryFromSerializedForce,
    LoadForceEntry,
    type RemoteLoadForceEntry,
} from '../models/load-force-entry.model';
import {
    decodeForceFromStorage,
    encodeForceForStorage,
    type StoredForceRecord,
} from '../models/runtime/force-storage-codec';
import { inspectSerializedCBTForceV2 } from '../models/runtime/force-persistence-boundary';
import {
    convertPersistedForceV1,
    convertPersistedMekUnitV1,
    convertPersistedNonMekUnitV1,
    type PersistedForceV1ConversionWarning,
    type PersistedForceV1ConversionOptions,
} from '../models/runtime/legacy-force-v1-converter';
import type { SavedEntityIdentity } from '../models/persisted-unit-state';
import { naturalCompare } from '../utils/sort.util';
import { DataService } from './data.service';
import { DbService } from './db.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { UserStateService } from './userState.service';
import { UnitRuntimeService } from './unit-runtime.service';
import { ReadyMekUnitService } from './ready-mek-unit.service';
import { ReadyNonMekUnitService } from './ready-non-mek-unit.service';
import { WsService, type WsMessage } from './ws.service';

type WsDataResponse<T> = WsMessage & { readonly data?: T };
type ForceSaveResponse = WsMessage & {
    readonly action?: string;
    readonly code?: string;
    readonly message?: string;
};
type ForceTagsUpdateResponse = ForceSaveResponse & { readonly timestamp?: string };

export interface ForceTagsUpdateResult {
    tags: string[];
    timestamp: string | null;
}

/** Validated, fully materialized remote state that has not touched live authority or storage. */
export interface StagedRemoteForceSnapshot {
    readonly force: Force;
}

/** Fully validated detached acceptance capability. It still owns no live authority. */
export interface PreparedRemoteForceAcceptance {
    readonly force: Force;
}

export type PreparedRemoteForceAcceptanceCommitResult =
    | {
        readonly accepted: true;
        /** No-throw irreversible force-authority commit; valid only after predecessor retirement. */
        readonly finalize: () => void;
        /** Available after `finalize` has run. */
        readonly persistence: () => Promise<void>;
    }
    | {
        readonly accepted: false;
        readonly reason: 'NOT_PREPARED' | 'AUTHORITY_CHANGED' | 'PREDECESSOR_NOT_RETIRED';
    };

interface StagedRemoteForceSnapshotPayload {
    readonly serialized: SerializedForce;
    readonly instanceId: string;
    readonly authorityFingerprint: ForceOwnerAuthorityFingerprint;
    readonly owned: boolean;
    readonly readOnly: boolean;
}

interface ForceSaveFence {
    readonly owner: Force;
    instanceId: string;
    generation: number;
    revisionFence: ForceOwnerRevisionFence;
}

interface ForceLocalPersistenceOutcome {
    readonly generation: number;
    readonly sequence: number;
    readonly succeeded: boolean;
}

interface OwnerlessForceOperationLease {
    readonly ready: Promise<void>;
    readonly release: () => void;
    readonly completion: Promise<void>;
}

/** The existing server wire calls this a digest, but its value is the V2 force revision. */
function cloudForceRevisionToken(revision: number | null): string | null {
    return revision === null ? null : `revision:${revision}`;
}

function hasInvalidDurableForceIds(force: Force): boolean {
    if (force instanceof CBTForce) {
        return force.queryCanonicalRoster().kind !== 'available';
    }
    const groupIds = new Set<string>();
    const unitIds = new Set<string>();
    for (const group of force.groups()) {
        if (group.id.trim().length === 0 || groupIds.has(group.id)) return true;
        groupIds.add(group.id);
        for (const unit of group.units()) {
            if (unit.id.trim().length === 0 || unitIds.has(unit.id)) return true;
            unitIds.add(unit.id);
        }
    }
    return false;
}

@Injectable({ providedIn: 'root' })
export class ForcePersistenceService {
    private readonly dataService = inject(DataService);
    private readonly dbService = inject(DbService);
    private readonly wsService = inject(WsService);
    private readonly userStateService = inject(UserStateService);
    private readonly unitRuntimeService = inject(UnitRuntimeService);
    private readonly logger = inject(LoggerService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);

    public readonly isCloudForceLoading = signal(false);
    public readonly forceNeedsAdoption = new Subject<Force>();

    private readonly forceAuthorityGeneration = new Map<string, number>();
    private readonly activeForceAuthority = new Map<string, Force>();
    private readonly provisionalForceAuthority = new WeakSet<Force>();
    private readonly durableForceIdentity = new WeakMap<Force, string>();
    private readonly registeredForceIdentity = new WeakMap<Force, string>();
    private readonly ownerlessForceOperationLeases = new Map<string, Set<OwnerlessForceOperationLease>>();
    private readonly ownerlessForceOperationTail = new Map<string, Promise<void>>();
    private readonly stagedRemoteForceSnapshots = new WeakMap<
        StagedRemoteForceSnapshot,
        StagedRemoteForceSnapshotPayload
    >();
    private readonly preparedRemoteForceAcceptances = new WeakMap<
        PreparedRemoteForceAcceptance,
        StagedRemoteForceSnapshotPayload
    >();
    private readonly forceLocalSaveChain = new Map<string, Promise<void>>();
    private readonly forceLocalPersistenceOperations = new Map<string, Set<Promise<void>>>();
    private readonly forceLocalPersistenceOutcome = new Map<string, ForceLocalPersistenceOutcome>();
    private readonly forceLocalPersistenceSequence = new Map<string, number>();
    private readonly forceSaveFences = new Map<string, Set<ForceSaveFence>>();
    private readonly forceAutosaves = new WeakMap<Force, {
        scheduled: boolean;
        running: boolean;
        dirty: boolean;
    }>();
    private cachedForceTagsByInstanceId = new Map<string, string[]>();
    private pendingForceSavePreparations = 0;
    private pendingForceAutosaves = 0;
    private destroyed = false;

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.destroyed = true;
            for (const entry of this.saveForceCloudDebounce.values()) {
                clearTimeout(entry.timeout);
                for (const { reject } of entry.resolvers) {
                    reject(new Error('Service destroyed'));
                }
            }
            this.saveForceCloudDebounce.clear();
        });

        if (typeof window === 'undefined') return;

        const flushOnUnload = () => {
            try {
                this.flushAllPendingSavesOnUnload();
            } catch { /* best-effort */ }
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') flushOnUnload();
        };

        window.addEventListener('beforeunload', flushOnUnload);
        window.addEventListener('pagehide', flushOnUnload);
        document.addEventListener('visibilitychange', onVisibility);

        this.destroyRef.onDestroy(() => {
            window.removeEventListener('beforeunload', flushOnUnload);
            window.removeEventListener('pagehide', flushOnUnload);
            document.removeEventListener('visibilitychange', onVisibility);
        });
    }

    /** Newer timestamp wins; current storage wins a mixed-version tie, otherwise local wins. */
    private preferCloudForce(localRaw: SerializedForce, cloudRaw: SerializedForce): boolean {
        const localTimestamp = this.getComparableTimestamp(localRaw.timestamp);
        const cloudTimestamp = this.getComparableTimestamp(cloudRaw.timestamp);
        if (cloudTimestamp !== localTimestamp) return cloudTimestamp > localTimestamp;
        return localRaw.version === 1 && cloudRaw.version === 2;
    }

    private async getPersistedForceUnitIds(instanceId: string): Promise<readonly string[]> {
        const raw = await this.dbService.getForce(instanceId);
        if (!raw) return [];
        if (raw.version === 1) {
            return (raw.groups ?? []).flatMap(group => group.units
                .map(unit => unit.id)
                .filter(id => typeof id === 'string' && id.length > 0));
        }
        const persisted = await this.normalizePersistedForce(raw);
        return persisted.cbt !== undefined
            ? persisted.cbt.units.map(unit => unit.instanceId)
            : (persisted.groups ?? []).flatMap(group => group.units.map(unit => unit.id));
    }

    /** Converts the sole legacy storage format before it reaches live force models. */
    private async normalizePersistedForce(
        raw: SerializedForce,
        notifyWarnings = false,
    ): Promise<SerializedForce> {
        if (raw.version !== 1) return raw;

        const warnings: PersistedForceV1ConversionWarning[] = [];
        const warn = (warning: PersistedForceV1ConversionWarning): void => {
            warnings.push(warning);
            this.logger.warn(`V1 force conversion: ${warning.message}`);
        };

        const materializeUnit = async (
            request: Parameters<NonNullable<PersistedForceV1ConversionOptions['materializeUnit']>>[0],
        ) => {
            const identity = request.source.identity;
            if (identity.kind !== 'resolved') return undefined;
            const summary = this.dataService.getUnitByIdentity(
                identity.savedIdentity.provider,
                identity.savedIdentity.uuid,
            );
            if (!summary) return undefined;
            if (summary.entityType === 'Mek') {
                const ready = await this.injector.get(ReadyMekUnitService).loadReadyMek({
                    identity: identity.savedIdentity,
                    instanceId: request.instanceId,
                    deployment: request.deployment,
                    scenario: request.scenario,
                });
                try {
                    return await convertPersistedMekUnitV1(request.source, ready);
                } catch (error) {
                    warn({
                        kind: 'state-reset',
                        unit: summary.name,
                        message: `Unit "${summary.name}" loaded without its saved state: ${error instanceof Error ? error.message : String(error)}`,
                    });
                    return ready.serialize();
                }
            }
            const ready = await this.injector.get(ReadyNonMekUnitService).loadReadyNonMekUnit({
                identity: identity.savedIdentity,
                instanceId: request.instanceId,
                deployment: request.deployment,
                scenario: request.scenario,
            });
            try {
                return convertPersistedNonMekUnitV1(request.source, ready);
            } catch (error) {
                warn({
                    kind: 'state-reset',
                    unit: summary.name,
                    message: `Unit "${summary.name}" loaded without its saved state: ${error instanceof Error ? error.message : String(error)}`,
                });
                return ready.serialize();
            }
        };

        const converted = await convertPersistedForceV1(raw, {
            resolveIdentity: unit => this.unitRuntimeService.resolvePersistedUnitIdentity({
                unit: typeof unit['unit'] === 'string' ? unit['unit'] : '',
                chassis: typeof unit['chassis'] === 'string' ? unit['chassis'] : undefined,
                model: typeof unit['model'] === 'string' ? unit['model'] : undefined,
                type: typeof unit['type'] === 'string' ? unit['type'] : undefined,
                entityIdentity: unit['entityIdentity'] as SavedEntityIdentity | undefined,
            }, this.dataService.isDataReady()),
            materializeUnit,
            onWarning: warn,
        });
        if (notifyWarnings && warnings.length > 0) {
            await this.injector.get(DialogsService).showNotice(
                warnings.map(warning => `• ${warning.message}`).join('\n'),
                'V1 Save Loaded with Warnings',
            );
        }
        return converted;
    }

    private async loadPersistedForce(raw: SerializedForce): Promise<Force> {
        return this.deserializeCurrentForce(await this.normalizePersistedForce(raw, true));
    }

    private async deserializeCurrentForce(persisted: SerializedForce): Promise<Force> {
        const force = persisted.type === GameSystem.ALPHA_STRIKE
            ? ASForce.deserialize(persisted as ASSerializedForce, this.dataService, this.injector)
            : CBTForce.deserializeV2(persisted as SerializedClassicForce, this.dataService, this.injector);
        if (force.gameSystem === GameSystem.CLASSIC) {
            await force.loadCBTForceV2Persistence(persisted);
        }
        return force;
    }

    /** Materializes a detached candidate before ForceBuilder commits it. */
    public async stageRemoteForceSnapshot(serialized: SerializedForce): Promise<StagedRemoteForceSnapshot> {
        const detached = structuredClone(serialized);
        const normalized = structuredClone(await this.normalizePersistedForce(detached));
        const force = await this.deserializeCurrentForce(normalized);
        const persistenceBytes = detached.version === 1
            ? structuredClone(await force.serializeForPersistence())
            : normalized;
        if (!persistenceBytes.instanceId || force.instanceId() !== persistenceBytes.instanceId) {
            throw new Error('Staged remote force identity does not match its serialized snapshot');
        }
        force.markCloudCBTForceV2Saved(persistenceBytes);
        const staged = Object.freeze({ force });
        this.stagedRemoteForceSnapshots.set(staged, this.captureStagedRemoteForcePayload(
            force,
            persistenceBytes,
        ));
        return staged;
    }

    private captureStagedRemoteForcePayload(
        force: Force,
        serialized: SerializedForce,
    ): StagedRemoteForceSnapshotPayload {
        return Object.freeze({
            serialized,
            instanceId: serialized.instanceId,
            authorityFingerprint: force.captureWholeOwnerAuthorityFingerprint(),
            owned: force.owned(),
            readOnly: force.readOnly(),
        });
    }

    private isStagedRemoteForcePayloadCurrent(
        force: Force,
        payload: StagedRemoteForceSnapshotPayload,
    ): boolean {
        try {
            return force.instanceId() === payload.instanceId
                && force.isWholeOwnerActive()
                && force.owned() === payload.owned
                && force.readOnly() === payload.readOnly
                && force.isWholeOwnerAuthorityFingerprintCurrent(payload.authorityFingerprint);
        } catch {
            return false;
        }
    }

    /** Invalidates an uncommitted detached snapshot token. */
    public discardRemoteForceSnapshot(staged: StagedRemoteForceSnapshot): void {
        this.stagedRemoteForceSnapshots.delete(staged);
    }

    /**
     * Consumes a staged token without changing live
     * authority. The returned capability may be committed synchronously after
     * the old Force owner has drained, or discarded if its slot fence loses.
     */
    public prepareRemoteForceSnapshotAcceptance(
        staged: StagedRemoteForceSnapshot,
    ): PreparedRemoteForceAcceptance {
        const payload = this.stagedRemoteForceSnapshots.get(staged);
        if (!payload) {
            throw new Error('Remote force snapshot was not staged by this service or was already consumed');
        }
        const instanceId = staged.force.instanceId();
        if (!instanceId || !this.isStagedRemoteForcePayloadCurrent(staged.force, payload)) {
            this.stagedRemoteForceSnapshots.delete(staged);
            throw new Error('Remote force snapshot authority changed before acceptance');
        }
        try {
            // This can run arbitrary subclass validation, so it happens while
            // the candidate is still detached and the old owner is recoverable.
            staged.force.markCloudCBTForceV2Saved(payload.serialized);
        } catch (error) {
            this.stagedRemoteForceSnapshots.delete(staged);
            throw error;
        }
        let preparedPayload: StagedRemoteForceSnapshotPayload;
        try {
            preparedPayload = this.captureStagedRemoteForcePayload(staged.force, payload.serialized);
        } catch (error) {
            this.stagedRemoteForceSnapshots.delete(staged);
            throw error;
        }
        if (staged.force.instanceId() !== instanceId
            || !this.isStagedRemoteForcePayloadCurrent(staged.force, preparedPayload)) {
            this.stagedRemoteForceSnapshots.delete(staged);
            throw new Error('Remote force snapshot authority changed while preparing acceptance');
        }
        this.stagedRemoteForceSnapshots.delete(staged);
        const prepared = Object.freeze({ force: staged.force });
        this.preparedRemoteForceAcceptances.set(prepared, preparedPayload);
        return prepared;
    }

    /** Invalidates a validated but uncommitted acceptance token. */
    public discardPreparedRemoteForceAcceptance(prepared: PreparedRemoteForceAcceptance): void {
        this.preparedRemoteForceAcceptances.delete(prepared);
    }

    /**
     * Reversible preparation for an exact predecessor-bound acceptance. It
     * consumes the callback-scoped retirement proof but does not move force
     * authority or queue persistence. The returned no-throw finalizer becomes
     * effective only after the exact predecessor is permanently retired.
     */
    public commitPreparedRemoteForceReplacement(
        prepared: PreparedRemoteForceAcceptance,
        predecessor: Force,
        authority: ForceOwnerReplacementCommitAuthority,
    ): PreparedRemoteForceAcceptanceCommitResult {
        const payload = this.preparedRemoteForceAcceptances.get(prepared);
        if (!payload) return Object.freeze({ accepted: false, reason: 'NOT_PREPARED' as const });
        if (!this.isStagedRemoteForcePayloadCurrent(prepared.force, payload)) {
            this.preparedRemoteForceAcceptances.delete(prepared);
            return Object.freeze({ accepted: false, reason: 'AUTHORITY_CHANGED' as const });
        }
        if (this.activeForceAuthority.get(payload.instanceId) !== predecessor
            || predecessor.instanceId() !== payload.instanceId
            || !predecessor.consumeWholeOwnerReplacementCommitAuthority(authority)) {
            return Object.freeze({ accepted: false, reason: 'PREDECESSOR_NOT_RETIRED' as const });
        }
        const instanceId = payload.instanceId;
        let finalized = false;
        let persistence: Promise<void> | null = null;
        const finalize = () => {
            if (finalized
                || !predecessor.isWholeOwnerRetired()
                || this.activeForceAuthority.get(instanceId) !== predecessor) return;
            finalized = true;
            try {
                this.preparedRemoteForceAcceptances.delete(prepared);
                this.activeForceAuthority.set(instanceId, prepared.force);
                this.registeredForceIdentity.set(prepared.force, instanceId);
                this.registeredForceIdentity.delete(predecessor);
                const generation = this.advanceForceAuthorityGeneration(instanceId);
                const localWrite = this.enqueueLocalForceWrite(
                    instanceId,
                    () => this.dbService.saveForce(payload.serialized),
                );
                persistence = this.trackForceLocalPersistenceOperation(
                    instanceId,
                    generation,
                    localWrite,
                ).then(() => {
                    if (this.activeForceAuthority.get(instanceId) === prepared.force
                        && prepared.force.instanceId() === instanceId) {
                        this.durableForceIdentity.set(prepared.force, instanceId);
                    }
                });
            } catch (error) {
                persistence = Promise.reject(error);
            }
        };
        return Object.freeze({
            accepted: true,
            finalize,
            persistence: () => persistence
                ?? Promise.reject(new Error('Remote replacement was not finalized after predecessor retirement.')),
        });
    }

    /**
     * Prepares exact force-authority removal inside Force's retirement callback.
     * The returned closure is synchronous/no-throw and becomes effective only
     * after the predecessor has been permanently retired.
     */
    public prepareForceAuthorityRemoval(
        force: Force,
        authority: ForceOwnerReplacementCommitAuthority,
    ): (() => void) | null {
        const instanceId = force.instanceId();
        const provisional = this.provisionalForceAuthority.has(force);
        const generation = instanceId === null ? 0 : this.currentForceAuthorityGeneration(instanceId);
        if (provisional) {
            if ((instanceId !== null && this.activeForceAuthority.has(instanceId))
                || this.registeredForceIdentity.has(force)
                || !force.consumeWholeOwnerReplacementCommitAuthority(authority)) return null;
        } else if (instanceId === null) {
            return null;
        } else if (this.activeForceAuthority.get(instanceId) !== force
            || this.registeredForceIdentity.get(force) !== instanceId
            || !force.consumeWholeOwnerReplacementCommitAuthority(authority)) return null;
        let finalized = false;
        return () => {
            if (finalized || !force.isWholeOwnerRetired()) return;
            finalized = true;
            try {
                if (provisional) {
                    this.provisionalForceAuthority.delete(force);
                    return;
                }
                const registeredInstanceId = instanceId;
                if (registeredInstanceId === null
                    || this.currentForceAuthorityGeneration(registeredInstanceId) !== generation
                    || this.activeForceAuthority.get(registeredInstanceId) !== force
                    || this.registeredForceIdentity.get(force) !== instanceId) return;
                this.activeForceAuthority.delete(registeredInstanceId);
                this.registeredForceIdentity.delete(force);
                this.advanceForceAuthorityGeneration(registeredInstanceId);
            } catch (error) {
                this.logger.warn(`Could not finalize retired Data authority ${instanceId ?? force.name}: ${error}`);
            }
        };
    }

    /**
     * Claims an ownerless ID or confirms the already-registered exact owner.
     * Ordinary activation is never a replacement primitive; remote replacement
     * moves the map only through its predecessor-bound retirement finalizer.
     */
    public activateForceAuthority(force: Force): boolean {
        const instanceId = force.instanceId();
        if (!force.isWholeOwnerActive()) return false;
        // A provisional owner stays object-keyed even if public serialization
        // has already caused Force to mint its eventual ID. Only the paired
        // persistence proof may atomically promote it into the ID map.
        if (this.provisionalForceAuthority.has(force)) return instanceId === null;
        if (!instanceId) {
            this.provisionalForceAuthority.add(force);
            return true;
        }
        const registeredInstanceId = this.registeredForceIdentity.get(force);
        if (registeredInstanceId !== undefined && registeredInstanceId !== instanceId) return false;
        const previous = this.activeForceAuthority.get(instanceId);
        if (previous === force) return true;
        if (previous !== undefined) return false;
        if ((this.ownerlessForceOperationLeases.get(instanceId)?.size ?? 0) > 0) return false;
        this.advanceForceAuthorityGeneration(instanceId);
        this.activeForceAuthority.set(instanceId, force);
        this.registeredForceIdentity.set(force, instanceId);
        return true;
    }

    /** Releases only the exact permanently retired owner. */
    public deactivateForceAuthority(force: Force): boolean {
        const instanceId = force.instanceId();
        if (!force.isWholeOwnerRetired()) return false;
        if (!instanceId) return this.provisionalForceAuthority.delete(force);
        if (this.registeredForceIdentity.get(force) !== instanceId) return false;
        if (this.activeForceAuthority.get(instanceId) !== force) return false;
        this.activeForceAuthority.delete(instanceId);
        this.registeredForceIdentity.delete(force);
        // Detachment is an authority transition just like replacement.
        // Fence already-prepared and queued old-owner saves immediately.
        this.advanceForceAuthorityGeneration(instanceId);
        return true;
    }

    public hasDurableForceIdentity(force: Force): boolean {
        const instanceId = force.instanceId();
        return instanceId !== null && this.durableForceIdentity.get(force) === instanceId;
    }

    private acquireOwnerlessForceOperation(instanceId: string): OwnerlessForceOperationLease | null {
        if (this.activeForceAuthority.has(instanceId)) return null;
        const ready = (this.ownerlessForceOperationTail.get(instanceId) ?? Promise.resolve())
            .catch(() => undefined);
        let settle!: () => void;
        const settled = new Promise<void>(resolve => { settle = resolve; });
        const completion = ready.then(() => settled);
        let released = false;
        const lease = Object.freeze({
            ready,
            completion,
            release: () => {
                if (released) return;
                released = true;
                settle();
            },
        });
        const leases = this.ownerlessForceOperationLeases.get(instanceId)
            ?? new Set<OwnerlessForceOperationLease>();
        leases.add(lease);
        this.ownerlessForceOperationLeases.set(instanceId, leases);
        this.ownerlessForceOperationTail.set(instanceId, completion);
        void completion.finally(() => {
            if (this.ownerlessForceOperationTail.get(instanceId) === completion) {
                this.ownerlessForceOperationTail.delete(instanceId);
            }
        });
        return lease;
    }

    private releaseOwnerlessForceOperation(instanceId: string, lease: OwnerlessForceOperationLease): void {
        const leases = this.ownerlessForceOperationLeases.get(instanceId);
        if (!leases) return;
        leases.delete(lease);
        if (leases.size === 0) this.ownerlessForceOperationLeases.delete(instanceId);
        lease.release();
    }

    private isOwnerlessForceOperationCurrent(
        instanceId: string,
        lease: OwnerlessForceOperationLease,
        generation: number,
    ): boolean {
        return this.ownerlessForceOperationLeases.get(instanceId)?.has(lease) === true
            && this.currentForceAuthorityGeneration(instanceId) === generation
            && !this.activeForceAuthority.has(instanceId);
    }

    public async getForce(
        instanceId: string,
        ownedOnly: boolean = false,
        { skipLocal = false, showLoading = true }: { skipLocal?: boolean; showLoading?: boolean } = {},
    ): Promise<Force | null> {
        // Storage reconciliation is detached work. It may have storage/cloud
        // side effects only while the ID remains continuously ownerless.
        const ownerlessLease = this.acquireOwnerlessForceOperation(instanceId);
        const authorityGeneration = this.currentForceAuthorityGeneration(instanceId);
        const detachedAuthorityIsCurrent = () => ownerlessLease !== null
            && this.isOwnerlessForceOperationCurrent(instanceId, ownerlessLease, authorityGeneration);
        try {
        if (!ownerlessLease) return null;
        await ownerlessLease.ready;
        if (!detachedAuthorityIsCurrent()) return null;
        const localRaw = skipLocal ? null : await this.dbService.getForce(instanceId);
        let cloudRaw: SerializedForce | null = null;
        let triedCloud = false;
        if (showLoading) this.isCloudForceLoading.set(true);
        try {
            const ws = await this.canUseCloud();
            if (ws) {
                try {
                    cloudRaw = await this.getForceCloud(instanceId, ownedOnly, !skipLocal);
                    triedCloud = true;
                } catch {
                    cloudRaw = null;

                }
            }
        } finally {
            if (showLoading) this.isCloudForceLoading.set(false);
        }
        let local: Force | null = null;
        let cloud: Force | null = null;
        let result: Force | null = null;
        let resultHasDurableLocalIdentity = false;
        if (localRaw) {
            try {
                local = await this.loadPersistedForce(localRaw);
            } catch (error) { 
                this.logger.error(error instanceof Error ? error.message : String(error));
            }
        }
        if (cloudRaw) {
            try {
                cloud = await this.loadPersistedForce(cloudRaw);
            } catch (error) { 
                this.logger.error(error instanceof Error ? error.message : String(error));
            }
        }

        let cloudIsNewer = false;
        if (local && cloud) {
            cloudIsNewer = this.preferCloudForce(localRaw!, cloudRaw!);
            result = cloudIsNewer ? cloud : local;
            resultHasDurableLocalIdentity = result === local;
        } else if (!triedCloud && local) {
            result = local;
            resultHasDurableLocalIdentity = true;
        } else {
            result = cloud || local || null;
            resultHasDurableLocalIdentity = result === local && local !== null;
        }

        if (result?.gameSystem === GameSystem.CLASSIC) {
            if (!triedCloud) {
                result.setExpectedCloudCBTForceV2Revision(undefined);
            } else if (cloudRaw === null) {
                result.setExpectedCloudCBTForceV2Revision(null);
            } else {
                result.markCloudCBTForceV2Saved(cloudRaw);
            }
        }

        // If we reached cloud but the force only exists locally, push it up
        if (triedCloud && local && localRaw && cloudRaw === null && detachedAuthorityIsCurrent()) {
            this.logger.info(`Force "${local.name}" exists locally but not in cloud: pushing to cloud.`);
            local.setExpectedCloudCBTForceV2Revision(null);
            if (!local.readOnly() && ownerlessLease) {
                try {
                    await this.pushOwnerlessForceToCloud(
                        local,
                        localRaw,
                        ownerlessLease,
                        authorityGeneration,
                    );
                } catch (error) {
                    this.logger.error(`Failed to save force ${local.instanceId()} to cloud: ${error}`);
                }
            }
        } else 
        if (triedCloud
            && (cloudIsNewer || !local)
            && cloud
            && cloudRaw !== null
            && cloud.owned()
            && !skipLocal
            && detachedAuthorityIsCurrent()) {
            if (!local) {
                this.logger.info(`Force "${cloud.name}" exists in cloud but not locally: saving local copy.`);
            } else {
                this.logger.info(`Force "${cloud.name}" exists in cloud and is newer: updating local copy.`);
            }
            resultHasDurableLocalIdentity = ownerlessLease !== null
                && await this.saveSerializedForceToLocalStorageUnderLease(
                    structuredClone(cloudRaw),
                    ownerlessLease,
                    authorityGeneration,
                );
        }

        if (result?.instanceId() === instanceId && resultHasDurableLocalIdentity) {
            // The returned exact owner materialized from an already durable
            // local/cloud record; do not reclassify it as a fresh unsaved owner.
            this.durableForceIdentity.set(result, instanceId);
        }
        return result;
        } finally {
            if (ownerlessLease) this.releaseOwnerlessForceOperation(instanceId, ownerlessLease);
        }
    }

    public async saveForce(force: Force, localOnly: boolean = false): Promise<void> {
        const fence = this.captureForceSaveFence(force);
        if (!fence) return;
        let cloudOwnsFence = false;
        try {
            const serialized = await this.saveForceLocally(force, fence);
            if (!serialized || localOnly) return;
            cloudOwnsFence = true;
            void this.saveForceCloud(force, serialized, fence)
                .catch(error => {
                    this.logger.error(`Failed to save force ${force.instanceId()} to cloud: ${error}`);
                })
                .finally(() => this.releaseForceSaveFence(fence));
        } finally {
            if (!cloudOwnsFence) this.releaseForceSaveFence(fence);
        }
    }

    /**
     * Coalesces UI-originated autosaves and starts them in a later task. This
     * guarantees that ADD/reorder/edit can paint before force serialization,
     * hashing and IndexedDB work begins.
     */
    public queueForceAutosave(force: Force): void {
        let state = this.forceAutosaves.get(force);
        if (!state) {
            state = { scheduled: false, running: false, dirty: false };
            this.forceAutosaves.set(force, state);
        }
        state.dirty = true;
        if (state.scheduled || state.running || this.destroyed) return;
        state.scheduled = true;
        this.pendingForceAutosaves += 1;
        setTimeout(() => {
            state!.scheduled = false;
            state!.running = true;
            void this.drainForceAutosave(force, state!);
        }, 0);
    }

    private async drainForceAutosave(
        force: Force,
        state: { scheduled: boolean; running: boolean; dirty: boolean },
    ): Promise<void> {
        try {
            while (state.dirty && !this.destroyed && force.isWholeOwnerActive()) {
                state.dirty = false;
                try {
                    await this.saveForce(force);
                } catch (error) {
                    this.logger.error(`Could not auto-save force ${force.instanceId() ?? force.name}: ${error}`);
                }
                if (state.dirty) await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
        } finally {
            state.running = false;
            this.pendingForceAutosaves = Math.max(0, this.pendingForceAutosaves - 1);
            if (!force.isWholeOwnerActive()) state.dirty = false;
            else if (state.dirty && !this.destroyed) this.queueForceAutosave(force);
        }
    }

    public async saveForceAndWaitForCloud(force: Force): Promise<boolean> {
        const fence = this.captureForceSaveFence(force);
        if (!fence) return false;
        try {
            const serialized = await this.saveForceLocally(force, fence);
            if (!serialized) return false;
            await this.saveForceCloudImmediately(force, serialized, fence);
            return this.isForceSaveFenceCurrent(force, fence);
        } finally {
            this.releaseForceSaveFence(fence);
        }
    }

    /**
     * Waits for every local persistence operation admitted for this exact live
     * owner before retirement closed its gate. Callers must recheck their slot
     * and owner fingerprint after the await.
     */
    public async drainForceAuthorityPersistence(
        force: Force,
        fingerprint: ForceOwnerAuthorityFingerprint,
    ): Promise<boolean> {
        const instanceId = force.instanceId();
        if (this.provisionalForceAuthority.has(force)) {
            return (instanceId === null || !this.activeForceAuthority.has(instanceId))
                && !this.registeredForceIdentity.has(force)
                && force.isWholeOwnerAuthorityFingerprintCurrent(fingerprint);
        }
        if (!instanceId) return force.isWholeOwnerAuthorityFingerprintCurrent(fingerprint);
        const generation = this.currentForceAuthorityGeneration(instanceId);
        let stablePasses = 0;
        for (;;) {
            if (this.activeForceAuthority.get(instanceId) !== force
                || this.currentForceAuthorityGeneration(instanceId) !== generation
                || !force.isWholeOwnerAuthorityFingerprintCurrent(fingerprint)) return false;
            const pending = [...(this.forceLocalPersistenceOperations.get(instanceId) ?? [])];
            if (pending.length > 0) {
                stablePasses = 0;
                const settlements = await Promise.allSettled(pending);
                if (settlements.some(settlement => settlement.status === 'rejected')) return false;
                // A save's outer continuation schedules its cloud debounce just
                // after the local-operation sentinel settles. Yield once so it
                // becomes visible before declaring this owner quiescent.
                await Promise.resolve();
                continue;
            }

            const debounce = this.saveForceCloudDebounce.get(instanceId);
            if (debounce?.fence.generation === generation) {
                stablePasses = 0;
                if (debounce.force !== force) return false;
                try {
                    // Retirement is an explicit flush boundary. Waiting for the
                    // debounce timer would leave an old AS write capable of
                    // reaching the server after a newer remote publication.
                    await this.saveForceCloudImmediately(
                        debounce.force,
                        debounce.serialized,
                        debounce.fence,
                    );
                } catch (error) {
                    this.logger.error(`Could not drain cloud persistence for ${instanceId}: ${error}`);
                    throw error;
                }
                continue;
            }

            const cloudEntry = this.forceCloudSaveChain.get(instanceId);
            if (cloudEntry?.generation === generation) {
                stablePasses = 0;
                try {
                    await cloudEntry.promise;
                } catch (error) {
                    this.logger.error(`Could not drain in-flight cloud persistence for ${instanceId}: ${error}`);
                    throw error;
                }
                continue;
            }

            if (stablePasses === 0) {
                stablePasses = 1;
                await Promise.resolve();
                continue;
            }
            const localOutcome = this.forceLocalPersistenceOutcome.get(instanceId);
            if (localOutcome?.generation === generation && !localOutcome.succeeded) return false;
            return this.activeForceAuthority.get(instanceId) === force
                && this.currentForceAuthorityGeneration(instanceId) === generation
                && force.isWholeOwnerAuthorityFingerprintCurrent(fingerprint);
        }
    }

    /**
     * Claims an exact remote conflict predecessor and durably overwrites it.
     * The caller supplies the local owner fingerprint captured for the dialog;
     * any intervening local edit or slot replacement fails closed. For CBT the
     * validated remote V2 revision becomes the one-shot cloud CAS predecessor.
     */
    public async saveForceOverRemoteConflict(
        force: Force,
        remoteSnapshot: SerializedForce,
        localFingerprint: ForceOwnerAuthorityFingerprint,
        isConflictCurrent: () => boolean = () => true,
    ): Promise<void> {
        const remote = structuredClone(remoteSnapshot);
        const instanceId = force.instanceId();
        if (!instanceId
            || remote.instanceId !== instanceId
            || remote.type !== force.gameSystem) {
            throw new Error('The remote conflict no longer identifies this force owner.');
        }

        let remoteRevision: number | null | undefined;
        if (force.gameSystem === GameSystem.CLASSIC) {
            const inspected = await inspectSerializedCBTForceV2(remote);
            remoteRevision = inspected?.forceRevision ?? null;
        }

        const activeForce = this.activeForceAuthority.get(instanceId);
        if (!isConflictCurrent()
            || activeForce !== force
            || !force.isWholeOwnerActive()
            || force.readOnly()
            || !force.isWholeOwnerAuthorityFingerprintCurrent(localFingerprint)) {
            throw new Error('The local force changed while the sync conflict was open.');
        }

        if (force.gameSystem === GameSystem.CLASSIC) {
            force.setExpectedCloudCBTForceV2Revision(remoteRevision);
        }
        const previousTimestamp = force.timestamp;
        force.emitChanged();
        if (force.timestamp === previousTimestamp || !force.isWholeOwnerActive()) {
            throw new Error('The local force could not claim the remote conflict.');
        }
        if (!await this.saveForceAndWaitForCloud(force)) {
            throw new Error('The local force ceased to be authoritative while saving the conflict resolution.');
        }
    }

    private captureForceSaveFence(force: Force): ForceSaveFence | null {
        if (force.readOnly()) {
            this.logger.warn(`ForcePersistenceService.saveForce() blocked: force "${force.name}" is read-only.`);
            return null;
        }
        const instanceId = force.instanceId();
        if (this.provisionalForceAuthority.has(force)) {
            return {
                owner: force,
                instanceId: '',
                generation: 0,
                revisionFence: force.captureForceOwnerRevisionFence(),
            };
        }
        if (!instanceId) {
            this.logger.warn(`ForcePersistenceService.saveForce() blocked: fresh force "${force.name}" has no provisional authority.`);
            return null;
        }
        const activeForce = this.activeForceAuthority.get(instanceId);
        if (activeForce !== force || this.registeredForceIdentity.get(force) !== instanceId) {
            this.logger.warn(`ForcePersistenceService.saveForce() blocked: force "${force.name}" is no longer the active authority for ${instanceId}.`);
            return null;
        }
        const fence: ForceSaveFence = {
            owner: force,
            instanceId,
            generation: this.currentForceAuthorityGeneration(instanceId),
            revisionFence: force.captureForceOwnerRevisionFence(),
        };
        const fences = this.forceSaveFences.get(instanceId) ?? new Set<ForceSaveFence>();
        fences.add(fence);
        this.forceSaveFences.set(instanceId, fences);
        return fence;
    }

    /** Promotes only a Force-minted null-ID serialization into the ID authority map. */
    private promoteProvisionalForceSaveFence(
        force: Force,
        fence: ForceSaveFence,
        prepared: Awaited<ReturnType<Force['serializeForPersistenceWithRevisionFence']>>,
    ): boolean {
        const instanceId = prepared.serialized.instanceId;
        if (fence.instanceId !== '') return fence.instanceId === instanceId;
        if (!instanceId
            || !this.provisionalForceAuthority.has(force)
            || force.instanceId() !== instanceId
            || !force.isPersistenceIdentityPromotion(prepared.identityPromotionProof)
            || !force.isForceOwnerRevisionFenceCurrent(prepared.revisionFence)
            || this.activeForceAuthority.has(instanceId)) return false;
        this.provisionalForceAuthority.delete(force);
        this.activeForceAuthority.set(instanceId, force);
        this.registeredForceIdentity.set(force, instanceId);
        fence.instanceId = instanceId;
        fence.generation = this.advanceForceAuthorityGeneration(instanceId);
        fence.revisionFence = prepared.revisionFence;
        const fences = this.forceSaveFences.get(instanceId) ?? new Set<ForceSaveFence>();
        fences.add(fence);
        this.forceSaveFences.set(instanceId, fences);
        return true;
    }

    private releaseForceSaveFence(fence: ForceSaveFence): void {
        const fences = this.forceSaveFences.get(fence.instanceId);
        if (!fences) return;
        fences.delete(fence);
        if (fences.size === 0) this.forceSaveFences.delete(fence.instanceId);
    }

    private recordForceLocalPersistenceOutcome(
        instanceId: string,
        generation: number,
        sequence: number,
        succeeded: boolean,
    ): void {
        if (!instanceId) return;
        const previous = this.forceLocalPersistenceOutcome.get(instanceId);
        if (previous
            && previous.generation === generation
            && previous.sequence > sequence) return;
        this.forceLocalPersistenceOutcome.set(instanceId, Object.freeze({
            generation,
            sequence,
            succeeded,
        }));
    }

    private trackForceLocalPersistenceOperation(
        instanceId: string,
        generation: number,
        operation: Promise<void>,
    ): Promise<void> {
        const operations = this.forceLocalPersistenceOperations.get(instanceId) ?? new Set<Promise<void>>();
        const sequence = (this.forceLocalPersistenceSequence.get(instanceId) ?? 0) + 1;
        this.forceLocalPersistenceSequence.set(instanceId, sequence);
        let tracked!: Promise<void>;
        const cleanup = (succeeded: boolean) => {
            this.recordForceLocalPersistenceOutcome(instanceId, generation, sequence, succeeded);
            operations.delete(tracked);
            if (operations.size === 0 && this.forceLocalPersistenceOperations.get(instanceId) === operations) {
                this.forceLocalPersistenceOperations.delete(instanceId);
            }
        };
        tracked = operation.then(
            () => cleanup(true),
            error => {
                cleanup(false);
                throw error;
            },
        );
        operations.add(tracked);
        this.forceLocalPersistenceOperations.set(instanceId, operations);
        void tracked.catch(() => undefined);
        return tracked;
    }

    private async saveForceLocally(force: Force, fence: ForceSaveFence): Promise<SerializedForce | null> {
        let settleOperation!: () => void;
        let rejectOperation!: (reason?: unknown) => void;
        const operation = new Promise<void>((resolve, reject) => {
            settleOperation = resolve;
            rejectOperation = reject;
        });
        // The operation remains rejected for drain/allSettled, while this
        // observation prevents a completed failure from becoming an unhandled
        // rejection before a retirement begins draining it.
        void operation.catch(() => undefined);
        // Null-ID preparations cannot be indexed yet, but they are still
        // synchronously visible through the global preparation counter. Once
        // promotion wins below, register this same sentinel under the minted ID.
        let operationInstanceId = fence.instanceId;
        let operations = operationInstanceId
            ? this.forceLocalPersistenceOperations.get(operationInstanceId) ?? new Set<Promise<void>>()
            : new Set<Promise<void>>();
        operations.add(operation);
        if (operationInstanceId) this.forceLocalPersistenceOperations.set(operationInstanceId, operations);
        let sequence = operationInstanceId
            ? (this.forceLocalPersistenceSequence.get(operationInstanceId) ?? 0) + 1
            : 0;
        if (operationInstanceId) this.forceLocalPersistenceSequence.set(operationInstanceId, sequence);
        this.pendingForceSavePreparations += 1;
        let succeeded = false;
        let rejected = false;
        let rejection: unknown;
        try {
            const prepared = await force.serializeForPersistenceWithRevisionFence();
            // Classic persistence may install its freshly sealed V2/bridge
            // authority as part of serialization. Force returns the only
            // fingerprint that can soundly cross that controlled mutation.
            fence.revisionFence = prepared.revisionFence;
            const serialized = prepared.serialized;
            if (!this.promoteProvisionalForceSaveFence(force, fence, prepared)) return null;
            if (!operationInstanceId) {
                operationInstanceId = fence.instanceId;
                operations = this.forceLocalPersistenceOperations.get(operationInstanceId) ?? new Set<Promise<void>>();
                operations.add(operation);
                this.forceLocalPersistenceOperations.set(operationInstanceId, operations);
                sequence = (this.forceLocalPersistenceSequence.get(operationInstanceId) ?? 0) + 1;
                this.forceLocalPersistenceSequence.set(operationInstanceId, sequence);
            }
            if (!this.isForceSaveFenceCurrent(force, fence)) return null;
            await this.enqueueLocalForceWrite(fence.instanceId, () => this.isForceSaveFenceCurrent(force, fence)
                ? this.dbService.saveForce(serialized)
                : Promise.resolve());
            if (!this.isForceSaveFenceCurrent(force, fence)) return null;
            this.durableForceIdentity.set(force, fence.instanceId);
            succeeded = true;
            return serialized;
        } catch (error) {
            rejected = true;
            rejection = error;
            throw error;
        } finally {
            this.recordForceLocalPersistenceOutcome(fence.instanceId, fence.generation, sequence, succeeded);
            this.pendingForceSavePreparations -= 1;
            operations.delete(operation);
            if (operations.size === 0
                && operationInstanceId
                && this.forceLocalPersistenceOperations.get(operationInstanceId) === operations) {
                this.forceLocalPersistenceOperations.delete(operationInstanceId);
            }
            if (rejected) rejectOperation(rejection);
            else settleOperation();
        }
    }

    public async updateForceTags(instanceId: string, tags: readonly string[], updateCloud: boolean = true): Promise<ForceTagsUpdateResult> {
        const normalizedTags = sanitizeForceTags(tags);
        const activeForce = this.activeForceAuthority.get(instanceId);
        if (activeForce) {
            if (activeForce.readOnly() || !activeForce.isWholeOwnerActive()) {
                throw new Error('The selected loaded force is protected, read-only, or changing ownership.');
            }
            if (activeForce.setTagsForExplicitPersistence(normalizedTags)) {
                if (updateCloud) {
                    if (!await this.saveForceAndWaitForCloud(activeForce)) {
                        throw new Error('The loaded force changed ownership before its tags were saved.');
                    }
                } else {
                    await this.saveForce(activeForce, true);
                }
            }
            if (this.activeForceAuthority.get(instanceId) !== activeForce) {
                throw new Error('The selected force authority changed while its tags were being updated.');
            }
            this.updateCachedForceTags(instanceId, normalizedTags);
            return { tags: normalizedTags, timestamp: activeForce.timestamp };
        }

        const lease = this.acquireOwnerlessForceOperation(instanceId);
        if (!lease) throw new Error('The selected force authority changed while its tags were being updated.');
        const generation = this.currentForceAuthorityGeneration(instanceId);
        try {
            await lease.ready;
            const authorityIsCurrent = () => this.isOwnerlessForceOperationCurrent(instanceId, lease, generation);
            if (!authorityIsCurrent()) throw new Error('The selected force authority changed while its tags were being updated.');
            const localRaw = await this.dbService.getForce(instanceId);
            if (localRaw?.version === 2 && localRaw.type === GameSystem.ALPHA_STRIKE) {
                if (!authorityIsCurrent()) {
                    throw new Error('The selected force authority changed while its tags were being updated.');
                }
                const updatedLocalForce = await this.dbService.updateForceTags(instanceId, normalizedTags);
                if (!authorityIsCurrent()) {
                    throw new Error('The selected force authority changed while its tags were being updated.');
                }
                let updated = updatedLocalForce !== null;
                let cloudUpdate: { updated: boolean; timestamp: string | null } | null = null;
                if (updateCloud) {
                    cloudUpdate = await this.updateForceTagsCloud(instanceId, normalizedTags, generation);
                    if (!authorityIsCurrent()) {
                        throw new Error('The selected force authority changed while its tags were being updated.');
                    }
                    updated = cloudUpdate.updated || updated;
                }
                if (!updated) throw new Error('The selected force could not be updated.');
                this.updateCachedForceTags(instanceId, normalizedTags);
                const timestamp = cloudUpdate?.timestamp ?? updatedLocalForce?.timestamp ?? null;
                if (updatedLocalForce && timestamp && updatedLocalForce.timestamp !== timestamp) {
                    updatedLocalForce.timestamp = timestamp;
                    await this.enqueueLocalForceWrite(instanceId, () => authorityIsCurrent()
                        ? this.dbService.saveForce(updatedLocalForce)
                        : Promise.resolve());
                }
                if (!authorityIsCurrent()) {
                    throw new Error('The selected force authority changed while its tags were being updated.');
                }
                return { tags: normalizedTags, timestamp };
            }
            let cloudRaw: SerializedForce | null = null;
            let triedCloud = false;
            if (updateCloud && authorityIsCurrent() && await this.canUseCloud()) {
                cloudRaw = await this.getForceCloud(instanceId, false);
                triedCloud = true;
            }
            if (!authorityIsCurrent()) throw new Error('The selected force authority changed while its tags were being updated.');

            const local = localRaw ? await this.loadPersistedForce(localRaw) : null;
            const cloud = cloudRaw ? await this.loadPersistedForce(cloudRaw) : null;
            if ((local && hasInvalidDurableForceIds(local)) || (cloud && hasInvalidDurableForceIds(cloud))) {
                throw new Error('The selected force has invalid or duplicate durable IDs and cannot be retagged.');
            }
            if (!authorityIsCurrent()) throw new Error('The selected force authority changed while its tags were being updated.');

            let force: Force | null;
            if (local && cloud && localRaw && cloudRaw) {
                force = this.preferCloudForce(localRaw, cloudRaw) ? cloud : local;
            } else {
                force = cloud ?? local;
            }
            if (!force || force.readOnly()) {
                throw new Error('The selected force is missing, protected, or read-only and cannot be retagged.');
            }
            if (force.gameSystem === GameSystem.CLASSIC) {
                if (cloudRaw) force.markCloudCBTForceV2Saved(cloudRaw);
                else force.setExpectedCloudCBTForceV2Revision(triedCloud ? null : undefined);
            }
            force.setTagsForExplicitPersistence(normalizedTags);
            const prepared = await force.serializeForPersistenceWithAuthorityFence();
            if (!authorityIsCurrent()
                || prepared.serialized.instanceId !== instanceId
                || !force.isWholeOwnerAuthorityFingerprintCurrent(prepared.authorityFingerprint)) {
                throw new Error('The selected force authority changed while its tags were being updated.');
            }
            if (!await this.saveSerializedForceToLocalStorageUnderLease(
                prepared.serialized,
                lease,
                generation,
            )) throw new Error('The selected force could not be updated locally.');
            if (updateCloud && triedCloud && !await this.pushOwnerlessForceToCloud(
                force,
                prepared.serialized,
                lease,
                generation,
                force.getExpectedCloudCBTForceV2Revision(),
            )) throw new Error('The selected force could not be updated in cloud storage.');
            if (!authorityIsCurrent()) throw new Error('The selected force authority changed while its tags were being updated.');
            this.updateCachedForceTags(instanceId, normalizedTags);
            return { tags: normalizedTags, timestamp: prepared.serialized.timestamp ?? null };
        } finally {
            this.releaseOwnerlessForceOperation(instanceId, lease);
        }
    }

    public getCachedForceTagLabels(): string[] {
        const labels = new Map<string, string>();
        for (const tags of this.cachedForceTagsByInstanceId.values()) {
            for (const tag of tags) {
                const key = tag.toLocaleLowerCase();
                if (!labels.has(key)) {
                    labels.set(key, tag);
                }
            }
        }

        return Array.from(labels.values())
            .sort(naturalCompare);
    }

    public updateCachedForceTags(instanceId: string, tags: readonly string[] | null | undefined): void {
        if (!instanceId) {
            return;
        }

        this.cachedForceTagsByInstanceId.set(instanceId, sanitizeForceTags(tags ?? []));
    }

    /** Pushes exact durable local bytes while the ID remains ownerless. */
    private async pushOwnerlessForceToCloud(
        force: Force,
        serialized: SerializedForce,
        lease: OwnerlessForceOperationLease,
        generation: number,
        expectedCloudRevision: number | null | undefined = null,
    ): Promise<boolean> {
        const instanceId = force.instanceId();
        if (!instanceId || serialized.instanceId !== instanceId
            || !this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
        const detached = decodeForceFromStorage(encodeForceForStorage(serialized));
        const ws = await this.canUseCloud();
        if (!ws || !this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
        let savedForceCount: number | undefined;
        try {
            savedForceCount = await this.dbService.countForces();
        } catch (error) {
            if (this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) {
                this.logger.warn(`Could not count local forces before cloud save: ${error}`);
            }
        }
        if (!this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
        const response = await this.wsService.sendAndWaitForResponse<ForceSaveResponse>({
            action: 'saveForce',
            uuid: this.userStateService.uuid(),
            data: encodeForceForStorage(detached),
            ...(detached.cbt === undefined ? {} : {
                cbtPersistence: {
                    writerVersion: 2,
                    ...(expectedCloudRevision === undefined ? {} : {
                        expectedIntegrityDigest: cloudForceRevisionToken(expectedCloudRevision),
                    }),
                },
            }),
            ...(savedForceCount === undefined ? {} : { savedForceCount }),
        });
        if (!this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
        if (!response) throw new Error('Cloud save did not receive a response.');
        if (response.code === 'not_owner') throw new Error('Cannot save force to cloud: not the owner.');
        if (response.action === 'error') {
            throw new Error(response.message ?? 'Cloud save failed.');
        }
        if (response.action !== 'forceSaved') {
            throw new Error(`Cloud save returned unexpected response: ${response.action ?? 'unknown'}.`);
        }
        if (force.gameSystem === GameSystem.CLASSIC) force.markCloudCBTForceV2Saved(detached);
        return this.isOwnerlessForceOperationCurrent(instanceId, lease, generation);
    }

    private refreshCachedForceTags(forces: readonly Pick<LoadForceEntry, 'instanceId' | 'tags'>[]): void {
        const nextCache = new Map<string, string[]>();
        for (const force of forces) {
            if (!force.instanceId) {
                continue;
            }

            nextCache.set(force.instanceId, sanitizeForceTags(force.tags ?? []));
        }

        this.cachedForceTagsByInstanceId = nextCache;
    }



    public async saveSerializedForceToLocalStorage(serialized: SerializedForce): Promise<boolean> {
        this.pendingForceSavePreparations += 1;
        let instanceId = '';
        let lease: OwnerlessForceOperationLease | null = null;
        try {
            // Raw transport callers never retain write ownership. Detach the
            // complete bytes synchronously and bind the initially-unloaded ID
            // to its exact Data authority generation across validation/queueing.
            const detached = structuredClone(serialized);
            if (!detached.instanceId) throw new Error('Force instance ID is required for saving.');
            instanceId = detached.instanceId;
            lease = this.acquireOwnerlessForceOperation(instanceId);
            if (!lease) throw new Error('Raw force bytes cannot overwrite a loaded force owner.');
            const generation = this.currentForceAuthorityGeneration(instanceId);
            await lease.ready;
            if (!this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
            return await this.saveSerializedForceToLocalStorageUnderLease(detached, lease, generation);
        } finally {
            if (lease && instanceId) this.releaseOwnerlessForceOperation(instanceId, lease);
            this.pendingForceSavePreparations -= 1;
        }
    }

    private async saveSerializedForceToLocalStorageUnderLease(
        detached: SerializedForce,
        lease: OwnerlessForceOperationLease,
        generation: number,
    ): Promise<boolean> {
        const normalized = await this.normalizePersistedForce(detached);
        const instanceId = normalized.instanceId;
        if (!instanceId || !this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
        if (normalized.type !== GameSystem.ALPHA_STRIKE && normalized.cbt !== undefined) {
            await inspectSerializedCBTForceV2(normalized);
        }
        if (!this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
        let written = false;
        await this.enqueueLocalForceWrite(
            instanceId,
            async () => {
                if (!this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return;
                await this.dbService.saveForce(normalized);
                written = this.isOwnerlessForceOperationCurrent(instanceId, lease, generation);
            },
        );
        return written;
    }

    public async listForces(): Promise<LoadForceEntry[]> {
        this.logger.info(`Retrieving local forces...`);
        const localForces: LoadForceEntry[] = [];
        for (const raw of await this.dbService.listForces()) {
            try {
                localForces.push(createLoadForceEntryFromSerializedForce(
                    await this.normalizePersistedForce(raw),
                    this.dataService,
                    { local: true },
                ));
            } catch (error) {
                this.logger.warn(`Skipping unreadable saved force: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.logger.info(`Retrieving cloud forces...`);
        const cloudForces = await this.listForcesCloud();
        this.logger.info(`Found ${localForces.length} local forces and ${cloudForces.length} cloud forces.`);
        const forceMap = new Map<string, LoadForceEntry>();
        const getTimestamp = (f: { readonly timestamp?: string | number | null }) => {
            if (f && typeof f.timestamp === 'number') return f.timestamp;
            if (f && f.timestamp) return new Date(f.timestamp).getTime();
            return 0;
        };
        for (const force of localForces) {
            if (!force) continue;
            if (!force.instanceId) continue;
            force.local = true;
            forceMap.set(force.instanceId, force);
        }
        for (const cloudForce of cloudForces) {
            if (!cloudForce) continue;
            if (!cloudForce.instanceId) continue;
            const localForce = forceMap.get(cloudForce.instanceId);
            if (!localForce || getTimestamp(cloudForce) >= getTimestamp(localForce)) {
                if (localForce) {
                    cloudForce.local = true; // This force is both local and cloud
                }
                forceMap.set(cloudForce.instanceId, cloudForce);
            }
        }
        const mergedForces = Array.from(forceMap.values()).sort((a, b) => getTimestamp(b) - getTimestamp(a));
        this.refreshCachedForceTags(mergedForces);
        this.logger.info(`Found ${mergedForces.length} unique forces.`);
        return mergedForces;
    }

    private static readonly FORCE_BULK_CHUNK_SIZE = 100;

    public async cacheForcesLocally(instanceIds: readonly string[]): Promise<number> {
        const uniqueIds = Array.from(new Set(instanceIds.filter((instanceId): instanceId is string => !!instanceId)));
        if (uniqueIds.length === 0) return 0;

        const localRawForces = await Promise.all(uniqueIds.map((instanceId) => this.dbService.getForce(instanceId)));
        const missingIds = uniqueIds.filter((instanceId, index) => !localRawForces[index]);
        if (missingIds.length === 0) return 0;

        const cloudForces = await this.getForcesCloudRawByIds(missingIds);
        for (const force of cloudForces) {
            await this.saveSerializedForceToLocalStorage(force);
        }

        return cloudForces.length;
    }

    public async getLoadForceEntriesByIds(instanceIds: readonly string[]): Promise<LoadForceEntry[]> {
        const orderedIds = Array.from(new Set(instanceIds.filter((instanceId): instanceId is string => !!instanceId)));
        if (orderedIds.length === 0) return [];

        const entryMap = new Map<string, LoadForceEntry>();
        const localRawForces = await Promise.all(orderedIds.map(instanceId => this.dbService.getForce(instanceId)));

        for (const localRaw of localRawForces) {
            if (!localRaw?.instanceId) continue;
            entryMap.set(
                localRaw.instanceId,
                createLoadForceEntryFromSerializedForce(
                    await this.normalizePersistedForce(localRaw),
                    this.dataService,
                    { local: true },
                ),
            );
        }

        const cloudForces = await this.getForcesBulkSummaries(orderedIds);
        for (const raw of cloudForces) {
            if (!raw?.instanceId) continue;
            const cloudEntry = createLoadForceEntry(raw, this.dataService, { cloud: true });
            const existing = entryMap.get(raw.instanceId);
            if (!existing || this.getComparableTimestamp(raw.timestamp) >= this.getComparableTimestamp(existing.timestamp)) {
                if (existing?.local) cloudEntry.local = true;
                entryMap.set(raw.instanceId, cloudEntry);
            }
        }

        return orderedIds
            .map(instanceId => entryMap.get(instanceId))
            .filter((entry): entry is LoadForceEntry => entry !== undefined);
    }

    private async getForcesBulkSummaries(instanceIds: readonly string[]): Promise<RemoteLoadForceEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const orderedIds = Array.from(new Set(instanceIds.filter((instanceId): instanceId is string => !!instanceId)));
        const result: RemoteLoadForceEntry[] = [];

        for (let i = 0; i < orderedIds.length; i += ForcePersistenceService.FORCE_BULK_CHUNK_SIZE) {
            const chunk = orderedIds.slice(i, i + ForcePersistenceService.FORCE_BULK_CHUNK_SIZE);
            const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<RemoteLoadForceEntry[]>>({
                action: 'getForcesBulk',
                instanceIds: chunk,
            });
            result.push(...(response?.data ?? []));
        }

        return result;
    }

    private async getForcesCloudRawByIds(instanceIds: readonly string[]): Promise<SerializedForce[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const orderedIds = Array.from(new Set(instanceIds.filter((instanceId): instanceId is string => !!instanceId)));
        const uuid = this.userStateService.uuid();
        const result: SerializedForce[] = [];

        for (const instanceId of orderedIds) {
            const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<StoredForceRecord | null>>({
                action: 'getForce',
                uuid,
                instanceId,
                ownedOnly: false,
            });
            const raw = response?.data;
            if (raw != null) {
                const decoded = decodeForceFromStorage(raw);
                if (decoded.instanceId) result.push(decoded);
            }
        }

        return result;
    }

    private _cloudReadyChecked = false;
    private async canUseCloud(timeoutMs = 3000): Promise<WebSocket | null> {
        if (!navigator.onLine) return null;
        const ws = this.wsService.getWebSocket();
        if (!ws) return null;
        if (!this._cloudReadyChecked) {
            try {
                await Promise.race([
                    this.wsService.getWsReady(),
                    new Promise((_, reject) => setTimeout(() => reject('WebSocket connect timeout'), timeoutMs))
                ]);
            } catch {
                this._cloudReadyChecked = true;
                return null;
            }
        }
        if (ws.readyState !== WebSocket.OPEN) return null;
        return ws;
    }

    public async deleteForce(instanceId: string): Promise<void> {
        // A tombstone generation plus the per-ID write queue makes deletion
        // follow every already-started local write and rejects every prepared
        // old-generation successor. Deleted bytes cannot be resurrected by an
        // owner command that was pending when its slot retired.
        const lease = this.acquireOwnerlessForceOperation(instanceId);
        if (!lease) throw new Error('A loaded force must be retired before it can be deleted.');
        try {
            await lease.ready;
            if (!this.ownerlessForceOperationLeases.get(instanceId)?.has(lease)
                || this.activeForceAuthority.has(instanceId)) {
                throw new Error('A loaded force must be retired before it can be deleted.');
            }
            const unitIds = await this.getPersistedForceUnitIds(instanceId);
            const deletionGeneration = this.advanceForceAuthorityGeneration(instanceId);
            await this.enqueueLocalForceWrite(instanceId, () => this.dbService.deleteForce(instanceId, unitIds));
            // Delete from cloud
            const ws = await this.canUseCloud();
            if (ws
                && this.isOwnerlessForceOperationCurrent(instanceId, lease, deletionGeneration)) {
                const uuid = this.userStateService.uuid();
                const payload = {
                    action: 'delForce',
                    uuid,
                    instanceId
                };
                this.wsService.send(payload);
            }
        } finally {
            this.releaseOwnerlessForceOperation(instanceId, lease);
        }
    }

    /** Delete a force from local storage only (no cloud request). */
    public async deleteLocalForce(instanceId: string): Promise<void> {
        const lease = this.acquireOwnerlessForceOperation(instanceId);
        if (!lease) throw new Error('A loaded force must be retired before it can be deleted locally.');
        try {
            await lease.ready;
            if (!this.ownerlessForceOperationLeases.get(instanceId)?.has(lease)
                || this.activeForceAuthority.has(instanceId)) {
                throw new Error('A loaded force must be retired before it can be deleted locally.');
            }
            const unitIds = await this.getPersistedForceUnitIds(instanceId);
            this.advanceForceAuthorityGeneration(instanceId);
            await this.enqueueLocalForceWrite(instanceId, () => this.dbService.deleteForce(instanceId, unitIds));
        } finally {
            this.releaseOwnerlessForceOperation(instanceId, lease);
        }
    }

    private getComparableTimestamp(timestamp: string | number | null | undefined): number {
        if (typeof timestamp === 'number') return timestamp;
        if (timestamp) return new Date(timestamp).getTime();
        return 0;
    }


    private async listForcesCloud(): Promise<LoadForceEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];
        const forces: LoadForceEntry[] = [];
        const uuid = this.userStateService.uuid();
        const payload = {
            action: 'listForces',
            uuid,
        };
        const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<RemoteLoadForceEntry[]>>(payload);
        if (response?.data) {
            for (const raw of response.data) {
                try {
                    forces.push(createLoadForceEntry(raw, this.dataService, { cloud: true }));
                } catch (error) {
                    this.logger.error('Failed to deserialize force: ' + error + ' ' + raw);
                }
            }
        }
        return forces;
    }

    SAVE_FORCE_CLOUD_DEBOUNCE_MS = 2000;
    // Debounce map to prevent multiple simultaneous saves for the same force
    private saveForceCloudDebounce = new Map<string, {
        timeout: ReturnType<typeof setTimeout>,
        force: Force,
        serialized: SerializedForce,
        expectedCloudRevision: number | null | undefined,
        fence: ForceSaveFence,
        resolvers: Array<{ resolve: () => void, reject: (reason?: unknown) => void }>
    }>();
    /** Serializes acknowledged writes per force so each CAS uses its predecessor's revision. */
    private forceCloudSaveChain = new Map<string, {
        readonly generation: number;
        readonly fence: ForceSaveFence;
        readonly promise: Promise<number | null | undefined>;
    }>();

    /** Includes serialization/IndexedDB work and acknowledged cloud work. */
    public hasPendingForceSaves(): boolean {
        return this.pendingForceAutosaves > 0
            || this.pendingForceSavePreparations > 0
            || this.forceLocalSaveChain.size > 0
            || this.saveForceCloudDebounce.size > 0
            || this.forceCloudSaveChain.size > 0;
    }

    private currentForceAuthorityGeneration(instanceId: string): number {
        return this.forceAuthorityGeneration.get(instanceId) ?? 0;
    }

    private isForceSaveFenceCurrent(force: Force, fence: ForceSaveFence): boolean {
        const activeForce = this.activeForceAuthority.get(fence.instanceId);
        return fence.owner === force
            && force.instanceId() === fence.instanceId
            && this.registeredForceIdentity.get(force) === fence.instanceId
            && !force.readOnly()
            && activeForce === force
            && this.currentForceAuthorityGeneration(fence.instanceId) === fence.generation
            && force.isForceOwnerRevisionFenceCurrent(fence.revisionFence);
    }

    /** A cloud acknowledgement updates only the cloud CAS witness. */
    private acknowledgeForceCloudSave(
        force: Force,
        serialized: SerializedForce,
        fence: ForceSaveFence,
    ): void {
        if (!this.isForceSaveFenceCurrent(force, fence)) return;
        force.markCloudCBTForceV2Saved(serialized);
        const pending = this.saveForceCloudDebounce.get(fence.instanceId);
        if (pending
            && pending.force === force
            && pending.fence.generation === fence.generation
            && this.isForceSaveFenceCurrent(force, pending.fence)) {
            pending.expectedCloudRevision = force.getExpectedCloudCBTForceV2Revision();
        }
    }

    private advanceForceAuthorityGeneration(instanceId: string): number {
        const next = this.currentForceAuthorityGeneration(instanceId) + 1;
        this.forceAuthorityGeneration.set(instanceId, next);
        this.forceLocalPersistenceOutcome.delete(instanceId);
        this.forceSaveFences.delete(instanceId);
        const pending = this.saveForceCloudDebounce.get(instanceId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.saveForceCloudDebounce.delete(instanceId);
            for (const resolver of pending.resolvers) resolver.resolve();
        }
        const inFlight = this.forceCloudSaveChain.get(instanceId);
        if (inFlight && inFlight.generation !== next) {
            // A superseded request may remain unresolved at the transport
            // layer, but it no longer represents pending live authority.
            this.forceCloudSaveChain.delete(instanceId);
        }
        return next;
    }

    private enqueueLocalForceWrite(instanceId: string, write: () => Promise<void>): Promise<void> {
        const predecessor = this.forceLocalSaveChain.get(instanceId);
        const task = predecessor
            ? predecessor.then(write, write)
            : Promise.resolve().then(write);
        this.forceLocalSaveChain.set(instanceId, task);
        task.then(
            () => {
                if (this.forceLocalSaveChain.get(instanceId) === task) {
                    this.forceLocalSaveChain.delete(instanceId);
                }
            },
            () => {
                if (this.forceLocalSaveChain.get(instanceId) === task) {
                    this.forceLocalSaveChain.delete(instanceId);
                }
            },
        );
        return task;
    }

    private async saveForceCloud(
        force: Force,
        serialized: SerializedForce,
        fence: ForceSaveFence,
    ): Promise<void> {
        if (force.readOnly()) {
            this.logger.warn(`ForcePersistenceService.saveForceCloud() blocked: force "${force.name}" is read-only.`);
            return;
        }
        const instanceId = force.instanceId();
        if (!instanceId) return; // Should not happen, nothing to save without an instanceId
        if (!this.isForceSaveFenceCurrent(force, fence)) return;

        return new Promise<void>((resolve, reject) => {
            const existing = this.saveForceCloudDebounce.get(instanceId);
            if (existing) {
                // clear previous timeout and replace stored force with latest
                clearTimeout(existing.timeout);
                existing.force = force;
                existing.serialized = serialized;
                existing.expectedCloudRevision = force.getExpectedCloudCBTForceV2Revision();
                existing.fence = fence;
                existing.resolvers.push({ resolve, reject });
                // reschedule
                const timeout = setTimeout(() => {
                    void this.flushSaveForceCloud(instanceId);
                }, this.SAVE_FORCE_CLOUD_DEBOUNCE_MS);
                existing.timeout = timeout;
                this.saveForceCloudDebounce.set(instanceId, existing);
            } else {
                const timeout = setTimeout(() => {
                    void this.flushSaveForceCloud(instanceId);
                }, this.SAVE_FORCE_CLOUD_DEBOUNCE_MS);
                // store/replace entry
                this.saveForceCloudDebounce.set(instanceId, {
                    timeout,
                    force,
                    serialized,
                    expectedCloudRevision: force.getExpectedCloudCBTForceV2Revision(),
                    fence,
                    resolvers: [{ resolve, reject }]
                });
            }
        });
    }

    private async updateForceTagsCloud(
        instanceId: string,
        tags: readonly string[],
        generation: number,
    ): Promise<{ updated: boolean; timestamp: string | null }> {
        const failed = { updated: false, timestamp: null };
        const ws = await this.canUseCloud();
        if (!ws
            || generation !== this.currentForceAuthorityGeneration(instanceId)
            || this.activeForceAuthority.has(instanceId)) {
            return failed;
        }

        try {
            const uuid = this.userStateService.uuid();
            const response = await this.wsService.sendAndWaitForResponse<ForceTagsUpdateResponse>({
                action: 'setForceTags',
                uuid,
                instanceId,
                tags,
            });

            if (generation !== this.currentForceAuthorityGeneration(instanceId)
                || this.activeForceAuthority.has(instanceId)) return failed;

            if (!response) {
                return failed;
            }

            if (response.code === 'not_owner') {
                this.logger.warn(`Cannot update force tags in cloud for ${instanceId}: not the owner.`);
                return failed;
            }

            if (response.action === 'error') {
                this.logger.error(`Failed to update force tags in cloud for ${instanceId}: ${response.message ?? 'unknown error'}`);
                return failed;
            }

            return response.action === 'forceTagsUpdated'
                ? {
                    updated: true,
                    timestamp: response.timestamp ?? null,
                }
                : failed;
        } catch (err) {
            this.logger.error(`Failed to update force tags in cloud for ${instanceId}: ${err}`);
            return failed;
        }
    }

    private async saveForceCloudImmediately(
        force: Force,
        serialized: SerializedForce,
        fence: ForceSaveFence,
    ): Promise<void> {
        const instanceId = force.instanceId();
        if (!instanceId) return;
        if (!this.isForceSaveFenceCurrent(force, fence)) return;

        const pending = this.saveForceCloudDebounce.get(instanceId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.saveForceCloudDebounce.delete(instanceId);
        }

        try {
            await this.sendForceToCloudOrdered(
                force,
                serialized,
                pending?.expectedCloudRevision ?? force.getExpectedCloudCBTForceV2Revision(),
                fence,
            );
            for (const resolver of pending?.resolvers ?? []) {
                resolver.resolve();
            }
        } catch (error) {
            for (const resolver of pending?.resolvers ?? []) {
                resolver.reject(error);
            }
            throw error;
        }
    }

    private sendForceToCloudOrdered(
        force: Force,
        serialized: SerializedForce,
        expectedCloudRevision: number | null | undefined,
        fence: ForceSaveFence,
    ): Promise<void> {
        const instanceId = force.instanceId();
        if (!instanceId) return Promise.reject(new Error('Force instance ID is required for cloud saving.'));
        if (!this.isForceSaveFenceCurrent(force, fence)) return Promise.resolve();
        const predecessorEntry = this.forceCloudSaveChain.get(instanceId);
        const predecessor = predecessorEntry?.generation === fence.generation
            ? predecessorEntry.promise
            : undefined;
        const send = (expected: number | null | undefined) => {
            // A successor can sit behind an acknowledged predecessor while a
            // remote authority swap advances the generation. Never put those
            // already-queued stale bytes on the wire.
            if (!this.isForceSaveFenceCurrent(force, fence)) {
                return Promise.resolve<number | null | undefined>(undefined);
            }
            return this.sendForceToCloud(
                force,
                serialized,
                expected,
                instanceId,
                fence,
            );
        };
        const sent = predecessor
            ? predecessor.then(send, () => send(expectedCloudRevision))
            : send(expectedCloudRevision);
        const task = sent.then(acknowledgedRevision => {
            if (this.isForceSaveFenceCurrent(force, fence)) {
                this.acknowledgeForceCloudSave(force, serialized, fence);
                return force.getExpectedCloudCBTForceV2Revision();
            }
            return acknowledgedRevision;
        });
        const entry = Object.freeze({ generation: fence.generation, fence, promise: task });
        this.forceCloudSaveChain.set(instanceId, entry);
        task.then(
            () => {
                if (this.forceCloudSaveChain.get(instanceId) === entry) {
                    this.forceCloudSaveChain.delete(instanceId);
                }
            },
            () => {
                if (this.forceCloudSaveChain.get(instanceId) === entry) {
                    this.forceCloudSaveChain.delete(instanceId);
                }
            },
        );
        return task.then(() => undefined);
    }

    private async sendForceToCloud(
        force: Force,
        serialized: SerializedForce,
        expectedCloudRevision: number | null | undefined,
        instanceId: string,
        fence: ForceSaveFence,
    ): Promise<number | null | undefined> {
        const ws = await this.canUseCloud();
        if (!this.isForceSaveFenceCurrent(force, fence)) return undefined;
        if (!ws) {
            throw new Error('Cloud save skipped because WebSocket is unavailable.');
        }

        const uuid = this.userStateService.uuid();
        let savedForceCount: number | undefined;
        try {
            savedForceCount = await this.dbService.countForces();
        } catch (error) {
            if (this.isForceSaveFenceCurrent(force, fence)) {
                this.logger.warn(`Could not count local forces before cloud save: ${error}`);
            }
        }
        if (!this.isForceSaveFenceCurrent(force, fence)) return undefined;
        let response: ForceSaveResponse | null;
        try {
            response = await this.wsService.sendAndWaitForResponse<ForceSaveResponse>({
                action: 'saveForce',
                uuid,
                data: encodeForceForStorage(serialized),
                ...(serialized.cbt === undefined ? {} : {
                    cbtPersistence: {
                        writerVersion: 2,
                        ...(expectedCloudRevision === undefined ? {} : {
                            expectedIntegrityDigest: cloudForceRevisionToken(expectedCloudRevision),
                        }),
                    },
                }),
                ...(savedForceCount === undefined ? {} : { savedForceCount }),
            });

        } catch (error) {
            if (!this.isForceSaveFenceCurrent(force, fence)) return undefined;
            throw error;
        }
        // Remote acceptance detaches old-generation responses completely:
        // no adoption prompts, warnings, revision acknowledgements, or errors.
        if (!this.isForceSaveFenceCurrent(force, fence)) return undefined;

        if (!response) {
            throw new Error('Cloud save did not receive a response.');
        }
        if (response.code === 'not_owner') {
            this.logger.warn('Cannot save force to cloud: not the owner.');
            this.forceNeedsAdoption.next(force);
            throw new Error('Cannot save force to cloud: not the owner.');
        }
        if (response.action === 'error') {
            throw new Error(response.message ?? 'Cloud save failed.');
        }
        if (response.action !== 'forceSaved') {
            throw new Error(`Cloud save returned unexpected response: ${response.action ?? 'unknown'}.`);
        }
        return serialized.cbt?.forceRevision ?? null;
    }

    // Flush function performs the actual cloud save for the latest Force for a given instanceId
    private async flushSaveForceCloud(instanceId: string): Promise<void> {
        const entry = this.saveForceCloudDebounce.get(instanceId);
        if (!entry) return;
        // Remove entry immediately to allow new debounces
        this.saveForceCloudDebounce.delete(instanceId);
        clearTimeout(entry.timeout);

        const { force, serialized, expectedCloudRevision, fence, resolvers } = entry;

        if (force.readOnly()) {
            this.logger.warn(`ForcePersistenceService.flushSaveForceCloud() blocked: force "${force.name}" is read-only.`);
            for (const r of resolvers) r.resolve();
            return;
        }
        if (!this.isForceSaveFenceCurrent(force, fence)) {
            for (const r of resolvers) r.resolve();
            return;
        }

        try {
            await this.sendForceToCloudOrdered(force, serialized, expectedCloudRevision, fence);
            for (const r of resolvers) r.resolve();
        } catch (err) {
            for (const r of resolvers) r.reject(err);
        }
    }

    // Best-effort flush of all pending debounced cloud saves.
    private flushAllPendingSavesOnUnload(): void {
        if (!this.saveForceCloudDebounce || this.saveForceCloudDebounce.size === 0) return;

        const ws = this.wsService.getWebSocket();
        const canSendOverWs = ws && ws.readyState === WebSocket.OPEN;

        for (const [instanceId, entry] of Array.from(this.saveForceCloudDebounce.entries())) {
            try {
                // stop scheduled debounce
                clearTimeout(entry.timeout);
                this.saveForceCloudDebounce.delete(instanceId);

                // Skip read-only forces, they must never be saved
                if (entry.force.readOnly()) {
                    for (const r of entry.resolvers) {
                        try { r.resolve(); } catch { /* best-effort */ }
                    }
                    continue;
                }

                // An acknowledged CAS is already in flight. Its chained save
                // owns the next expected revision; a synchronous unload write
                // would carry stale CAS evidence and can only be rejected.
                if (this.forceCloudSaveChain.has(instanceId)) {
                    for (const r of entry.resolvers) {
                        try { r.resolve(); } catch { /* best-effort */ }
                    }
                    continue;
                }

                // try to send final payload over websocket if available (synchronous queueing)
                if (canSendOverWs) {
                    try {
                        const uuid = this.userStateService.uuid();
                        const payload = {
                            action: 'saveForce',
                            uuid,
                            data: encodeForceForStorage(entry.serialized),
                            ...(entry.serialized.cbt === undefined ? {} : {
                                cbtPersistence: {
                                    writerVersion: 2,
                                    ...(entry.expectedCloudRevision === undefined
                                        ? {}
                                        : {
                                            expectedIntegrityDigest: cloudForceRevisionToken(
                                                entry.expectedCloudRevision,
                                            ),
                                        }),
                                },
                            }),
                        };
                        this.wsService.send(payload);
                    } catch { /* best-effort */ }
                }

                // resolve pending promises so callers do not hang on unload
                for (const r of entry.resolvers) {
                    try { r.resolve(); } catch { /* best-effort */ }
                }
            } catch (err) {
                // ensure resolvers are resolved even on error
                for (const r of entry.resolvers) {
                    try { r.resolve(); } catch { /* best-effort */ }
                }
            }
        }
    }

    private async getForceCloud(
        instanceId: string,
        ownedOnly: boolean,
        includeOwnership: boolean = true,
    ): Promise<SerializedForce | null> {
        const ws = await this.canUseCloud();
        if (!ws) return null;
        const payload = {
            action: 'getForce',
            ...(includeOwnership ? { uuid: this.userStateService.uuid() } : {}),
            instanceId,
            ownedOnly,
        };
        const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<StoredForceRecord>>(payload);
        const data = response?.data;
        return data === undefined || data === null
            ? null
            : decodeForceFromStorage(data);
    }

    /* ----------------------------------------------------------
     * Canvas Data
     */

    public deleteCanvasDataOfUnit(unit: ForceUnit): void {
        this.dbService.deleteCanvasData(unit.id);
    }

}
