// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import { CatalogDownloadTrackerService } from '../catalogs/catalog-base.service';
import { LoggerService } from '../logger.service';
import {
    ApplicationCatalogBundleCoordinatorService,
    type DependencyAssetHashes,
    type PreparedApplicationCatalogDependencies,
} from './application-catalog-bundle-coordinator.service';
import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';
import type {
    CoreCatalogSynchronizer,
    PreparedCoreCatalogSynchronization,
    PreparedCoreRelease,
} from './core-catalog-synchronizer';
import { CoreUnitCatalogBackend, CoreUnitCatalogService } from './core-unit-catalog.service';
import type { PublishedCatalogGeneration, UnitCatalogDatabase } from './unit-catalog-database';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asCatalogActivationId,
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
} from './unit-catalog.types';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001');
const LOCAL_HASH = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
const REMOTE_HASH = asSourceHash('BBBBBBBBBBBBBBBBBBBBBBBBBBA');
const ASSET_HASHES = Object.freeze({
    equipment: LOCAL_HASH,
    quirks: LOCAL_HASH,
    sourcebooks: LOCAL_HASH,
    eras: LOCAL_HASH,
    factions: LOCAL_HASH,
    sprites: LOCAL_HASH,
}) satisfies DependencyAssetHashes;

function bundle(): ApplicationCatalogDependencyBundle {
    return {
        equipment: {},
        quirks: {},
        sourcebooks: {},
        eras: {},
        factions: {},
        spriteManifest: { manifestDigest: LOCAL_HASH, manifestText: '' },
    } as unknown as ApplicationCatalogDependencyBundle;
}

function generation(
    name = 'Local Unit',
    manifestHash = LOCAL_HASH,
    summaryVersion: number = UNIT_SUMMARY_VERSION,
): PublishedCatalogGeneration<readonly UnitSummary[]> {
    const summary = {
        summaryVersion,
        hash: manifestHash,
        uuid: UUID,
        provider: MM_DATA_UNIT_PROVIDER_ID,
        origin: 'megamek',
        entityType: 'Mek',
        loadIssues: [],
        rulesRefs: [],
        name,
    } as unknown as UnitSummary;
    const activationId = asCatalogActivationId(`${manifestHash}:${summaryVersion}`);
    return Object.freeze({
        activationId,
        manifest: Object.freeze({
            hash: manifestHash,
            json: '{}',
            manifest: Object.freeze({
                units: Object.freeze({
                    [UUID]: Object.freeze({
                        file: makeUnitFileName(UUID, 'mtf'),
                        hash: manifestHash,
                        format: 'mtf' as const,
                    }),
                }),
            }),
        }),
        summary: Object.freeze({
            activationId,
            summaryVersion,
            payload: Object.freeze([summary]),
        }),
        summaryDependencyHashes: Object.freeze({
            equipment: ASSET_HASHES.equipment,
            quirks: ASSET_HASHES.quirks,
            sourcebooks: ASSET_HASHES.sourcebooks,
            sprites: ASSET_HASHES.sprites,
        }),
    });
}

function dependencies(value = bundle()): PreparedApplicationCatalogDependencies {
    return {
        bundle: value,
        assetHashes: ASSET_HASHES,
        equipment: {},
        quirks: {},
        sourcebooks: {},
        eras: {},
        factions: {},
        sprites: {},
        getProjector: async () => ({} as never),
    } as unknown as PreparedApplicationCatalogDependencies;
}

function release(
    active: PublishedCatalogGeneration<readonly UnitSummary[]> | undefined,
): PreparedCoreRelease {
    const source = active ?? generation('Remote Unit', REMOTE_HASH);
    return {
        assetsManifest: {
            'online-assets/generated/units-manifest.json': source.manifest.hash,
            'online-assets/generated/units.zip': source.manifest.hash,
        },
        manifest: source.manifest,
        ...(active ? { active } : {}),
        manifestSource: active ? 'stored' : 'repository',
        archiveChecksum: source.manifest.hash,
        openArchive: jasmine.createSpy('openArchive').and.resolveTo({
            archive: {},
            summaries: source.summary.payload,
            dependencyBundle: bundle(),
            blob: new Blob(['unit archive data that is long enough']),
            dispose: jasmine.createSpy('disposeOpenedArchive'),
        }),
        dispose: jasmine.createSpy('disposeRelease'),
    } as unknown as PreparedCoreRelease;
}

function synchronization(
    candidate: PublishedCatalogGeneration<readonly UnitSummary[]>,
): PreparedCoreCatalogSynchronization {
    return {
        assetsManifest: {
            'online-assets/generated/units-manifest.json': candidate.manifest.hash,
            'online-assets/generated/units.zip': candidate.manifest.hash,
        },
        result: {
            status: 'updated',
            activationId: candidate.activationId,
            strategy: 'individual',
            downloadedUnits: 1,
            manifestSource: 'repository',
        },
        generation: candidate,
        requiresPublication: true,
        finalize: jasmine.createSpy('finalize').and.resolveTo(),
        discard: jasmine.createSpy('discard'),
    };
}

async function flushBackgroundRefresh(): Promise<void> {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('CoreUnitCatalogService', () => {
    let database: jasmine.SpyObj<UnitCatalogDatabase>;
    let synchronizer: jasmine.SpyObj<CoreCatalogSynchronizer>;
    let bundles: jasmine.SpyObj<ApplicationCatalogBundleCoordinatorService>;
    let backend: jasmine.SpyObj<CoreUnitCatalogBackend>;
    let logger: jasmine.SpyObj<LoggerService>;

    beforeEach(() => {
        database = jasmine.createSpyObj<UnitCatalogDatabase>(
            'UnitCatalogDatabase',
            ['readActiveCatalog', 'readSourceArchive', 'close'],
        );
        synchronizer = jasmine.createSpyObj<CoreCatalogSynchronizer>(
            'CoreCatalogSynchronizer',
            ['preparePinnedRelease', 'prepareSynchronization'],
        );
        bundles = jasmine.createSpyObj<ApplicationCatalogBundleCoordinatorService>(
            'ApplicationCatalogBundleCoordinatorService',
            [
                'prepareCachedDependencies',
                'preparePublishedBundle',
                'prepareCurrentDependencies',
                'currentAssetHashes',
                'persistPreparedDependencies',
                'recordInstalledUnitAssets',
                'commitPreparedDependencies',
            ],
        );
        bundles.prepareCachedDependencies.and.resolveTo(dependencies());
        bundles.preparePublishedBundle.and.callFake(async value => dependencies(value));
        bundles.prepareCurrentDependencies.and.callFake(async previous => previous);
        bundles.currentAssetHashes.and.resolveTo(ASSET_HASHES);
        bundles.persistPreparedDependencies.and.resolveTo();
        bundles.recordInstalledUnitAssets.and.resolveTo();
        backend = jasmine.createSpyObj<CoreUnitCatalogBackend>(
            'CoreUnitCatalogBackend',
            ['openDatabase', 'createSynchronizer'],
        );
        backend.openDatabase.and.resolveTo(database);
        backend.createSynchronizer.and.returnValue(synchronizer);
        logger = jasmine.createSpyObj<LoggerService>('LoggerService', ['info', 'warn', 'error']);

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                CoreUnitCatalogService,
                { provide: CoreUnitCatalogBackend, useValue: backend },
                { provide: ApplicationCatalogBundleCoordinatorService, useValue: bundles },
                {
                    provide: CatalogDownloadTrackerService,
                    useValue: { trackDownload: <T>(work: () => Promise<T>) => work() },
                },
                { provide: LoggerService, useValue: logger },
            ],
        });
    });

    afterEach(() => TestBed.resetTestingModule());

    it('publishes local data before starting any remote work', async () => {
        const local = generation();
        database.readActiveCatalog.and.resolveTo(local);
        synchronizer.preparePinnedRelease.and.returnValue(new Promise(() => undefined));
        const service = TestBed.inject(CoreUnitCatalogService);

        await service.initialize();

        expect(service.pendingActivation()?.generation).toBe(local);
        expect(synchronizer.preparePinnedRelease).not.toHaveBeenCalled();

        const pending = service.pendingActivation()!;
        service.commitPendingActivation(pending.revision);

        expect(service.catalogSnapshot().generation).toBe(local);
        expect(service.state()).toEqual({ status: 'ready', availableUnits: 1 });
        expect(synchronizer.preparePinnedRelease).toHaveBeenCalledTimes(1);
    });

    it('publishes a stale summary generation before rebuilding it in the background', async () => {
        const local = generation('Local Unit', LOCAL_HASH, UNIT_SUMMARY_VERSION - 1);
        database.readActiveCatalog.and.resolveTo(local);
        synchronizer.preparePinnedRelease.and.returnValue(new Promise(() => undefined));
        const service = TestBed.inject(CoreUnitCatalogService);

        await service.initialize();

        expect(service.pendingActivation()?.generation).toBe(local);
        expect(service.pendingActivation()?.snapshot.summaries[0].summaryVersion)
            .toBe(UNIT_SUMMARY_VERSION - 1);
        expect(synchronizer.preparePinnedRelease).not.toHaveBeenCalled();
    });

    it('silently keeps the local catalog when connectivity is unavailable', async () => {
        const local = generation();
        database.readActiveCatalog.and.resolveTo(local);
        synchronizer.preparePinnedRelease.and.rejectWith(new TypeError('Failed to fetch'));
        const service = TestBed.inject(CoreUnitCatalogService);

        await service.initialize();
        service.commitPendingActivation(service.pendingActivation()!.revision);
        await flushBackgroundRefresh();

        expect(service.catalogSnapshot().generation).toBe(local);
        expect(service.state()).toEqual({ status: 'ready', availableUnits: 1 });
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith('Offline; using the local unit catalog.');
    });

    it('shows a non-blocking refresh error for a real repository fault', async () => {
        const local = generation();
        database.readActiveCatalog.and.resolveTo(local);
        synchronizer.preparePinnedRelease.and.rejectWith(
            new Error('Repository assets manifest returned HTTP 404'),
        );
        const service = TestBed.inject(CoreUnitCatalogService);

        await service.initialize();
        service.commitPendingActivation(service.pendingActivation()!.revision);
        await flushBackgroundRefresh();

        expect(service.catalogSnapshot().generation).toBe(local);
        expect(service.state()).toEqual(jasmine.objectContaining({
            status: 'error',
            availableUnits: 1,
            error: jasmine.stringMatching(/HTTP 404/u),
        }));
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('requires a successful remote bootstrap when no local catalog exists', async () => {
        database.readActiveCatalog.and.resolveTo(undefined);
        synchronizer.preparePinnedRelease.and.rejectWith(
            new Error('Repository assets manifest returned HTTP 404'),
        );
        const service = TestBed.inject(CoreUnitCatalogService);

        await expectAsync(service.initialize()).toBeRejectedWithError(/HTTP 404/u);

        expect(service.state()).toEqual(jasmine.objectContaining({
            status: 'error',
            availableUnits: 0,
        }));
    });

    it('queues a completed background update without replacing the live catalog early', async () => {
        const local = generation();
        const remote = generation('Remote Unit', REMOTE_HASH);
        const prepared = synchronization(remote);
        database.readActiveCatalog.and.resolveTo(local);
        synchronizer.preparePinnedRelease.and.resolveTo(release(local));
        synchronizer.prepareSynchronization.and.resolveTo(prepared);
        const service = TestBed.inject(CoreUnitCatalogService);

        await service.initialize();
        service.commitPendingActivation(service.pendingActivation()!.revision);
        await flushBackgroundRefresh();

        expect(service.catalogSnapshot().generation).toBe(local);
        expect(service.pendingActivation()?.generation).toBe(remote);
        const pending = service.pendingActivation()!;
        expect(await service.finalizePendingActivation(pending.revision)).toBeTrue();
        service.commitPendingActivation(pending.revision);
        expect(service.catalogSnapshot().generation).toBe(remote);
        expect(prepared.finalize).toHaveBeenCalledTimes(1);
    });
});
