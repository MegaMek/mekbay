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
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';

describe('UnitAvailabilitySourceService', () => {
    let service: UnitAvailabilitySourceService;

    const factionsById = new Map<number, Faction>();
    const orderedEras: Era[] = [];
    const units: Unit[] = [];
    const megaMekAvailabilityByUnitName = new Map<string, { n?: string; e: Record<string, Record<string, [number, number]>> }>();
    const megaMekAvailabilityRecords: Array<{ n?: string; e: Record<string, Record<string, [number, number]>> }> = [];
    const optionsServiceMock = {
        options: signal({ availabilitySource: 'mul' as AvailabilitySource }),
    };

    const dataServiceMock = {
        searchCorpusVersion: signal(1),
        getUnits: jasmine.createSpy('getUnits').and.callFake(() => units),
        getEras: jasmine.createSpy('getEras').and.callFake(() => orderedEras),
        getFactionById: jasmine.createSpy('getFactionById').and.callFake((id: number) => factionsById.get(id) ?? null),
        getMegaMekAvailabilityRecordForUnit: jasmine.createSpy('getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return megaMekAvailabilityByUnitName.get(unit.name);
        }),
        getMegaMekAvailabilityRecords: jasmine.createSpy('getMegaMekAvailabilityRecords').and.callFake(() => megaMekAvailabilityRecords),
    };

    beforeEach(() => {
        factionsById.clear();
        orderedEras.length = 0;
        units.length = 0;
        megaMekAvailabilityByUnitName.clear();
        megaMekAvailabilityRecords.length = 0;
        dataServiceMock.searchCorpusVersion.set(1);
        dataServiceMock.getUnits.calls.reset();
        dataServiceMock.getEras.calls.reset();
        dataServiceMock.getFactionById.calls.reset();
        dataServiceMock.getMegaMekAvailabilityRecordForUnit.calls.reset();
        dataServiceMock.getMegaMekAvailabilityRecords.calls.reset();
        optionsServiceMock.options.set({ availabilitySource: 'mul' });

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

    it('does not expose MegaMek weights while Master Unit List availability is selected', () => {
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

        expect(service.getUnitAvailabilityWeight(unit, faction, era)).toBeNull();
        expect(dataServiceMock.getMegaMekAvailabilityRecordForUnit).not.toHaveBeenCalled();
    });

    it('exposes MegaMek weights when the MegaMek availability option is selected', () => {
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

        optionsServiceMock.options.set({ availabilitySource: 'megamek' });
        megaMekAvailabilityByUnitName.set(unit.name, {
            n: unit.name,
            e: {
                '3150': {
                    '99': [7, 0],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);

        expect(service.getUnitAvailabilityWeight(unit, faction, era)).toBe(7);
        expect(dataServiceMock.getMegaMekAvailabilityRecordForUnit).toHaveBeenCalledWith(unit);
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
        expect(service.getUnitAvailabilityWeight(unit, faction, era, 'megamek')).toBe(7);
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
        expect(service.getUnitAvailabilityWeight(unit, faction, era, 'mul')).toBeNull();
        expect(service.useMegaMekAvailability('mul')).toBeFalse();
        expect(service.useMegaMekAvailability()).toBeTrue();
    });

    it('returns MegaMek per-source details even when MUL availability is selected and omits zero scores', () => {
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

        megaMekAvailabilityByUnitName.set(unit.name, {
            n: unit.name,
            e: {
                '3150': {
                    '99': [7, 0],
                },
            },
        });
        megaMekAvailabilityRecords.push(megaMekAvailabilityByUnitName.get(unit.name)!);

        expect(service.getMegaMekAvailabilityDetails(unit, faction, era)).toEqual([
            {
                source: 'Production',
                score: 7,
                rarity: 'Common',
            },
        ]);
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
        expect(service.getUnitAvailabilityWeight(unit, faction, era)).toBe(3);
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