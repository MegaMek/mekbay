import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Unit } from '../models/units.model';
import type { TagData } from './db.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UnitRuntimeService } from './unit-runtime.service';
import { MulUnitSourcesCatalogService } from './catalogs/mul-unit-sources-catalog.service';
import { UnitSearchIndexService } from './unit-search-index.service';

function createUnit(name: string, chassis = name): Unit {
    return { name, chassis, type: 'Mek' } as unknown as Unit;
}

describe('UnitRuntimeService', () => {
    let service: UnitRuntimeService;
    const unitSearchIndexServiceMock = {
        prepareUnits: jasmine.createSpy('prepareUnits'),
        rebuildTagSearchIndex: jasmine.createSpy('rebuildTagSearchIndex'),
    };
    const tagsServiceMock = {
        getTagData: jasmine.createSpy('getTagData'),
        fixNameTagsCoveredByChassis: jasmine.createSpy('fixNameTagsCoveredByChassis'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        unitSearchIndexServiceMock.prepareUnits.calls.reset();
        unitSearchIndexServiceMock.rebuildTagSearchIndex.calls.reset();
        tagsServiceMock.getTagData.calls.reset();
        tagsServiceMock.fixNameTagsCoveredByChassis.calls.reset();
        tagsServiceMock.fixNameTagsCoveredByChassis.and.resolveTo(undefined);

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                UnitRuntimeService,
                { provide: TagsService, useValue: tagsServiceMock },
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

    it('removes unit tags that are already covered by same-named chassis tags when applying tag data', () => {
        const prime = createUnit('Dasher Prime', 'Dasher');
        const variantA = createUnit('Dasher A', 'Dasher');
        const adder = createUnit('Adder Prime', 'Adder');
        const tagData: TagData = {
            tags: {
                clan: {
                    label: 'CLAN',
                    units: {
                        'Dasher Prime': { q: 2 },
                        'Dasher A': {},
                        'Adder Prime': {},
                    },
                    chassis: {
                        'Dasher|Mek': {},
                    },
                },
                cjf: {
                    label: 'CJF',
                    units: {
                        'Dasher Prime': {},
                        'Dasher A': {},
                    },
                    chassis: {},
                },
            },
            timestamp: 1,
            formatVersion: 3,
        };
        tagsServiceMock.fixNameTagsCoveredByChassis.and.callFake((units: Unit[], data: TagData | null) => {
            for (const unit of units) {
                const chassisKey = `${unit.chassis}|${unit.type}`;
                for (const entry of Object.values(data?.tags ?? {})) {
                    if (entry.units[unit.name] !== undefined && entry.chassis[chassisKey] !== undefined) {
                        delete entry.units[unit.name];
                    }
                }
            }
            return Promise.resolve();
        });

        service.applyTagDataToUnits([prime, variantA, adder], tagData, { rebuildTagSearchIndex: false });

        expect(prime._nameTags).toEqual([{ tag: 'CJF', quantity: 1 }]);
        expect(prime._chassisTags).toEqual([{ tag: 'CLAN', quantity: 1 }]);
        expect(variantA._nameTags).toEqual([{ tag: 'CJF', quantity: 1 }]);
        expect(variantA._chassisTags).toEqual([{ tag: 'CLAN', quantity: 1 }]);
        expect(adder._nameTags).toEqual([{ tag: 'CLAN', quantity: 1 }]);
        expect(adder._chassisTags).toEqual([]);
        expect(tagData.tags['clan'].units).toEqual({ 'Adder Prime': {} });
        expect(tagsServiceMock.fixNameTagsCoveredByChassis).toHaveBeenCalledOnceWith([prime, variantA, adder], tagData);
    });
});
