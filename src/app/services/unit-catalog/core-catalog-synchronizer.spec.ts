// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import type { RepositoryAssetManifestService } from '../catalogs/repository-asset-manifest.service';
import type {
    DependencyAssetHashes,
    PreparedApplicationCatalogDependencies,
} from './application-catalog-bundle-coordinator.service';
import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';
import { createCoreUnitSourceArchive, type CoreUnitSourceReplacement } from './core-unit-archive';
import {
    CoreCatalogSynchronizer,
    type OpenedCoreRelease,
    type PreparedCoreRelease,
} from './core-catalog-synchronizer';
import {
    CORE_UNITS_ARCHIVE_PATH,
    CORE_UNITS_MANIFEST_PATH,
    MAX_INCREMENTAL_SUMMARY_REBUILDS,
    type CoreUnitManifestEntry,
    type CoreUnitsManifest,
    type StoredCoreUnitsManifest,
} from './core-unit-manifest';
import type { CoreUnitSummaryProjector } from './entity-summary-projector';
import {
    type PublishedCatalogGeneration,
    UnitCatalogDatabase,
} from './unit-catalog-database';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asCatalogActivationId,
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
    type UnitUuid,
} from './unit-catalog.types';

describe('CoreCatalogSynchronizer', () => {
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const manifestHash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const unitHash = asSourceHash('EEEEEEEEEEEEEEEEEEEEEEEEEEE');
    const archiveHash = asSourceHash('IIIIIIIIIIIIIIIIIIIIIIIIIII');
    const file = makeUnitFileName(uuid, 'mtf');
    const manifest: CoreUnitsManifest = { units: { [uuid]: { file, hash: unitHash, format: 'mtf' } } };
    let database: jasmine.SpyObj<UnitCatalogDatabase>;
    let repository: jasmine.SpyObj<RepositoryAssetManifestService>;
    let synchronizer: CoreCatalogSynchronizer;

    beforeEach(() => {
        database = jasmine.createSpyObj<UnitCatalogDatabase>('UnitCatalogDatabase', [
            'readActiveCatalog', 'readSourceArchive', 'writeActiveCatalog',
        ]);
        repository = jasmine.createSpyObj<RepositoryAssetManifestService>('RepositoryAssetManifestService', [
            'loadManifest', 'descriptor', 'readText', 'download',
        ]);
        repository.loadManifest.and.resolveTo(assetsManifest());
        synchronizer = new CoreCatalogSynchronizer(database, {
            baseUrl: 'https://assets.example.test/',
            repositoryAssets: repository,
        });
    });

    it('reuses the saved units manifest and leaves the ZIP download lazy', async () => {
        const active = generation();
        database.readActiveCatalog.and.resolveTo(active);
        repository.descriptor.and.callFake(async path => ({
            hash: path === CORE_UNITS_MANIFEST_PATH ? manifestHash : archiveHash,
        }));

        const release = await synchronizer.preparePinnedRelease({
            signal: new AbortController().signal,
        });

        expect(release.active).toBe(active);
        expect(release.manifest).toBe(active.manifest);
        expect(release.manifestSource).toBe('stored');
        expect(release.archiveChecksum).toBe(archiveHash);
        expect(repository.readText).not.toHaveBeenCalled();
        expect(repository.download).not.toHaveBeenCalled();
        release.dispose();
    });

    it('downloads only units-manifest.json when its supplied hash changed', async () => {
        const repositoryManifestHash = asSourceHash('MMMMMMMMMMMMMMMMMMMMMMMMMMM');
        database.readActiveCatalog.and.resolveTo(generation());
        repository.loadManifest.and.resolveTo(assetsManifest(repositoryManifestHash));
        repository.readText.and.resolveTo({
            path: CORE_UNITS_MANIFEST_PATH,
            descriptor: { hash: repositoryManifestHash },
            text: JSON.stringify({ [file]: unitHash }),
        });

        const release = await synchronizer.preparePinnedRelease({
            signal: new AbortController().signal,
        });

        expect(release.manifest.hash).toBe(repositoryManifestHash);
        expect(release.manifest.manifest.units[uuid]).toEqual(manifest.units[uuid]);
        expect(release.manifestSource).toBe('repository');
        expect(repository.readText).toHaveBeenCalledOnceWith(
            CORE_UNITS_MANIFEST_PATH,
            jasmine.any(AbortSignal),
        );
        expect(repository.download).not.toHaveBeenCalled();
        release.dispose();
    });

    it('does no archive or projection work when the active generation is current', async () => {
        const active = generation();
        const archiveBlob = new Blob([new Uint8Array(22)]);
        database.readSourceArchive.and.resolveTo(archiveBlob);
        const openArchive = jasmine.createSpy('openArchive');
        const projector = jasmine.createSpyObj<CoreUnitSummaryProjector>('CoreUnitSummaryProjector', ['project']);

        const prepared = await synchronizer.prepareSynchronization(
            preparedRelease(active, openArchive),
            dependencies(),
            projector,
            { signal: new AbortController().signal, dependenciesChanged: false },
        );

        expect(prepared.result).toEqual(jasmine.objectContaining({
            status: 'unchanged', strategy: 'none', downloadedUnits: 0,
        }));
        expect(prepared.requiresPublication).toBeFalse();
        expect(openArchive).not.toHaveBeenCalled();
        expect(projector.project).not.toHaveBeenCalled();
        await prepared.finalize();
        expect(database.writeActiveCatalog).not.toHaveBeenCalled();
    });

    it('uses a fresh ZIP on first install and regenerates only an obsolete summary', async () => {
        database.readActiveCatalog.and.resolveTo(undefined);
        const current = summary();
        const stale = {
            ...current,
            summaryVersion: UNIT_SUMMARY_VERSION - 1,
        } as unknown as UnitSummary;
        const sourceBytes = new TextEncoder().encode('native source').buffer;
        const opened: OpenedCoreRelease = {
            archive: {
                files: [file],
                extract: async () => sourceBytes,
                compactSources: async () => new ArrayBuffer(22),
            },
            summaries: [stale],
            dependencyBundle: dependencyBundle(),
            blob: new Blob([new Uint8Array(22)]),
            dispose: jasmine.createSpy('dispose'),
        };
        const openArchive = jasmine.createSpy('openArchive').and.resolveTo(opened);
        const projector = jasmine.createSpyObj<CoreUnitSummaryProjector>('CoreUnitSummaryProjector', ['project']);
        projector.project.and.resolveTo({ summary: current, diagnostics: [] });

        const prepared = await synchronizer.prepareSynchronization(
            preparedRelease(undefined, openArchive),
            dependencies(),
            projector,
            { signal: new AbortController().signal, dependenciesChanged: true },
        );

        expect(prepared.result).toEqual(jasmine.objectContaining({
            status: 'updated', strategy: 'archive', downloadedUnits: 1,
        }));
        expect(projector.project).toHaveBeenCalledOnceWith({
            entryKey: {
                origin: 'megamek',
                design: { provider: MM_DATA_UNIT_PROVIDER_ID, uuid },
                sourceRevision: unitHash,
            },
            format: 'mtf',
            file,
            bytes: sourceBytes,
        });
        expect(prepared.generation.summary.payload).toEqual([current]);

        await prepared.finalize();
        await prepared.finalize();
        expect(database.writeActiveCatalog).toHaveBeenCalledTimes(1);
        expect(database.writeActiveCatalog.calls.mostRecent().args[0]).toBe(prepared.generation);
        expect(database.writeActiveCatalog.calls.mostRecent().args[1]).toBe(opened.blob);
    });

    it('uses the ZIP when more than 400 summaries need regeneration', async () => {
        const catalog = manyUnitCatalog(MAX_INCREMENTAL_SUMMARY_REBUILDS + 1, UNIT_SUMMARY_VERSION - 1);
        database.readSourceArchive.and.resolveTo(new Blob([new Uint8Array(22)]));
        const opened: OpenedCoreRelease = {
            archive: {
                files: catalog.sources.map(source => source.file),
                extract: () => Promise.reject(new Error('Current embedded summaries should be reused')),
                compactSources: async () => new ArrayBuffer(22),
            },
            summaries: catalog.currentSummaries,
            dependencyBundle: dependencyBundle(),
            blob: new Blob([new Uint8Array(22)]),
            dispose: jasmine.createSpy('dispose'),
        };
        const openArchive = jasmine.createSpy('openArchive').and.resolveTo(opened);
        const projector = jasmine.createSpyObj<CoreUnitSummaryProjector>('CoreUnitSummaryProjector', ['project']);

        const prepared = await synchronizer.prepareSynchronization(
            preparedRelease(catalog.generation, openArchive, catalog.storedManifest),
            dependencies(),
            projector,
            { signal: new AbortController().signal, dependenciesChanged: false },
        );

        expect(openArchive).toHaveBeenCalledTimes(1);
        expect(projector.project).not.toHaveBeenCalled();
        expect(prepared.result).toEqual(jasmine.objectContaining({
            status: 'updated',
            strategy: 'archive',
            downloadedUnits: MAX_INCREMENTAL_SUMMARY_REBUILDS + 1,
        }));
    });

    it('regenerates in the client when the preferred ZIP is unavailable', async () => {
        const catalog = manyUnitCatalog(MAX_INCREMENTAL_SUMMARY_REBUILDS + 1, UNIT_SUMMARY_VERSION - 1);
        const localArchive = await createCoreUnitSourceArchive(catalog.storedManifest.manifest, catalog.sources);
        database.readSourceArchive.and.resolveTo(new Blob([localArchive]));
        const openArchive = jasmine.createSpy('openArchive').and.rejectWith(new TypeError('Offline'));
        const projector = jasmine.createSpyObj<CoreUnitSummaryProjector>('CoreUnitSummaryProjector', ['project']);
        projector.project.and.callFake(async request => ({
            summary: summaryFor(request.entryKey.design.uuid, UNIT_SUMMARY_VERSION),
            diagnostics: [],
        }));

        const prepared = await synchronizer.prepareSynchronization(
            preparedRelease(catalog.generation, openArchive, catalog.storedManifest),
            dependencies(),
            projector,
            { signal: new AbortController().signal, dependenciesChanged: false },
        );

        expect(openArchive).toHaveBeenCalledTimes(1);
        expect(projector.project).toHaveBeenCalledTimes(MAX_INCREMENTAL_SUMMARY_REBUILDS + 1);
        expect(prepared.result).toEqual(jasmine.objectContaining({
            status: 'updated', strategy: 'none', downloadedUnits: 0,
        }));
        expect(prepared.generation.summary.payload.every(
            unit => unit.summaryVersion === UNIT_SUMMARY_VERSION,
        )).toBeTrue();
    });

    function preparedRelease(
        active: PublishedCatalogGeneration<readonly UnitSummary[]> | undefined,
        openArchive: () => Promise<OpenedCoreRelease>,
        releaseManifest = storedManifest(),
    ): PreparedCoreRelease {
        return {
            assetsManifest: assetsManifest(releaseManifest.hash),
            manifest: releaseManifest,
            ...(active ? { active } : {}),
            manifestSource: active ? 'stored' : 'repository',
            archiveChecksum: archiveHash,
            openArchive,
            dispose: () => undefined,
        };
    }

    function generation(): PublishedCatalogGeneration<readonly UnitSummary[]> {
        const activationId = asCatalogActivationId(`${manifestHash}:${UNIT_SUMMARY_VERSION}`);
        return {
            activationId,
            manifest: storedManifest(),
            summary: { activationId, summaryVersion: UNIT_SUMMARY_VERSION, payload: [summary()] },
            summaryDependencyHashes: summaryHashes(),
        };
    }

    function storedManifest(): StoredCoreUnitsManifest {
        return { manifest, json: JSON.stringify({ [file]: unitHash }), hash: manifestHash };
    }

    function summary(): UnitSummary {
        return summaryFor(uuid, UNIT_SUMMARY_VERSION);
    }

    function summaryFor(unitUuid: UnitUuid, summaryVersion: number): UnitSummary {
        return {
            uuid: unitUuid,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            origin: 'megamek',
            hash: unitHash,
            summaryVersion,
            entityType: 'Mek',
            loadIssues: [],
            rulesRefs: [],
            name: 'Test Unit',
        } as unknown as UnitSummary;
    }

    function manyUnitCatalog(count: number, summaryVersion: number): {
        readonly storedManifest: StoredCoreUnitsManifest;
        readonly generation: PublishedCatalogGeneration<readonly UnitSummary[]>;
        readonly currentSummaries: readonly UnitSummary[];
        readonly sources: readonly CoreUnitSourceReplacement[];
    } {
        const units = {} as Record<UnitUuid, CoreUnitManifestEntry>;
        const manifestJson: Record<string, string> = {};
        const summaries: UnitSummary[] = [];
        const currentSummaries: UnitSummary[] = [];
        const sources: CoreUnitSourceReplacement[] = [];
        for (let index = 1; index <= count; index += 1) {
            const unitUuid = asUnitUuid(`019f6767-0dcb-7bb8-992f-${index.toString(16).padStart(12, '0')}`);
            const unitFile = makeUnitFileName(unitUuid, 'mtf');
            units[unitUuid] = { file: unitFile, hash: unitHash, format: 'mtf' };
            manifestJson[unitFile] = unitHash;
            summaries.push(summaryFor(unitUuid, summaryVersion));
            currentSummaries.push(summaryFor(unitUuid, UNIT_SUMMARY_VERSION));
            sources.push({ file: unitFile, bytes: new TextEncoder().encode(`source ${index}`).buffer });
        }
        const catalogManifest: StoredCoreUnitsManifest = {
            manifest: { units },
            json: JSON.stringify(manifestJson),
            hash: manifestHash,
        };
        const activationId = asCatalogActivationId(`${manifestHash}:${summaryVersion}`);
        return {
            storedManifest: catalogManifest,
            generation: {
                activationId,
                manifest: catalogManifest,
                summary: { activationId, summaryVersion, payload: summaries },
                summaryDependencyHashes: summaryHashes(),
            },
            currentSummaries,
            sources,
        };
    }

    function assetsManifest(unitsHash = manifestHash): Readonly<Record<string, string>> {
        return Object.freeze({
            [CORE_UNITS_MANIFEST_PATH]: unitsHash,
            [CORE_UNITS_ARCHIVE_PATH]: archiveHash,
        });
    }

    function summaryHashes() {
        return Object.freeze({
            equipment: hashes.equipment,
            quirks: hashes.quirks,
            sourcebooks: hashes.sourcebooks,
            sprites: hashes.sprites,
        });
    }
});

const hashes = Object.freeze({
    equipment: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    quirks: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    sourcebooks: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    factions: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    sprites: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
}) satisfies DependencyAssetHashes;

function dependencies(): PreparedApplicationCatalogDependencies {
    return {
        bundle: dependencyBundle(),
        assetHashes: hashes,
    } as unknown as PreparedApplicationCatalogDependencies;
}

function dependencyBundle(): ApplicationCatalogDependencyBundle {
    return {
        equipment: {}, quirks: {}, sourcebooks: {}, factions: {},
        spriteManifest: { manifestDigest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA', manifestText: '{}' },
    } as unknown as ApplicationCatalogDependencyBundle;
}
