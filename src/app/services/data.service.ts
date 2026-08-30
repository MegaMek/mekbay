// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, signal, Injector, inject, DestroyRef, effect } from '@angular/core';
import type { UnitSummary } from '../models/unit-summary.model';
import type { Faction, FactionId } from '../models/factions.model';
import type { Era } from '../models/eras.model';
import { DbService, type TagData } from './db.service';
import { TagsService } from './tags.service';
import { PublicTagsService } from './public-tags.service';

import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { Quirk } from '../models/quirks.model';
import { WsService } from './ws.service';
import type { ForceUnit } from '../models/force-unit.model';
import {
    Force,
    type ForceOwnerAuthorityFingerprint,
    type ForceOwnerRevisionFence,
    type ForceOwnerReplacementCommitAuthority,
} from '../models/force.model';
import {
    FORCE_NOTE_MAX_LENGTH,
    AS_SERIALIZED_FORCE_SCHEMA,
    CBT_SERIALIZED_FORCE_SCHEMA,
    sanitizeForceTags,
    type ASSerializedForce,
    type SerializedClassicForce,
    type SerializedForce,
    type SerializedUnit,
} from '../models/force-serialization';
import { Sanitizer } from '../utils/sanitizer.util';
import { UserStateService } from './userState.service';
import {
    createLoadForceEntry,
    createLoadForceEntryFromSerializedForce,
    LoadForceEntry,
    type RemoteLoadForceEntry,
} from '../models/load-force-entry.model';
import { LoggerService } from './logger.service';
import { type SerializedOperation, LoadOperationEntry, type OperationForceInfo } from '../models/operation.model';
import { type LoadedOrganization, type SerializedOrganization, LoadOrganizationEntry } from '../models/organization.model';
import { Subject } from 'rxjs';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';
import type { Sourcebook } from '../models/sourcebook.model';
import type { SarnaLookupUnit } from '../models/sarna-page-titles.model';
import type { MegaMekFactionAffiliation, MegaMekFactionRecord, MegaMekFactions } from '../models/megamek/factions.model';
import type { MegaMekWeightedAvailabilityRecord } from '../models/megamek/availability.model';
import type { MegaMekRulesetRecord } from '../models/megamek/rulesets.model';
import type { ForceNameWords } from '../models/force-name-words.model';
import { getForcePacks } from '../models/forcepacks.model';
import type { UnitSearchWorkerFactionEraSnapshot, UnitSearchWorkerIndexSnapshot } from '../utils/unit-search-worker-protocol.util';
import { MegaMekAvailabilityCatalogService } from './catalogs/megamek-availability-catalog.service';
import { MegaMekFactionsCatalogService } from './catalogs/megamek-factions-catalog.service';
import { MegaMekRulesetsCatalogService } from './catalogs/megamek-rulesets-catalog.service';
import { ErasCatalogService } from './catalogs/eras-catalog.service';
import { FactionsCatalogService } from './catalogs/mulfactions-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SarnaPageTitlesCatalogService } from './catalogs/sarna-page-titles-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import {
    UnitSearchIndexService,
    type PreparedUnitSearchIndexes,
} from './unit-search-index.service';
import {
    UnitRuntimeService,
    type PreparedUnitRuntimeCatalog,
} from './unit-runtime.service';
import {
    UnitsCatalogService,
    type PreparedUnitsCatalogActivation,
} from './catalogs/units-catalog.service';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { ForceNameWordsCatalogService } from './catalogs/force-name-words-catalog.service';
import { CatalogDownloadTrackerService } from './catalogs/catalog-base.service';
import { MULFACTION_EXTINCT, MULFACTION_NONE } from '../models/mulfactions.model';
import { naturalCompare } from '../utils/sort.util';
import { getUnitVariantGroupKey } from '../utils/unit-variant.util';
import { uuidv7 } from '../utils/uuid.util';
import { jsonValuesEqual } from '../utils/json-value.util';
import type { RuntimeCatalogProgressState } from '../models/startup-progress.model';
import {
    decodeForceFromStorage,
    encodeForceForStorage,
} from '../models/runtime/force-storage-codec';
import {
    cloneAsJson,
    DeferredUnitResolutionError,
    type JsonValue,
    type PersistedUnitIdentity,
    type SavedEntityIdentity,
} from '../models/persisted-unit-state';
import type { UnitReferenceResolution } from './unit-runtime.service';
import type { StoredCoreContent, UnitProviderId } from './unit-catalog/unit-catalog.types';
import { PresentationCatalogSyncService } from './catalogs/presentation-catalog-sync.service';
import { inspectSerializedCBTForceV2 } from '../models/runtime/force-persistence-boundary';
import {
    convertPersistedForceV1,
    convertPersistedNonMekUnitV1,
    convertPersistedMekUnitV1,
    type PersistedForceV1ConversionOptions,
} from '../models/runtime/legacy-force-v1-converter';
import { ReadyMekUnitService } from './ready-mek-unit.service';
import { ReadyNonMekUnitService } from './ready-non-mek-unit.service';


export const DOES_NOT_TRACK = 999;

export interface BucketStatSummary {
    min: number;
    max: number;
    average: number;
}

export interface MinMaxStatsRange {
    armor: BucketStatSummary,
    internal: BucketStatSummary,
    heat: BucketStatSummary,
    dissipation: BucketStatSummary,
    dissipationEfficiency: BucketStatSummary,
    runMP: BucketStatSummary,
    run2MP: BucketStatSummary,
    umuMP: BucketStatSummary,
    jumpMP: BucketStatSummary,
    alphaNoPhysical: BucketStatSummary,
    alphaNoPhysicalNoOneshots: BucketStatSummary,
    maxRange: BucketStatSummary,
    weightedMaxRange: BucketStatSummary,
    dpt: BucketStatSummary,
    asTmm: BucketStatSummary,
    asArm: BucketStatSummary,
    asStr: BucketStatSummary,
    asDmgS: BucketStatSummary,
    asDmgM: BucketStatSummary,
    asDmgL: BucketStatSummary,

    // Capital ships
    dropshipCapacity: BucketStatSummary,
    escapePods: BucketStatSummary,
    lifeBoats: BucketStatSummary,
    gravDecks: BucketStatSummary,
    sailIntegrity: BucketStatSummary,
    kfIntegrity: BucketStatSummary,
}
export interface UnitSubtypeMaxStats {
    [unitSubtype: string]: MinMaxStatsRange
}

// Generic store update payload used for cross-tab notifications
export type BroadcastPayload = {
    source: 'mekbay';
    action: 'update';   // e.g. 'update'
    context?: string;     // e.g. 'tags'
    meta?: any;         // optional misc info
};

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
        /** No-throw irreversible Data-authority commit; valid only after predecessor retirement. */
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

interface StrictRemoteUnitRow {
    readonly groupId: string;
    readonly payload: JsonValue;
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
        if (typeof group.id !== 'string' || group.id.trim().length === 0 || groupIds.has(group.id)) return true;
        groupIds.add(group.id);
        for (const unit of group.units()) {
            if (typeof unit.id !== 'string' || unit.id.trim().length === 0 || unitIds.has(unit.id)) return true;
            unitIds.add(unit.id);
        }
    }
    return false;
}

function requireDurableRemoteId(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Remote force snapshot has a missing ${label}`);
    }
    return value;
}

function assertCanonicalRemoteForceMetadata(serialized: SerializedForce): void {
    if (serialized.type !== GameSystem.ALPHA_STRIKE
        && serialized.type !== GameSystem.CLASSIC) {
        throw new Error('Remote force snapshot has an invalid game system');
    }
    if ((serialized.version !== 1 && serialized.version !== 2)
        || typeof serialized.timestamp !== 'string'
        || serialized.timestamp.length === 0
        || typeof serialized.instanceId !== 'string'
        || serialized.instanceId.length === 0
        || typeof serialized.name !== 'string') {
        throw new Error('Remote force snapshot is missing required canonical persistence fields');
    }
    if (serialized.type === GameSystem.ALPHA_STRIKE || serialized.version === 1) {
        const sanitized = Sanitizer.sanitize(
            serialized,
            serialized.type === GameSystem.ALPHA_STRIKE
                ? AS_SERIALIZED_FORCE_SCHEMA
                : CBT_SERIALIZED_FORCE_SCHEMA as any,
        ) as unknown as JsonValue;
        if (serialized.version === 1
            && sanitized !== null
            && typeof sanitized === 'object'
            && !Array.isArray(sanitized)) {
            sanitized['version'] = 1;
        }
        const projectToSourceShape = (source: JsonValue, canonical: JsonValue): JsonValue => {
            if (Array.isArray(source)) {
                if (!Array.isArray(canonical)) return canonical;
                return canonical.map((entry, index) => projectToSourceShape(
                    source[index] as JsonValue,
                    entry,
                ));
            }
            if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
                if (canonical === null || typeof canonical !== 'object' || Array.isArray(canonical)) {
                    return canonical;
                }
                const result: Record<string, JsonValue> = {};
                for (const [key, sourceValue] of Object.entries(source)) {
                    if (Object.prototype.hasOwnProperty.call(canonical, key)) {
                        result[key] = projectToSourceShape(
                            sourceValue,
                            (canonical as Record<string, JsonValue>)[key],
                        );
                    }
                }
                return result;
            }
            return canonical;
        };
        const source = cloneAsJson(serialized);
        if (!jsonValuesEqual(
            source,
            projectToSourceShape(source, sanitized),
        )) {
            throw new Error('Remote force snapshot is not in canonical persisted form');
        }
    }
    if (serialized.note !== undefined
        && (serialized.note.length === 0
            || serialized.note.length > FORCE_NOTE_MAX_LENGTH)) {
        throw new Error('Remote force snapshot note is not in canonical persisted form');
    }
    if (serialized.tags !== undefined) {
        const canonicalTags = sanitizeForceTags(serialized.tags);
        if (canonicalTags.length === 0
            || !jsonValuesEqual(
                cloneAsJson(serialized.tags),
                cloneAsJson(canonicalTags),
            )) {
            throw new Error('Remote force snapshot tags are not in canonical persisted form');
        }
    }
}

/**
 * Schema validity is weaker than persistence-writer canonicality: the schema
 * accepts explicit empty/false compatibility values that the Force writer
 * deliberately omits, and it accepts empty groups that the writer removes.
 * Compare transport-owned metadata against the detached owner's writer.
 * The strict V2 codec validates the CBT envelope separately.
 */
function assertCanonicalRemoteWriterProjection(serialized: SerializedForce, force: Force): void {
    if (serialized.type === GameSystem.CLASSIC && serialized.cbt === undefined) return;
    const canonical = cloneAsJson(force.serialize()) as Record<string, JsonValue>;
    const supplied = cloneAsJson(serialized) as Record<string, JsonValue>;
    delete canonical['owned'];
    delete canonical['cbt'];
    delete supplied['owned'];
    delete supplied['cbt'];

    if (!jsonValuesEqual(supplied, canonical)) {
        throw new Error('Remote force snapshot disagrees with the canonical persistence writer');
    }
}

/** Rejects identity ambiguity before any remote Force object is constructed. */
function assertStrictRemoteSerializedTopology(serialized: SerializedForce): void {
    if (serialized.type === GameSystem.CLASSIC && serialized.cbt !== undefined) {
        if (serialized.groups !== undefined || serialized.c3Networks !== undefined) {
            throw new Error('A direct CBT V2 force cannot contain V1 groups or C3 networks');
        }
        return;
    }
    if (!Array.isArray(serialized.groups)) {
        throw new Error('Remote force snapshot is missing its groups array');
    }
    const groupIds = new Set<string>();
    const unitIds = new Set<string>();
    for (const [groupIndex, group] of serialized.groups.entries()) {
        if (group === null || typeof group !== 'object' || Array.isArray(group)) {
            throw new Error(`Remote force snapshot group ${groupIndex} is malformed`);
        }
        const groupId = requireDurableRemoteId(group.id, `durable group ID at index ${groupIndex}`);
        if (groupIds.has(groupId)) {
            throw new Error(`Remote force snapshot has duplicate durable group ID: ${groupId}`);
        }
        groupIds.add(groupId);
        if (!Array.isArray(group.units)) {
            throw new Error(`Remote force snapshot group ${groupId} has no units array`);
        }
        for (const [unitIndex, unit] of group.units.entries()) {
            if (unit === null || typeof unit !== 'object' || Array.isArray(unit)) {
                throw new Error(`Remote force snapshot unit ${groupId}:${unitIndex} is malformed`);
            }
            const unitId = requireDurableRemoteId(unit.id, `durable unit ID at ${groupId}:${unitIndex}`);
            if (unitIds.has(unitId)) {
                throw new Error(`Remote force snapshot has duplicate durable unit ID: ${unitId}`);
            }
            unitIds.add(unitId);
        }
    }
}

/**
 * A deserializer may omit a row only when the Force retained that exact row as
 * a deferred bridge descriptor. Ordinary setup/constructor failures are never
 * allowed to silently shrink remotely authoritative state.
 */
function assertStrictRemoteForceMaterialization(serialized: SerializedForce, force: Force): void {
    if (serialized.cbt !== undefined) {
        if (!(force instanceof CBTForce)) {
            throw new Error('A direct CBT V2 record materialized the wrong force type');
        }
        const roster = force.queryCanonicalRoster();
        if (roster.kind !== 'available'
            || roster.snapshot.structural.members.length !== serialized.cbt.units.length) {
            throw new Error('Direct CBT V2 materialization changed the durable roster');
        }
        return;
    }
    const sourceGroups = serialized.groups!;
    const sourceGroupIds = new Set(sourceGroups.map(group => group.id));
    const sourceUnits = new Map<string, StrictRemoteUnitRow>();
    for (const group of sourceGroups) {
        for (const unit of group.units) {
            sourceUnits.set(unit.id, Object.freeze({
                groupId: group.id,
                payload: cloneAsJson(unit),
            }));
        }
    }

    const materializedGroups = force.groups();
    if (materializedGroups.length !== sourceGroups.length) {
        throw new Error('Remote force deserialization changed the durable group roster');
    }
    const materializedGroupIds = new Set<string>();
    const materializedUnitIds = new Set<string>();
    for (const [groupIndex, group] of materializedGroups.entries()) {
        const groupId = requireDurableRemoteId(group.id, 'materialized durable group ID');
        if (materializedGroupIds.has(groupId)
            || !sourceGroupIds.has(groupId)
            || sourceGroups[groupIndex]?.id !== groupId) {
            throw new Error(`Remote force deserialization produced an ambiguous group ID: ${groupId}`);
        }
        materializedGroupIds.add(groupId);
        for (const unit of group.units()) {
            const unitId = requireDurableRemoteId(unit.id, `materialized durable unit ID in ${groupId}`);
            const source = sourceUnits.get(unitId);
            if (!source || source.groupId !== groupId || materializedUnitIds.has(unitId)) {
                throw new Error(`Remote force deserialization changed durable unit ownership: ${unitId}`);
            }
            materializedUnitIds.add(unitId);
        }
    }

    const deferredUnitIds = new Set<string>();
    const retainedOnlyDeferredUnitIds = new Set<string>();
    for (const descriptor of force.getDeferredUnitDescriptors()) {
        const payload = descriptor.sourcePayload;
        if (payload === undefined || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('Remote force has a deferred unit without an exact retained payload');
        }
        const unitId = requireDurableRemoteId(payload['id'], 'deferred durable unit ID');
        const source = sourceUnits.get(unitId);
        if (source === undefined) {
            if (materializedUnitIds.has(unitId) || retainedOnlyDeferredUnitIds.has(unitId)) {
                throw new Error(`Remote force has a duplicate retained durable unit ID: ${unitId}`);
            }
            retainedOnlyDeferredUnitIds.add(unitId);
            continue;
        }
        if (materializedUnitIds.has(unitId)
            || deferredUnitIds.has(unitId)
            || !jsonValuesEqual(source.payload, payload)) {
            throw new Error(`Remote force has an ambiguous deferred unit row: ${unitId}`);
        }
        deferredUnitIds.add(unitId);
    }

    for (const unitId of sourceUnits.keys()) {
        if (!materializedUnitIds.has(unitId) && !deferredUnitIds.has(unitId)) {
            throw new Error(`Remote force deserialization skipped a non-deferred unit row: ${unitId}`);
        }
    }
    if (materializedUnitIds.size + deferredUnitIds.size !== sourceUnits.size) {
        throw new Error('Remote force deserialization changed the durable unit roster');
    }
    for (const [groupIndex, group] of materializedGroups.entries()) {
        const expectedVisibleUnitIds = sourceGroups[groupIndex].units
            .map(unit => unit.id)
            .filter(unitId => !deferredUnitIds.has(unitId));
        const actualVisibleUnitIds = group.units().map(unit => unit.id);
        if (expectedVisibleUnitIds.length !== actualVisibleUnitIds.length
            || expectedVisibleUnitIds.some((unitId, index) => actualVisibleUnitIds[index] !== unitId)) {
            throw new Error(`Remote force deserialization reordered durable units in group ${group.id}`);
        }
    }
}

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private logger = inject(LoggerService);
    private broadcast?: BroadcastChannel;
    private broadcastHandler?: (ev: MessageEvent) => void;
    private injector = inject(Injector);
    private dbService = inject(DbService);
    private wsService = inject(WsService);
    private userStateService = inject(UserStateService);
    private tagsService = inject(TagsService);
    private publicTagsService = inject(PublicTagsService);
    private destroyRef = inject(DestroyRef);
    private unitSearchIndexService = inject(UnitSearchIndexService);
    private unitRuntimeService = inject(UnitRuntimeService);
    private unitsCatalog = inject(UnitsCatalogService);
    private presentationCatalogs = inject(PresentationCatalogSyncService);
    private equipmentCatalog = inject(EquipmentCatalogService);
    private erasCatalog = inject(ErasCatalogService);
    private factionsCatalog = inject(FactionsCatalogService);
    private megaMekAvailabilityCatalog = inject(MegaMekAvailabilityCatalogService);
    private megaMekFactionsCatalog = inject(MegaMekFactionsCatalogService);
    private megaMekRulesetsCatalog = inject(MegaMekRulesetsCatalogService);
    private quirksCatalog = inject(QuirksCatalogService);
    private sarnaPageTitlesCatalog = inject(SarnaPageTitlesCatalogService);
    private sourcebooksCatalog = inject(SourcebooksCatalogService);
    private forceNameWordsCatalog = inject(ForceNameWordsCatalogService);
    private catalogDownloadTracker = inject(CatalogDownloadTrackerService);

    isDataReady = signal(false);
    public readonly isDownloading = this.catalogDownloadTracker.isDownloading;
    public readonly unitCatalogState = this.unitsCatalog.coreState;
    public readonly runtimeCatalogProgress = signal<RuntimeCatalogProgressState>({ status: 'idle' });
    public readonly auxiliaryCatalogProgress = signal<RuntimeCatalogProgressState>({ status: 'idle' });
    /** Exact gate: worker/search derivatives belong to the currently committed summary revision. */
    public readonly runtimeSearchIndexesReady = signal(false);
    public isCloudForceLoading = signal(false);

    /** Emits when a cloud save is rejected (not_owner) and the force needs adoption. */
    public forceNeedsAdoption = new Subject<Force>();

    /** One authority generation fences local preparation, queued CAS, and remote adoption. */
    private readonly forceAuthorityGeneration = new Map<string, number>();
    private readonly activeForceAuthority = new Map<string, Force>();
    /** Fresh unsaved owners have no durable ID yet and are claimed by object identity. */
    private readonly provisionalForceAuthority = new WeakSet<Force>();
    /** Set only after this exact owner completes a local durable write. */
    private readonly durableForceIdentity = new WeakMap<Force, string>();
    /** Exact ID key under which an owner was registered; public signal drift cannot rekey it. */
    private readonly registeredForceIdentity = new WeakMap<Force, string>();
    /** Ownerless raw side effects block synchronous owner activation until settled. */
    private readonly ownerlessForceOperationLeases = new Map<string, Set<OwnerlessForceOperationLease>>();
    /** Submission-order barrier reserved before ownerless validation can await. */
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
    /** Whole local save preparations, registered before their first await. */
    private readonly forceLocalPersistenceOperations = new Map<string, Set<Promise<void>>>();
    /** Latest submitted local operation outcome, retained after promise cleanup. */
    private readonly forceLocalPersistenceOutcome = new Map<string, ForceLocalPersistenceOutcome>();
    private readonly forceLocalPersistenceSequence = new Map<string, number>();
    /** Save fences stay registered through local preparation and any cloud acknowledgement. */
    private readonly forceSaveFences = new Map<string, Set<ForceSaveFence>>();
    private pendingForceSavePreparations = 0;
    private readonly forceAutosaves = new WeakMap<Force, {
        scheduled: boolean;
        running: boolean;
        dirty: boolean;
    }>();
    private pendingForceAutosaves = 0;

    /** packName -> Set<chassis|as.TP|omni> for force pack membership checks */
    private forcePackToLookupKey: Map<string, Set<string>> | null = null;
    /** chassis|as.TP|omni -> sorted pack names[] for reverse lookups */
    private lookupKeyToForcePacks: Map<string, string[]> | null = null;
    private cachedForceTagsByInstanceId = new Map<string, string[]>();

    public tagsVersion = signal(0);
    public searchCorpusVersion = signal(0);
    public megaMekAvailabilityVersion = signal(0);
    public sarnaPageTitlesVersion = signal(0);
    private appliedUnitCatalogRevision = 0;
    private queuedUnitCatalogRevision = 0;
    private unitCatalogSettlement: Promise<void> = Promise.resolve();
    private readonly dataReadyWaiters = new Set<() => void>();
    private auxiliaryStartupSettlement: Promise<void> = Promise.resolve();
    private localSearchCatalogHydration: Promise<void> = Promise.resolve();
    private initialization?: Promise<void>;
    private destroyed = false;
    private catalogActivationFinalizing = false;
    private hasLatestTagDataSnapshot = false;
    private latestTagDataSnapshot: TagData | null = null;
    private bufferedTagRefresh?: {
        readonly data: TagData | null;
        readonly searchIndexChanged: boolean;
    };
    private bufferedPublicTagRefresh = false;
    /** Atomic derived membership projection paired with the visible Unit[] activation. */
    private activeEras?: Era[];
    private activeFactions?: Faction[];


    constructor() {
        effect(() => {
            const pending = this.unitsCatalog.pendingActivation();
            if (!pending || pending.revision <= this.appliedUnitCatalogRevision) return;
            this.queueUnitCatalogRevision(pending.revision);
        });
        this.destroyRef.onDestroy(() => { this.destroyed = true; });
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                this.broadcast = new BroadcastChannel('mekbay-updates');
                this.broadcastHandler = (ev: MessageEvent) => {
                    void this.handleStoreUpdate(ev.data as any);
                };
                this.broadcast.addEventListener('message', this.broadcastHandler);
                inject(DestroyRef).onDestroy(() => {
                    if (this.broadcast && this.broadcastHandler) {
                        this.broadcast.removeEventListener('message', this.broadcastHandler);
                    }
                    this.broadcast?.close();
                });
            };
        } catch { /* best-effort */ }
        if (typeof window !== 'undefined') {
            const flushOnUnload = () => {
                try {
                    this.flushAllPendingSavesOnUnload();
                } catch { /* best-effort */ }
            };
            const onVisibility = () => {
                if (document.visibilityState === 'hidden') {
                    flushOnUnload();
                }
            };
            const onOnline = () => {
                // Small delay to let WS reconnect first
                setTimeout(() => this.tagsService.syncFromCloud(), 1000);
            };
            
            window.addEventListener('beforeunload', flushOnUnload);
            window.addEventListener('pagehide', flushOnUnload);
            document.addEventListener('visibilitychange', onVisibility);
            window.addEventListener('online', onOnline);
            
            this.destroyRef.onDestroy(() => {
                window.removeEventListener('beforeunload', flushOnUnload);
                window.removeEventListener('pagehide', flushOnUnload);
                document.removeEventListener('visibilitychange', onVisibility);
                window.removeEventListener('online', onOnline);
                this.broadcast?.close();
                // Clear pending debounced saves and reject their promises to prevent memory leaks
                for (const [, entry] of this.saveForceCloudDebounce) {
                    clearTimeout(entry.timeout);
                    // Reject pending promises to notify callers
                    for (const { reject } of entry.resolvers) {
                        reject(new Error('Service destroyed'));
                    }
                }
                this.saveForceCloudDebounce.clear();
            });
        }

        // Wire up TagsService callbacks
        this.tagsService.setRefreshUnitsCallback((tagData, options) => {
            this.applyTagDataToUnits(tagData, options);
        });
        this.tagsService.setNotifyStoreUpdatedCallback((options) => {
            this.notifyStoreUpdated('update', 'tags', options);
        });

        // Register WS message handlers for tag sync (handled by TagsService)
        this.tagsService.registerWsHandlers();

        // Wire up PublicTagsService callback
        this.publicTagsService.setRefreshUnitsCallback(() => {
            this.applyPublicTagsToUnits();
        });

        // Initialize PublicTagsService (loads cached tags from IndexedDB)
        this.publicTagsService.initialize();

        // Register WS handlers for public tag sync
        this.publicTagsService.registerWsHandlers();
    }

    /**
     * Apply tag data to all loaded units.
     * Called by TagsService when tags change.
     * 
     * V3 format: tags = { tagId: { label, units: {unitName: {}}, chassis: {chassisKey: {}} } }
     */
    private applyTagDataToUnits(tagData: TagData | null, options?: { searchIndexChanged?: boolean }): void {
        const searchIndexChanged = options?.searchIndexChanged ?? true;
        this.latestTagDataSnapshot = tagData;
        this.hasLatestTagDataSnapshot = true;
        if (this.catalogActivationFinalizing) {
            this.bufferedTagRefresh = { data: tagData, searchIndexChanged };
            return;
        }
        this.unitRuntimeService.applyTagDataToUnits(this.getUnits(), tagData, { rebuildTagSearchIndex: searchIndexChanged });
        if (searchIndexChanged) {
            this.tagsVersion.update(v => v + 1);
        }
    }

    /**
     * Apply public tags to all loaded units.
     * Called by PublicTagsService when public tags change (import/subscribe/update).
     */
    private applyPublicTagsToUnits(
        units: UnitSummary[] = this.getUnits(),
        options: { readonly rebuildTagSearchIndex?: boolean } = {},
    ): void {
        if (this.catalogActivationFinalizing && units === this.getUnits()) {
            this.bufferedPublicTagRefresh = true;
            return;
        }
        this.unitRuntimeService.applyPublicTagsToUnits(units, options);
        this.tagsVersion.update(v => v + 1);
    }

    /** Flush callbacks that arrived while the fenced DB pointer was finalizing. */
    private flushBufferedTagRefresh(): void {
        const searchIndexChanged = this.applyBufferedTagRefreshToUnits(this.getUnits());
        if (!searchIndexChanged) return;
        this.unitSearchIndexService.rebuildTagSearchIndex(this.getUnits());
        this.tagsVersion.update(version => version + 1);
        this.bumpSearchCorpusVersion();
    }

    /** Applies buffered tag state to one exact Unit[] without publishing an index. */
    private applyBufferedTagRefreshToUnits(units: UnitSummary[]): boolean {
        const local = this.bufferedTagRefresh;
        const refreshPublic = this.bufferedPublicTagRefresh;
        this.bufferedTagRefresh = undefined;
        this.bufferedPublicTagRefresh = false;
        if (!local && !refreshPublic) return false;
        if (local) {
            this.unitRuntimeService.applyPreparedTagDataToUnits(
                units,
                local.data,
                { rebuildTagSearchIndex: false },
            );
        }
        if (refreshPublic) {
            this.unitRuntimeService.applyPublicTagsToUnits(units, { rebuildTagSearchIndex: false });
        }
        return Boolean(local?.searchIndexChanged || refreshPublic);
    }

    public notifyStoreUpdated(action: BroadcastPayload['action'], store?: string, meta?: any) {
        if (!this.broadcast) return;
        const payload: any = { source: 'mekbay', action, store, meta };
        try {
            this.broadcast?.postMessage(payload);
        } catch { /* best-effort */ }
    }

    private async handleStoreUpdate(msg: BroadcastPayload): Promise<void> {
        try {
            if (!msg || msg.source !== 'mekbay') return;
            const action = msg.action;
            const context = msg.context;
            if (action === 'update' && context === 'tags') {
                // Reload tag data from TagsService and apply to units
                const tagData = await this.tagsService.getTagData();
                this.applyTagDataToUnits(tagData, msg.meta);
            }
        } catch (err) {
            this.logger.error('Error handling store update broadcast: ' + err);
        }
    }

    public getUnits(): UnitSummary[] {
        return this.unitsCatalog.getUnits();
    }

    public getUnitSummaries(): readonly UnitSummary[] {
        return this.unitsCatalog.getCoreSummaries();
    }

    public getUnitByName(name: string): UnitSummary | undefined {
        return this.unitRuntimeService.getUnitByName(name);
    }

    public getUnitByIdentity(provider: UnitProviderId, uuid: string): UnitSummary | undefined {
        return this.unitRuntimeService.getUnitByIdentity(provider, uuid);
    }

    public getUnitByPublicationArtifact(
        provider: UnitProviderId,
        uuid: string,
        documentRevision: string,
        nativeSourceHash?: string,
    ): UnitSummary | undefined {
        return this.unitRuntimeService.getUnitByPublicationArtifact(
            provider,
            uuid,
            documentRevision,
            nativeSourceHash,
        );
    }

    public getUnitSummaryByIdentity(provider: UnitProviderId, uuid: string): UnitSummary | undefined {
        return this.unitsCatalog.getCoreSummaryByIdentity(provider, uuid);
    }

    public readNativeUnitSource(provider: UnitProviderId, uuid: string): Promise<StoredCoreContent | undefined> {
        return this.unitsCatalog.readNativeUnitSource(provider, uuid);
    }

    public getSavedEntityIdentity(unit: UnitSummary): SavedEntityIdentity | undefined {
        return this.unitRuntimeService.getSavedEntityIdentity(unit);
    }

    /** UUID/provider is authoritative; name is accepted only for an unversioned unique legacy match. */
    public resolveSerializedUnit(data: SerializedUnit): Extract<UnitReferenceResolution, { readonly kind: 'resolved' }> {
        const resolution = this.unitRuntimeService.resolveUnitReference(
            data,
            this.isDataReady(),
        );
        if (resolution.kind === 'deferred') {
            throw new DeferredUnitResolutionError(resolution.descriptor);
        }
        return resolution;
    }

    private resolveLegacyUnitIdentity(rawUnit: Readonly<Record<string, unknown>>): PersistedUnitIdentity {
        const unitName = typeof rawUnit['unit'] === 'string' ? rawUnit['unit'] : '';
        return this.unitRuntimeService.resolvePersistedUnitIdentity({
            unit: unitName,
            chassis: typeof rawUnit['chassis'] === 'string' ? rawUnit['chassis'] : undefined,
            model: typeof rawUnit['model'] === 'string' ? rawUnit['model'] : undefined,
            type: typeof rawUnit['type'] === 'string' ? rawUnit['type'] : undefined,
            entityIdentity: rawUnit['entityIdentity'] as SavedEntityIdentity | undefined,
        }, this.isDataReady());
    }

    public getEquipmentRegistry(): EquipmentRegistry {
        return this.equipmentCatalog.getEquipmentRegistry();
    }

    /** Resolves an equipment internal name or alias using the canonical registry. */
    public findEquipment(name: string) {
        return this.getEquipmentRegistry().findEquipment(name) ?? undefined;
    }

    /** Links equipment only on an explicitly detached mechanics/display unit. */
    public linkEquipmentToUnit(unit: UnitSummary): void {
        this.unitRuntimeService.linkEquipmentToUnit(unit, this.getEquipmentRegistry());
    }

    public getFactions(): Faction[] {
        return this.activeFactions ?? this.factionsCatalog.getFactions();
    }

    public getFactionByName(name: string): Faction | undefined {
        const canonical = this.factionsCatalog.getFactionByName(name);
        return canonical === undefined
            ? undefined
            : this.getFactions().find(faction => faction.id === canonical.id);
    }

    public getFactionById(id: FactionId): Faction | undefined {
        return this.getFactions().find(faction => faction.id === id);
    }

    public getEras(): Era[] {
        return this.activeEras ?? this.erasCatalog.getEras();
    }

    public getEraByName(name: string): Era | undefined {
        return this.getEras().find(era => era.name === name);
    }

    public getEraById(id: number): Era | undefined {
        return this.getEras().find(era => era.id === id);
    }

    public getQuirkByName(name: string): Quirk | undefined {
        return this.quirksCatalog.getQuirkByName(name);
    }

    public getQuirkByKey(key: string): Quirk | undefined {
        return this.quirksCatalog.getQuirkByKey(key);
    }

    public getSourcebookByAbbrev(abbrev: string): Sourcebook | undefined {
        return this.sourcebooksCatalog.getSourcebookByAbbrev(abbrev);
    }

    /**
     * Get the display title for a sourcebook abbreviation.
     * Falls back to the abbreviation itself if not found.
     */
    public getSourcebookTitle(abbrev: string): string {
        return this.sourcebooksCatalog.getSourcebookTitle(abbrev);
    }

    public getSarnaPageTitleForUnit(unit: SarnaLookupUnit | null | undefined): string | undefined {
        return this.sarnaPageTitlesCatalog.getPageTitleForUnit(unit);
    }

    public getForceNameWords(): ForceNameWords {
        return this.forceNameWordsCatalog.getWords();
    }

    public getMegaMekFactions(): MegaMekFactions {
        return this.megaMekFactionsCatalog.getFactions();
    }

    public getMegaMekFactionByKey(key: string): MegaMekFactionRecord | undefined {
        return this.megaMekFactionsCatalog.getFactionByKey(key);
    }

    public getMegaMekFactionsByMulId(mulId: number): MegaMekFactionRecord[] {
        return this.megaMekFactionsCatalog.getFactionsByMulId(mulId);
    }

    public getMegaMekRulesets(): readonly MegaMekRulesetRecord[] {
        return this.megaMekRulesetsCatalog.getRulesets();
    }

    public getMegaMekRulesetByFactionKey(factionKey: string): MegaMekRulesetRecord | undefined {
        return this.megaMekRulesetsCatalog.getRulesetByFactionKey(factionKey);
    }

    public getMegaMekRulesetsByMulFactionId(mulFactionId: number): MegaMekRulesetRecord[] {
        return this.getMegaMekFactionsByMulId(mulFactionId)
            .map((faction) => this.megaMekRulesetsCatalog.getRulesetByFactionKey(faction.id))
            .filter((ruleset): ruleset is MegaMekRulesetRecord => ruleset !== undefined);
    }

    public getMegaMekAvailabilityRecords(): readonly MegaMekWeightedAvailabilityRecord[] {
        return this.megaMekAvailabilityCatalog.getRecords();
    }

    public getMegaMekAvailabilityRecordForUnit(unit: Pick<UnitSummary, 'name'>): MegaMekWeightedAvailabilityRecord | undefined {
        return this.megaMekAvailabilityCatalog.getRecordForUnit(unit);
    }

    private bumpSearchCorpusVersion(): void {
        this.searchCorpusVersion.update(version => version + 1);
    }

    private bumpMegaMekAvailabilityVersion(): void {
        this.megaMekAvailabilityVersion.update(version => version + 1);
    }

    private bumpSarnaPageTitlesVersion(): void {
        this.sarnaPageTitlesVersion.update(version => version + 1);
    }

    private invalidateForcePackCaches(): void {
        this.forcePackToLookupKey = null;
        this.lookupKeyToForcePacks = null;
    }

    private rebuildUnitCatalogIndexes(units: UnitSummary[]): void {
        this.invalidateForcePackCaches();
        this.unitRuntimeService.preprocessUnits(units);
    }

    public getIndexedUnitIds(filterKey: string, value: string): ReadonlySet<string> | undefined {
        return this.unitSearchIndexService.getIndexedUnitIds(filterKey, value);
    }

    public getIndexedFilterValues(filterKey: string): string[] {
        return this.unitSearchIndexService.getIndexedFilterValues(filterKey);
    }

    public getUnitSearchIdentityKeysByName(unitName: string): readonly string[] {
        return this.unitSearchIndexService.getUnitIdentityKeysByName(unitName);
    }

    public getSearchWorkerIndexSnapshot(): UnitSearchWorkerIndexSnapshot {
        return this.unitSearchIndexService.getSearchWorkerIndexSnapshot();
    }

    public getSearchWorkerFactionEraSnapshot(): UnitSearchWorkerFactionEraSnapshot {
        return this.unitSearchIndexService.getSearchWorkerFactionEraSnapshot();
    }

    public getDropdownOptionUniverse(filterKey: string): Array<{ name: string; img?: string }> {
        return this.unitSearchIndexService.getDropdownOptionUniverse(filterKey);
    }

    public getIndexedComponentUnitCounts(name: string): ReadonlyMap<string, number> | undefined {
        return this.unitSearchIndexService.getIndexedComponentUnitCounts(name);
    }

    public refreshSearchCorpus(): void {
        this.runtimeSearchIndexesReady.set(false);
        this.rebuildUnitCatalogIndexes(this.getUnits());
        this.postprocessData();
        this.runtimeSearchIndexesReady.set(true);
        this.bumpSearchCorpusVersion();
    }

    /** Test/diagnostic seam for the serialized hot-reload settlement queue. */
    public whenUnitCatalogSettled(): Promise<void> {
        return this.unitCatalogSettlement;
    }

    private queueUnitCatalogRevision(revision: number): void {
        if (revision <= this.appliedUnitCatalogRevision
            || revision <= this.queuedUnitCatalogRevision) {
            return;
        }
        this.queuedUnitCatalogRevision = revision;
        this.unitCatalogSettlement = this.unitCatalogSettlement
            .catch(() => undefined)
            .then(() => this.applyUnitCatalogRevision(revision));
    }

    private async applyUnitCatalogRevision(revision: number): Promise<void> {
        const pending = this.readExactPendingActivation(revision);
        if (!pending || revision <= this.appliedUnitCatalogRevision) return;
        const units = pending.snapshot.units;
        const startedAt = Date.now();
        const indexPreparationStartedAt = Date.now();
        let backgroundYieldMs = 0;
        const yieldForResponsiveness = async (): Promise<void> => {
            const yieldStartedAt = Date.now();
            await this.yieldBackgroundCatalogWork();
            backgroundYieldMs += Math.max(0, Date.now() - yieldStartedAt);
        };
        let completed = false;
        this.logger.info(
            `[Background:runtime-unit-catalog] Started revision ${revision} for ${units.length.toLocaleString()} stored summaries.`,
        );

        this.catalogActivationFinalizing = true;
        let summaryCommitted = false;
        try {
            const eras = pending.core.dependencies.eras.eras;
            const factions = pending.core.dependencies.factions.factions;
            const equipmentRegistry = pending.core.dependencies.equipment.registry;
            const membershipState = this.cloneEraFactionMembershipState(eras, factions);

            const runtimePreparationStartedAt = Date.now();
            const runtimeCandidate: PreparedUnitRuntimeCatalog =
                this.unitRuntimeService.prepareRuntimeCatalog(units);
            const runtimePreparationMs = Math.max(0, Date.now() - runtimePreparationStartedAt);

            this.setRuntimeCatalogProgress({
                status: 'running',
                completed: 0,
                total: 5,
                detail: `Preparing indexes from ${units.length.toLocaleString()} stored unit summaries`,
            });

            // Availability is a separate saved catalog. Its cache-only hydration
            // starts alongside the core summary read and must settle before the
            // first search corpus is published; remote revalidation stays in the
            // auxiliary background phase.
            const localCatalogHydrationStartedAt = Date.now();
            await this.localSearchCatalogHydration;
            const localCatalogHydrationMs = Math.max(0, Date.now() - localCatalogHydrationStartedAt);
            await yieldForResponsiveness();
            if (revision < this.queuedUnitCatalogRevision) return;
            const tagPreparationStartedAt = Date.now();
            const hydratedTagData = await this.unitRuntimeService.loadUnitTags(
                units,
                { rebuildTagSearchIndex: false },
            );
            if (revision < this.queuedUnitCatalogRevision) return;
            this.unitRuntimeService.applyPreparedTagDataToUnits(
                units,
                this.hasLatestTagDataSnapshot ? this.latestTagDataSnapshot : hydratedTagData,
                { rebuildTagSearchIndex: false },
            );
            const tagPreparationMs = Math.max(0, Date.now() - tagPreparationStartedAt);
            this.setRuntimeCatalogProgress({
                status: 'running', completed: 1, total: 5,
                detail: 'Loaded personal unit tags',
            });

            await yieldForResponsiveness();
            if (revision < this.queuedUnitCatalogRevision) return;
            const summaryFilterPreparationStartedAt = Date.now();
            this.applyNoneFactionMemberships(units, membershipState.eras, membershipState.factions);
            this.unitRuntimeService.postprocessUnits(units, membershipState.eras, { loadTags: false });
            this.unitRuntimeService.applyPublicTagsToUnits(units, { rebuildTagSearchIndex: false });
            this.applyBufferedTagRefreshToUnits(units);
            const summaryFilterPreparationMs = Math.max(0, Date.now() - summaryFilterPreparationStartedAt);
            this.setRuntimeCatalogProgress({
                status: 'running', completed: 2, total: 5,
                detail: 'Prepared summary filters and availability memberships',
            });

            await yieldForResponsiveness();
            if (revision < this.queuedUnitCatalogRevision) return;
            const extinctFaction = membershipState.factions.find(
                faction => faction.id === MULFACTION_EXTINCT,
            );
            const searchIndexPreparationStartedAt = Date.now();
            const searchCandidate: PreparedUnitSearchIndexes =
                this.unitSearchIndexService.prepareCatalogIndexes(
                    units,
                    membershipState.eras,
                    membershipState.factions,
                    extinctFaction,
                    equipmentRegistry,
                );
            const searchIndexPreparationMs = Math.max(0, Date.now() - searchIndexPreparationStartedAt);
            this.setRuntimeCatalogProgress({
                status: 'running', completed: 3, total: 5,
                detail: `Indexed ${units.length.toLocaleString()} unit summaries`,
            });

            this.setRuntimeCatalogProgress({
                status: 'running', completed: 4, total: 5,
                detail: 'Finalizing the shared catalog publication',
            });

            const publicationStartedAt = Date.now();
            if (!this.readExactPendingActivation(revision, pending)) return;
            if (!await this.unitsCatalog.finalizePendingActivation(revision)
                || !this.readExactPendingActivation(revision, pending)) return;
            const committed = this.unitsCatalog.commitPendingActivation(revision);
            if (!committed) {
                throw new Error('The finalized application catalog activation was superseded before commit');
            }
            summaryCommitted = true;

            // One synchronous publication boundary: consumers can never see a
            // new summary paired with old memberships, derived fields, or indexes.
            this.unitRuntimeService.commitPreparedRuntimeCatalog(runtimeCandidate);
            this.activeEras = membershipState.eras;
            this.activeFactions = membershipState.factions;
            this.unitSearchIndexService.commitPreparedCatalogIndexes(searchCandidate);
            this.appliedUnitCatalogRevision = committed.revision;
            this.invalidateForcePackCaches();
            this.runtimeSearchIndexesReady.set(true);
            this.tagsVersion.update(version => version + 1);
            this.bumpSearchCorpusVersion();
            this.markDataReady();

            this.setRuntimeCatalogProgress({
                status: 'running', completed: 5, total: 5,
                detail: 'Unit indexes and shared catalog publication are ready',
            });
            const publicationMs = Math.max(0, Date.now() - publicationStartedAt);
            const indexPreparationMs = Math.max(0, Date.now() - indexPreparationStartedAt);
            this.logger.info(
                `[Background:runtime-unit-catalog] Prepared unit indexes in ${indexPreparationMs} ms `
                + `[runtime=${runtimePreparationMs}ms, local-catalog=${localCatalogHydrationMs}ms, tags=${tagPreparationMs}ms, `
                + `summary-filters=${summaryFilterPreparationMs}ms, search-indexes=${searchIndexPreparationMs}ms, `
                + `unit-derivatives=${searchCandidate.preparationTimings.unitDerivativesMs}ms, `
                + `filter-indexes=${searchCandidate.preparationTimings.filterIndexesMs}ms, `
                + `component-indexes=${searchCandidate.preparationTimings.componentIndexesMs}ms, `
                + `index-keys=${searchCandidate.indexStats.filterKeys.toLocaleString()}, `
                + `index-values=${searchCandidate.indexStats.filterValues.toLocaleString()}, `
                + `memberships=${searchCandidate.indexStats.memberships.toLocaleString()}, `
                + `publication=${publicationMs}ms, yielding=${backgroundYieldMs}ms].`,
            );
            this.logger.info(
                `[Background:runtime-unit-catalog] Search-index phases `
                + `[identity-map=${searchCandidate.preparationTimings.identityMapMs}ms, `
                + `unit-filters=${searchCandidate.preparationTimings.unitFiltersMs}ms, `
                + `component-indexes=${searchCandidate.preparationTimings.componentIndexesMs}ms, `
                + `era-memberships=${searchCandidate.preparationTimings.eraMembershipsMs}ms, `
                + `faction-memberships=${searchCandidate.preparationTimings.factionMembershipsMs}ms, `
                + `finalization=${searchCandidate.preparationTimings.finalizationMs}ms].`,
            );
            try {
                await this.unitsCatalog.acknowledgeCatalogRevisionApplied(committed.revision);
            } catch (error) {
                this.logger.warn(`Catalog maintenance acknowledgement failed: ${this.describeError(error)}`);
            }
            await this.yieldBackgroundCatalogWork();
            this.setRuntimeCatalogProgress({ status: 'idle' });
            completed = true;
            this.logger.info(
                `[Background:runtime-unit-catalog] Finished revision ${revision} in ${Math.max(0, Date.now() - startedAt)} ms.`,
            );
        } catch (error) {
            if (!summaryCommitted && this.readExactPendingActivation(revision, pending)) {
                this.unitsCatalog.rejectPendingActivation(revision, error);
                this.setRuntimeCatalogProgress({
                    status: 'error',
                    detail: this.describeError(error),
                });
                this.logger.error(`Failed to prepare application catalog activation: ${this.describeError(error)}`);
            } else if (summaryCommitted) {
                this.setRuntimeCatalogProgress({
                    status: 'error',
                    detail: this.describeError(error),
                });
                this.logger.error(`Failed to build background unit indexes: ${this.describeError(error)}`);
            }
        } finally {
            if (!completed && revision < this.queuedUnitCatalogRevision) {
                this.logger.info(
                    `[Background:runtime-unit-catalog] Superseded revision ${revision} after ${Math.max(0, Date.now() - startedAt)} ms.`,
                );
            }
            if (this.catalogActivationFinalizing) {
                this.catalogActivationFinalizing = false;
                try {
                    this.flushBufferedTagRefresh();
                } catch (error) {
                    this.logger.warn(`Buffered tag refresh failed: ${this.describeError(error)}`);
                }
            }
        }
    }

    private yieldBackgroundCatalogWork(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    private setRuntimeCatalogProgress(progress: RuntimeCatalogProgressState): void {
        this.runtimeCatalogProgress.set(progress);
    }

    private setAuxiliaryCatalogProgress(progress: RuntimeCatalogProgressState): void {
        this.auxiliaryCatalogProgress.set(progress);
    }

    private readExactPendingActivation(
        revision: number,
        expected?: PreparedUnitsCatalogActivation,
    ): PreparedUnitsCatalogActivation | undefined {
        if (this.destroyed) return undefined;
        const pending = this.unitsCatalog.pendingActivation();
        if (!pending || pending.revision !== revision || (expected && pending !== expected)) return undefined;
        return pending;
    }

    private rebuildTagSearchIndex(): void {
        this.unitSearchIndexService.rebuildTagSearchIndex(this.getUnits());
    }

    public getUnitSubtypeMaxStats(subtype: string): MinMaxStatsRange {
        return this.unitSearchIndexService.getUnitSubtypeMaxStats(subtype);
    }

    public getASUnitTypeMaxStats(asUnitType: string): MinMaxStatsRange {
        return this.unitSearchIndexService.getASUnitTypeMaxStats(asUnitType);
    }

    private postprocessData(): void {
        this.applyNoneFactionMemberships(this.getUnits(), this.getEras(), this.getFactions());
        this.unitRuntimeService.postprocessUnits(this.getUnits(), this.getEras());
        const extinctFaction = this.getFactionById(MULFACTION_EXTINCT);
        this.unitSearchIndexService.rebuildIndexes(
            this.getUnits(),
            this.getEras(),
            this.getFactions(),
            extinctFaction,
            this.getEquipmentRegistry(),
        );
    }

    private applyNoneFactionMemberships(units: readonly UnitSummary[], eras: readonly Era[], factions: readonly Faction[]): void {
        const noneFaction = factions.find(faction => faction.id === MULFACTION_NONE);
        if (!noneFaction) {
            return;
        }

        const factionUnitIds = new Set<number>();
        for (const faction of factions) {
            if (faction.id === MULFACTION_NONE) {
                continue;
            }

            for (const eraUnitIds of Object.values(faction.eras) as Set<number>[]) {
                for (const unitId of eraUnitIds) {
                    factionUnitIds.add(unitId);
                }
            }
        }

        const noneUnits = units.filter((unit) => !factionUnitIds.has(unit.id));

        noneFaction.eras = {};
        for (const era of eras) {
            const noneEraUnitIds = new Set<number>();
            for (const unit of noneUnits) {
                if (!this.isUnitYearValidForEra(unit, era)) {
                    continue;
                }

                noneEraUnitIds.add(unit.id);
                (era.units as Set<number>).add(unit.id);
            }

            if (noneEraUnitIds.size > 0) {
                noneFaction.eras[era.id] = noneEraUnitIds;
                (era.factions as Set<number>).add(MULFACTION_NONE);
            }
        }
    }

    private isUnitYearValidForEra(unit: Pick<UnitSummary, 'year'>, era: Era): boolean {
        const eraEndYear = era.years.to ?? Number.POSITIVE_INFINITY;
        return unit.year < eraEndYear;
    }

    private async checkForUpdate(): Promise<void> {
        await this.unitsCatalog.initialize();
        const pending = this.unitsCatalog.pendingActivation();
        if (pending) this.queueUnitCatalogRevision(pending.revision);
        await this.waitForDataReadyOrCatalogSettlement();
        if (!this.isDataReady()) {
            throw new Error('The application catalog did not commit a complete activation');
        }
    }

    private waitForDataReadyOrCatalogSettlement(): Promise<void> {
        if (this.isDataReady()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error): void => {
                if (settled) return;
                settled = true;
                this.dataReadyWaiters.delete(onReady);
                if (error) reject(error);
                else resolve();
            };
            const onReady = (): void => finish();
            this.dataReadyWaiters.add(onReady);
            void this.whenUnitCatalogSettled().then(() => {
                if (this.isDataReady()) finish();
                else finish(new Error('The application catalog did not commit a complete activation'));
            }, error => finish(error instanceof Error ? error : new Error(this.describeError(error))));
        });
    }

    private markDataReady(): void {
        this.isDataReady.set(true);
        for (const resolve of this.dataReadyWaiters) resolve();
        this.dataReadyWaiters.clear();
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }
        if (typeof error === 'object' && error !== null && 'message' in error) {
            return String(error.message);
        }

        return String(error);
    }

    private initializeCatalog(
        name: string,
        initialize: () => Promise<void>,
        onInitialized?: () => void,
    ): Promise<boolean> {
        return initialize()
            .then(() => {
                onInitialized?.();
                return true;
            })
            .catch((error) => {
                this.logger.error(`Failed to initialize catalog service "${name}": ${this.describeError(error)}`);
                return false;
            });
    }

    private async ensureCatalogGroupInitialized(
        catalogs: readonly { name: string; ensure: () => Promise<boolean> }[],
    ): Promise<boolean> {
        const results = await Promise.all(catalogs.map(async ({ name, ensure }) => ({ name, success: await ensure() })));
        const failures = results.filter((result) => !result.success).map((result) => result.name);

        if (failures.length === 0) {
            return true;
        }

        this.logger.error(
            `Failed to initialize ${failures.length} catalog service${failures.length === 1 ? '' : 's'}: ${failures.map((name) => `"${name}"`).join(', ')}`,
        );
        return false;
    }

    private initializeStartupCatalogs(): Promise<boolean> {
        return this.ensureCatalogGroupInitialized([
            {
                name: 'fluff_images',
                ensure: () => this.initializeCatalog(
                    'fluff_images',
                    () => this.presentationCatalogs.initializeFluffImages(),
                ),
            },
            {
                name: 'force_name_words',
                ensure: () => this.initializeCatalog('force_name_words', () => this.forceNameWordsCatalog.initialize()),
            },
            { name: 'megamek_availability', ensure: () => this.ensureMegaMekAvailabilityCatalogInitialized() },
            {
                name: 'sarna_page_titles',
                ensure: () => this.initializeCatalog(
                    'sarna_page_titles',
                    () => this.sarnaPageTitlesCatalog.initialize(),
                    () => {
                        if (this.sarnaPageTitlesVersion() === 0) {
                            this.bumpSarnaPageTitlesVersion();
                        }
                    },
                ),
            },
        ]);
    }

    public ensureMegaMekAvailabilityCatalogInitialized(): Promise<boolean> {
        const previousRevision = this.megaMekAvailabilityCatalog.getCatalogRevision();
        return this.initializeCatalog(
            'megamek_availability',
            () => this.megaMekAvailabilityCatalog.initialize(),
            () => {
                if (this.megaMekAvailabilityVersion() === 0
                    || this.megaMekAvailabilityCatalog.getCatalogRevision() !== previousRevision) {
                    this.bumpMegaMekAvailabilityVersion();
                }
            },
        );
    }

    private async hydrateSavedSearchCatalogs(): Promise<void> {
        try {
            if (await this.megaMekAvailabilityCatalog.hydrateFromCache()
                && this.megaMekAvailabilityVersion() === 0) {
                this.bumpMegaMekAvailabilityVersion();
            }
        } catch (error) {
            this.logger.warn(`Saved availability catalog could not be loaded: ${this.describeError(error)}`);
        }
    }

    public ensureMegaMekCatalogsInitialized(): Promise<boolean> {
        return this.ensureCatalogGroupInitialized([
            { name: 'megamek_availability', ensure: () => this.ensureMegaMekAvailabilityCatalogInitialized() },
            {
                name: 'megamek_factions',
                ensure: () => this.initializeCatalog('megamek_factions', () => this.megaMekFactionsCatalog.initialize()),
            },
            {
                name: 'megamek_rulesets',
                ensure: () => this.initializeCatalog('megamek_rulesets', () => this.megaMekRulesetsCatalog.initialize()),
            },
        ]);
    }

    private startAuxiliaryStartupCatalogs(): Promise<void> {
        const startedAt = Date.now();
        this.logger.info('[Background:auxiliary-catalogs] Started.');
        this.setAuxiliaryCatalogProgress({
            status: 'running', completed: 0, total: 1,
            detail: 'Loading optional presentation and rules catalogs',
        });
        return this.initializeStartupCatalogs()
            .then(ready => {
                if (ready) {
                    this.logger.info(
                        `[Background:auxiliary-catalogs] Finished in ${Math.max(0, Date.now() - startedAt)} ms.`,
                    );
                    this.setAuxiliaryCatalogProgress({ status: 'idle' });
                    return;
                }
                this.setAuxiliaryCatalogProgress({
                    status: 'error',
                    detail: 'One or more optional startup catalogs could not be loaded',
                });
            })
            .catch(error => {
                this.setAuxiliaryCatalogProgress({ status: 'error', detail: this.describeError(error) });
                this.logger.warn(
                    `[Background:auxiliary-catalogs] Failed after ${Math.max(0, Date.now() - startedAt)} ms: ${this.describeError(error)}`,
                );
            });
    }

    /**
     * Starts the single application-catalog bootstrap. Route-scoped services
     * may join this promise, but must never initialize required CatalogBase
     * services on their own: only the atomic bundle coordinator may publish
     * equipment, quirks, sourcebooks, eras, factions, sheets, and sprites.
     */
    public initialize(): Promise<void> {
        if (this.isDataReady()) return Promise.resolve();
        if (this.initialization) return this.initialization;
        const startedAt = Date.now();
        this.logger.info('[Startup] Loading local data.');
        let initialization!: Promise<void>;
        initialization = this.performInitialize()
            .then(() => {
                if (this.isDataReady()) {
                    this.logger.info(
                        `[Startup] Local data ready in ${Math.max(0, Date.now() - startedAt)} ms.`,
                    );
                }
            })
            .finally(() => {
                if (this.initialization === initialization) this.initialization = undefined;
            });
        this.initialization = initialization;
        return this.initialization;
    }

    /** Exact readiness gate for editor/mechanics routes entered during cold bootstrap. */
    public async requireApplicationCatalogReady(): Promise<void> {
        await this.initialize();
        if (!this.isDataReady()) {
            throw new Error('The complete application catalog is not ready');
        }
    }

    private async performInitialize(): Promise<void> {
        this.isDataReady.set(false);
        const applicationDatabaseReady = this.dbService.waitForDbReady();
        this.localSearchCatalogHydration = applicationDatabaseReady
            .then(() => this.hydrateSavedSearchCatalogs());
        try {
            await Promise.all([
                applicationDatabaseReady,
                this.localSearchCatalogHydration,
                this.checkForUpdate(),
            ]);
            // These catalogs enable optional features only. A slow/unavailable
            // request must never delay readiness after the exact core
            // application bundle and all required derived state are committed.
            this.auxiliaryStartupSettlement = this.startAuxiliaryStartupCatalogs();
            void this.auxiliaryStartupSettlement;
        } catch (error) {
            this.logger.error(`Failed to initialize data: ${this.describeError(error)}`);
            // Never promote length-only or mixed legacy caches to readiness.
            // A previously committed exact LKG remains interactive; a cold
            // start remains unavailable until a complete activation wins.
            if (this.appliedUnitCatalogRevision === 0) this.isDataReady.set(false);
        }
    }

    private isCloudNewer(localRaw: any, cloudRaw: any): boolean {
        const localTs = localRaw?.timestamp ? new Date(localRaw.timestamp).getTime() : 0;
        const cloudTs = cloudRaw?.timestamp ? new Date(cloudRaw.timestamp).getTime() : 0;
        return cloudTs > localTs;
    }

    /** Build derived memberships without mutating a prepared or already-live catalog bundle. */
    private cloneEraFactionMembershipState(
        eras: readonly Era[],
        factions: readonly Faction[],
    ): { eras: Era[]; factions: Faction[] } {
        return {
            eras: eras.map(era => ({
                ...era,
                factions: new Set(era.factions),
                units: new Set(era.units),
            })),
            factions: factions.map(faction => ({
                ...faction,
                eras: Object.fromEntries(
                    Object.entries(faction.eras).map(([eraId, units]) => [
                        eraId,
                        new Set(units),
                    ]),
                ),
            })),
        };
    }

    private async normalizePersistedForce(
        raw: SerializedForce,
        materializeUnits = true,
    ): Promise<SerializedForce> {
        const materializeUnit = async (request: Parameters<NonNullable<PersistedForceV1ConversionOptions['materializeUnit']>>[0]) => {
            const identity = request.source.identity;
            if (identity.kind !== 'resolved') return undefined;
            const summary = this.getUnitByIdentity(
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
                return convertPersistedMekUnitV1(request.source, ready);
            }
            const ready = await this.injector.get(ReadyNonMekUnitService).loadReadyNonMekUnit({
                identity: identity.savedIdentity,
                instanceId: request.instanceId,
                deployment: request.deployment,
                scenario: request.scenario,
            });
            return convertPersistedNonMekUnitV1(request.source, ready);
        };
        return raw.version === 1
            ? convertPersistedForceV1(raw, {
                resolveIdentity: unit => this.resolveLegacyUnitIdentity(unit),
                ...(materializeUnits ? { materializeUnit } : {}),
            })
            : Promise.resolve(raw);
    }

    private async getPersistedForceUnitIds(instanceId: string): Promise<readonly string[]> {
        const raw = await this.dbService.getForce(instanceId);
        if (!raw) return [];
        const normalized = await this.normalizePersistedForce(raw, false);
        return normalized.cbt !== undefined
            ? normalized.cbt.units.map(unit => unit.instanceId)
            : (normalized.groups ?? []).flatMap(group => group.units.map(unit => unit.id));
    }

    /** Preview and live load share the same one-way V1 ingress. */
    public async createLoadForceEntryFromPersistedForce(
        raw: SerializedForce,
        options: { cloud?: boolean; local?: boolean } = {},
    ): Promise<LoadForceEntry> {
        const normalized = await this.normalizePersistedForce(raw);
        return createLoadForceEntryFromSerializedForce(normalized, this, options);
    }

    private async deserializePersistedForce(raw: SerializedForce): Promise<Force> {
        const persisted = await this.normalizePersistedForce(raw);
        return this.deserializeNormalizedForce(persisted);
    }

    private async deserializeNormalizedForce(persisted: SerializedForce): Promise<Force> {
        const force = persisted.type === GameSystem.ALPHA_STRIKE
            ? ASForce.deserialize(persisted as ASSerializedForce, this, this.injector)
            : CBTForce.deserializeV2(persisted as SerializedClassicForce, this, this.injector);
        try {
            if (force.gameSystem === GameSystem.CLASSIC) {
                await force.loadCBTForceV2Persistence(persisted);
            }
            return force;
        } catch (error) {
            this.destroyDetachedForce(force);
            throw error;
        }
    }

    /**
     * Materializes remote state off-live. V1 conversion, V2 validation,
     * encounter restore, and direct authority staging all complete on the
     * detached force before ForceBuilder is allowed to commit it.
     */
    public async stageRemoteForceSnapshot(serialized: SerializedForce): Promise<StagedRemoteForceSnapshot> {
        // A remote snapshot is JSON authority. Converting it before any model
        // construction both detaches caller ownership and rejects cycles,
        // non-finite values, and other non-wire graphs.
        const detached = cloneAsJson(serialized) as unknown as SerializedForce;
        assertStrictRemoteSerializedTopology(detached);
        assertCanonicalRemoteForceMetadata(detached);
        const normalized = structuredClone(await this.normalizePersistedForce(detached));
        const force = await this.deserializeNormalizedForce(structuredClone(normalized));
        // V1 is ingress only. Persist the canonical V2 writer result, not a
        // version-flipped copy of an old wire graph. Native V2 input remains
        // exact so non-canonical or conflicting transport bytes are rejected.
        const persistenceBytes = detached.version === 1
            ? structuredClone(await force.serializeForPersistence())
            : normalized;
        try {
            if (!persistenceBytes.instanceId || force.instanceId() !== persistenceBytes.instanceId) {
                throw new Error('Staged remote force identity does not match its serialized snapshot');
            }
            assertStrictRemoteForceMaterialization(persistenceBytes, force);
            // Production deserializers always return a Force instance. Some
            // narrow structural test doubles intentionally exercise only token
            // lifetime/materialization paths and have no persistence writer.
            if (force instanceof Force) {
                assertCanonicalRemoteWriterProjection(persistenceBytes, force);
            }
            // A detached candidate represents bytes already observed in cloud.
            // Bind that predecessor before its comparable persistent witness is
            // captured so equal-time supported CBT snapshots can
            // be compared exactly against the live owner.
            force.markCloudCBTForceV2Saved(persistenceBytes);
        } catch (error) {
            this.destroyDetachedForce(force);
            throw error;
        }
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

    /** Releases an uncommitted detached snapshot and its unit subscriptions. */
    public discardRemoteForceSnapshot(staged: StagedRemoteForceSnapshot): void {
        if (!this.stagedRemoteForceSnapshots.delete(staged)) return;
        this.destroyDetachedForce(staged.force);
    }

    /**
     * Consumes and completely validates a staged token without changing live
     * authority. The returned capability may be committed synchronously after
     * the old Force owner has drained, or discarded if its slot fence loses.
     */
    public prepareRemoteForceSnapshotAcceptance(
        staged: StagedRemoteForceSnapshot,
    ): PreparedRemoteForceAcceptance {
        const payload = this.stagedRemoteForceSnapshots.get(staged);
        if (!payload) {
            throw new Error('Remote force snapshot was not staged by this DataService or was already consumed');
        }
        const instanceId = staged.force.instanceId();
        if (!instanceId || !this.isStagedRemoteForcePayloadCurrent(staged.force, payload)) {
            this.stagedRemoteForceSnapshots.delete(staged);
            this.destroyDetachedForce(staged.force);
            throw new Error('Remote force snapshot authority changed before acceptance');
        }
        try {
            // This can run arbitrary subclass validation, so it happens while
            // the candidate is still detached and the old owner is recoverable.
            staged.force.markCloudCBTForceV2Saved(payload.serialized);
        } catch (error) {
            this.stagedRemoteForceSnapshots.delete(staged);
            this.destroyDetachedForce(staged.force);
            throw error;
        }
        let preparedPayload: StagedRemoteForceSnapshotPayload;
        try {
            preparedPayload = this.captureStagedRemoteForcePayload(staged.force, payload.serialized);
        } catch (error) {
            this.stagedRemoteForceSnapshots.delete(staged);
            this.destroyDetachedForce(staged.force);
            throw error;
        }
        if (staged.force.instanceId() !== instanceId
            || !this.isStagedRemoteForcePayloadCurrent(staged.force, preparedPayload)) {
            this.stagedRemoteForceSnapshots.delete(staged);
            this.destroyDetachedForce(staged.force);
            throw new Error('Remote force snapshot authority changed while preparing acceptance');
        }
        this.stagedRemoteForceSnapshots.delete(staged);
        const prepared = Object.freeze({ force: staged.force });
        this.preparedRemoteForceAcceptances.set(prepared, preparedPayload);
        return prepared;
    }

    /** Releases a validated but uncommitted acceptance and its detached graph. */
    public discardPreparedRemoteForceAcceptance(prepared: PreparedRemoteForceAcceptance): void {
        if (!this.preparedRemoteForceAcceptances.delete(prepared)) return;
        this.destroyDetachedForce(prepared.force);
    }

    /**
     * Reversible preparation for an exact predecessor-bound acceptance. It
     * consumes the callback-scoped retirement proof but does not move Data
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
            this.destroyDetachedForce(prepared.force);
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
                    () => this.dbService.saveForce(payload.serialized, { allowRevisionOverride: true }),
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
     * Prepares exact Data-authority removal inside Force's retirement callback.
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

    private destroyDetachedForce(force: Force): void {
        if (force instanceof CBTForce) return;
        for (const unit of force.units()) {
            try {
                unit.destroy();
            } catch (error) {
                this.logger.warn(`Could not destroy detached force unit ${unit.id}: ${error}`);
            }
        }
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
        let cloudRaw: any | null = null;
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
                local = await this.deserializePersistedForce(localRaw);
            } catch (error) { 
                this.logger.error((error as any)?.message ?? error);
            }
        }
        if (cloudRaw) {
            try {
                cloud = await this.deserializePersistedForce(cloudRaw as SerializedForce);
            } catch (error) { 
                this.logger.error((error as any)?.message ?? error);
            }
        }

        let cloudIsNewer = false;
        if (local && cloud) {
            const localTimestamp = this.getComparableTimestamp(localRaw?.timestamp);
            const cloudTimestamp = this.getComparableTimestamp(cloudRaw?.timestamp);
            const sameTimestamp = localTimestamp === cloudTimestamp;
            const localIsV1 = localRaw?.version === 1;
            const cloudIsV2 = cloudRaw?.version === 2;
            cloudIsNewer = sameTimestamp && localIsV1 && cloudIsV2
                ? true
                : this.isCloudNewer(localRaw, cloudRaw);
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
                result.markCloudCBTForceV2Saved(cloudRaw as SerializedForce);
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
                    cloneAsJson(cloudRaw as SerializedForce) as unknown as SerializedForce,
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
            if (state.dirty && !this.destroyed) this.queueForceAutosave(force);
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
        const remote = cloneAsJson(remoteSnapshot) as unknown as SerializedForce;
        assertStrictRemoteSerializedTopology(remote);
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
            this.logger.warn(`DataService.saveForce() blocked: force "${force.name}" is read-only.`);
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
            this.logger.warn(`DataService.saveForce() blocked: fresh force "${force.name}" has no provisional authority.`);
            return null;
        }
        const activeForce = this.activeForceAuthority.get(instanceId);
        if (activeForce !== force || this.registeredForceIdentity.get(force) !== instanceId) {
            this.logger.warn(`DataService.saveForce() blocked: force "${force.name}" is no longer the active authority for ${instanceId}.`);
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
        const detachedForces = new Set<Force>();
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
                cloudRaw = await this.getForceCloud(instanceId, false) as SerializedForce | null;
                triedCloud = true;
            }
            if (!authorityIsCurrent()) throw new Error('The selected force authority changed while its tags were being updated.');

            const local = localRaw ? await this.deserializePersistedForce(localRaw) : null;
            const cloud = cloudRaw ? await this.deserializePersistedForce(cloudRaw) : null;
            if (local) detachedForces.add(local);
            if (cloud) detachedForces.add(cloud);
            if ((local && hasInvalidDurableForceIds(local)) || (cloud && hasInvalidDurableForceIds(cloud))) {
                throw new Error('The selected force has invalid or duplicate durable IDs and cannot be retagged.');
            }
            if (!authorityIsCurrent()) throw new Error('The selected force authority changed while its tags were being updated.');

            let force: Force | null;
            if (local && cloud) {
                const localTimestamp = this.getComparableTimestamp(localRaw?.timestamp);
                const cloudTimestamp = this.getComparableTimestamp(cloudRaw?.timestamp);
                if (localTimestamp === cloudTimestamp
                    && local.getWholeOwnerPersistentAuthoritySnapshotJson()
                        !== cloud.getWholeOwnerPersistentAuthoritySnapshotJson()) {
                    throw new Error('The selected force has divergent local and cloud authority at the same timestamp.');
                }
                force = this.isCloudNewer(localRaw, cloudRaw) ? cloud : local;
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
            for (const force of detachedForces) this.destroyDetachedForce(force);
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
        const detached = cloneAsJson(serialized) as unknown as SerializedForce;
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
        const response = await this.wsService.sendAndWaitForResponse({
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
        if (response.action === 'error') throw new Error(response.message ?? 'Cloud save failed.');
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
            const detached = cloneAsJson(serialized) as unknown as SerializedForce;
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
        const instanceId = detached.instanceId;
        if (!instanceId || !this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
        const normalized = await this.normalizePersistedForce(detached);
        if (normalized.type !== GameSystem.ALPHA_STRIKE && normalized.cbt !== undefined) {
            await inspectSerializedCBTForceV2(normalized);
        }
        if (!this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return false;
        let written = false;
        await this.enqueueLocalForceWrite(
            instanceId,
            async () => {
                if (!this.isOwnerlessForceOperationCurrent(instanceId, lease, generation)) return;
                await this.dbService.saveForce(normalized, { allowRevisionOverride: true });
                written = this.isOwnerlessForceOperationCurrent(instanceId, lease, generation);
            },
        );
        return written;
    }

    public async listForces(): Promise<LoadForceEntry[]> {
        this.logger.info(`Retrieving local forces...`);
        const localForces = await this.dbService.listForces(this);
        this.logger.info(`Retrieving cloud forces...`);
        const cloudForces = await this.listForcesCloud();
        this.logger.info(`Found ${localForces.length} local forces and ${cloudForces.length} cloud forces.`);
        const forceMap = new Map<string, LoadForceEntry>();
        const getTimestamp = (f: any) => {
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
                await this.createLoadForceEntryFromPersistedForce(localRaw, { local: true }),
            );
        }

        const cloudForces = await this.getForcesBulkSummaries(orderedIds);
        for (const raw of cloudForces) {
            if (!raw?.instanceId) continue;
            const cloudEntry = createLoadForceEntry(raw, this, { cloud: true });
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

        for (let i = 0; i < orderedIds.length; i += DataService.FORCE_BULK_CHUNK_SIZE) {
            const chunk = orderedIds.slice(i, i + DataService.FORCE_BULK_CHUNK_SIZE);
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getForcesBulk',
                instanceIds: chunk,
            });
            if (!response?.data || !Array.isArray(response.data)) continue;
            result.push(...response.data as RemoteLoadForceEntry[]);
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
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getForce',
                uuid,
                instanceId,
                ownedOnly: false,
            });
            const raw = response?.data;
            if (raw && typeof raw === 'object') {
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

    /* ----------------------------------------------------------
     * Operations (multi-force compositions)
     */

    /**
     * Save an operation locally and to the cloud.
     */
    public async saveOperation(op: SerializedOperation): Promise<void> {
        await this.dbService.saveOperation(op);
        this.saveOperationCloud(op);
    }

    /**
     * Retrieve a single operation by ID.
     * Fetches from both local storage and cloud in parallel, then keeps
     * whichever is newer (mirroring `getForce()` behaviour).
     * Returns a LoadOperationEntry enriched with force metadata, or null if not found.
     */
    public async getOperation(operationId: string): Promise<LoadOperationEntry | null> {
        const localPromise = this.getOperationLocal(operationId);
        let cloudEntry: LoadOperationEntry | null = null;
        let triedCloud = false;

        try {
            const ws = await this.canUseCloud();
            if (ws) {
                try {
                    cloudEntry = await this.getOperationCloud(operationId);
                    triedCloud = true;
                } catch {
                    cloudEntry = null;
                }
            }
        } catch {
            // cloud unavailable
        }

        const localEntry = await localPromise;

        // Pick the best result
        let result: LoadOperationEntry | null;
        if (localEntry && cloudEntry) {
            result = cloudEntry.timestamp > localEntry.timestamp ? cloudEntry : localEntry;
            result.owned = cloudEntry.owned;
        } else if (!triedCloud && localEntry) {
            result = localEntry;
        } else {
            result = cloudEntry || localEntry || null;
        }

        if (result) {
            result.localTimestamp = localEntry?.timestamp ?? 0;
            result.cloudTimestamp = triedCloud ? (cloudEntry?.timestamp ?? 0) : 0;

            // Push to cloud when we reached it and local is newer (or cloud is missing)
            if (triedCloud && result.localTimestamp > result.cloudTimestamp) {
                const serialized = await this.dbService.getOperation(operationId);
                if (serialized) {
                    this.saveOperationCloud(serialized);
                }
            }
        }

        return result;
    }

    /**
     * Retrieve a single operation from local IndexedDB.
     * No force enrichment — callers that load the operation will fetch
     * the actual forces via `getForce()` immediately after.
     */
    private async getOperationLocal(operationId: string): Promise<LoadOperationEntry | null> {
        const serialized = await this.dbService.getOperation(operationId);
        if (!serialized) return null;

        return new LoadOperationEntry({
            operationId: serialized.operationId,
            name: serialized.name || '',
            note: serialized.note || '',
            timestamp: serialized.timestamp,
            forces: serialized.forces.map(ref => ({
                instanceId: ref.instanceId,
                alignment: ref.alignment,
                timestamp: ref.timestamp,
                exists: false,
            })),
            local: true,
        });
    }

    /**
     * Delete an operation locally and from the cloud.
     */
    public async deleteOperation(operationId: string): Promise<void> {
        await this.dbService.deleteOperation(operationId);
        const ws = await this.canUseCloud();
        if (ws) {
            this.wsService.send({
                action: 'delOperation',
                operationId,
            });
        }
    }

    /**
     * List operations, merging local and cloud.
     * Cloud entries include joined force metadata; local entries are enriched
     * with locally available force data.
     *
     * After merging:
     * - Cloud operations are saved locally for offline access.
     * - Local-only operations are verified against the cloud to detect
     *   ownership conflicts (e.g. user changed accounts). If a conflict is
     *   found, the local operation gets a new operationId and is saved to cloud.
     */
    public async listOperations(): Promise<LoadOperationEntry[]> {
        const [localOps, cloudOps] = await Promise.all([
            this.listOperationsLocal(),
            this.listOperationsCloud(),
        ]);

        // Merge: cloud wins for same operationId, but keep local-only entries
        const opMap = new Map<string, LoadOperationEntry>();

        for (const op of localOps) {
            op.local = true;
            opMap.set(op.operationId, op);
        }

        const cloudOnlyOps: LoadOperationEntry[] = [];
        for (const cloudOp of cloudOps) {
            const existing = opMap.get(cloudOp.operationId);
            cloudOp.cloud = true;
            if (existing) {
                cloudOp.local = true;
                // Merge: use cloud's enriched force data but update with any
                // locally-fresher force info
                this.mergeOperationForceInfo(cloudOp, existing);
            } else {
                cloudOnlyOps.push(cloudOp);
            }
            opMap.set(cloudOp.operationId, cloudOp);
        }

        // Save cloud operations locally for offline access and to sync name/note changes.
        // Fire-and-forget to avoid blocking the UI.
        this.saveCloudOperationsLocally(cloudOps);

        // Identify local-only operations (not found on cloud) and verify them
        const localOnlyOps = Array.from(opMap.values()).filter(op => op.local && !op.cloud);
        if (localOnlyOps.length > 0) {
            // Fire-and-forget: verify ownership in the background
            this.verifyLocalOnlyOperations(localOnlyOps, opMap);
        }

        return Array.from(opMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Save cloud operations to local IndexedDB for offline access.
     * Uses the cloud data (which may have updated name/note) and writes them locally.
     */
    private async saveCloudOperationsLocally(cloudOps: LoadOperationEntry[]): Promise<void> {
        for (const op of cloudOps) {
            try {
                const serialized: SerializedOperation = {
                    operationId: op.operationId,
                    name: op.name,
                    note: op.note,
                    timestamp: op.timestamp,
                    forces: op.forces.map(f => ({
                        instanceId: f.instanceId,
                        alignment: f.alignment,
                        timestamp: f.timestamp,
                    })),
                };
                await this.dbService.saveOperation(serialized);
            } catch (err) {
                this.logger.error(`Failed to save cloud operation locally: ${err}`);
            }
        }
    }

    /**
     * Verify local-only operations against the cloud to detect ownership conflicts.
     * If a local operation exists on the cloud but isn't owned by us, we re-ID it
     * locally and save the new copy to the cloud immediately.
     * If it doesn't exist on the cloud, we leave it alone (user may have deleted it
     * from another device).
     *
     * Sends requests in chunks of VERIFY_OPS_CHUNK_SIZE to stay within the server limit.
     */
    private static readonly VERIFY_OPS_CHUNK_SIZE = 100;

    private async verifyLocalOnlyOperations(
        localOnlyOps: LoadOperationEntry[],
        opMap: Map<string, LoadOperationEntry>,
    ): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;

        const allIds = localOnlyOps.map(op => op.operationId);

        try {
            // Process in chunks to respect server-side cap
            for (let i = 0; i < allIds.length; i += DataService.VERIFY_OPS_CHUNK_SIZE) {
                const chunk = allIds.slice(i, i + DataService.VERIFY_OPS_CHUNK_SIZE);
                const response = await this.wsService.sendAndWaitForResponse({
                    action: 'verifyOperations',
                    operationIds: chunk,
                });
                if (!response?.data || !Array.isArray(response.data)) continue;

                await this.processVerifyResults(response.data, localOnlyOps, opMap);
            }
        } catch (err) {
            this.logger.error(`Failed to verify local-only operations: ${err}`);
        }
    }

    /**
     * Process verify results for a single chunk and handle conflicts.
     */
    private async processVerifyResults(
        results: Array<{ operationId: string; exists: boolean; owned: boolean }>,
        localOnlyOps: LoadOperationEntry[],
        opMap: Map<string, LoadOperationEntry>,
    ): Promise<void> {
        for (const result of results) {
            const { operationId, exists, owned } = result;

            if (exists && !owned) {
                // Conflict: the operationId is owned by another user.
                // Generate a new operationId, update local, and save to cloud.
                const conflictOp = localOnlyOps.find(op => op.operationId === operationId);
                if (!conflictOp) continue;

                const newOperationId = uuidv7();
                this.logger.warn(
                    `Operation "${conflictOp.name}" (${operationId}) is owned by another account. ` +
                    `Re-assigning to new ID: ${newOperationId}`
                );

                // Delete old local entry
                await this.dbService.deleteOperation(operationId);

                // Build the serialized operation with the new ID
                const serialized: SerializedOperation = {
                    operationId: newOperationId,
                    name: conflictOp.name,
                    note: conflictOp.note,
                    timestamp: conflictOp.timestamp,
                    forces: conflictOp.forces.map(f => ({
                        instanceId: f.instanceId,
                        alignment: f.alignment,
                        timestamp: f.timestamp,
                    })),
                };

                // Save locally with new ID
                await this.dbService.saveOperation(serialized);
                // Save to cloud with new ID
                await this.saveOperationCloud(serialized);

                // Update the opMap entry so callers see the new ID
                opMap.delete(operationId);
                conflictOp.operationId = newOperationId;
                conflictOp.cloud = true;
                opMap.set(newOperationId, conflictOp);
            }
            // If !exists: the operation was deleted elsewhere, leave it local-only.
            // It will be pushed to cloud if the user explicitly loads it.
        }
    }

    /**
     * Merge local force metadata into a cloud-enriched operation entry.
     * If local has newer timestamps for any force, update the entry.
     */
    private mergeOperationForceInfo(target: LoadOperationEntry, localEntry: LoadOperationEntry): void {
        for (const localForce of localEntry.forces) {
            const cloudForce = target.forces.find(f => f.instanceId === localForce.instanceId);
            if (!cloudForce) {
                // Force exists locally but not in cloud response — add it
                target.forces.push(localForce);
            } else {
                // If local force info is more recent, prefer it
                const localTs = localForce.forceTimestamp ? new Date(localForce.forceTimestamp).getTime() : 0;
                const cloudTs = cloudForce.forceTimestamp ? new Date(cloudForce.forceTimestamp).getTime() : 0;
                if (localTs > cloudTs) {
                    cloudForce.name = localForce.name ?? cloudForce.name;
                    cloudForce.type = localForce.type ?? cloudForce.type;
                    cloudForce.factionId = localForce.factionId ?? cloudForce.factionId;
                    cloudForce.eraId = localForce.eraId ?? cloudForce.eraId;
                    cloudForce.bv = localForce.bv ?? cloudForce.bv;
                    cloudForce.pv = localForce.pv ?? cloudForce.pv;
                    cloudForce.forceTimestamp = localForce.forceTimestamp;
                }
                // Mark force as existing if either source has it
                if (localForce.exists) cloudForce.exists = true;
            }
        }
    }

    private async listOperationsLocal(): Promise<LoadOperationEntry[]> {
        const serialized = await this.dbService.listOperations();
        const entries: LoadOperationEntry[] = [];

        for (const op of serialized) {
            const forces: OperationForceInfo[] = [];
            for (const ref of op.forces) {
                // Try to enrich with local force metadata
                const localForce = await this.dbService.getForce(ref.instanceId);
                forces.push({
                    instanceId: ref.instanceId,
                    alignment: ref.alignment,
                    timestamp: ref.timestamp,
                    name: localForce?.name,
                    type: localForce?.type as GameSystem | undefined,
                    factionId: localForce?.factionId,
                    eraId: localForce?.eraId,
                    bv: localForce?.bv,
                    pv: localForce?.pv,
                    forceTimestamp: localForce?.timestamp,
                    exists: !!localForce,
                });
            }
            entries.push(new LoadOperationEntry({
                operationId: op.operationId,
                name: op.name || '',
                note: op.note || '',
                timestamp: op.timestamp,
                forces,
                local: true,
            }));
        }
        return entries;
    }

    private async listOperationsCloud(): Promise<LoadOperationEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const response = await this.wsService.sendAndWaitForResponse({
            action: 'listOperations',
        });
        if (!response?.data || !Array.isArray(response.data)) return [];

        return response.data.map((raw: any) => new LoadOperationEntry({
            operationId: raw.operationId,
            name: raw.name || '',
            note: raw.note || '',
            timestamp: raw.timestamp,
            owned: raw.owned ?? true,
            forces: (raw.forces || []).map((f: any) => ({
                instanceId: f.instanceId,
                alignment: f.alignment,
                timestamp: f.timestamp,
                name: f.name,
                type: f.type,
                factionId: f.factionId,
                eraId: f.eraId,
                bv: f.bv,
                pv: f.pv,
                forceTimestamp: f.forceTimestamp,
                exists: f.exists ?? false,
            } as OperationForceInfo)),
            cloud: true,
        }));
    }

    private async getOperationCloud(operationId: string): Promise<LoadOperationEntry | null> {
        const ws = await this.canUseCloud();
        if (!ws) return null;

        const response = await this.wsService.sendAndWaitForResponse({
            action: 'getOperation',
            operationId,
        });
        const raw = response?.data;
        if (!raw) return null;

        return new LoadOperationEntry({
            operationId: raw.operationId,
            name: raw.name || '',
            note: raw.note || '',
            timestamp: raw.timestamp,
            owned: raw.owned ?? false,
            forces: (raw.forces || []).map((f: any) => ({
                instanceId: f.instanceId,
                alignment: f.alignment,
                timestamp: f.timestamp,
                exists: false,
            })),
            cloud: true,
        });
    }

    private async saveOperationCloud(op: SerializedOperation): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;
        this.wsService.send({
            action: 'saveOperation',
            data: op,
        });
    }

    /**
     * Bulk-fetch basic force metadata from the cloud for a list of instanceIds.
     * Returns enrichment data (name, type, bv, pv, timestamp) for each found force.
     * Sends requests in chunks of 100 to stay within the server limit.
     */
    private static readonly FORCE_INFO_CHUNK_SIZE = 100;

    public async getForceInfoBulk(instanceIds: string[]): Promise<Map<string, OperationForceInfo>> {
        const result = new Map<string, OperationForceInfo>();
        const ws = await this.canUseCloud();
        if (!ws || instanceIds.length === 0) return result;

        try {
            for (let i = 0; i < instanceIds.length; i += DataService.FORCE_INFO_CHUNK_SIZE) {
                const chunk = instanceIds.slice(i, i + DataService.FORCE_INFO_CHUNK_SIZE);
                const response = await this.wsService.sendAndWaitForResponse({
                    action: 'getForceInfoBulk',
                    instanceIds: chunk,
                });
                if (!response?.data || !Array.isArray(response.data)) continue;

                for (const entry of response.data) {
                    result.set(entry.instanceId, {
                        instanceId: entry.instanceId,
                        alignment: 'friendly', // placeholder, caller should override
                        timestamp: '',          // placeholder, caller should override
                        name: entry.name,
                        type: entry.type,
                        factionId: entry.factionId,
                        eraId: entry.eraId,
                        bv: entry.bv,
                        pv: entry.pv,
                        forceTimestamp: entry.timestamp,
                        exists: true,
                    });
                }
            }
        } catch (err) {
            this.logger.error(`Failed to fetch force info bulk: ${err}`);
        }

        return result;
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
        const response = await this.wsService.sendAndWaitForResponse(payload);
        if (response && Array.isArray(response.data)) {
            for (const raw of response.data as RemoteLoadForceEntry[]) {
                try {
                    forces.push(createLoadForceEntry(raw, this, { cloud: true }));
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
        resolvers: Array<{ resolve: () => void, reject: (e: any) => void }>
    }>();
    /** Serializes acknowledged writes per force so each CAS uses its predecessor's revision. */
    private forceCloudSaveChain = new Map<string, {
        readonly generation: number;
        readonly fence: ForceSaveFence;
        readonly promise: Promise<number | null | undefined>;
    }>();

    public hasPendingCloudSaves(): boolean {
        return this.saveForceCloudDebounce.size > 0 || this.forceCloudSaveChain.size > 0;
    }

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
            this.logger.warn(`DataService.saveForceCloud() blocked: force "${force.name}" is read-only.`);
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
            const response = await this.wsService.sendAndWaitForResponse({
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
                ? { updated: true, timestamp: typeof response.timestamp === 'string' ? response.timestamp : null }
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
        let response: any;
        try {
            response = await this.wsService.sendAndWaitForResponse({
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
            this.logger.warn(`DataService.flushSaveForceCloud() blocked: force "${force.name}" is read-only.`);
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
    ): Promise<any | null> {
        const ws = await this.canUseCloud();
        if (!ws) return null;
        const payload = {
            action: 'getForce',
            ...(includeOwnership ? { uuid: this.userStateService.uuid() } : {}),
            instanceId,
            ownedOnly,
        };
        const response = await this.wsService.sendAndWaitForResponse(payload);
        return response.data ? decodeForceFromStorage(response.data) : null;
    }

    /* ----------------------------------------------------------
     * Canvas Data
     */

    public deleteCanvasDataOfUnit(unit: ForceUnit): void {
        this.dbService.deleteCanvasData(unit.id);
    }

    /* ----------------------------------------------------------
     * Force Pack Lookups (lazily built, cached globally)
     */

    /**
     * Build both force pack lookup maps on first use.
        * - forcePackToLookupKey: packName -> Set<chassis|as.TP|omni>
        * - lookupKeyToForcePacks: chassis|as.TP|omni -> sorted packName[]
     */
    private buildForcePackCaches(): void {
        this.forcePackToLookupKey = new Map();
        const reverseMap = new Map<string, Set<string>>();

        for (const pack of getForcePacks()) {
            const lookupKeys = new Set<string>();

            const processUnits = (unitList: Array<{ name: string }>) => {
                for (const pu of unitList) {
                    const unit = this.getUnitByName(pu.name);
                    if (unit) {
                        const key = getUnitVariantGroupKey(unit);
                        lookupKeys.add(key);
                        if (!reverseMap.has(key)) reverseMap.set(key, new Set());
                        reverseMap.get(key)!.add(pack.name);
                    }
                }
            };

            processUnits(pack.units);
            if (pack.variants) {
                for (const variant of pack.variants) {
                    processUnits(variant.units);
                }
            }

            this.forcePackToLookupKey.set(pack.name, lookupKeys);
        }

        this.lookupKeyToForcePacks = new Map();
        for (const [key, names] of reverseMap) {
            this.lookupKeyToForcePacks.set(key, Array.from(names).sort());
        }
    }

    /**
    * Check if a unit belongs to a force pack (by variants).
     */
    public unitBelongsToForcePack(unit: UnitSummary, packName: string): boolean {
        if (!this.forcePackToLookupKey) this.buildForcePackCaches();
        const lookupSet = this.forcePackToLookupKey!.get(packName);
        if (!lookupSet) return false;
        return lookupSet.has(getUnitVariantGroupKey(unit));
    }

    /**
    * Get the variants set for a force pack (for bulk filtering).
     */
    public getForcePackLookupSet(packName: string): Set<string> | undefined {
        if (!this.forcePackToLookupKey) this.buildForcePackCaches();
        return this.forcePackToLookupKey!.get(packName);
    }

    /**
    * Get the sorted list of force pack names that contain a unit's variants.
     */
    public getForcePacksForUnit(unit: UnitSummary): string[] {
        if (!this.lookupKeyToForcePacks) this.buildForcePackCaches();
        return this.lookupKeyToForcePacks!.get(getUnitVariantGroupKey(unit)) ?? [];
    }

    /* ----------------------------------------------------------
     * Organizations (force org-chart layouts)
     */

    public async saveOrganization(org: SerializedOrganization): Promise<void> {
        await this.dbService.saveOrganization(org);
        this.saveOrganizationCloud(org);
    }

    public async deleteOrganization(organizationId: string): Promise<void> {
        await this.dbService.deleteOrganization(organizationId);
        const ws = await this.canUseCloud();
        if (ws) {
            this.wsService.send({
                action: 'delOrganization',
                organizationId,
            });
        }
    }

    public async listOrganizations(): Promise<LoadOrganizationEntry[]> {
        const [localOrgs, cloudOrgs] = await Promise.all([
            this.listOrganizationsLocal(),
            this.listOrganizationsCloud(),
        ]);

        const orgMap = new Map<string, LoadOrganizationEntry>();

        for (const org of localOrgs) {
            org.local = true;
            orgMap.set(org.organizationId, org);
        }

        for (const cloudOrg of cloudOrgs) {
            const existing = orgMap.get(cloudOrg.organizationId);
            cloudOrg.cloud = true;
            if (existing) {
                cloudOrg.local = true;
            }
            orgMap.set(cloudOrg.organizationId, cloudOrg);
        }

        // Push local-only orgs to cloud
        const localOnly = Array.from(orgMap.values()).filter(o => o.local && !o.cloud);
        if (localOnly.length > 0) {
            for (const entry of localOnly) {
                const serialized = await this.dbService.getOrganization(entry.organizationId);
                if (serialized) this.saveOrganizationCloud(serialized);
            }
        }

        // Save cloud orgs locally for offline access
        for (const cloudOrg of cloudOrgs) {
            const localEntry = localOrgs.find(l => l.organizationId === cloudOrg.organizationId);
            if (!localEntry || cloudOrg.timestamp > localEntry.timestamp) {
                // Fetch full org from cloud and save locally
                this.syncOrganizationFromCloud(cloudOrg.organizationId);
            }
        }

        return Array.from(orgMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    public async getOrganization(organizationId: string): Promise<LoadedOrganization | null> {
        const localPromise = this.dbService.getOrganization(organizationId);
        let cloudOrg: LoadedOrganization | null = null;

        try {
            const ws = await this.canUseCloud();
            if (ws) {
                const response = await this.wsService.sendAndWaitForResponse({
                    action: 'getOrganization',
                    organizationId,
                });
                cloudOrg = response?.data ?? null;
            }
        } catch {
            // cloud unavailable
        }

        const localOrg = await localPromise;

        if (localOrg && cloudOrg) {
            return cloudOrg.timestamp > localOrg.timestamp ? cloudOrg : localOrg;
        }
        return cloudOrg || localOrg || null;
    }

    /**
     * Find all locally-stored organizations that contain a specific force instanceId.
     */
    public async findOrganizationsForForce(instanceId: string): Promise<LoadOrganizationEntry[]> {
        const serialized = await this.dbService.listOrganizations();
        return serialized
            .filter(org => org.forces.some(f => f.instanceId === instanceId))
            .map(org => new LoadOrganizationEntry({
                organizationId: org.organizationId,
                name: org.name,
                timestamp: org.timestamp,
                factionId: org.factionId,
                forceCount: org.forces.length,
                groupCount: org.groups.length,
                local: true,
            }));
    }

    private async listOrganizationsLocal(): Promise<LoadOrganizationEntry[]> {
        const serialized = await this.dbService.listOrganizations();
        return serialized.map(org => new LoadOrganizationEntry({
            organizationId: org.organizationId,
            name: org.name,
            timestamp: org.timestamp,
            factionId: org.factionId,
            forceCount: org.forces.length,
            groupCount: org.groups.length,
            local: true,
        }));
    }

    private async listOrganizationsCloud(): Promise<LoadOrganizationEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const response = await this.wsService.sendAndWaitForResponse({
            action: 'listOrganizations',
        });
        if (!response?.data || !Array.isArray(response.data)) return [];

        return response.data.map((raw: any) => new LoadOrganizationEntry({
            organizationId: raw.organizationId,
            name: raw.name || '',
            timestamp: raw.timestamp,
            factionId: raw.factionId,
            forceCount: raw.forceCount ?? 0,
            groupCount: raw.groupCount ?? 0,
            cloud: true,
            owned: raw.owned ?? true,
        }));
    }

    private async saveOrganizationCloud(org: SerializedOrganization): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;
        this.wsService.send({
            action: 'saveOrganization',
            data: org,
        });
    }

    private async syncOrganizationFromCloud(organizationId: string): Promise<void> {
        try {
            const ws = await this.canUseCloud();
            if (!ws) return;
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getOrganization',
                organizationId,
            });
            if (response?.data) {
                const { owned: _owned, ...serialized } = response.data as LoadedOrganization;
                await this.dbService.saveOrganization(serialized);
            }
        } catch {
            // Silently fail — will retry on next list
        }
    }
}
