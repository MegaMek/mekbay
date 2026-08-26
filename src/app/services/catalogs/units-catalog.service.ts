// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { REMOTE_HOST, normalizeUnitServerUrl } from '../../models/common.model';
import type { UnitSummary, Units } from '../../models/unit-summary.model';
import { materializeUnitSummaryView } from '../../utils/unit-summary-view';
import { withServiceWorkerBypass } from '../../utils/service-worker-bypass.util';
import { LoggerService } from '../logger.service';
import { OptionsService } from '../options.service';
import {
    CoreUnitCatalogService,
    type CoreUnitCatalogSnapshot,
    type PreparedCoreCatalogActivation,
} from '../unit-catalog/core-unit-catalog.service';
import {
    customProviderIdForServer,
    importCustomProviderUnits,
} from '../unit-catalog/custom-provider-catalog';
import {
    asUnitProviderId,
    asUnitUuid,
    encodeDesignIdentity,
    MM_DATA_UNIT_PROVIDER_ID,
    type StoredCoreContent,
    type CatalogActivationId,
    type UnitProviderId,
} from '../unit-catalog/unit-catalog.types';
import { CatalogStorage } from './catalog-storage.service';

const MAX_CUSTOM_UNITS = 100_000;
const CUSTOM_RELATIVE_SIZE_FLOOR = 0.75;
const CUSTOM_RELATIVE_CHECK_MINIMUM = 100;

/**
 * Maximum number of verified MTF/BLK sources retained in memory.
 *
 * The cache lives at the catalog facade so repeated entity/Intel opens do not
 * ask the core ZIP worker to extract the same member again. Cached bytes are
 * always copied on ingress and egress; callers never receive the cache's
 * mutable ArrayBuffer. A core catalog revision change invalidates every entry.
 */
export const NATIVE_UNIT_SOURCE_CACHE_LIMIT = 20;

interface CachedNativeUnitSource {
    readonly coreRevision: number;
    readonly coreActivationId?: CatalogActivationId;
    readonly source: StoredCoreContent;
}

export interface UnitsCatalogSnapshot {
    readonly revision: number;
    readonly coreRevision: number;
    readonly coreActivationId?: CatalogActivationId;
    readonly summaries: readonly UnitSummary[];
    readonly units: UnitSummary[];
    readonly summariesByIdentity: ReadonlyMap<string, UnitSummary>;
}

interface PreparedUnitsCatalogActivationBase {
    /** Candidate Units revision; this is the exact Data settlement identity. */
    readonly revision: number;
    readonly coreRevision: number;
    readonly customOverlayRevision: number;
    readonly snapshot: UnitsCatalogSnapshot;
}

export type PreparedUnitsCatalogActivation =
    | (PreparedUnitsCatalogActivationBase & {
        readonly kind: 'megamek';
        readonly core: PreparedCoreCatalogActivation;
    })
    | (PreparedUnitsCatalogActivationBase & {
        /** User/custom-provider overlay over an already committed core bundle. */
        readonly kind: 'auxiliary';
    });

/**
 * Catalog facade during the Unit -> UnitSummary consumer migration.
 *
 * MegaMek data comes only from the locally generated native-source snapshot.
 * Additional `units.json` servers are imported as provider-scoped catalog-only
 * summaries. They deliberately remain non-gameplay until a server exposes real
 * UUID-addressed native sources. The old raw cache is retained as recovery
 * evidence and last-known-good transport input in the disposable catalog DB.
 */
@Injectable({ providedIn: 'root' })
export class UnitsCatalogService {
    private readonly core = inject(CoreUnitCatalogService);
    private readonly catalogStorage = inject(CatalogStorage);
    private readonly optionsService = inject(OptionsService);
    private readonly http = inject(HttpClient);
    private readonly logger = inject(LoggerService);

    public readonly coreState = this.core.state;

    private readonly snapshotValue = signal<UnitsCatalogSnapshot>(Object.freeze({
        revision: 0,
        coreRevision: 0,
        summaries: Object.freeze([]),
        units: [],
        summariesByIdentity: new Map<string, UnitSummary>(),
    }));
    public readonly catalogSnapshot = this.snapshotValue.asReadonly();
    public readonly catalogRevision = computed(() => this.snapshotValue().revision);
    private readonly pendingActivationValue = signal<PreparedUnitsCatalogActivation | undefined>(undefined);
    public readonly pendingActivation = this.pendingActivationValue.asReadonly();
    private readonly liveCoreUpdatesEnabled = signal(false);
    private customSummaries: readonly UnitSummary[] = Object.freeze([]);
    private providerServer = new Map<UnitProviderId, string>();
    private customOverlayRevision = 0;
    private appliedCoreRevision = 0;
    private readonly nativeSourceCache = new Map<string, CachedNativeUnitSource>();
    private readonly nativeSourceLoads = new Map<string, Promise<StoredCoreContent | undefined>>();
    /** Increments for every prepared candidate, including superseded ones. */
    private nextPreparedRevision = 1;
    private initialized = false;
    private initialization?: Promise<void>;
    /** Optional custom-provider work is observed by diagnostics, never foreground readiness. */
    private customServerRefreshSettlement: Promise<void> = Promise.resolve();

    public constructor() {
        effect(() => {
            const enabled = this.liveCoreUpdatesEnabled();
            const pending = this.core.pendingActivation();
            const prepared = this.pendingActivationValue();
            if (enabled && pending
                && (prepared?.kind !== 'megamek' || pending.revision !== prepared.coreRevision)) {
                this.prepareCoreActivation(pending);
            }
            const coreSnapshot = this.core.catalogSnapshot();
            if (!enabled || coreSnapshot.revision <= this.appliedCoreRevision) return;
            this.prepareAuxiliaryActivation(coreSnapshot);
        });
    }

    public initialize(): Promise<void> {
        if (this.initialized) return Promise.resolve();
        if (this.initialization) return this.initialization;
        this.initialization = this.performInitialize()
            .then(() => { this.initialized = true; })
            .finally(() => { this.initialization = undefined; });
        return this.initialization;
    }

    public getUnits(): UnitSummary[] {
        return this.snapshotValue().units;
    }

    public getCoreSummaries(): readonly UnitSummary[] {
        return this.snapshotValue().summaries;
    }

    public getCoreSummaryByIdentity(provider: UnitProviderId, uuid: string): UnitSummary | undefined {
        try {
            return this.snapshotValue().summariesByIdentity.get(encodeDesignIdentity({
                provider: asUnitProviderId(provider),
                uuid: asUnitUuid(uuid),
            }));
        } catch {
            return undefined;
        }
    }

    public async readNativeUnitSource(
        provider: UnitProviderId,
        uuid: string,
    ): Promise<StoredCoreContent | undefined> {
        if (provider !== MM_DATA_UNIT_PROVIDER_ID) return undefined;
        const coreSnapshot = this.core.catalogSnapshot();
        const coreRevision = coreSnapshot.revision;
        const coreActivationId = coreSnapshot.generation?.activationId;
        const cached = this.nativeSourceCache.get(uuid);
        let source: StoredCoreContent | undefined;
        if (cached?.coreRevision === coreRevision
            && cached.coreActivationId === coreActivationId) {
            // Map insertion order is the LRU order. Touch before returning.
            this.nativeSourceCache.delete(uuid);
            this.nativeSourceCache.set(uuid, cached);
            source = cloneStoredCoreContent(cached.source);
        } else {
            if (cached) this.nativeSourceCache.delete(uuid);
            const loadKey = `${coreRevision}\0${coreActivationId ?? ''}\0${uuid}`;
            let loading = this.nativeSourceLoads.get(loadKey);
            if (!loading) {
                loading = (async () => {
                    const loaded = await this.core.readUnitSource(uuid);
                    if (!loaded) return undefined;
                    const currentCore = this.core.catalogSnapshot();
                    if (currentCore.revision !== coreRevision
                        || currentCore.generation?.activationId !== coreActivationId) {
                        throw new Error('Core catalog generation changed while opening the native unit source');
                    }
                    const retained = cloneStoredCoreContent(loaded);
                    this.nativeSourceCache.set(uuid, Object.freeze({
                        coreRevision,
                        ...(coreActivationId === undefined ? {} : { coreActivationId }),
                        source: retained,
                    }));
                    while (this.nativeSourceCache.size > NATIVE_UNIT_SOURCE_CACHE_LIMIT) {
                        this.nativeSourceCache.delete(this.nativeSourceCache.keys().next().value!);
                    }
                    const summary = this.getCoreSummaryByIdentity(provider, uuid);
                    const unitLabel = summary ? ` for unit "${summary.name}"` : '';
                    this.logger.info(
                        `Opening native ${retained.format.toUpperCase()} unit file "${retained.file}"${unitLabel} (${provider}/${uuid}).`,
                    );
                    return retained;
                })().finally(() => this.nativeSourceLoads.delete(loadKey));
                this.nativeSourceLoads.set(loadKey, loading);
            }
            const retained = await loading;
            if (!retained) return undefined;
            source = cloneStoredCoreContent(retained);
        }
        if (!source) return undefined;
        return source;
    }

    /** Settles every initial catalog producer, including optional custom providers. */
    public async whenBackgroundCatalogSettled(): Promise<void> {
        await Promise.all([
            this.core.whenRefreshSettled(),
            this.customServerRefreshSettlement,
        ]);
    }

    /** DataService calls this only after it has rebuilt every derived index. */
    public acknowledgeCatalogRevisionApplied(revision: number): Promise<void> {
        const snapshot = this.snapshotValue();
        if (revision !== snapshot.revision || snapshot.coreActivationId === undefined) {
            return Promise.resolve();
        }
        return this.core.acknowledgeCatalogConsumersReady(
            snapshot.coreRevision,
            snapshot.coreActivationId,
        );
    }

    private async performInitialize(): Promise<void> {
        await this.core.initialize();
        const initialPending = this.core.pendingActivation();
        if (!initialPending && this.core.catalogSnapshot().summaries.length === 0) {
            throw new Error('The core unit catalog prepared no complete activation');
        }
        const pending = this.core.pendingActivation();
        if (pending) {
            this.prepareCoreActivation(pending);
        } else if (this.core.catalogSnapshot().summaries.length === 0) {
            throw new Error('The core unit catalog prepared no complete activation');
        } else {
            this.prepareAuxiliaryActivation(this.core.catalogSnapshot());
        }
        this.liveCoreUpdatesEnabled.set(true);

        // Custom providers are optional network overlays. Publish the saved
        // catalog first; if an overlay changes, it receives its own
        // later activation and cannot delay local search or saved-force use.
        this.customServerRefreshSettlement = this.refreshCustomServers().then(changed => {
            if (!changed) return;
            const currentCorePending = this.core.pendingActivation();
            if (currentCorePending) {
                this.prepareCoreActivation(currentCorePending);
            } else {
                this.prepareAuxiliaryActivation(this.core.catalogSnapshot());
            }
        });
        void this.customServerRefreshSettlement;
    }

    private async refreshCustomServers(): Promise<boolean> {
        const servers = this.configuredCustomServers();
        if (servers.length === 0
            && this.customSummaries.length === 0
            && this.providerServer.size === 0) {
            return false;
        }
        const startedAt = Date.now();
        try {
            const changed = await this.loadCustomServers(servers);
            if (changed) {
                this.logger.info(
                    `[Background:custom-unit-catalogs] Updated in ${Math.max(0, Date.now() - startedAt)} ms.`,
                );
            }
            return changed;
        } catch (error) {
            this.logger.warn(
                `[Background:custom-unit-catalogs] Failed after ${Math.max(0, Date.now() - startedAt)} ms: ${this.describeServerError(error)}`,
            );
            return false;
        }
    }

    /** Final no-build switch invoked in the same turn as Core/Data commits. */
    public commitPendingActivation(revision: number): UnitsCatalogSnapshot | undefined {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return undefined;
        const committedCustomOverlayRevision = pending.customOverlayRevision;
        if (pending.kind === 'megamek') {
            if (!this.core.commitPendingActivation(pending.core.revision)) return undefined;
            this.appliedCoreRevision = pending.core.snapshot.revision;
            this.nativeSourceCache.clear();
        } else {
            this.appliedCoreRevision = pending.coreRevision;
        }
        this.snapshotValue.set(pending.snapshot);
        this.pendingActivationValue.set(undefined);
        if (committedCustomOverlayRevision !== this.customOverlayRevision) {
            // Custom transport may have completed while a cold core candidate
            // was still invisible. Queue it after this exact commit;
            // never publish the custom Unit[] ahead of Data settlement.
            queueMicrotask(() => this.prepareAuxiliaryActivation(this.core.catalogSnapshot()));
        }
        return pending.snapshot;
    }

    public async finalizePendingActivation(revision: number): Promise<boolean> {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return false;
        return pending.kind === 'auxiliary'
            ? true
            : this.core.finalizePendingActivation(pending.core.revision);
    }

    public rejectPendingActivation(revision: number, error: unknown): void {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return;
        this.pendingActivationValue.set(undefined);
        if (pending.kind === 'megamek') {
            this.core.rejectPendingActivation(pending.core.revision, error);
        }
    }

    private prepareCoreActivation(core: PreparedCoreCatalogActivation): PreparedUnitsCatalogActivation {
        const existing = this.pendingActivationValue();
        if (existing?.kind === 'megamek'
            && existing.coreRevision === core.revision
            && existing.customOverlayRevision === this.customOverlayRevision) return existing;
        const snapshot = this.buildCombinedSnapshot(core.snapshot);
        const prepared = Object.freeze({
            kind: 'megamek' as const,
            revision: snapshot.revision,
            coreRevision: core.revision,
            customOverlayRevision: this.customOverlayRevision,
            core,
            snapshot,
        });
        this.pendingActivationValue.set(prepared);
        return prepared;
    }

    private prepareAuxiliaryActivation(coreSnapshot: CoreUnitCatalogSnapshot): PreparedUnitsCatalogActivation | undefined {
        const existing = this.pendingActivationValue();
        if (existing?.kind === 'megamek') return undefined;
        if (existing?.kind === 'auxiliary'
            && existing.coreRevision === coreSnapshot.revision
            && existing.customOverlayRevision === this.customOverlayRevision) {
            return existing;
        }
        const snapshot = this.buildCombinedSnapshot(coreSnapshot);
        const prepared = Object.freeze({
            kind: 'auxiliary' as const,
            revision: snapshot.revision,
            coreRevision: coreSnapshot.revision,
            customOverlayRevision: this.customOverlayRevision,
            snapshot,
        });
        this.pendingActivationValue.set(prepared);
        return prepared;
    }

    private configuredCustomServers(): readonly string[] {
        const configured = this.optionsService.options().unitServers ?? [];
        const primaryHost = normalizeUnitServerUrl(REMOTE_HOST);
        return Array.from(new Set(
            configured
                .map(normalizeUnitServerUrl)
                .filter(server => server && server !== primaryHost),
        ));
    }

    private async loadCustomServers(servers: readonly string[]): Promise<boolean> {
        if (servers.length === 0) {
            const changed = this.customSummaries.length > 0 || this.providerServer.size > 0;
            this.customSummaries = Object.freeze([]);
            this.providerServer = new Map<UnitProviderId, string>();
            if (changed) this.customOverlayRevision += 1;
            return changed;
        }

        const customSummaries: UnitSummary[] = [];
        const identities = new Set(
            this.core.catalogSnapshot().summaries.map(summary => encodeDesignIdentity(summary)),
        );
        const providerServer = new Map<UnitProviderId, string>();

        for (const server of servers) {
            let data: Units | null = null;
            try {
                data = await this.loadServerUnits(server);
            } catch (error) {
                this.logger.warn(`Failed to load units from additional server ${server}: ${this.describeServerError(error)}`);
                continue;
            }
            if (!data || !Array.isArray(data.units)) continue;

            try {
                const imported = await importCustomProviderUnits(server, data);
                const provider = await customProviderIdForServer(server);
                providerServer.set(provider, server);
                let added = 0;
                for (const summary of imported) {
                    const identity = encodeDesignIdentity(summary);
                    // Provider + UUID is the identity. A same-named or same-UUID
                    // design from another provider is not an override.
                    if (identities.has(identity)) continue;
                    identities.add(identity);
                    customSummaries.push(summary);
                    added += 1;
                }
                this.logger.info(`Imported ${added} catalog-only unit(s) from ${server}.`);
            } catch (error) {
                this.logger.warn(`Ignoring invalid custom-provider catalog from ${server}: ${this.describeServerError(error)}`);
            }
        }
        // Custom rows are normalized JSON summaries. Compare the complete
        // authoritative rows, not only their identities: a provider is allowed
        // to update an existing design without changing its UUID.
        const changed = JSON.stringify(this.customSummaries) !== JSON.stringify(customSummaries);
        this.customSummaries = Object.freeze(customSummaries);
        this.providerServer = providerServer;
        if (changed) this.customOverlayRevision += 1;
        return changed;
    }

    private buildCombinedSnapshot(coreSnapshot: CoreUnitCatalogSnapshot): UnitsCatalogSnapshot {

        const summaries = Object.freeze([
            ...coreSnapshot.summaries,
            ...this.customSummaries,
        ]);
        for (const summary of summaries) {
            if (Object.prototype.hasOwnProperty.call(summary, 'fluff')) {
                throw new Error('Runtime catalog summary cannot contain native-source fluff');
            }
        }
        const summariesByIdentity = new Map<string, UnitSummary>();
        for (const summary of summaries) {
            summariesByIdentity.set(encodeDesignIdentity(summary), summary);
        }

        const previousUnitsByIdentity = new Map<string, UnitSummary>();
        const currentSnapshot = this.snapshotValue();
        for (let index = 0; index < currentSnapshot.units.length; index += 1) {
            const previousSummary = currentSnapshot.summaries[index];
            const previousUnit = currentSnapshot.units[index];
            if (previousSummary && previousUnit) {
                previousUnitsByIdentity.set(encodeDesignIdentity(previousSummary), previousUnit);
            }
        }
        const units = summaries.map(summary => {
            const adapted = materializeUnitSummaryView(summary);
            const server = this.providerServer.get(summary.provider);
            const unit = server ? { ...adapted, serverHost: server } : adapted;
            const previous = previousUnitsByIdentity.get(encodeDesignIdentity(summary));
            if (previous) preserveTransientUnitOverlays(previous, unit);
            return unit;
        });

        return Object.freeze({
            revision: this.nextPreparedRevision++,
            coreRevision: coreSnapshot.revision,
            ...(coreSnapshot.generation
                ? { coreActivationId: coreSnapshot.generation.activationId }
                : {}),
            summaries,
            units,
            summariesByIdentity,
        });
    }

    private async loadServerUnits(server: string): Promise<Units | null> {
        const url = `${server}/units.json`;
        const storageKey = await customUnitsStorageKey(server);
        const cachedCandidate = await this.catalogStorage.get<Units>(storageKey);
        const cached = isUsableCustomDataset(cachedCandidate) ? cachedCandidate : null;
        if (cachedCandidate && !cached) {
            this.logger.warn(`Ignoring malformed cached units from additional server ${server}.`);
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) return cached ?? null;

        try {
            const response = await firstValueFrom(this.http.get<Units>(withServiceWorkerBypass(url), {
                observe: 'response',
                reportProgress: false,
            }));
            const body = response.body;
            if (!isUsableCustomDataset(body) || isImplausibleCustomShrink(body, cached)) {
                this.logger.warn(`Additional server ${server} returned an invalid or implausibly truncated unit catalog.`);
                return cached ?? null;
            }
            const assetHash = body.assetHash;
            if (cached?.assetHash === assetHash) return cached;
            const data: Units = {
                version: body.version,
                assetHash,
                units: body.units,
            };
            await this.catalogStorage.put(storageKey, assetHash, data);
            return data;
        } catch (error) {
            this.logger.warn(`Failed to download units from ${server}: ${this.describeServerError(error)}`);
            return cached ?? null;
        }
    }

    private describeServerError(error: unknown): string {
        if (error instanceof HttpErrorResponse) {
            if (error.status === 0) {
                return 'network/CORS error (status 0); verify the server and its CORS headers';
            }
            return `HTTP ${error.status} ${error.statusText}`.trim();
        }
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
}

async function customUnitsStorageKey(server: string): Promise<string> {
    const provider = await customProviderIdForServer(server);
    return `custom_units_${provider.slice('custom:'.length)}`;
}

function cloneStoredCoreContent(source: StoredCoreContent): StoredCoreContent {
    return Object.freeze({
        file: source.file,
        hash: source.hash,
        format: source.format,
        bytes: source.bytes.slice(0),
    });
}

function isUsableCustomDataset(data: Units | null | undefined): data is Units {
    return !!data
        && Array.isArray(data.units)
        && data.units.length > 0
        && data.units.length <= MAX_CUSTOM_UNITS
        && typeof data.assetHash === 'string'
        && data.assetHash.length > 0
        && data.units.every(unit => typeof unit?.name === 'string' && unit.name.trim().length > 0);
}

function isImplausibleCustomShrink(candidate: Units, previous: Units | null): boolean {
    return !!previous
        && previous.units.length >= CUSTOM_RELATIVE_CHECK_MINIMUM
        && candidate.units.length < Math.ceil(previous.units.length * CUSTOM_RELATIVE_SIZE_FLOOR);
}

function preserveTransientUnitOverlays(source: UnitSummary, target: UnitSummary): void {
    target._nameTags = (source._nameTags ?? []).map(entry => ({ ...entry }));
    target._chassisTags = (source._chassisTags ?? []).map(entry => ({ ...entry }));
    target._publicTags = source._publicTags?.map(entry => ({ ...entry }));
}
