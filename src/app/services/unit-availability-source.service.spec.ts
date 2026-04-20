import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { AvailabilitySource } from '../models/options.model';
import { MULFACTION_EXTINCT } from '../models/mulfactions.model';
import type { Unit } from '../models/units.model';
import {
    MEGAMEK_AVAILABILITY_RARITY_OPTIONS,
    MEGAMEK_AVAILABILITY_UNKNOWN,
    MEGAMEK_AVAILABILITY_UNKNOWN_SCORE,
} from '../models/megamek/availability.model';
import type { MegaMekFactionRecord } from '../models/megamek/factions.model';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';

describe('UnitAvailabilitySourceService', () => {
    let service: UnitAvailabilitySourceService;

    const factionsById = new Map<number, Faction>();
    const megaMekFactionsByMulId = new Map<number, MegaMekFactionRecord[]>();
    const orderedEras: Era[] = [];
    const units: Unit[] = [];
    const megaMekAvailabilityByUnitName = new Map<string, { n?: string; e: Record<string, Record<string, [number, number]>> }>();
    const megaMekAvailabilityRecords: Array<{ n?: string; e: Record<string, Record<string, [number, number]>> }> = [];
    const optionsServiceMock = {
        options: signal<{
            availabilitySource: AvailabilitySource;
            megaMekAvailabilityFiltersUseAllScopedOptions?: boolean;
        }>({ availabilitySource: 'mul', megaMekAvailabilityFiltersUseAllScopedOptions: true }),
    };

    const dataServiceMock = {
        searchCorpusVersion: signal(1),
        megaMekAvailabilityVersion: signal(0),
        getUnits: jasmine.createSpy('getUnits').and.callFake(() => units),
        getUnitByName: jasmine.createSpy('getUnitByName').and.callFake((name: string) => {
            return units.find((unit) => unit.name === name);
        }),
        getEras: jasmine.createSpy('getEras').and.callFake(() => orderedEras),
        getFactions: jasmine.createSpy('getFactions').and.callFake(() => Array.from(factionsById.values())),
        getFactionById: jasmine.createSpy('getFactionById').and.callFake((id: number) => factionsById.get(id) ?? null),
        getMegaMekFactionsByMulId: jasmine.createSpy('getMegaMekFactionsByMulId').and.callFake((mulId: number) => megaMekFactionsByMulId.get(mulId) ?? []),
        getMegaMekAvailabilityRecordForUnit: jasmine.createSpy('getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return megaMekAvailabilityByUnitName.get(unit.name);
        }),
        getMegaMekAvailabilityRecords: jasmine.createSpy('getMegaMekAvailabilityRecords').and.callFake(() => megaMekAvailabilityRecords),
    };

    beforeEach(() => {
        factionsById.clear();
        megaMekFactionsByMulId.clear();
        orderedEras.length = 0;
        units.length = 0;
        megaMekAvailabilityByUnitName.clear();
        megaMekAvailabilityRecords.length = 0;
        dataServiceMock.searchCorpusVersion.set(1);
        dataServiceMock.megaMekAvailabilityVersion.set(0);
        dataServiceMock.getUnits.calls.reset();
        dataServiceMock.getUnitByName.calls.reset();
        dataServiceMock.getEras.calls.reset();
        dataServiceMock.getFactions.calls.reset();
        dataServiceMock.getFactionById.calls.reset();
        dataServiceMock.getMegaMekFactionsByMulId.calls.reset();
        dataServiceMock.getMegaMekAvailabilityRecordForUnit.calls.reset();
        dataServiceMock.getMegaMekAvailabilityRecords.calls.reset();
        optionsServiceMock.options.set({ availabilitySource: 'mul', megaMekAvailabilityFiltersUseAllScopedOptions: true });

        TestBed.configureTestingModule({
            providers: [
                UnitAvailabilitySourceService,
                { provide: DataService, useValue: dataServiceMock },
                { provide: OptionsService, useValue: optionsServiceMock },
            ],
        });

        service = TestBed.inject(UnitAvailabilitySourceService);
    });

    it('returns visible era unit ids without extinct members', () => {
        const era = {
            id: 100,
            name: 'Succession Wars',
            units: new Set([1, 2, 3]),
            years: { from: 2780, to: 3049 },
        } as Era;
        orderedEras.push(era);

        factionsById.set(MULFACTION_EXTINCT, {
            id: MULFACTION_EXTINCT,
            name: 'Extinct',
            group: 'Other',
            img: '',
            eras: {
                [era.id]: new Set([2]),
            },
        } as Faction);

        expect(Array.from(service.getVisibleEraUnitIds(era)).sort((left, right) => left.localeCompare(right))).toEqual(['1', '3']);
    });

    it('scopes faction availability to the selected eras', () => {
        const faction = {
            id: 42,
            name: 'Federated Suns',
            group: 'Inner Sphere',
            img: '',
            eras: {
                100: new Set([1, 2]),
                200: new Set([3, 4]),
            },
        } as Faction;

        expect(Array.from(service.getFactionUnitIds(faction, new Set([200]))).sort((left, right) => left.localeCompare(right))).toEqual(['3', '4']);
    });

    it('supports MegaMek availability overrides without changing the global option', () => {
        const era = {
            id: 3150,
            name: 'ilClan',
            units: new Set<number>(),
            years: { from: 3151 },
        } as Era;
        const faction = {
            id: 99,
            name: 'Test Faction',
            group: 'Other',
            img: '',
            eras: {},
        } as Faction;
        const unit = { id: 1, name: 'Atlas', type: 'Mek', chassis: 'Atlas', model: 'AS7-D' } as Unit;

        orderedEras.push(era);
        units.push(unit);
        megaMekAvailabilityByUnitName.set(unit.name, {
            n: unit.name,
            e: {
                '3150': {
                    '99': [7, 0],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);

        expect(service.getFactionEraUnitIds(faction, era).size).toBe(0);
        expect(service.getFactionEraUnitIds(faction, era, 'megamek').has(unit.name)).toBeTrue();
        expect(service.getUnitAvailabilityKey(unit, 'megamek')).toBe(unit.name);
        expect(optionsServiceMock.options().availabilitySource).toBe('mul');
    });

    it('supports MUL availability overrides while MegaMek is globally enabled', () => {
        const era = {
            id: 100,
            name: 'Succession Wars',
            units: new Set([1, 2]),
            years: { from: 2780, to: 3049 },
        } as Era;
        const faction = {
            id: 42,
            name: 'Federated Suns',
            group: 'Inner Sphere',
            img: '',
            eras: {
                100: new Set([1]),
            },
        } as Faction;
        const unit = { id: 1, name: 'Atlas', type: 'Mek', chassis: 'Atlas', model: 'AS7-D' } as Unit;

        orderedEras.push(era);
        optionsServiceMock.options.set({ availabilitySource: 'megamek' });

        expect(Array.from(service.getFactionEraUnitIds(faction, era, 'mul'))).toEqual(['1']);
        expect(service.getUnitAvailabilityKey(unit, 'mul')).toBe('1');
        expect(service.useMegaMekAvailability('mul')).toBeFalse();
        expect(service.useMegaMekAvailability()).toBeTrue();
    });

    it('builds a force-scoped MegaMek availability context from only the provided units', () => {
        const earlyEra = {
            id: 3050,
            name: 'Clan Invasion',
            units: new Set<number>(),
            years: { from: 3050, to: 3061 },
        } as Era;
        const lateEra = {
            id: 3067,
            name: 'Civil War',
            units: new Set<number>(),
            years: { from: 3062, to: 3080 },
        } as Era;
        const combine = {
            id: 7,
            name: 'Draconis Combine',
            group: 'Inner Sphere',
            img: '',
            eras: {},
        } as Faction;
        const fedsuns = {
            id: 8,
            name: 'Federated Suns',
            group: 'Inner Sphere',
            img: '',
            eras: {},
        } as Faction;
        const extinctFaction = {
            id: MULFACTION_EXTINCT,
            name: 'Extinct',
            group: 'Other',
            img: '',
            eras: {},
        } as Faction;
        const atlas = { id: 1, name: 'Atlas', type: 'Mek', chassis: 'Atlas', model: 'AS7-D' } as Unit;
        const locust = { id: 2, name: 'Locust', type: 'Mek', chassis: 'Locust', model: 'LCT-1V' } as Unit;
        const missing = { id: 3, name: 'Missing', type: 'Mek', chassis: 'Missing', model: 'MIS-1' } as Unit;

        orderedEras.push(earlyEra, lateEra);
        units.push(atlas, locust, missing);
        optionsServiceMock.options.set({ availabilitySource: 'megamek' });

        megaMekAvailabilityByUnitName.set(atlas.name, {
            n: atlas.name,
            e: {
                '3050': { '7': [5, 0] },
                '3067': { '8': [4, 0] },
            },
        });
        megaMekAvailabilityByUnitName.set(locust.name, {
            n: locust.name,
            e: {
                '3050': { '7': [0, 3] },
            },
        });

        const context = service.createForceAvailabilityContextForUnits([atlas, locust, missing], orderedEras);

        expect(context.source).toBe('megamek');
        expect(Array.from(context.getVisibleEraUnitIds(earlyEra)).sort((left, right) => left.localeCompare(right))).toEqual(['Atlas', 'Locust']);
        expect(Array.from(context.getVisibleEraUnitIds(lateEra))).toEqual(['Atlas']);
        expect(Array.from(context.getFactionEraUnitIds(combine, earlyEra)).sort((left, right) => left.localeCompare(right))).toEqual(['Atlas', 'Locust']);
        expect(Array.from(context.getFactionEraUnitIds(fedsuns, lateEra))).toEqual(['Atlas']);
        expect(Array.from(context.getFactionEraUnitIds(extinctFaction, lateEra))).toEqual(['Locust']);
        expect(Array.from(context.getFactionUnitIds(combine)).sort((left, right) => left.localeCompare(right))).toEqual(['Atlas', 'Locust']);
    });

    it('uses MegaMek faction active years for factionExistsInEra when faction metadata is available', () => {
        const activeEra = {
            id: 3050,
            name: 'Clan Invasion',
            units: new Set<number>(),
            years: { from: 3050, to: 3061 },
        } as Era;
        const inactiveEra = {
            id: 3151,
            name: 'ilClan',
            units: new Set<number>(),
            years: { from: 3151 },
        } as Era;
        const faction = {
            id: 7,
            name: 'Draconis Combine',
            group: 'Inner Sphere',
            img: '',
            eras: {},
        } as Faction;

        megaMekFactionsByMulId.set(faction.id, [{
            id: 'DC',
            name: 'Draconis Combine',
            mulId: [faction.id],
            yearsActive: [{ start: 2319, end: 3130 }],
            fallBackFactions: [],
            ancestry: [],
            nameChanges: [],
        }]);

        expect(service.factionExistsInEra(faction, activeEra, 'megamek')).toBeTrue();
        expect(service.factionExistsInEra(faction, inactiveEra, 'megamek')).toBeFalse();
    });

    it('falls back to MUL faction membership when MegaMek faction metadata is unavailable', () => {
        const era = {
            id: 100,
            name: 'Succession Wars',
            units: new Set<number>(),
            years: { from: 2780, to: 3049 },
        } as Era;
        const faction = {
            id: 42,
            name: 'Federated Suns',
            group: 'Inner Sphere',
            img: '',
            eras: {
                100: new Set([1]),
            },
        } as Faction;

        expect(service.factionExistsInEra(faction, era, 'megamek')).toBeTrue();
    });

    it('returns isolated sets for single-era MUL lookups while using the cached faction-era membership', () => {
        const era = {
            id: 100,
            name: 'Succession Wars',
            units: new Set([1, 2]),
            years: { from: 2780, to: 3049 },
        } as Era;
        const otherEra = {
            id: 200,
            name: 'Clan Invasion',
            units: new Set([3]),
            years: { from: 3050, to: 3067 },
        } as Era;
        const faction = {
            id: 42,
            name: 'Federated Suns',
            group: 'Inner Sphere',
            img: '',
            eras: {
                100: new Set([1]),
                200: new Set([3]),
            },
        } as Faction;

        const first = service.getFactionEraUnitIds(faction, era, 'mul');
        first.add('999');

        expect(Array.from(service.getFactionEraUnitIds(faction, era, 'mul'))).toEqual(['1']);
        expect(Array.from(service.getFactionUnitIds(faction, new Set([otherEra.id]), 'mul'))).toEqual(['3']);
    });

    it('returns the highest scoped MegaMek score and marks missing data as unknown', () => {
        const scopedUnit = { id: 1, name: 'Scoped Unit', type: 'Mek', chassis: 'Scoped Unit', model: 'SCP-1' } as Unit;
        const missingUnit = { id: 2, name: 'Missing Unit', type: 'Mek', chassis: 'Missing Unit', model: 'MIS-1' } as Unit;

        units.push(scopedUnit, missingUnit);
        megaMekAvailabilityByUnitName.set(scopedUnit.name, {
            n: scopedUnit.name,
            e: {
                '3050': {
                    '7': [5, 1],
                    '8': [0, 2],
                },
                '3067': {
                    '7': [4, 6.6],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(scopedUnit.name)!);

        expect(service.getMegaMekAvailabilityScore(scopedUnit)).toBe(6.6);
        expect(service.getMegaMekAvailabilityScore(scopedUnit, {
            availabilityFrom: new Set(['Production']),
        })).toBe(5);
        expect(service.getMegaMekAvailabilityScore(scopedUnit, {
            factionIds: new Set([8]),
        })).toBe(2);
        expect(service.getMegaMekAvailabilityScore(scopedUnit, {
            eraIds: new Set([3067]),
            factionIds: new Set([8]),
        })).toBe(0);
        expect(service.getMegaMekAvailabilityScore(missingUnit)).toBe(MEGAMEK_AVAILABILITY_UNKNOWN_SCORE);
    });

    it('matches MegaMek rarity against any scoped availability option when the feature flag is enabled', () => {
        const ilClan = {
            id: 3151,
            name: 'ilClan',
            units: new Set<number>(),
            years: { from: 3151 },
        } as Era;
        const darkAge = {
            id: 3131,
            name: 'Dark Age',
            units: new Set<number>(),
            years: { from: 3131, to: 3150 },
        } as Era;
        const unit = {
            id: 3,
            name: 'BattleMaster C3',
            type: 'Mek',
            chassis: 'BattleMaster',
            model: 'C3',
        } as Unit;

        orderedEras.push(darkAge, ilClan);
        units.push(unit);
        megaMekAvailabilityByUnitName.set(unit.name, {
            n: unit.name,
            e: {
                '3131': {
                    '1': [2, 2],
                },
                '3151': {
                    '1': [2, 2],
                    '2': [7, 0],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);

        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', {
            eraIds: new Set([ilClan.id]),
        })).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Very Rare', {
            eraIds: new Set([ilClan.id]),
        })).toBeTrue();

        expect(service.unitMatchesAvailabilityRarity(unit, 'Very Rare', {
            eraIds: new Set([darkAge.id]),
        })).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', {
            eraIds: new Set([darkAge.id]),
        })).toBeFalse();

        expect(service.unitMatchesAvailabilityRarity(unit, 'Very Rare', {
            eraIds: new Set([ilClan.id]),
            factionIds: new Set([1]),
        })).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', {
            eraIds: new Set([ilClan.id]),
            factionIds: new Set([2]),
        })).toBeTrue();

        expect(service.unitMatchesAvailabilityRarity(unit, 'Very Rare', {
            eraIds: new Set([ilClan.id]),
            availabilityFrom: new Set(['Salvage']),
        })).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', {
            eraIds: new Set([ilClan.id]),
            availabilityFrom: new Set(['Salvage']),
        })).toBeFalse();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Very Rare', {
            eraIds: new Set([ilClan.id]),
            availabilityFrom: new Set(['Production']),
        })).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', {
            eraIds: new Set([ilClan.id]),
            availabilityFrom: new Set(['Production']),
        })).toBeTrue();

        expect(service.getMegaMekRarityUnitIds('Common', {
            eraIds: new Set([ilClan.id]),
        }).has(unit.name)).toBeTrue();
        expect(service.getMegaMekRarityUnitIds('Very Rare', {
            eraIds: new Set([ilClan.id]),
        }).has(unit.name)).toBeTrue();
        expect(service.getMegaMekRarityUnitIds('Common', {
            eraIds: new Set([ilClan.id]),
            availabilityFrom: new Set(['Production']),
        }).has(unit.name)).toBeTrue();
        expect(service.getMegaMekRarityUnitIds('Very Rare', {
            eraIds: new Set([ilClan.id]),
            availabilityFrom: new Set(['Production']),
        }).has(unit.name)).toBeTrue();
    });

    it('rebuilds scoped MegaMek rarity caches when the rarity mode changes', () => {
        const ilClan = {
            id: 3151,
            name: 'ilClan',
            units: new Set<number>(),
            years: { from: 3151 },
        } as Era;
        const unit = {
            id: 3,
            name: 'BattleMaster C3',
            type: 'Mek',
            chassis: 'BattleMaster',
            model: 'C3',
        } as Unit;

        orderedEras.push(ilClan);
        units.push(unit);
        megaMekAvailabilityByUnitName.set(unit.name, {
            n: unit.name,
            e: {
                '3151': {
                    '1': [2, 0],
                    '2': [7, 0],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);

        const context = {
            eraIds: new Set([ilClan.id]),
            availabilityFrom: new Set(['Production' as const]),
        };

        optionsServiceMock.options.set({
            availabilitySource: 'megamek',
            megaMekAvailabilityFiltersUseAllScopedOptions: true,
        });

        expect(service.getMegaMekRarityUnitIds('Very Rare', context).has(unit.name)).toBeTrue();

        optionsServiceMock.options.set({
            availabilitySource: 'megamek',
            megaMekAvailabilityFiltersUseAllScopedOptions: false,
        });

        expect(service.getMegaMekRarityUnitIds('Very Rare', context).has(unit.name)).toBeFalse();
        expect(service.getMegaMekRarityUnitIds('Common', context).has(unit.name)).toBeTrue();
    });

    it('bridges MegaMek scope through MUL faction membership when MUL availability is selected', () => {
        const darkAge = {
            id: 3131,
            name: 'Dark Age',
            units: new Set<number>(),
            years: { from: 3131, to: 3150 },
        } as Era;
        const ilClan = {
            id: 3151,
            name: 'ilClan',
            units: new Set<number>(),
            years: { from: 3151 },
        } as Era;
        const unit = {
            id: 3,
            name: 'BattleMaster C3',
            type: 'Mek',
            chassis: 'BattleMaster',
            model: 'C3',
        } as Unit;

        orderedEras.push(darkAge, ilClan);
        units.push(unit);
        factionsById.set(40, {
            id: 40,
            name: 'Rasalhague Dominion',
            group: 'IS Clan',
            img: '',
            eras: {
                3131: new Set([unit.id]),
                3151: new Set([unit.id]),
            },
        } as Faction);
        factionsById.set(82, {
            id: 82,
            name: 'Clan Sea Fox',
            group: 'IS Clan',
            img: '',
            eras: {
                3131: new Set([unit.id]),
            },
        } as Faction);
        factionsById.set(100, {
            id: 100,
            name: 'Clan Protectorate',
            group: 'IS Clan',
            img: '',
            eras: {
                3151: new Set([unit.id]),
            },
        } as Faction);

        megaMekAvailabilityByUnitName.set(unit.name, {
            n: unit.name,
            e: {
                '3131': {
                    '40': [1.7, 0],
                    '82': [0, 1],
                    '100': [7.7, 1],
                },
                '3151': {
                    '40': [1.2, 0],
                    '100': [7.6, 1],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);

        const darkAgeContext = {
            bridgeThroughMulMembership: true,
            eraIds: new Set([darkAge.id]),
        };
        const ilClanContext = {
            bridgeThroughMulMembership: true,
            eraIds: new Set([ilClan.id]),
        };

        expect(service.getMegaMekAvailabilityScore(unit, {
            ...darkAgeContext,
            availabilityFrom: new Set(['Production']),
        })).toBe(1.7);
        expect(service.getMegaMekAvailabilityScore(unit, {
            ...darkAgeContext,
            availabilityFrom: new Set(['Salvage']),
        })).toBe(1);
        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', darkAgeContext)).toBeFalse();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Very Rare', darkAgeContext)).toBeTrue();
        expect(service.getMegaMekRarityUnitIds('Common', darkAgeContext).has(unit.name)).toBeFalse();
        expect(service.getMegaMekRarityUnitIds('Very Rare', darkAgeContext).has(unit.name)).toBeTrue();

        expect(service.getMegaMekAvailabilityScore(unit, {
            ...ilClanContext,
            availabilityFrom: new Set(['Production']),
        })).toBe(7.6);
        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', ilClanContext)).toBeTrue();
    });

    it('marks MUL memberships without scoped MegaMek data as Unknown even when other scoped factions are known', () => {
        const ilClan = {
            id: 3151,
            name: 'ilClan',
            units: new Set<number>(),
            years: { from: 3151 },
        } as Era;
        const unit = {
            id: 3,
            name: 'BattleMaster C3',
            type: 'Mek',
            chassis: 'BattleMaster',
            model: 'C3',
        } as Unit;

        orderedEras.push(ilClan);
        units.push(unit);
        factionsById.set(40, {
            id: 40,
            name: 'Rasalhague Dominion',
            group: 'IS Clan',
            img: '',
            eras: {
                3151: new Set([unit.id]),
            },
        } as Faction);
        factionsById.set(100, {
            id: 100,
            name: 'Clan Protectorate',
            group: 'IS Clan',
            img: '',
            eras: {
                3151: new Set([unit.id]),
            },
        } as Faction);
        factionsById.set(120, {
            id: 120,
            name: 'Raven Alliance',
            group: 'IS Clan',
            img: '',
            eras: {
                3151: new Set([unit.id]),
            },
        } as Faction);

        megaMekAvailabilityByUnitName.set(unit.name, {
            n: unit.name,
            e: {
                '3151': {
                    '40': [2, 0],
                    '100': [7, 0],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);

        const ilClanContext = {
            bridgeThroughMulMembership: true,
            eraIds: new Set([ilClan.id]),
        };
        const ravenAllianceContext = {
            bridgeThroughMulMembership: true,
            eraIds: new Set([ilClan.id]),
            factionIds: new Set([120]),
        };

        expect(service.getMegaMekUnknownUnitIds(ilClanContext).has(unit.name)).toBeTrue();
        expect(service.getMegaMekAvailabilityUnitIds(ilClanContext).has(unit.name)).toBeTrue();
        expect(service.unitMatchesAvailabilityFrom(unit, MEGAMEK_AVAILABILITY_UNKNOWN, ilClanContext)).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unit, MEGAMEK_AVAILABILITY_UNKNOWN, ilClanContext)).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', ilClanContext)).toBeTrue();

        expect(service.getMegaMekUnknownUnitIds(ravenAllianceContext).has(unit.name)).toBeTrue();
        expect(service.unitMatchesAvailabilityFrom(unit, MEGAMEK_AVAILABILITY_UNKNOWN, ravenAllianceContext)).toBeTrue();
        expect(service.unitMatchesAvailabilityFrom(unit, 'Production', ravenAllianceContext)).toBeFalse();
        expect(service.unitMatchesAvailabilityRarity(unit, MEGAMEK_AVAILABILITY_UNKNOWN, ravenAllianceContext)).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unit, 'Common', ravenAllianceContext)).toBeFalse();
    });

    it('does not fall back to MUL era visibility when MegaMek availability has no matching entries', () => {
        const era = {
            id: 100,
            name: 'Succession Wars',
            units: new Set([1, 2, 3]),
            years: { from: 2780, to: 3049 },
        } as Era;
        orderedEras.push(era);

        optionsServiceMock.options.set({ availabilitySource: 'megamek' });

        expect(Array.from(service.getVisibleEraUnitIds(era))).toEqual([]);
    });

    it('treats salvage-only MegaMek entries as available', () => {
        const era = {
            id: 3050,
            name: 'Clan Invasion',
            units: new Set<number>(),
            years: { from: 3050, to: 3061 },
        } as Era;
        const faction = {
            id: 7,
            name: 'Draconis Combine',
            group: 'Inner Sphere',
            img: '',
            eras: {},
        } as Faction;
        const unit = {
            id: 11,
            name: 'Salvage Hawk',
            type: 'Mek',
            chassis: 'Salvage Hawk',
            model: 'SHK-1',
        } as Unit;

        orderedEras.push(era);
        units.push(unit);
        optionsServiceMock.options.set({ availabilitySource: 'megamek' });

        megaMekAvailabilityByUnitName.set(unit.name, {
            n: unit.name,
            e: {
                '3050': {
                    '7': [0, 3],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);

        expect(service.getVisibleEraUnitIds(era).has(unit.name)).toBeTrue();
        expect(service.getFactionEraUnitIds(faction, era).has(unit.name)).toBeTrue();
    });

    it('builds MegaMek extinct availability from sorted era order instead of numeric era ids', () => {
        const earlyEra = {
            id: 900,
            name: 'Star League',
            units: new Set<number>(),
            years: { from: 2750, to: 2780 },
        } as Era;
        const middleEra = {
            id: 100,
            name: 'Succession Wars',
            units: new Set<number>(),
            years: { from: 2781, to: 3049 },
        } as Era;
        const lateEra = {
            id: 700,
            name: 'ilClan',
            units: new Set<number>(),
            years: { from: 3151 },
        } as Era;
        const extinctFaction = {
            id: MULFACTION_EXTINCT,
            name: 'Extinct',
            group: 'Other',
            img: '',
            eras: {},
        } as Faction;
        const returningUnit = {
            id: 21,
            name: 'Boomerang',
            type: 'Mek',
            chassis: 'Boomerang',
            model: 'BMR-1',
        } as Unit;
        const goneUnit = {
            id: 22,
            name: 'Ghost',
            type: 'Mek',
            chassis: 'Ghost',
            model: 'GST-1',
        } as Unit;

        orderedEras.push(earlyEra, middleEra, lateEra);
        units.push(returningUnit, goneUnit);
        factionsById.set(MULFACTION_EXTINCT, extinctFaction);
        optionsServiceMock.options.set({ availabilitySource: 'megamek' });

        megaMekAvailabilityByUnitName.set(returningUnit.name, {
            n: returningUnit.name,
            e: {
                '900': { '1': [5, 0] },
                '700': { '1': [4, 0] },
            },
        });
        megaMekAvailabilityByUnitName.set(goneUnit.name, {
            n: goneUnit.name,
            e: {
                '900': { '1': [6, 0] },
            },
        });
        megaMekAvailabilityRecords.push(
            megaMekAvailabilityByUnitName.get(returningUnit.name)!,
            megaMekAvailabilityByUnitName.get(goneUnit.name)!,
        );

        expect(Array.from(service.getFactionEraUnitIds(extinctFaction, middleEra)).sort((left, right) => left.localeCompare(right))).toEqual(['Boomerang', 'Ghost']);
        expect(Array.from(service.getFactionEraUnitIds(extinctFaction, lateEra)).sort((left, right) => left.localeCompare(right))).toEqual(['Ghost']);
        expect(service.getVisibleEraUnitIds(lateEra).has(returningUnit.name)).toBeTrue();
        expect(service.getVisibleEraUnitIds(lateEra).has(goneUnit.name)).toBeFalse();
    });

    it('distinguishes Unknown from Not Available and infers MegaMek availability in MUL mode', () => {
        const knownUnit = {
            id: 23,
            name: 'Known Unit',
            type: 'Mek',
            chassis: 'Known Unit',
            model: 'KNU-1',
        } as Unit;
        const unknownUnit = {
            id: 24,
            name: 'Unknown Unit',
            type: 'Mek',
            chassis: 'Unknown Unit',
            model: 'UNK-1',
        } as Unit;

        units.push(knownUnit, unknownUnit);
        megaMekAvailabilityByUnitName.set(knownUnit.name, {
            n: knownUnit.name,
            e: {
                '3050': {
                    '7': [4, 0],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(knownUnit.name)!);

        const salvageScope = {
            eraIds: new Set([3050]),
            factionIds: new Set([7]),
            availabilityFrom: new Set(['Salvage' as const]),
        };

        expect(optionsServiceMock.options().availabilitySource).toBe('mul');
        expect(service.unitMatchesAvailabilityFrom(unknownUnit, MEGAMEK_AVAILABILITY_UNKNOWN)).toBeTrue();
        expect(service.unitMatchesAvailabilityFrom(unknownUnit, 'Production')).toBeFalse();
        expect(service.unitMatchesAvailabilityRarity(unknownUnit, MEGAMEK_AVAILABILITY_UNKNOWN)).toBeTrue();
        expect(service.unitMatchesAvailabilityRarity(unknownUnit, 'Not Available', salvageScope)).toBeFalse();
        expect(service.unitMatchesAvailabilityRarity(knownUnit, 'Not Available', salvageScope)).toBeTrue();
        expect(service.getMegaMekRarityUnitIds(MEGAMEK_AVAILABILITY_UNKNOWN).has(unknownUnit.name)).toBeTrue();
        expect(service.getMegaMekRarityUnitIds('Not Available', salvageScope).has(knownUnit.name)).toBeTrue();
        expect(service.getMegaMekRarityUnitIds('Not Available', salvageScope).has(unknownUnit.name)).toBeFalse();
    });

    it('distributes MegaMek rarity buckets evenly across scores 1 through 10', () => {
        const era = {
            id: 3050,
            name: 'Clan Invasion',
            units: new Set<number>(),
            years: { from: 3050, to: 3061 },
        } as Era;
        const faction = {
            id: 7,
            name: 'Draconis Combine',
            group: 'Inner Sphere',
            img: '',
            eras: {},
        } as Faction;

        orderedEras.push(era);
        optionsServiceMock.options.set({ availabilitySource: 'megamek' });

        const scoredUnits = [
            { id: 31, name: 'VR1', type: 'Mek', chassis: 'VR1', model: 'A', score: 1, rarity: 'Very Rare' },
            { id: 32, name: 'VR2', type: 'Mek', chassis: 'VR2', model: 'A', score: 2, rarity: 'Very Rare' },
            { id: 33, name: 'R3', type: 'Mek', chassis: 'R3', model: 'A', score: 3, rarity: 'Rare' },
            { id: 34, name: 'R4', type: 'Mek', chassis: 'R4', model: 'A', score: 4, rarity: 'Rare' },
            { id: 35, name: 'U5', type: 'Mek', chassis: 'U5', model: 'A', score: 5, rarity: 'Uncommon' },
            { id: 36, name: 'U6', type: 'Mek', chassis: 'U6', model: 'A', score: 6, rarity: 'Uncommon' },
            { id: 37, name: 'C7', type: 'Mek', chassis: 'C7', model: 'A', score: 7, rarity: 'Common' },
            { id: 38, name: 'C8', type: 'Mek', chassis: 'C8', model: 'A', score: 8, rarity: 'Common' },
            { id: 39, name: 'VC9', type: 'Mek', chassis: 'VC9', model: 'A', score: 9, rarity: 'Very Common' },
            { id: 40, name: 'VC10', type: 'Mek', chassis: 'VC10', model: 'A', score: 10, rarity: 'Very Common' },
        ] as Array<Unit & { score: number; rarity: typeof MEGAMEK_AVAILABILITY_RARITY_OPTIONS[number] }>;

        units.push(...scoredUnits);
        for (const unit of scoredUnits) {
            megaMekAvailabilityByUnitName.set(unit.name, {
                n: unit.name,
                e: {
                    '3050': {
                        '7': [unit.score, 0],
                    },
                },
            });
            megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);
        }

        for (const unit of scoredUnits) {
            expect(service.unitMatchesAvailabilityRarity(unit, unit.rarity, {
                eraIds: new Set([era.id]),
                factionIds: new Set([faction.id]),
            })).toBeTrue();
        }
    });
});