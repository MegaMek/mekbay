import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { MegaMekRulesetRecord } from '../models/megamek/rulesets.model';
import type { AvailabilitySource } from '../models/options.model';
import type { Unit } from '../models/units.model';
import { DataService } from './data.service';
import { ForceGeneratorService } from './force-generator.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';

describe('ForceGeneratorService negative era filters', () => {
    let service: ForceGeneratorService;

    const erasByName = new Map<string, Era>();
    const erasById = new Map<number, Era>();
    const factionsByName = new Map<string, Faction>();
    const factionsById = new Map<number, Faction>();
    const availabilityByUnitName = new Map<string, { e: Record<string, Record<string, [number, number]>> }>();
    const megaMekAvailabilityRecords: Array<{ e: Record<string, Record<string, [number, number]>> }> = [];
    const units: Unit[] = [];
    const optionsServiceMock = {
        options: signal<{ availabilitySource: AvailabilitySource }>({ availabilitySource: 'megamek' }),
    };

    const filtersServiceMock = {
        filteredUnits: signal<Unit[]>([]),
        effectiveFilterState: jasmine.createSpy('effectiveFilterState').and.returnValue({}),
    };

    const dataServiceMock = {
        searchCorpusVersion: signal(1),
        getUnits: jasmine.createSpy('getUnits').and.callFake(() => units),
        getEras: jasmine.createSpy('getEras').and.callFake(() => [...erasById.values()]),
        getEraByName: jasmine.createSpy('getEraByName').and.callFake((name: string) => erasByName.get(name)),
        getEraById: jasmine.createSpy('getEraById').and.callFake((id: number) => erasById.get(id)),
        getFactionByName: jasmine.createSpy('getFactionByName').and.callFake((name: string) => factionsByName.get(name)),
        getFactionById: jasmine.createSpy('getFactionById').and.callFake((id: number) => factionsById.get(id)),
        getFactions: jasmine.createSpy('getFactions').and.callFake(() => [...factionsById.values()]),
        getMegaMekAvailabilityRecords: jasmine.createSpy('getMegaMekAvailabilityRecords').and.callFake(() => megaMekAvailabilityRecords),
        getMegaMekAvailabilityRecordForUnit: jasmine.createSpy('getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => (
            availabilityByUnitName.get(unit.name)
        )),
        getMegaMekRulesetsByMulFactionId: jasmine.createSpy('getMegaMekRulesetsByMulFactionId').and.returnValue([] as MegaMekRulesetRecord[]),
        getMegaMekFactionByKey: jasmine.createSpy('getMegaMekFactionByKey').and.returnValue(undefined),
    };

    function createEra(id: number, name: string): Era {
        return {
            id,
            name,
            years: { from: id, to: id + 1 },
            factions: [],
            units: [],
        } as Era;
    }

    function createFaction(id: number, name: string): Faction {
        return {
            id,
            name,
            group: 'Other',
            img: '',
            eras: {},
        } as Faction;
    }

    beforeEach(() => {
        erasByName.clear();
        erasById.clear();
        factionsByName.clear();
        factionsById.clear();
        availabilityByUnitName.clear();
        megaMekAvailabilityRecords.length = 0;
        units.length = 0;
        dataServiceMock.searchCorpusVersion.set(1);
        optionsServiceMock.options.set({ availabilitySource: 'megamek' });
        filtersServiceMock.effectiveFilterState.calls.reset();
        filtersServiceMock.effectiveFilterState.and.returnValue({});

        for (const spy of Object.values(dataServiceMock)) {
            if ('calls' in spy) {
                spy.calls.reset();
            }
        }

        TestBed.configureTestingModule({
            providers: [
                ForceGeneratorService,
                { provide: DataService, useValue: dataServiceMock },
                { provide: OptionsService, useValue: optionsServiceMock },
                UnitAvailabilitySourceService,
                { provide: UnitSearchFiltersService, useValue: filtersServiceMock },
            ],
        });

        service = TestBed.inject(ForceGeneratorService);
    });

    it('does not pick eras excluded by a negative-only era filter', () => {
        const excludedEra = createEra(2570, 'Age of War');
        const allowedEra = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = { name: 'Atlas' } as Unit;

        erasByName.set(excludedEra.name, excludedEra);
        erasById.set(excludedEra.id, excludedEra);
        erasByName.set(allowedEra.name, allowedEra);
        erasById.set(allowedEra.id, allowedEra);
        factionsById.set(faction.id, faction);
        units.push(unit);

        const availabilityRecord: { e: Record<string, Record<string, [number, number]>> } = {
            e: {
                '2570': {
                    '10': [3, 0],
                },
                '3150': {
                    '10': [3, 0],
                },
            },
        };
        availabilityByUnitName.set(unit.name, availabilityRecord);
        megaMekAvailabilityRecords.push(availabilityRecord);

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: {
                    'Age of War': {
                        name: 'Age of War',
                        state: 'not',
                        count: 1,
                    },
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0);

        const context = service.resolveGenerationContext([unit]);

        expect(context.forceEra?.id).toBe(3150);
        expect(context.availabilityEraIds).toEqual([3150]);
    });

    it('does not roll MUL-invisible eras when only the faction filter is active', () => {
        const invisibleEra = createEra(2570, 'Age of War');
        const visibleEra = createEra(3067, 'Civil War');
        const faction = createFaction(10, 'Capellan Confederation');
        const unit = { id: 1, name: 'Vindicator' } as Unit;
        const availabilityRecord: { e: Record<string, Record<string, [number, number]>> } = {
            e: {
                '2570': {
                    '10': [3, 0],
                },
                '3067': {
                    '10': [3, 0],
                },
            },
        };

        invisibleEra.units = new Set<number>();
        visibleEra.units = new Set<number>([unit.id]);
        faction.eras = {
            [visibleEra.id]: new Set<number>([unit.id]),
        };

        erasByName.set(invisibleEra.name, invisibleEra);
        erasById.set(invisibleEra.id, invisibleEra);
        erasByName.set(visibleEra.name, visibleEra);
        erasById.set(visibleEra.id, visibleEra);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        availabilityByUnitName.set(unit.name, availabilityRecord);
        megaMekAvailabilityRecords.push(availabilityRecord);
        units.push(unit);
        optionsServiceMock.options.set({ availabilitySource: 'mul' });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            faction: {
                interactedWith: true,
                value: {
                    cc: {
                        name: 'Capellan Confederation',
                        state: 'or',
                        count: 1,
                    },
                },
            },
        });

        const context = service.resolveGenerationContext([unit]);

        expect(context.forceFaction).toBe(faction);
        expect(context.forceEra).toBe(visibleEra);
        expect(context.availabilityEraIds).toEqual([visibleEra.id]);
        expect(context.availablePairCount).toBe(1);
    });
});