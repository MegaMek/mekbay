// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { LoggerService } from '../logger.service';
import {
    CatalogBaseService,
    CatalogDownloadTrackerService,
    type PreparedCatalogTransport,
} from './catalog-base.service';
import { RepositoryAssetManifestService } from './repository-asset-manifest.service';

const TEST_CATALOG_PATH = 'online-assets/test-catalog.json';

interface TestCatalogData {
    items?: number[];
    assetHash?: string;
}

@Injectable()
class TestCatalogService extends CatalogBaseService<TestCatalogData, TestCatalogData> {
    public cachedData: TestCatalogData | undefined;
    public savedData: TestCatalogData[] = [];
    private items: number[] = [];

    protected override get catalogKey(): string { return 'test_catalog'; }
    protected override get repositoryAssetPath(): string { return TEST_CATALOG_PATH; }
    public getItems(): number[] { return this.items; }
    protected override hasHydratedData(): boolean { return this.items.length > 0; }

    protected override async loadFromCache(): Promise<TestCatalogData | undefined> {
        return this.cachedData;
    }

    protected override async saveToCache(data: TestCatalogData): Promise<void> {
        this.savedData.push(data);
        this.cachedData = data;
    }

    protected override hydrate(data: TestCatalogData): void {
        this.items = Array.isArray(data.items) ? [...data.items] : [];
        this.transportRevision = data.assetHash || '';
    }

    protected override normalizeFetchedData(data: TestCatalogData, assetHash: string): TestCatalogData {
        return { ...data, assetHash };
    }

    protected override getDatasetSize(data: TestCatalogData): number {
        return Array.isArray(data.items) ? data.items.length : 0;
    }

    protected override getMinimumDatasetSize(): number { return 5; }
}

describe('CatalogBaseService', () => {
    let service: TestCatalogService;
    let logger: { info: jasmine.Spy; warn: jasmine.Spy; error: jasmine.Spy };
    let assets: { descriptor: jasmine.Spy; readJson: jasmine.Spy };
    let downloadTracker: CatalogDownloadTrackerService;
    const body = { items: [1, 2, 3, 4, 5, 6], assetHash: 'revision-a' };

    beforeEach(() => {
        TestBed.resetTestingModule();
        logger = {
            info: jasmine.createSpy('info'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
        };
        assets = {
            descriptor: jasmine.createSpy('descriptor').and.resolveTo({ hash: body.assetHash }),
            readJson: jasmine.createSpy('readJson').and.resolveTo({
                descriptor: { hash: body.assetHash },
                value: body,
            }),
        };
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                TestCatalogService,
                { provide: LoggerService, useValue: logger },
                { provide: RepositoryAssetManifestService, useValue: assets },
            ],
        });
        service = TestBed.inject(TestCatalogService);
        downloadTracker = TestBed.inject(CatalogDownloadTrackerService);
    });

    it('hydrates saved data without network work and reuses that read during initialization', async () => {
        service.cachedData = body;
        const loadFromCache = spyOn<any>(service, 'loadFromCache').and.callThrough();

        expect(await service.hydrateFromCache()).toBeTrue();
        expect(service.getItems()).toEqual(body.items);
        expect(assets.descriptor).not.toHaveBeenCalled();

        await service.initialize();

        expect(loadFromCache).toHaveBeenCalledTimes(1);
        expect(assets.descriptor).toHaveBeenCalledWith(TEST_CATALOG_PATH);
        expect(assets.readJson).not.toHaveBeenCalled();
        expect(service.savedData).toEqual([]);
    });

    it('refetches when the cached dataset is invalid even if its revision matches', async () => {
        service.cachedData = { assetHash: body.assetHash, items: [] };

        await service.initialize();

        expect(assets.readJson).toHaveBeenCalledWith(TEST_CATALOG_PATH);
        expect(service.getItems()).toEqual(body.items);
        expect(service.savedData).toEqual([body]);
        expect(logger.warn).toHaveBeenCalledWith(jasmine.stringMatching(/Ignoring invalid cache test_catalog dataset/));
    });

    it('reports downloading while the verified asset is being read', async () => {
        assets.readJson.and.callFake(async () => {
            expect(downloadTracker.isDownloading()).toBeTrue();
            return { descriptor: { hash: body.assetHash }, value: body };
        });

        expect(downloadTracker.isDownloading()).toBeFalse();
        await service.initialize();
        expect(downloadTracker.isDownloading()).toBeFalse();
    });

    it('shares concurrent initialization and memoizes success', async () => {
        const firstInitialization = service.initialize();
        const secondInitialization = service.initialize();
        expect(secondInitialization).toBe(firstInitialization);
        await Promise.all([firstInitialization, secondInitialization]);
        await service.initialize();

        expect(assets.descriptor).toHaveBeenCalledTimes(1);
        expect(assets.readJson).toHaveBeenCalledTimes(1);
    });

    it('allows initialization to retry after a verified asset read fails', async () => {
        assets.readJson.and.rejectWith(new Error('corrupt or incomplete'));

        await expectAsync(service.initialize()).toBeRejectedWithError('corrupt or incomplete');
        expect(downloadTracker.isDownloading()).toBeFalse();
        expect(service.savedData).toEqual([]);

        assets.readJson.and.resolveTo({ descriptor: { hash: body.assetHash }, value: body });
        await service.initialize();
        expect(service.getItems()).toEqual(body.items);
    });

    it('uses hydrated cache when the repository manifest is unavailable', async () => {
        service.cachedData = body;
        assets.descriptor.and.rejectWith(new Error('offline'));

        await service.initialize();

        expect(service.getItems()).toEqual(body.items);
        expect(service.isInitialized()).toBeTrue();
        expect(assets.readJson).not.toHaveBeenCalled();
        expect(service.savedData).toEqual([]);
    });

    it('rejects an unavailable manifest when no valid cache exists', async () => {
        service.cachedData = { items: [] };
        assets.descriptor.and.rejectWith(new Error('offline'));

        await expectAsync(service.initialize()).toBeRejectedWithError('offline');
        expect(service.isInitialized()).toBeFalse();
    });

    it('keeps reporting downloading until all tracked catalog fetches finish', async () => {
        let finishFirstDownload!: () => void;
        let finishSecondDownload!: () => void;
        const firstDownload = downloadTracker.trackDownload(() => new Promise<void>(resolve => {
            finishFirstDownload = resolve;
        }));
        const secondDownload = downloadTracker.trackDownload(() => new Promise<void>(resolve => {
            finishSecondDownload = resolve;
        }));

        expect(downloadTracker.isDownloading()).toBeTrue();
        finishFirstDownload();
        await firstDownload;
        expect(downloadTracker.isDownloading()).toBeTrue();
        finishSecondDownload();
        await secondDownload;
        expect(downloadTracker.isDownloading()).toBeFalse();
    });

    it('preserves the previous dataset when the remote update is empty', async () => {
        service.cachedData = { ...body, assetHash: 'cached-hash' };
        assets.readJson.and.resolveTo({ descriptor: { hash: 'revision-b' }, value: { items: [] } });

        await service.initialize();

        expect(service.getItems()).toEqual(body.items);
        expect(service.getCatalogRevision()).toBe('cached-hash');
        expect(service.savedData).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith('Preserved cached test_catalog after rejecting the remote update.');
        expect(logger.error).toHaveBeenCalledWith(jasmine.stringMatching(/Rejected test_catalog update/));
        await service.initialize();
        expect(assets.readJson).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid remote dataset when no cached data can be restored', async () => {
        assets.readJson.and.resolveTo({ descriptor: { hash: 'revision-b' }, value: { items: [] } });

        await expectAsync(service.initialize()).toBeRejectedWithError(/Rejected test_catalog update/);
        expect(service.getItems()).toEqual([]);
        expect(service.savedData).toEqual([]);
    });

    it('accepts a verified smaller catalog that meets its minimum size', async () => {
        service.cachedData = {
            assetHash: 'cached-hash',
            items: Array.from({ length: 200 }, (_, index) => index),
        };

        await service.initialize();

        expect(service.getItems()).toEqual(body.items);
        expect(service.savedData).toEqual([body]);
        expect(service.getCatalogRevision()).toBe(body.assetHash);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('reuses unchanged detached transport without hydrating or persisting it', async () => {
        const previous: PreparedCatalogTransport<TestCatalogData> = { source: 'bundle', data: body };
        const signal = new AbortController().signal;

        expect(await service.prepareRemoteTransport(previous, signal)).toBe(previous);
        expect(assets.descriptor).toHaveBeenCalledWith(TEST_CATALOG_PATH, signal);
        expect(assets.readJson).not.toHaveBeenCalled();
        expect(service.getItems()).toEqual([]);
        expect(service.savedData).toEqual([]);
    });

    it('prepares changed transport with the manifest revision and forwards cancellation', async () => {
        const signal = new AbortController().signal;
        const candidate = await service.prepareRemoteTransport(undefined, signal);

        expect(candidate).toEqual({ source: 'remote', data: body });
        expect(assets.readJson).toHaveBeenCalledWith(TEST_CATALOG_PATH, signal);
        expect(service.getItems()).toEqual([]);
        expect(service.savedData).toEqual([]);
        expect(service.isInitialized()).toBeFalse();
    });
});
