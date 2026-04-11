import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Unit } from '../models/units.model';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UnitRuntimeService } from './unit-runtime.service';
import { MulUnitSourcesCatalogService } from './catalogs/mul-unit-sources-catalog.service';
import { UnitSearchIndexService } from './unit-search-index.service';

function createUnit(name: string): Unit {
    return { name } as Unit;
}

describe('UnitRuntimeService', () => {
    let service: UnitRuntimeService;
    const unitSearchIndexServiceMock = {
        prepareUnits: jasmine.createSpy('prepareUnits'),
        rebuildTagSearchIndex: jasmine.createSpy('rebuildTagSearchIndex'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        unitSearchIndexServiceMock.prepareUnits.calls.reset();
        unitSearchIndexServiceMock.rebuildTagSearchIndex.calls.reset();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                UnitRuntimeService,
                { provide: TagsService, useValue: { getTagData: jasmine.createSpy('getTagData') } },
                { provide: PublicTagsService, useValue: { getPublicTagsForUnit: jasmine.createSpy('getPublicTagsForUnit') } },
                { provide: MulUnitSourcesCatalogService, useValue: { getUnitSourcesByMulId: jasmine.createSpy('getUnitSourcesByMulId') } },
                { provide: UnitSearchIndexService, useValue: unitSearchIndexServiceMock },
            ],
        });

        service = TestBed.inject(UnitRuntimeService);
    });

    it('retrieves units by name without matching case exactly', () => {
        const unit = createUnit('Mad Cat Prime');

        service.preprocessUnits([unit]);

        expect(service.getUnitByName('Mad Cat Prime')).toBe(unit);
        expect(service.getUnitByName('mad cat prime')).toBe(unit);
        expect(service.getUnitByName('MAD CAT PRIME')).toBe(unit);
    });
});