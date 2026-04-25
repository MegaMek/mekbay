import { provideZonelessChangeDetection, Injectable } from '@angular/core';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { LoggerService } from '../logger.service';
import { CatalogBaseService } from './catalog-base.service';

interface TestCatalogData {
    items?: number[];
    etag?: string;
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
        return '/test-catalog.json';
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
        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: TestCatalogData, etag: string): TestCatalogData {
        return {
            ...data,
            etag,
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
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('refetches when the cached dataset is invalid even if the ETag matches', async () => {
        service.cachedData = { etag: 'etag-1', items: [] };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const headRequest = httpMock.expectOne('/test-catalog.json');
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', {
            headers: new HttpHeaders({ ETag: 'etag-1' }),
        });
        await settleMicrotasks();

        const getRequest = httpMock.expectOne('/test-catalog.json');
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush({ items: [1, 2, 3, 4, 5, 6] }, {
            headers: new HttpHeaders({ ETag: 'etag-1' }),
        });

        await initializePromise;

        expect(service.getItems()).toEqual([1, 2, 3, 4, 5, 6]);
        expect(service.savedData).toEqual([
            { etag: 'etag-1', items: [1, 2, 3, 4, 5, 6] },
        ]);
        expect(logger.warn).toHaveBeenCalledWith(jasmine.stringMatching(/Ignoring invalid cache test_catalog dataset/));
    });

    it('preserves the previous dataset when the remote update is empty', async () => {
        service.cachedData = { etag: 'etag-old', items: [1, 2, 3, 4, 5, 6] };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const headRequest = httpMock.expectOne('/test-catalog.json');
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', {
            headers: new HttpHeaders({ ETag: 'etag-new' }),
        });
        await settleMicrotasks();

        const getRequest = httpMock.expectOne('/test-catalog.json');
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush({ items: [] }, {
            headers: new HttpHeaders({ ETag: 'etag-new' }),
        });

        await expectAsync(initializePromise).toBeRejectedWithError(/Rejected test_catalog update/);

        expect(service.getItems()).toEqual([1, 2, 3, 4, 5, 6]);
        expect(service.savedData).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith('Preserved cached test_catalog after rejecting the remote update.');
    });

    it('rejects suspiciously shrunken remote datasets and keeps the previous data', async () => {
        service.cachedData = {
            etag: 'etag-old',
            items: Array.from({ length: 20 }, (_, index) => index),
        };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const headRequest = httpMock.expectOne('/test-catalog.json');
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', {
            headers: new HttpHeaders({ ETag: 'etag-new' }),
        });
        await settleMicrotasks();

        const getRequest = httpMock.expectOne('/test-catalog.json');
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush({ items: [1, 2, 3, 4, 5] }, {
            headers: new HttpHeaders({ ETag: 'etag-new' }),
        });

        await expectAsync(initializePromise).toBeRejectedWithError(/Rejected test_catalog update/);

        expect(service.getItems()).toEqual(Array.from({ length: 20 }, (_, index) => index));
        expect(service.savedData).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(jasmine.stringMatching(/Rejected test_catalog update: Error: received only 5 entries after previously loading 20/));
    });
});