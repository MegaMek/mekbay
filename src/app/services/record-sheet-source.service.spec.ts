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
    const options = signal({ CBTRules: 'core-2026' } as Options);

    beforeEach(() => {
        options.set({ CBTRules: 'core-2026' } as Options);
        TestBed.configureTestingModule({
            providers: [
                RecordSheetSourceService,
                { provide: OptionsService, useValue: { options } },
                {
                    provide: UnitFluffImageService,
                    useValue: { resolveEntityUrl: () => 'https://art.example/tank.png' },
                },
            ],
        });
    });

    it('always generates a record sheet from the Entity and active ruleset', async () => {
        const generated = svg('generated');
        const generate = spyOn(RecordSheetSvgGenerator, 'generate').and.resolveTo(generated);
        const entity = new TestTankEntity();
        const service = TestBed.inject(RecordSheetSourceService);

        const result = await service.load(entity);

        expect(generate).toHaveBeenCalledOnceWith(entity, jasmine.objectContaining({
            ruleset: 'core-2026',
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
