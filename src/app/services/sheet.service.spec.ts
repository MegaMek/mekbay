// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { SheetService } from './sheet.service';

const SERVER = 'https://sheets.example';
const FILE = 'mek/Atlas AS7-D.svg';
const URL = `${SERVER}/sheets/mek/Atlas%20AS7-D.svg`;
const CACHE_KEY = `${SERVER}::${FILE}`;

function svg(id: string): SVGSVGElement {
    return new DOMParser()
        .parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" id="${id}"/>`, 'image/svg+xml')
        .documentElement as unknown as SVGSVGElement;
}

describe('SheetService', () => {
    let service: SheetService;
    let http: HttpTestingController;
    let db: jasmine.SpyObj<Pick<DbService, 'getSheetMeta' | 'getSheet' | 'touchSheet' | 'saveSheet'>>;

    beforeEach(() => {
        db = jasmine.createSpyObj('DbService', ['getSheetMeta', 'getSheet', 'touchSheet', 'saveSheet']);
        db.touchSheet.and.resolveTo(undefined);
        db.saveSheet.and.resolveTo(undefined);
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                SheetService,
                { provide: DbService, useValue: db },
                { provide: LoggerService, useValue: jasmine.createSpyObj('LoggerService', ['info', 'warn', 'error']) },
            ],
        });
        service = TestBed.inject(SheetService);
        http = TestBed.inject(HttpTestingController);
        spyOnProperty(navigator, 'onLine', 'get').and.returnValue(true);
    });

    afterEach(() => http.verify());

    it('uses a fresh cached SVG without network traffic', async () => {
        const cached = svg('cached');
        db.getSheetMeta.and.resolveTo({ timestamp: Date.now(), etag: 'same' });
        db.getSheet.and.resolveTo(cached);

        expect(await service.getSheet(FILE, SERVER)).toBe(cached);
        expect(db.getSheet).toHaveBeenCalledOnceWith(CACHE_KEY);
        expect(db.saveSheet).not.toHaveBeenCalled();
    });

    it('downloads, polyfills, and caches a missing SVG', async () => {
        db.getSheetMeta.and.resolveTo(null);
        const result = service.getSheet(FILE, SERVER);
        await settleMicrotasks();

        http.expectOne(URL).flush('', { headers: new HttpHeaders({ ETag: 'new' }) });
        await settleMicrotasks();
        http.expectOne(URL).flush('<svg xmlns="http://www.w3.org/2000/svg" id="downloaded"/>', {
            headers: new HttpHeaders({ ETag: 'new' }),
        });

        expect((await result).id).toBe('downloaded');
        expect(db.saveSheet).toHaveBeenCalledOnceWith(CACHE_KEY, jasmine.any(SVGSVGElement), 'new');
    });
});

async function settleMicrotasks(): Promise<void> {
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
}
