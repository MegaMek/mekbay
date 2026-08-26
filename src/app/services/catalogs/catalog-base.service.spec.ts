// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, Injectable } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { LoggerService } from '../logger.service';
import {
    CatalogBaseService,
    CatalogDownloadTrackerService,
} from './catalog-base.service';

const TEST_CATALOG_URL = 'https://catalog.example/test-catalog.json?ngsw-bypass=true';

interface TestCatalogData {
    items?: number[];
    assetHash?: string;
}

async function settleMicrotasks(): Promise<void> {
    for (let index = 0; index < 3; index += 1) {
        await Promise.resolve();
    }
}

@Injectable()
class TestCatalogService extends CatalogBaseService<TestCatalogData, TestCatalogData> {
    public cachedData: TestCatalogData | undefined;
    public savedData: TestCatalogData[] = [];
    private items: number[] = [];

    protected override get catalogKey(): string {
        return 'test_catalog';
    }

    protected override get remoteUrl(): string {
        return 'https://catalog.example/test-catalog.json';
    }

    public getItems(): number[] {
        return this.items;
    }

    protected override hasHydratedData(): boolean {
        return this.items.length > 0;
    }

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
        return {
            ...data,
            assetHash,
        };
    }

    protected override getDatasetSize(data: TestCatalogData): number {
        return Array.isArray(data.items) ? data.items.length : 0;
    }

    protected override getMinimumDatasetSize(): number {
        return 5;
    }

    protected override getMinimumRelativeComparisonSize(): number {
        return 10;
    }
}

describe('CatalogBaseService', () => {
    let service: TestCatalogService;
    let httpMock: HttpTestingController;
    let logger: {
        info: jasmine.Spy;
        warn: jasmine.Spy;
        error: jasmine.Spy;
    };
    let downloadTracker: CatalogDownloadTrackerService;

    beforeEach(() => {
        TestBed.resetTestingModule();

        logger = {
            info: jasmine.createSpy('info'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
        };

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                TestCatalogService,
                { provide: LoggerService, useValue: logger },
            ],
        });

        service = TestBed.inject(TestCatalogService);
        downloadTracker = TestBed.inject(CatalogDownloadTrackerService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('hydrates saved data without network work and reuses that read during full initialization', async () => {
        const body = { items: [1, 2, 3, 4, 5, 6], assetHash: 'revision-a' };
        service.cachedData = { ...body };
        const loadFromCache = spyOn<any>(service, 'loadFromCache').and.callThrough();

        expect(await service.hydrateFromCache()).toBeTrue();
        expect(service.getItems()).toEqual([1, 2, 3, 4, 5, 6]);
        httpMock.expectNone(TEST_CATALOG_URL);

        const initialization = service.initialize();
        await settleMicrotasks();
        httpMock.expectOne(TEST_CATALOG_URL).flush(body);
        await initialization;

        expect(loadFromCache).toHaveBeenCalledTimes(1);
        expect(service.savedData).toEqual([]);
    });

    it('refetches when the cached dataset is invalid', async () => {
        service.cachedData = { assetHash: 'cached-hash', items: [] };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const getRequest = httpMock.expectOne(TEST_CATALOG_URL);
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush({ items: [1, 2, 3, 4, 5, 6], assetHash: 'revision-a' });

        await initializePromise;

        expect(service.getItems()).toEqual([1, 2, 3, 4, 5, 6]);
        expect(service.savedData).toEqual([
            jasmine.objectContaining({ assetHash: jasmine.any(String), items: [1, 2, 3, 4, 5, 6] }),
        ]);
        expect(logger.warn).toHaveBeenCalledWith(jasmine.stringMatching(/Ignoring invalid cache test_catalog dataset/));
    });

    it('reports downloading only while a catalog fetch is active', async () => {
        expect(downloadTracker.isDownloading()).toBeFalse();

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const getRequest = httpMock.expectOne(TEST_CATALOG_URL);
        expect(downloadTracker.isDownloading()).toBeTrue();

        getRequest.flush({ items: [1, 2, 3, 4, 5, 6], assetHash: 'revision-a' });

        await initializePromise;

        expect(downloadTracker.isDownloading()).toBeFalse();
    });

    it('shares concurrent initialization and memoizes success', async () => {
        const body = { items: [1, 2, 3, 4, 5, 6], assetHash: 'revision-a' };
        service.cachedData = { ...body };

        const firstInitialization = service.initialize();
        const secondInitialization = service.initialize();
        expect(secondInitialization).toBe(firstInitialization);
        await settleMicrotasks();

        const request = httpMock.expectOne(TEST_CATALOG_URL);
        expect(request.request.method).toBe('GET');
        request.flush(body);
        await Promise.all([firstInitialization, secondInitialization]);

        await service.initialize();
        httpMock.expectNone(TEST_CATALOG_URL);
    });

    it('allows initialization to retry after failure', async () => {
        const failedInitialization = service.initialize();
        await settleMicrotasks();

        httpMock.expectOne(TEST_CATALOG_URL).flush('offline', { status: 503, statusText: 'Unavailable' });
        await expectAsync(failedInitialization).toBeRejected();

        const retry = service.initialize();
        await settleMicrotasks();
        httpMock.expectOne(TEST_CATALOG_URL).flush({ items: [1, 2, 3, 4, 5, 6], assetHash: 'revision-a' });
        await retry;
    });

    it('keeps reporting downloading until all tracked catalog fetches finish', async () => {
        let finishFirstDownload!: () => void;
        let finishSecondDownload!: () => void;
        const firstDownload = downloadTracker.trackDownload(() => new Promise<void>((resolve) => {
            finishFirstDownload = resolve;
        }));
        const secondDownload = downloadTracker.trackDownload(() => new Promise<void>((resolve) => {
            finishSecondDownload = resolve;
        }));

        expect(downloadTracker.isDownloading()).toBeTrue();

        finishFirstDownload();
        await settleMicrotasks();

        expect(downloadTracker.isDownloading()).toBeTrue();

        finishSecondDownload();
        await Promise.all([firstDownload, secondDownload]);

        expect(downloadTracker.isDownloading()).toBeFalse();
    });

    it('preserves the previous dataset when the remote update is empty', async () => {
        service.cachedData = { assetHash: 'cached-hash', items: [1, 2, 3, 4, 5, 6] };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const getRequest = httpMock.expectOne(TEST_CATALOG_URL);
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush({ items: [], assetHash: 'revision-b' });

        await expectAsync(initializePromise).toBeRejectedWithError(/Rejected test_catalog update/);

        expect(service.getItems()).toEqual([1, 2, 3, 4, 5, 6]);
        expect(service.savedData).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith('Preserved cached test_catalog after rejecting the remote update.');
    });

    it('rejects suspiciously shrunken remote datasets and keeps the previous data', async () => {
        service.cachedData = {
            assetHash: 'cached-hash',
            items: Array.from({ length: 20 }, (_, index) => index),
        };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const getRequest = httpMock.expectOne(TEST_CATALOG_URL);
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush({ items: [1, 2, 3, 4, 5], assetHash: 'revision-b' });

        await expectAsync(initializePromise).toBeRejectedWithError(/Rejected test_catalog update/);

        expect(service.getItems()).toEqual(Array.from({ length: 20 }, (_, index) => index));
        expect(service.savedData).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(jasmine.stringMatching(/Rejected test_catalog update: Error: received only 5 entries after previously loading 20/));
    });
});
