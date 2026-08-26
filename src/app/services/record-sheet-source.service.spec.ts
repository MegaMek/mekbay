// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TestTankEntity } from '../models/entity/testing/test-entities';
import type { Options } from '../models/options.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { RecordSheetSvgGenerator } from '../utils/sheets/record-sheet-svg-generator';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { PreGeneratedSheetCatalogService } from './pre-generated-sheet-catalog.service';
import { RecordSheetSourceService } from './record-sheet-source.service';
import { SheetService } from './sheet.service';

describe('RecordSheetSourceService', () => {
    const options = signal({ usePreGeneratedRecordSheets: false } as Options);
    let catalogs: jasmine.SpyObj<Pick<PreGeneratedSheetCatalogService, 'resolve'>>;
    let sheets: jasmine.SpyObj<Pick<SheetService, 'getSheet'>>;
    let logger: jasmine.SpyObj<Pick<LoggerService, 'warn'>>;
    let service: RecordSheetSourceService;

    beforeEach(() => {
        options.set({ usePreGeneratedRecordSheets: false } as Options);
        catalogs = jasmine.createSpyObj('PreGeneratedSheetCatalogService', ['resolve']);
        sheets = jasmine.createSpyObj('SheetService', ['getSheet']);
        logger = jasmine.createSpyObj('LoggerService', ['warn']);
        TestBed.configureTestingModule({
            providers: [
                RecordSheetSourceService,
                { provide: OptionsService, useValue: { options } },
                { provide: PreGeneratedSheetCatalogService, useValue: catalogs },
                { provide: SheetService, useValue: sheets },
                { provide: LoggerService, useValue: logger },
            ],
        });
        service = TestBed.inject(RecordSheetSourceService);
    });

    it('uses the lightweight generator by default without touching the legacy catalog', async () => {
        const generated = svg('generated');
        spyOn(RecordSheetSvgGenerator, 'generate').and.resolveTo(generated);

        const result = await service.load(createEmptyUnit(), new TestTankEntity());

        expect(service.mode()).toBe('generated');
        expect(result.source).toBe('generated');
        expect(result.svgs).toEqual([generated]);
        expect(catalogs.resolve).not.toHaveBeenCalled();
    });

    it('loads and clones every SVG listed by sheets.json when compatibility mode is enabled', async () => {
        options.set({ usePreGeneratedRecordSheets: true } as Options);
        catalogs.resolve.and.resolveTo([
            { serverHost: 'https://sheets.example', fileName: 'mek/first.svg' },
            { serverHost: 'https://sheets.example', fileName: 'mek/second.svg' },
        ]);
        const first = svg('first');
        const second = svg('second');
        sheets.getSheet.and.returnValues(Promise.resolve(first), Promise.resolve(second));

        const result = await service.load(createEmptyUnit(), new TestTankEntity());

        expect(service.mode()).toBe('pre-generated');
        expect(result.source).toBe('pre-generated');
        expect(result.svgs.length).toBe(2);
        expect(result.svgs[0]).not.toBe(first);
        expect(result.svgs[0].id).toBe('first');
        expect(result.svgs[0].dataset['mekbaySheetSource']).toBe('pre-generated');
        expect(sheets.getSheet).toHaveBeenCalledTimes(2);
    });

    it('falls back to generation when the catalog has no legacy sheet', async () => {
        options.set({ usePreGeneratedRecordSheets: true } as Options);
        catalogs.resolve.and.resolveTo([]);
        const generated = svg('fallback');
        spyOn(RecordSheetSvgGenerator, 'generate').and.resolveTo(generated);

        const result = await service.load(createEmptyUnit(), new TestTankEntity());

        expect(result.source).toBe('generated');
        expect(result.svgs).toEqual([generated]);
        expect(logger.warn).toHaveBeenCalled();
    });
});

function svg(id: string): SVGSVGElement {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    element.id = id;
    return element;
}
