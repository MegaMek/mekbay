// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TestTankEntity } from '../models/entity/testing/test-entities';
import type { Options } from '../models/options.model';
import { RecordSheetSvgGenerator } from '../utils/sheets/record-sheet-svg-generator';
import { UnitFluffImageService } from './catalogs/unit-fluff-image.service';
import { OptionsService } from './options.service';
import { RecordSheetSourceService } from './record-sheet-source.service';

describe('RecordSheetSourceService', () => {
    const options = signal({ CBTRules: 'core-2026', recordSheetPipLayout: 'classic', printAllOptions: { paperSize: 'letter' } } as Options);

    beforeEach(() => {
        options.set({ CBTRules: 'core-2026', recordSheetPipLayout: 'classic', printAllOptions: { paperSize: 'letter' } } as Options);
        TestBed.configureTestingModule({
            providers: [
                RecordSheetSourceService,
                { provide: OptionsService, useValue: { options } },
                {
                    provide: UnitFluffImageService,
                    useValue: { initialize: async () => undefined, resolveEntityUrl: () => 'https://art.example/tank.png' },
                },
            ],
        });
    });

    it('uses the global paper format unless the caller explicitly overrides it', async () => {
        options.update(value => ({ ...value, printAllOptions: { ...value.printAllOptions, paperSize: 'a4' } }));
        const generate = spyOn(RecordSheetSvgGenerator, 'generatePages').and.resolveTo([svg('sheet')]);
        const entity = new TestTankEntity();
        const service = TestBed.inject(RecordSheetSourceService);
        await service.load(entity);
        expect(generate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ format: 'a4', pageFormat: 'a4' }));
        await service.load(entity, { format: 'compact' });
        expect(generate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ format: 'compact', pageFormat: 'a4' }));
        await service.load(entity, { format: 'letter' });
        expect(generate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ format: 'letter', pageFormat: 'letter' }));
    });

    it('uses the default-enabled quirk setting and honors disabling it for every caller', async () => {
        const generate = spyOn(RecordSheetSvgGenerator, 'generatePages').and.resolveTo([svg('sheet')]);
        const service = TestBed.inject(RecordSheetSourceService);
        const entity = new TestTankEntity();
        await service.load(entity);
        expect(generate.calls.mostRecent().args[1]?.showQuirks).toBeTrue();
        options.update(value => ({ ...value, CBTOptionalRules: { ...value.CBTOptionalRules, quirks: false } }));
        await service.load(entity, { showQuirks: true });
        expect(generate.calls.mostRecent().args[1]?.showQuirks).toBeFalse();
    });

    it('always generates a record sheet from the Entity and active ruleset', async () => {
        const generated = svg('generated');
        const generate = spyOn(RecordSheetSvgGenerator, 'generatePages').and.resolveTo([generated]);
        const entity = new TestTankEntity();
        const service = TestBed.inject(RecordSheetSourceService);

        const result = await service.load(entity);

        expect(generate).toHaveBeenCalledOnceWith(entity, jasmine.objectContaining({
            ruleset: 'core-2026',
            pipLayout: 'classic',
            fluffImageUrl: 'https://art.example/tank.png',
        }));
        expect(result.svgs).toEqual([generated]);
        expect(generated.dataset['mekbaySheetSource']).toBe('generated');
    });
});

function svg(id: string): SVGSVGElement {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    element.id = id;
    return element;
}
