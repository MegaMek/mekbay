// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import { sha1Base64Url } from '../../utils/sha1.util';
import type {
    RepositoryAssetManifestService,
    RepositoryAssetsManifest,
} from '../catalogs/repository-asset-manifest.service';
import type {
    DependencyAssetHashes,
    PreparedApplicationCatalogDependencies,
} from './application-catalog-bundle-coordinator.service';
import { SUMMARY_DEPENDENCY_NAMES } from './application-catalog-dependency-bundle';
import {
    openCoreUnitRelease,
    openStoredCoreUnitArchive,
    type CoreUnitArchive,
    type CoreUnitRelease,
    type CoreUnitSourceReplacement,
} from './core-unit-archive';
import {
    openCoreCatalogArchiveInWorker,
    openCoreCatalogSourceArchiveInWorker,
    type CoreCatalogArchiveWorkerFactory,
    type WorkerBackedCoreRelease,
    type WorkerBackedCoreSourceArchive,
} from './core-catalog-archive-worker-client';
import {
    buildCoreCatalogGeneration,
    isReusableCoreSummary,
    prepareUnitSummaryArray,
} from './core-catalog-generation';
import {
    CORE_UNITS_ARCHIVE_PATH,
    CORE_UNITS_MANIFEST_PATH,
    MAX_PARALLEL_UNIT_FETCHES,
    MAX_INCREMENTAL_SUMMARY_REBUILDS,
    MAX_UNIT_FETCH_RETRIES,
    MAX_UNIT_SOURCE_BYTES,
    parseCoreUnitsManifest,
    planCoreCatalogDiff,
    type CoreUnitsManifest,
    type StoredCoreUnitsManifest,
} from './core-unit-manifest';
import type { CoreUnitSummaryProjector } from './entity-summary-projector';
import { buildStoredCoreContent } from './native-unit-source';
import {
    type PublishedCatalogGeneration,
    type SummaryDependencyHashes,
    UnitCatalogDatabase,
} from './unit-catalog-database';
import {
    asSourceHash,
    asUnitUuid,
    type CatalogActivationId,
    type CoreCatalogEntryKey,
    type SourceHash,
    type StoredCoreContent,
    type UnitFileName,
    type UnitUuid,
} from './unit-catalog.types';

const CORE_UNIT_FILES_ROOT = 'online-assets/generated/units';

export type CoreCatalogSyncPhase =
    | 'manifest'
    | 'dependency-fetch'
    | 'archive'
    | 'projecting'
    | 'publication';

export interface CoreCatalogSyncProgress {
    readonly phase: CoreCatalogSyncPhase;
    readonly completed: number;
    readonly total: number;
}

export interface CoreCatalogSyncResult {
    readonly status: 'unchanged' | 'updated';
    readonly activationId: CatalogActivationId;
    readonly strategy: 'none' | 'individual' | 'archive';
    readonly downloadedUnits: number;
    readonly manifestSource: 'stored' | 'repository';
}

export interface OpenedCoreRelease {
    readonly archive: CoreUnitArchive;
    readonly summaries: readonly UnitSummary[];
    readonly dependencyBundle: CoreUnitRelease['dependencyBundle'];
    readonly blob: Blob;
    dispose(): void;
}

export interface PreparedCoreRelease {
    readonly assetsManifest: RepositoryAssetsManifest;
    readonly manifest: StoredCoreUnitsManifest;
    readonly active?: PublishedCatalogGeneration<readonly UnitSummary[]>;
    readonly manifestSource: CoreCatalogSyncResult['manifestSource'];
    readonly archiveChecksum: SourceHash;
    openArchive(): Promise<OpenedCoreRelease>;
    dispose(): void;
}

export interface PreparedCoreCatalogSynchronization {
    readonly assetsManifest: RepositoryAssetsManifest;
    readonly result: CoreCatalogSyncResult;
    readonly generation: PublishedCatalogGeneration<readonly UnitSummary[]>;
    readonly requiresPublication: boolean;
    finalize(): Promise<void>;
    discard(): void;
}

interface PreparedCoreCatalogUpdate {
    readonly archiveBlob: Blob;
    readonly summaries: readonly UnitSummary[];
    readonly strategy: CoreCatalogSyncResult['strategy'];
    readonly downloadedUnits: number;
}

export interface CoreCatalogSynchronizerOptions {
    readonly baseUrl: string;
    readonly repositoryAssets: RepositoryAssetManifestService;
    readonly createArchiveWorker?: CoreCatalogArchiveWorkerFactory;
    readonly fetcher?: typeof globalThis.fetch;
}

export class CoreCatalogSynchronizer {
    private readonly fetcher: typeof globalThis.fetch;

    public constructor(
        private readonly database: UnitCatalogDatabase,
        private readonly options: CoreCatalogSynchronizerOptions,
    ) {
        this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    }

    public async preparePinnedRelease(input: {
        readonly signal: AbortSignal;
        readonly onProgress?: (progress: CoreCatalogSyncProgress) => void;
    }): Promise<PreparedCoreRelease> {
        emit(input.onProgress, { phase: 'manifest', completed: 0, total: 1 });
        const active = await this.database.readActiveCatalog<readonly UnitSummary[]>();
        const assetsManifest = await this.options.repositoryAssets.loadManifest(input.signal);
        const unitsManifestHash = asSourceHash(assetsManifest[CORE_UNITS_MANIFEST_PATH] ?? '');
        const archiveChecksum = asSourceHash(assetsManifest[CORE_UNITS_ARCHIVE_PATH] ?? '');
        const manifest = active?.manifest.hash === unitsManifestHash
            ? active.manifest
            : await this.options.repositoryAssets.readText(CORE_UNITS_MANIFEST_PATH, input.signal)
                .then(asset => parseCoreUnitsManifest(asset.text, asset.descriptor.hash));
        emit(input.onProgress, { phase: 'manifest', completed: 1, total: 1 });

        let opening: Promise<OpenedCoreRelease> | undefined;
        let opened: OpenedCoreRelease | undefined;
        let disposed = false;
        const release: PreparedCoreRelease = Object.freeze({
            assetsManifest,
            manifest,
            ...(active ? { active } : {}),
            manifestSource: active?.manifest.hash === unitsManifestHash ? 'stored' : 'repository',
            archiveChecksum,
            openArchive: async (): Promise<OpenedCoreRelease> => {
                if (disposed) throw new Error('Core release has been disposed');
                opening ??= this.openRepositoryArchive(manifest.manifest, archiveChecksum, input.signal, input.onProgress)
                    .then(value => opened = value);
                return opening;
            },
            dispose: (): void => {
                disposed = true;
                opened?.dispose();
            },
        });
        return release;
    }

    public async prepareSynchronization(
        release: PreparedCoreRelease,
        dependencies: PreparedApplicationCatalogDependencies,
        projector: CoreUnitSummaryProjector,
        input: {
            readonly signal: AbortSignal;
            readonly dependenciesChanged: boolean;
            readonly onProgress?: (progress: CoreCatalogSyncProgress) => void;
        },
    ): Promise<PreparedCoreCatalogSynchronization> {
        throwIfAborted(input.signal);
        const desired = release.manifest.manifest;
        const active = release.active;
        const activeArchiveBlob = active
            ? await this.database.readSourceArchive(active.manifest.hash)
            : undefined;
        const localFiles = new Set(activeArchiveBlob && active
            ? Object.values(active.manifest.manifest.units).map(entry => entry.file)
            : []);
        const diff = planCoreCatalogDiff(desired, active?.manifest.manifest, localFiles);
        const activeSummaries = new Map(
            (active?.summary.payload ?? []).map(summary => [summary.uuid, summary] as const),
        );
        const desiredUuids = Object.keys(desired.units) as UnitUuid[];
        const staleUuids = desiredUuids.filter(uuid => {
            const summary = activeSummaries.get(uuid);
            return !summary || !isReusableCoreSummary(summary, entryKey(uuid, desired));
        });
        const nextSummaryDependencyHashes = summaryDependencyHashes(dependencies.assetHashes);
        const summaryDependenciesChanged = !sameSummaryDependencyHashes(
            active?.summaryDependencyHashes,
            nextSummaryDependencyHashes,
        );
        const summaryRebuildCount = summaryDependenciesChanged ? desiredUuids.length : staleUuids.length;
        const unitFilesChanged = diff.addedUuids.length + diff.changedUuids.length + diff.removedUuids.length > 0;
        const unitCatalogChanged = unitFilesChanged
            || staleUuids.length > 0
            || summaryDependenciesChanged;
        if (!unitCatalogChanged && active && activeArchiveBlob) {
            return preparedSynchronization(
                this.database,
                active,
                activeArchiveBlob,
                {
                    status: input.dependenciesChanged ? 'updated' : 'unchanged',
                    activationId: active.activationId,
                    strategy: 'none',
                    downloadedUnits: 0,
                    manifestSource: release.manifestSource,
                },
                false,
                release.assetsManifest,
            );
        }

        const useArchive = !activeArchiveBlob
            || diff.strategy === 'archive'
            || summaryRebuildCount > MAX_INCREMENTAL_SUMMARY_REBUILDS;
        let update: PreparedCoreCatalogUpdate;
        if (useArchive) {
            try {
                const opened = await release.openArchive();
                update = {
                    archiveBlob: opened.blob,
                    summaries: await this.summariesFromArchive(
                        desired,
                        opened.archive,
                        opened.summaries,
                        projector,
                        input,
                    ),
                    strategy: 'archive',
                    downloadedUnits: desiredUuids.length,
                };
            } catch (error) {
                if (!activeArchiveBlob || input.signal.aborted) throw error;
                update = await this.prepareIncrementalUpdate(
                    activeArchiveBlob,
                    desired,
                    diff.missingFiles,
                    activeSummaries,
                    summaryDependenciesChanged,
                    projector,
                    input,
                );
            }
        } else {
            update = await this.prepareIncrementalUpdate(
                activeArchiveBlob,
                desired,
                diff.missingFiles,
                activeSummaries,
                summaryDependenciesChanged,
                projector,
                input,
            );
        }

        const built = buildCoreCatalogGeneration({
            unitsManifestHash: release.manifest.hash,
            summaryDependencyHashes: nextSummaryDependencyHashes,
            units: update.summaries,
        });
        const generation: PublishedCatalogGeneration<readonly UnitSummary[]> = Object.freeze({
            activationId: built.activationId,
            manifest: release.manifest,
            summary: Object.freeze({
                activationId: built.activationId,
                summaryVersion: UNIT_SUMMARY_VERSION,
                payload: built.summaries,
            }),
            summaryDependencyHashes: nextSummaryDependencyHashes,
        });
        const result: CoreCatalogSyncResult = Object.freeze({
            status: 'updated',
            activationId: generation.activationId,
            strategy: update.strategy,
            downloadedUnits: update.downloadedUnits,
            manifestSource: release.manifestSource,
        });
        return preparedSynchronization(
            this.database,
            generation,
            update.archiveBlob,
            result,
            true,
            release.assetsManifest,
            input.onProgress,
        );
    }

    private async prepareIncrementalUpdate(
        activeArchiveBlob: Blob,
        manifest: CoreUnitsManifest,
        missingFiles: readonly UnitFileName[],
        activeSummaries: ReadonlyMap<UnitUuid, UnitSummary>,
        regenerateAll: boolean,
        projector: CoreUnitSummaryProjector,
        input: {
            readonly signal: AbortSignal;
            readonly onProgress?: (progress: CoreCatalogSyncProgress) => void;
        },
    ): Promise<PreparedCoreCatalogUpdate> {
        const source = await this.openStoredArchive(activeArchiveBlob, manifest, input.signal);
        try {
            const replacements = await this.downloadChangedUnits(manifest, missingFiles, input);
            const replacementByFile = new Map(replacements.map(row => [row.file, row] as const));
            const summaries = await this.summariesFromIncrementalUpdate(
                manifest,
                source.archive,
                replacementByFile,
                activeSummaries,
                regenerateAll,
                projector,
                input,
            );
            return {
                archiveBlob: replacements.length === 0
                    ? activeArchiveBlob
                    : new Blob([await source.archive.compactSources(manifest, replacements)]),
                summaries,
                strategy: replacements.length === 0 ? 'none' : 'individual',
                downloadedUnits: replacements.length,
            };
        } finally {
            source.dispose();
        }
    }

    private async openRepositoryArchive(
        manifest: CoreUnitsManifest,
        checksum: SourceHash,
        signal: AbortSignal,
        onProgress?: (progress: CoreCatalogSyncProgress) => void,
    ): Promise<OpenedCoreRelease> {
        emit(onProgress, { phase: 'archive', completed: 0, total: 1 });
        const download = await this.options.repositoryAssets.download(CORE_UNITS_ARCHIVE_PATH, signal);
        if (download.descriptor.hash !== checksum) throw new Error('Units ZIP changed during download');
        const bytes = await download.blob.arrayBuffer();
        let opened: CoreUnitRelease | WorkerBackedCoreRelease;
        if (this.options.createArchiveWorker) {
            opened = await openCoreCatalogArchiveInWorker(bytes, checksum, manifest, {
                createWorker: this.options.createArchiveWorker,
                signal,
            });
        } else {
            opened = await openCoreUnitRelease(bytes, checksum, manifest);
        }
        emit(onProgress, { phase: 'archive', completed: 1, total: 1 });
        return Object.freeze({
            archive: opened.archive,
            summaries: opened.summaries,
            dependencyBundle: opened.dependencyBundle,
            blob: download.blob,
            dispose: () => 'dispose' in opened && opened.dispose(),
        });
    }

    private async openStoredArchive(
        blob: Blob,
        manifest: CoreUnitsManifest,
        signal: AbortSignal,
    ): Promise<{ readonly archive: CoreUnitArchive; dispose(): void }> {
        const bytes = await blob.arrayBuffer();
        if (this.options.createArchiveWorker) {
            const opened: WorkerBackedCoreSourceArchive = await openCoreCatalogSourceArchiveInWorker(
                bytes,
                manifest,
                { createWorker: this.options.createArchiveWorker, signal },
            );
            return opened;
        }
        return Object.freeze({
            archive: await openStoredCoreUnitArchive(bytes, manifest),
            dispose: () => undefined,
        });
    }

    private async downloadChangedUnits(
        manifest: CoreUnitsManifest,
        files: readonly UnitFileName[],
        input: {
            readonly signal: AbortSignal;
            readonly onProgress?: (progress: CoreCatalogSyncProgress) => void;
        },
    ): Promise<readonly (StoredCoreContent & CoreUnitSourceReplacement)[]> {
        const completed: (StoredCoreContent & CoreUnitSourceReplacement)[] = [];
        let cursor = 0;
        emit(input.onProgress, { phase: 'archive', completed: 0, total: files.length });
        const worker = async (): Promise<void> => {
            for (;;) {
                const index = cursor++;
                if (index >= files.length) return;
                const file = files[index];
                const uuid = asUnitUuid(file.slice(0, -4));
                const entry = manifest.units[uuid];
                const stored = await this.downloadUnit(uuid, entry, input.signal);
                completed.push(stored);
                emit(input.onProgress, { phase: 'archive', completed: completed.length, total: files.length });
            }
        };
        await Promise.all(Array.from(
            { length: Math.min(MAX_PARALLEL_UNIT_FETCHES, files.length) },
            () => worker(),
        ));
        return Object.freeze(completed);
    }

    private async downloadUnit(
        uuid: UnitUuid,
        entry: CoreUnitsManifest['units'][UnitUuid],
        signal: AbortSignal,
    ): Promise<StoredCoreContent & CoreUnitSourceReplacement> {
        const url = new URL(`${CORE_UNIT_FILES_ROOT}/${entry.file}`, this.options.baseUrl);
        url.searchParams.set('ngsw-bypass', 'true');
        let lastError: unknown;
        for (let attempt = 0; attempt <= MAX_UNIT_FETCH_RETRIES; attempt += 1) {
            throwIfAborted(signal);
            try {
                const response = await this.fetcher(url, {
                    method: 'GET',
                    cache: 'no-cache',
                    credentials: 'same-origin',
                    redirect: 'error',
                    signal,
                });
                if (!response.ok || response.status !== 200 || response.redirected) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const bytes = await readBoundedResponse(response, MAX_UNIT_SOURCE_BYTES);
                if (await sha1Base64Url(bytes) !== entry.hash) {
                    throw new Error('SHA-1 mismatch');
                }
                return await buildStoredCoreContent(uuid, entry, bytes);
            } catch (error) {
                if (signal.aborted) throw error;
                lastError = error;
            }
        }
        throw new Error(`Failed to download ${entry.file}`, { cause: lastError });
    }

    private async summariesFromArchive(
        manifest: CoreUnitsManifest,
        archive: CoreUnitArchive,
        embedded: readonly UnitSummary[],
        projector: CoreUnitSummaryProjector,
        input: {
            readonly signal: AbortSignal;
            readonly onProgress?: (progress: CoreCatalogSyncProgress) => void;
        },
    ): Promise<readonly UnitSummary[]> {
        const embeddedByUuid = new Map(embedded.map(summary => [summary.uuid, summary] as const));
        return this.projectSummaries(manifest, projector, input, async (uuid, entry) => {
            const summary = embeddedByUuid.get(uuid);
            if (summary && isReusableCoreSummary(summary, entryKey(uuid, manifest))) return summary;
            return this.project(projector, uuid, entry, await archive.extract(entry.file));
        });
    }

    private async summariesFromIncrementalUpdate(
        manifest: CoreUnitsManifest,
        archive: CoreUnitArchive,
        replacements: ReadonlyMap<UnitFileName, StoredCoreContent>,
        active: ReadonlyMap<UnitUuid, UnitSummary>,
        regenerateAll: boolean,
        projector: CoreUnitSummaryProjector,
        input: {
            readonly signal: AbortSignal;
            readonly onProgress?: (progress: CoreCatalogSyncProgress) => void;
        },
    ): Promise<readonly UnitSummary[]> {
        return this.projectSummaries(manifest, projector, input, async (uuid, entry) => {
            const summary = active.get(uuid);
            if (!regenerateAll && summary && isReusableCoreSummary(summary, entryKey(uuid, manifest))) return summary;
            const bytes = replacements.get(entry.file)?.bytes ?? await archive.extract(entry.file);
            return this.project(projector, uuid, entry, bytes);
        });
    }

    private async projectSummaries(
        manifest: CoreUnitsManifest,
        _projector: CoreUnitSummaryProjector,
        input: {
            readonly signal: AbortSignal;
            readonly onProgress?: (progress: CoreCatalogSyncProgress) => void;
        },
        resolve: (
            uuid: UnitUuid,
            entry: CoreUnitsManifest['units'][UnitUuid],
        ) => Promise<UnitSummary>,
    ): Promise<readonly UnitSummary[]> {
        const uuids = Object.keys(manifest.units).sort() as UnitUuid[];
        const summaries = new Array<UnitSummary>(uuids.length);
        let cursor = 0;
        let completed = 0;
        emit(input.onProgress, { phase: 'projecting', completed, total: uuids.length });
        const worker = async (): Promise<void> => {
            for (;;) {
                const index = cursor++;
                if (index >= uuids.length) return;
                throwIfAborted(input.signal);
                const uuid = uuids[index];
                summaries[index] = await resolve(uuid, manifest.units[uuid]);
                completed += 1;
                emit(input.onProgress, { phase: 'projecting', completed, total: uuids.length });
            }
        };
        await Promise.all(Array.from(
            { length: Math.min(MAX_PARALLEL_UNIT_FETCHES, uuids.length) },
            () => worker(),
        ));
        return prepareUnitSummaryArray(summaries);
    }

    private async project(
        projector: CoreUnitSummaryProjector,
        uuid: UnitUuid,
        entry: CoreUnitsManifest['units'][UnitUuid],
        bytes: ArrayBuffer,
    ): Promise<UnitSummary> {
        const projected = await projector.project({
            entryKey: entryKey(uuid, { units: { [uuid]: entry } } as CoreUnitsManifest),
            format: entry.format,
            file: entry.file,
            bytes,
        });
        return projected.summary;
    }
}

function entryKey(uuid: UnitUuid, manifest: CoreUnitsManifest): CoreCatalogEntryKey {
    return {
        origin: 'megamek',
        design: { provider: 'mm-data' as CoreCatalogEntryKey['design']['provider'], uuid },
        sourceRevision: manifest.units[uuid].hash,
    };
}

function sameSummaryDependencyHashes(
    left: SummaryDependencyHashes | undefined,
    right: SummaryDependencyHashes,
): boolean {
    return !!left && SUMMARY_DEPENDENCY_NAMES.every(name => left[name] === right[name]);
}

function summaryDependencyHashes(hashes: DependencyAssetHashes): SummaryDependencyHashes {
    return Object.freeze({
        equipment: hashes.equipment,
        quirks: hashes.quirks,
        sourcebooks: hashes.sourcebooks,
        sprites: hashes.sprites,
    });
}

function preparedSynchronization(
    database: UnitCatalogDatabase,
    generation: PublishedCatalogGeneration<readonly UnitSummary[]>,
    archiveBlob: Blob,
    result: CoreCatalogSyncResult,
    requiresPublication: boolean,
    assetsManifest: RepositoryAssetsManifest,
    onProgress?: (progress: CoreCatalogSyncProgress) => void,
): PreparedCoreCatalogSynchronization {
    let discarded = false;
    let finalized = false;
    return Object.freeze({
        assetsManifest,
        result: Object.freeze(result),
        generation,
        requiresPublication,
        finalize: async (): Promise<void> => {
            if (discarded) throw new Error('Core catalog candidate was discarded');
            if (finalized || !requiresPublication) return;
            emit(onProgress, { phase: 'publication', completed: 0, total: 1 });
            await database.writeActiveCatalog(generation, archiveBlob);
            finalized = true;
            emit(onProgress, { phase: 'publication', completed: 1, total: 1 });
        },
        discard: (): void => { discarded = true; },
    });
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<ArrayBuffer> {
    const declared = response.headers.get('Content-Length');
    if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > maximumBytes)) {
        throw new Error('Unit source exceeds its byte ceiling');
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
        throw new Error('Unit source exceeds its byte ceiling');
    }
    return bytes;
}

function emit(
    listener: ((progress: CoreCatalogSyncProgress) => void) | undefined,
    progress: CoreCatalogSyncProgress,
): void {
    try { listener?.(progress); } catch {}
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Core catalog update was cancelled', 'AbortError');
}
