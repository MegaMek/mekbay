// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideHttpClient, HttpHeaders } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { SheetService } from './sheet.service';

const TEST_SERVER_HOST = 'https://sheets.example';
const TEST_SHEET_NAME = 'mek/atlas.svg';
const TEST_SHEET_URL = `${TEST_SERVER_HOST}/sheets/${TEST_SHEET_NAME}`;
const TEST_CACHE_KEY = `${TEST_SERVER_HOST}::${TEST_SHEET_NAME}`;

function makeSvg(id: string): SVGSVGElement {
    return new DOMParser()
        .parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" id="${id}"/>`, 'image/svg+xml')
        .documentElement as unknown as SVGSVGElement;
}

async function settleMicrotasks(): Promise<void> {
    for (let index = 0; index < 3; index += 1) {
        await Promise.resolve();
    }
}

describe('SheetService', () => {
    let service: SheetService;
    let httpMock: HttpTestingController;
    let dbService: jasmine.SpyObj<DbService>;

    beforeEach(() => {
        TestBed.resetTestingModule();

        dbService = jasmine.createSpyObj<DbService>('DbService', [
            'getSheetMeta',
            'getSheet',
            'touchSheet',
            'saveSheet',
        ]);
        dbService.touchSheet.and.resolveTo(undefined);
        dbService.saveSheet.and.resolveTo(undefined);

        const logger = jasmine.createSpyObj<LoggerService>('LoggerService', [
            'info',
            'warn',
            'error',
        ]);

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                SheetService,
                { provide: DbService, useValue: dbService },
                { provide: LoggerService, useValue: logger },
            ],
        });

        service = TestBed.inject(SheetService);
        httpMock = TestBed.inject(HttpTestingController);
        spyOnProperty(navigator, 'onLine', 'get').and.returnValue(true);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('uses a fresh sheet whose cache fingerprintVersion matches', async () => {
        const cachedSheet = makeSvg('cached');
        dbService.getSheetMeta.and.resolveTo({
            timestamp: Date.now(),
            etag: 'etag-1',
            fingerprintVersion: 1,
        });
        dbService.getSheet.and.resolveTo(cachedSheet);

        const result = await service.getSheet(TEST_SHEET_NAME, TEST_SERVER_HOST);

        expect(result).toBe(cachedSheet);
        expect(dbService.getSheet).toHaveBeenCalledOnceWith(TEST_CACHE_KEY);
        expect(dbService.touchSheet).not.toHaveBeenCalled();
        expect(dbService.saveSheet).not.toHaveBeenCalled();
        httpMock.expectNone(TEST_SHEET_URL);
    });

    it('revalidates a fingerprintVersion mismatch without rejecting the cached sheet', async () => {
        const cachedSheet = makeSvg('cached');
        dbService.getSheetMeta.and.resolveTo({
            timestamp: Date.now(),
            etag: 'etag-1',
            fingerprintVersion: 0,
        });
        dbService.getSheet.and.resolveTo(cachedSheet);

        const sheetPromise = service.getSheet(TEST_SHEET_NAME, TEST_SERVER_HOST);
        await settleMicrotasks();

        const headRequest = httpMock.expectOne(TEST_SHEET_URL);
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', { headers: new HttpHeaders({ ETag: 'etag-1' }) });

        const result = await sheetPromise;

        expect(result).toBe(cachedSheet);
        expect(dbService.getSheet).toHaveBeenCalledOnceWith(TEST_CACHE_KEY);
        expect(dbService.touchSheet).toHaveBeenCalledOnceWith(TEST_CACHE_KEY, 1);
        expect(dbService.saveSheet).not.toHaveBeenCalled();
    });

    it('downloads and fingerprintVersions a replacement for a legacy cache entry', async () => {
        dbService.getSheetMeta.and.resolveTo({
            timestamp: Date.now(),
            etag: 'etag-old',
        });

        const sheetPromise = service.getSheet(TEST_SHEET_NAME, TEST_SERVER_HOST);
        await settleMicrotasks();

        const headRequest = httpMock.expectOne(TEST_SHEET_URL);
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', { headers: new HttpHeaders({ ETag: 'etag-new' }) });
        await settleMicrotasks();

        const getRequest = httpMock.expectOne(TEST_SHEET_URL);
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush('<svg xmlns="http://www.w3.org/2000/svg" id="downloaded"/>', {
            headers: new HttpHeaders({ ETag: 'etag-new' }),
        });

        const result = await sheetPromise;

        expect(result.id).toBe('downloaded');
        expect(dbService.getSheet).not.toHaveBeenCalled();
        expect(dbService.touchSheet).not.toHaveBeenCalled();
        expect(dbService.saveSheet).toHaveBeenCalledOnceWith(
            TEST_CACHE_KEY,
            jasmine.any(SVGSVGElement),
            'etag-new',
            1,
        );
    });
});
