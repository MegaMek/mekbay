// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { REMOTE_HOST } from '../models/common.model';
import type { UnitSummary } from '../models/unit-summary.model';
import {
    parsePreGeneratedSheetCatalog,
    PreGeneratedSheetCatalogService,
} from './pre-generated-sheet-catalog.service';

const UUID = '019f583e-a182-7f8d-a210-1cb31c1114cb';

describe('PreGeneratedSheetCatalogService', () => {
    it('downloads sheets.json once and resolves all pages by unit UUID', async () => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                PreGeneratedSheetCatalogService,
            ],
        });
        const service = TestBed.inject(PreGeneratedSheetCatalogService);
        const http = TestBed.inject(HttpTestingController);
        const unit = { uuid: UUID, serverHost: undefined } as unknown as UnitSummary;

        const first = service.resolve(unit);
        const second = service.resolve(unit);
        http.expectOne(`${REMOTE_HOST}/sheets.json?ngsw-bypass=true`).flush(JSON.stringify({
            [UUID]: ['mek/Atlas AS7-D.svg', 'mek/Atlas AS7-D_1.svg'],
        }));

        expect(await first).toEqual([
            { serverHost: REMOTE_HOST, fileName: 'mek/Atlas AS7-D.svg' },
            { serverHost: REMOTE_HOST, fileName: 'mek/Atlas AS7-D_1.svg' },
        ]);
        expect(await second).toEqual(await first);
        http.verify();
    });

    it('rejects catalog paths that can escape the sheets directory', () => {
        expect(() => parsePreGeneratedSheetCatalog(JSON.stringify({
            [UUID]: ['../outside.svg'],
        }))).toThrowError(/unsafe SVG path/u);
    });
});
