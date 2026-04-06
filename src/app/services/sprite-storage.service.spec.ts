import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { LoggerService } from './logger.service';
import { SpriteStorageService, type SpriteManifest } from './sprite-storage.service';

const TEST_MANIFEST: SpriteManifest = {
    types: {
        mek: {
            url: 'sprites/mek.png',
            width: 84,
            height: 72,
        },
    },
    icons: {
        'units/mek.png': {
            type: 'mek',
            x: 0,
            y: 0,
            w: 84,
            h: 72,
        },
    },
};

const CASED_MANIFEST: SpriteManifest = {
    types: {
        Mek: {
            url: 'sprites/mek.png',
            width: 84,
            height: 72,
        },
    },
    icons: {
        'Units/Mek.png': {
            type: 'Mek',
            x: 0,
            y: 0,
            w: 84,
            h: 72,
        },
    },
};

const TEST_BLOB = new Blob(['sprite-bytes'], { type: 'image/png' });

async function settleAsyncWork(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await Promise.resolve();
    }
}

async function waitForLoadingToFinish(service: SpriteStorageService): Promise<void> {
    for (let i = 0; i < 20; i++) {
        if (!service.loading()) {
            return;
        }

        await settleAsyncWork();
    }

    fail('SpriteStorageService did not finish loading.');
}

describe('SpriteStorageService', () => {
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

        spyOn(URL, 'createObjectURL').and.returnValue('blob:mapped-sprite');
        spyOn(URL, 'revokeObjectURL').and.stub();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                SpriteStorageService,
                { provide: LoggerService, useValue: logger },
            ],
        });

        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('uses the cached manifest and sprite blobs when the hash request fails', async () => {
        const metadataStore = new Map<string, unknown>([
            ['sprites_hash', 'hash-1'],
            ['sprites_manifest', CASED_MANIFEST],
        ]);
        const spriteStore = new Map<string, unknown>([
            ['Mek', TEST_BLOB],
        ]);

        spyOn<any>(SpriteStorageService.prototype, 'initIndexedDb').and.returnValue(Promise.resolve({} as IDBDatabase));
        spyOn<any>(SpriteStorageService.prototype, 'dbGet').and.callFake(async (store: string, key: string) => {
            if (store === 'metadata') {
                return metadataStore.get(key) ?? null;
            }

            if (store === 'sprites') {
                return spriteStore.get(key) ?? null;
            }

            return null;
        });
        spyOn<any>(SpriteStorageService.prototype, 'dbPut').and.returnValue(Promise.resolve());
        spyOn<any>(SpriteStorageService.prototype, 'dbClear').and.returnValue(Promise.resolve());

        const service = TestBed.inject(SpriteStorageService);

        httpMock.expectOne('sprites/unit-icons.hash').error(new ProgressEvent('error'));
        await waitForLoadingToFinish(service);

        httpMock.expectNone('sprites/unit-icons.json');

        const spriteInfo = await service.getSpriteInfo('UNITS/MEK.PNG');
        expect(spriteInfo).toEqual({
            url: 'blob:mapped-sprite',
            info: CASED_MANIFEST.icons['Units/Mek.png'],
        });
        expect(logger.warn).toHaveBeenCalledWith('Sprite hash unavailable. Using cached sprite data.');
    });

    it('keeps serving the cached sprite set when a refresh download fails', async () => {
        const metadataStore = new Map<string, unknown>([
            ['sprites_hash', 'old-hash'],
            ['sprites_manifest', TEST_MANIFEST],
        ]);
        const spriteStore = new Map<string, unknown>([
            ['mek', TEST_BLOB],
        ]);
        const dbPut = spyOn<any>(SpriteStorageService.prototype, 'dbPut').and.returnValue(Promise.resolve());

        spyOn<any>(SpriteStorageService.prototype, 'initIndexedDb').and.returnValue(Promise.resolve({} as IDBDatabase));
        spyOn<any>(SpriteStorageService.prototype, 'dbGet').and.callFake(async (store: string, key: string) => {
            if (store === 'metadata') {
                return metadataStore.get(key) ?? null;
            }

            if (store === 'sprites') {
                return spriteStore.get(key) ?? null;
            }

            return null;
        });
        spyOn<any>(SpriteStorageService.prototype, 'dbClear').and.returnValue(Promise.resolve());

        const service = TestBed.inject(SpriteStorageService);

        httpMock.expectOne('sprites/unit-icons.hash').flush('new-hash');
        await settleAsyncWork();
        httpMock.expectOne('sprites/unit-icons.json').flush(TEST_MANIFEST);
        await settleAsyncWork();
        httpMock.expectOne('sprites/mek.png').error(new ProgressEvent('error'));
        await waitForLoadingToFinish(service);

        const spriteInfo = await service.getSpriteInfo('units/mek.png');
        expect(spriteInfo).toEqual({
            url: 'blob:mapped-sprite',
            info: TEST_MANIFEST.icons['units/mek.png'],
        });
        expect(dbPut).not.toHaveBeenCalledWith('metadata', 'sprites_hash', 'new-hash');
    });

    it('keeps working in memory when IndexedDB is unavailable', async () => {
        spyOn<any>(SpriteStorageService.prototype, 'initIndexedDb').and.returnValue(Promise.resolve(null));

        const service = TestBed.inject(SpriteStorageService);

        httpMock.expectOne('sprites/unit-icons.hash').flush('hash-2');
        await settleAsyncWork();
        httpMock.expectOne('sprites/unit-icons.json').flush(TEST_MANIFEST);
        await settleAsyncWork();
        httpMock.expectOne('sprites/mek.png').flush(TEST_BLOB);
        await waitForLoadingToFinish(service);

        const spriteInfo = await service.getSpriteInfo('units/mek.png');
        expect(spriteInfo).toEqual({
            url: 'blob:mapped-sprite',
            info: TEST_MANIFEST.icons['units/mek.png'],
        });
    });

    it('treats icon and sprite type keys case-insensitively after download', async () => {
        spyOn<any>(SpriteStorageService.prototype, 'initIndexedDb').and.returnValue(Promise.resolve(null));

        const service = TestBed.inject(SpriteStorageService);

        httpMock.expectOne('sprites/unit-icons.hash').flush('hash-3');
        await settleAsyncWork();
        httpMock.expectOne('sprites/unit-icons.json').flush(CASED_MANIFEST);
        await settleAsyncWork();
        httpMock.expectOne('sprites/mek.png').flush(TEST_BLOB);
        await waitForLoadingToFinish(service);

        const spriteInfo = await service.getSpriteInfo('units/mek.png');
        expect(spriteInfo).toEqual({
            url: 'blob:mapped-sprite',
            info: CASED_MANIFEST.icons['Units/Mek.png'],
        });

        const cachedSpriteInfo = service.getCachedSpriteInfo('UNITS/MEK.PNG');
        expect(cachedSpriteInfo).toEqual({
            url: 'blob:mapped-sprite',
            info: CASED_MANIFEST.icons['Units/Mek.png'],
        });
    });
});