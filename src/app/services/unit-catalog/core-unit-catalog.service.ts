// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { UnitSummary } from '../../models/unit-summary.model';
import { CORE_CATALOG_ARCHIVE_WORKER_FACTORY } from '../../utils/core-catalog-archive-worker-factory.util';
import { UNIT_SUMMARY_PROJECTION_WORKERS } from '../../utils/unit-summary-projection-worker-factory.util';
import { CatalogDownloadTrackerService } from '../catalogs/catalog-base.service';
import { RepositoryAssetManifestService } from '../catalogs/repository-asset-manifest.service';
import { LoggerService } from '../logger.service';
import {
    ApplicationCatalogBundleCoordinatorService,
    type PreparedApplicationCatalogDependencies,
} from './application-catalog-bundle-coordinator.service';
import {
    CoreCatalogSynchronizer,
    sameSummaryDependencyHashes,
    type CoreCatalogSyncProgress,
    type CoreCatalogSyncResult,
    type PreparedCoreCatalogSynchronization,
} from './core-catalog-synchronizer';
import {
    openCoreCatalogSourceArchiveInWorker,
    type WorkerBackedCoreSourceArchive,
} from './core-catalog-archive-worker-client';
import { isUnitSummaryArray } from './core-catalog-generation';
import { openStoredCoreUnitArchive, type CoreUnitArchive } from './core-unit-archive';
import type { CoreUnitsManifest } from './core-unit-manifest';
import { buildStoredCoreContent } from './native-unit-source';
import {
    type PublishedCatalogGeneration,
    UnitCatalogDatabase,
    UnitCatalogDatabaseOpenBlockedError,
} from './unit-catalog-database';
import {
    asUnitUuid,
    type CatalogActivationId,
    type StoredCoreContent,
} from './unit-catalog.types';

export type CoreUnitCatalogState =
    | { readonly status: 'idle'; readonly availableUnits: 0 }
    | { readonly status: 'loading'; readonly availableUnits: number; readonly progress?: CoreCatalogSyncProgress }
    | { readonly status: 'ready'; readonly availableUnits: number; readonly result?: CoreCatalogSyncResult }
    | { readonly status: 'error'; readonly availableUnits: number; readonly error: string };

export interface CoreUnitCatalogSnapshot {
    readonly revision: number;
    readonly summaries: readonly UnitSummary[];
    readonly generation?: PublishedCatalogGeneration<readonly UnitSummary[]>;
}

export interface PreparedCoreCatalogActivation {
    readonly revision: number;
    readonly generation: PublishedCatalogGeneration<readonly UnitSummary[]>;
    readonly dependencies: PreparedApplicationCatalogDependencies;
    readonly preparedCore?: PreparedCoreCatalogSynchronization;
    readonly snapshot: CoreUnitCatalogSnapshot;
    readonly committedState: CoreUnitCatalogState;
}

interface OpenedSourceArchive {
    readonly archive: CoreUnitArchive;
    dispose(): void;
}

@Injectable({ providedIn: 'root' })
export class CoreUnitCatalogBackend {
    private readonly createArchiveWorker = inject(CORE_CATALOG_ARCHIVE_WORKER_FACTORY);
    private readonly summaryWorkers = inject(UNIT_SUMMARY_PROJECTION_WORKERS);
    private readonly repositoryAssets = inject(RepositoryAssetManifestService);

    public openDatabase(): Promise<UnitCatalogDatabase> {
        return UnitCatalogDatabase.open();
    }

    public createSynchronizer(database: UnitCatalogDatabase): CoreCatalogSynchronizer {
        return new CoreCatalogSynchronizer(database, {
            baseUrl: globalThis.document.baseURI,
            repositoryAssets: this.repositoryAssets,
            ...(this.createArchiveWorker ? { createArchiveWorker: this.createArchiveWorker } : {}),
            ...(this.summaryWorkers ? { summaryWorkers: this.summaryWorkers } : {}),
        });
    }

    public async openStoredSourceArchive(
        blob: Blob,
        manifest: CoreUnitsManifest,
        signal: AbortSignal,
    ): Promise<OpenedSourceArchive> {
        const bytes = await blob.arrayBuffer();
        if (this.createArchiveWorker) {
            const opened: WorkerBackedCoreSourceArchive = await openCoreCatalogSourceArchiveInWorker(
                bytes,
                manifest,
                { createWorker: this.createArchiveWorker, signal },
            );
            return opened;
        }
        return Object.freeze({
            archive: await openStoredCoreUnitArchive(bytes, manifest),
            dispose: () => undefined,
        });
    }
}

@Injectable({ providedIn: 'root' })
export class CoreUnitCatalogService {
    private readonly bundles = inject(ApplicationCatalogBundleCoordinatorService);
    private readonly backend = inject(CoreUnitCatalogBackend);
    private readonly downloads = inject(CatalogDownloadTrackerService);
    private readonly logger = inject(LoggerService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly stateValue = signal<CoreUnitCatalogState>({ status: 'idle', availableUnits: 0 });
    public readonly state = this.stateValue.asReadonly();
    private readonly snapshotValue = signal<CoreUnitCatalogSnapshot>(Object.freeze({
        revision: 0,
        summaries: Object.freeze([]),
    }));
    public readonly catalogSnapshot = this.snapshotValue.asReadonly();
    public readonly catalogRevision = computed(() => this.snapshotValue().revision);
    private readonly pendingActivationValue = signal<PreparedCoreCatalogActivation | undefined>(undefined);
    public readonly pendingActivation = this.pendingActivationValue.asReadonly();

    private database?: UnitCatalogDatabase;
    private synchronizer?: CoreCatalogSynchronizer;
    private activeDependencies?: PreparedApplicationCatalogDependencies;
    private initialization?: Promise<void>;
    private nextPendingRevision = 1;
    private destroyed = false;
    private refreshAfterInitialCommit = false;
    private readonly abortController = new AbortController();
    private sourceArchive?: {
        readonly activationId: CatalogActivationId;
        readonly opened: OpenedSourceArchive;
    };
    private sourceArchiveOpening?: { readonly activationId: CatalogActivationId; readonly promise: Promise<OpenedSourceArchive> };
    private retainedSource?: { readonly activationId: CatalogActivationId; readonly blob: Blob };

    public constructor() {
        this.destroyRef.onDestroy(() => {
            this.destroyed = true;
            this.abortController.abort();
            this.sourceArchive?.opened.dispose();
            this.database?.close();
        });
    }

    public getSummaries(): readonly UnitSummary[] {
        return this.snapshotValue().summaries;
    }

    public getPublishedGeneration(): PublishedCatalogGeneration<readonly UnitSummary[]> | undefined {
        return this.snapshotValue().generation;
    }

    public initialize(): Promise<void> {
        if (this.initialization) return this.initialization;
        this.initialization = this.performInitialize();
        return this.initialization;
    }

    public async finalizePendingActivation(revision: number): Promise<boolean> {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return false;
        const active = this.snapshotValue().generation;
        if (active && this.retainedSource?.activationId !== active.activationId) {
            // Retain the Blob handle without decompressing it. Disk can switch before the UI does.
            const blob = await this.database!.readSourceArchive(active.manifest.hash);
            if (!blob && this.sourceArchive?.activationId !== active.activationId) throw new Error('The active unit source ZIP is unavailable');
            if (blob) this.retainedSource = { activationId: active.activationId, blob };
        }
        if (this.destroyed || this.pendingActivationValue()?.revision !== revision) return false;
        await this.bundles.persistPreparedDependencies(pending.dependencies);
        await pending.preparedCore?.finalize();
        if (pending.preparedCore?.assetsManifest) {
            await this.bundles.recordInstalledUnitAssets(pending.preparedCore.assetsManifest);
        }
        return !this.destroyed && this.pendingActivationValue()?.revision === revision;
    }

    public commitPendingActivation(revision: number): CoreUnitCatalogSnapshot | undefined {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return undefined;
        this.bundles.commitPreparedDependencies(pending.dependencies);
        this.activeDependencies = pending.dependencies;
        this.sourceArchive?.opened.dispose();
        this.sourceArchive = undefined;
        this.sourceArchiveOpening = undefined;
        this.retainedSource = pending.generation.sourceArchive
            ? { activationId: pending.generation.activationId, blob: pending.generation.sourceArchive } : undefined;
        this.snapshotValue.set(pending.snapshot);
        this.pendingActivationValue.set(undefined);
        this.stateValue.set(pending.committedState);
        if (this.refreshAfterInitialCommit) {
            this.refreshAfterInitialCommit = false;
            this.startBackgroundRefresh();
        }
        return pending.snapshot;
    }

    public rejectPendingActivation(revision: number, error: unknown): void {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return;
        pending.preparedCore?.discard();
        this.pendingActivationValue.set(undefined);
        const snapshot = this.snapshotValue();
        const message = describeError(error);
        if (snapshot.summaries.length > 0) {
            this.logger.warn(`Catalog candidate was rejected; retaining active local data: ${message}`);
            this.stateValue.set({ status: 'error', availableUnits: snapshot.summaries.length, error: message });
        } else {
            this.stateValue.set({ status: 'error', availableUnits: 0, error: message });
        }
    }

    public acknowledgeCatalogConsumersReady(
        _revision: number,
        _activationId: CatalogActivationId,
    ): Promise<void> {
        return Promise.resolve();
    }

    public async readUnitSource(uuidValue: string): Promise<StoredCoreContent | undefined> {
        const generation = this.snapshotValue().generation;
        if (!generation) return undefined;
        let uuid;
        try { uuid = asUnitUuid(uuidValue); } catch { return undefined; }
        const entry = generation.manifest.manifest.units[uuid];
        if (!entry) return undefined;
        const opened = await this.getSourceArchive(generation);
        const bytes = await opened.archive.extract(entry.file);
        return buildStoredCoreContent(uuid, entry, bytes);
    }

    private async performInitialize(): Promise<void> {
        this.stateValue.set({ status: 'loading', availableUnits: 0 });
        try {
            this.database = await this.backend.openDatabase();
            this.synchronizer = this.backend.createSynchronizer(this.database);
            const active = await this.database.readActiveCatalog<readonly UnitSummary[]>();
            if (active && isUnitSummaryArray(active.summary.payload)) {
                const dependencies = await this.bundles.prepareCachedDependencies(
                    progress => this.setProgress(progress),
                );
                if (dependencies) {
                    if (sameSummaryDependencyHashes(active.summaryDependencyHashes, dependencies.assetHashes)) {
                        this.queueActivation(active, dependencies, undefined);
                    } else {
                        const recovered = await this.synchronizer.recoverCachedCatalog(active, dependencies, {
                            signal: this.abortController.signal, onProgress: progress => this.setProgress(progress),
                        });
                        this.queueActivation(recovered.generation, dependencies, recovered);
                    }
                    this.refreshAfterInitialCommit = true;
                    return;
                }
            }
            await this.performRefresh();
            if (!this.pendingActivationValue()) {
                throw new Error('The core unit catalog prepared no complete activation');
            }
        } catch (error) {
            if (error instanceof UnitCatalogDatabaseOpenBlockedError) throw error;
            this.stateValue.set({ status: 'error', availableUnits: 0, error: describeError(error) });
            throw error;
        }
    }

    private startBackgroundRefresh(): void {
        if (this.destroyed) return;
        void this.performRefresh().catch(error => {
            if (this.destroyed || this.abortController.signal.aborted) return;
            const snapshot = this.snapshotValue();
            if (isConnectivityUnavailable(error)) {
                this.logger.info('Offline; using the local unit catalog.');
                this.stateValue.set({ status: 'ready', availableUnits: snapshot.summaries.length });
                return;
            }
            const message = describeError(error);
            this.logger.warn(`Catalog refresh failed; retaining active local data: ${message}`);
            this.stateValue.set({ status: 'error', availableUnits: snapshot.summaries.length, error: message });
        });
    }

    private async performRefresh(): Promise<void> {
        if (!this.database || !this.synchronizer) throw new Error('Core unit catalog is not initialized');
        const release = await this.downloads.trackDownload(() => this.synchronizer!.preparePinnedRelease({
            signal: this.abortController.signal,
            onProgress: progress => this.setProgress(progress),
        }));
        try {
            let dependencies = this.activeDependencies;
            if (!dependencies && release.active) {
                dependencies = await this.bundles.prepareCachedDependencies(
                    progress => this.setProgress(progress),
                );
            }
            const previousDependencies = dependencies;
            if (dependencies) {
                dependencies = await this.bundles.prepareCurrentDependencies(
                    dependencies,
                    this.abortController.signal,
                    progress => this.setProgress(progress),
                );
            } else {
                const opened = await release.openArchive();
                dependencies = await this.bundles.preparePublishedBundle(
                    opened.dependencyBundle,
                    await this.bundles.currentAssetHashes(this.abortController.signal),
                    progress => this.setProgress(progress),
                );
            }
            const projector = await dependencies.getProjector();
            const prepared = await this.downloads.trackDownload(() => this.synchronizer!.prepareSynchronization(
                release,
                dependencies,
                projector,
                {
                    signal: this.abortController.signal,
                    dependenciesChanged: dependencies !== previousDependencies,
                    onProgress: progress => this.setProgress(progress),
                },
            ));
            if (!prepared.requiresPublication && prepared.result.status === 'unchanged') {
                this.stateValue.set({
                    status: 'ready',
                    availableUnits: this.snapshotValue().summaries.length,
                    result: prepared.result,
                });
                return;
            }
            this.queueActivation(prepared.generation, dependencies, prepared);
        } finally {
            release.dispose();
        }
    }

    private queueActivation(
        generation: PublishedCatalogGeneration<readonly UnitSummary[]>,
        dependencies: PreparedApplicationCatalogDependencies,
        preparedCore: PreparedCoreCatalogSynchronization | undefined,
    ): void {
        if (!isUnitSummaryArray(generation.summary.payload)) {
            throw new Error('Core catalog contains an invalid UnitSummary array');
        }
        if (!sameSummaryDependencyHashes(generation.summaryDependencyHashes, dependencies.assetHashes)) {
            throw new Error('Core summaries do not match the prepared catalog dependencies');
        }
        const revision = this.nextPendingRevision++;
        const snapshot: CoreUnitCatalogSnapshot = Object.freeze({
            revision: this.snapshotValue().revision + 1,
            summaries: generation.summary.payload,
            generation,
        });
        const committedState: CoreUnitCatalogState = Object.freeze({
            status: 'ready',
            availableUnits: snapshot.summaries.length,
            ...(preparedCore ? { result: preparedCore.result } : {}),
        });
        this.pendingActivationValue.set(Object.freeze({
            revision,
            generation,
            dependencies,
            ...(preparedCore ? { preparedCore } : {}),
            snapshot,
            committedState,
        }));
        this.stateValue.set({ status: 'loading', availableUnits: this.snapshotValue().summaries.length });
    }

    private async getSourceArchive(
        generation: PublishedCatalogGeneration<readonly UnitSummary[]>,
    ): Promise<OpenedSourceArchive> {
        if (this.sourceArchive?.activationId === generation.activationId) return this.sourceArchive.opened;
        if (!this.database) throw new Error('Unit catalog database is unavailable');
        if (this.sourceArchiveOpening?.activationId !== generation.activationId) {
            const promise = (async () => {
                const blob = this.retainedSource?.activationId === generation.activationId ? this.retainedSource.blob
                    : await this.database!.readSourceArchive(generation.manifest.hash);
                if (!blob) throw new Error('The active unit source ZIP is unavailable');
                const opened = await this.backend.openStoredSourceArchive(
                    blob,
                    generation.manifest.manifest,
                    this.abortController.signal,
                );
                if (this.destroyed || this.snapshotValue().generation?.activationId !== generation.activationId) {
                    opened.dispose();
                    throw new Error('Core catalog changed while opening its source ZIP');
                }
                this.sourceArchive = { activationId: generation.activationId, opened };
                return opened;
            })();
            this.sourceArchiveOpening = { activationId: generation.activationId, promise };
        }
        const opening = this.sourceArchiveOpening;
        try { return await opening.promise; }
        finally {
            if (this.sourceArchiveOpening === opening) this.sourceArchiveOpening = undefined;
        }
    }

    private setProgress(progress: CoreCatalogSyncProgress): void {
        if (this.destroyed) return;
        this.stateValue.set({
            status: 'loading',
            availableUnits: this.snapshotValue().summaries.length,
            progress,
        });
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isConnectivityUnavailable(error: unknown): boolean {
    if (globalThis.navigator?.onLine === false) return true;
    if (error instanceof TypeError) return true;
    if (error instanceof DOMException && error.name === 'NetworkError') return true;
    return typeof error === 'object'
        && error !== null
        && 'status' in error
        && error.status === 0;
}
