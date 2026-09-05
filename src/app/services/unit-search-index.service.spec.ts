// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { Equipment, WeaponEquipment } from '../models/equipment.model';
import { createEmptyUnit, type TestUnitOverrides } from '../testing/unit-test-helpers';
import { UnitSearchIndexService } from './unit-search-index.service';

function createUnit(overrides: TestUnitOverrides): UnitSummary {
    const { as: asOverrides, ...unitOverrides } = overrides;

    return createEmptyUnit({
        uuid: unitOverrides.uuid ?? unitOverrides.name ?? 'Unit',
        id: 1,
        name: 'Unit',
        chassis: 'Unit',
        model: 'A',
        year: 3050,
        engineRating: 250,
        engineHS: 10,
        role: 'Brawler',
        armorType: 'Standard',
        structureType: 'Standard',
        internal: 0,
        moveType: 'Biped',
        _displayType: 'Mek',
        ...unitOverrides,
        as: {
            TP: 'BM',
            SZ: 2,
            MVm: { '': 0 },
            ...asOverrides,
        },
    });
}

describe('UnitSearchIndexService', () => {
    it('stores p95 once per TP/superheavy bucket while retaining absolute maxima', () => {
        const service = new UnitSearchIndexService();
        const units = Array.from({ length: 100 }, (_, i) => createUnit({
            name: `BM ${i}`, armor: i + 1,
            subtype: i % 2 ? 'BattleMek Omni' : 'BattleMek',
        }));
        const superheavy = createUnit({ name: 'SH', armor: 800, weightClass: 'Colossal/Super-Heavy' });
        const vehicle = createUnit({ name: 'CV', armor: 500, as: { TP: 'CV' } });
        service.prepareUnits([...units, superheavy, vehicle]);
        const bucket = service.getUnitStats(units[0]);
        expect(bucket.armor).toEqual({ min: 1, max: 100, average: 50.5, p95: 95, count: 100 });
        expect(service.getUnitStats(units[1])).toBe(bucket);
        expect(service.getUnitStats(superheavy).armor.p95).toBe(800);
        expect(service.getUnitStats(vehicle).armor.p95).toBe(500);
        service.prepareUnits([superheavy]);
        expect(service.getUnitStats(units[0]).armor.count).toBe(0);
    });

    it('measures composite axes before taking percentiles', () => {
        const service = new UnitSearchIndexService();
        const first = createUnit({ armor: 100, internal: 10, run2: 20, jump: 0,
            as: { Arm: 8, Str: 2 } });
        const second = createUnit({ armor: 10, internal: 100, run2: 0, jump: 20,
            as: { Arm: 2, Str: 8 } });
        service.prepareUnits([first, second]);
        const stats = service.getUnitStats(first);
        expect(stats.endurance.p95).toBe(110);
        expect(stats.asEndurance.p95).toBe(10);
        expect(stats.mobility).toEqual({ min: 20, max: 20, average: 20, p95: 20, count: 2 });
    });

    it('excludes absent measurements but preserves zero and sparse capabilities', () => {
        const service = new UnitSearchIndexService();
        const units = Array.from({ length: 100 }, (_, i) => createUnit({
            name: `BA ${i}`, heat: null, dissipation: null,
            as: { TP: 'BA', TMM: i === 0 ? null : 0,
                dmg: { dmgL: i === 0 ? '0*' : '0' } },
        }));
        service.prepareUnits(units);
        const stats = service.getUnitStats(units[0]);
        expect(stats.heat.count).toBe(0);
        expect(stats.dissipation.count).toBe(0);
        expect(stats.dissipationEfficiency.count).toBe(0);
        expect(stats.asTmm.count).toBe(99);
        expect(stats.asTmm.p95).toBe(0);
        expect(stats.asDmgL.p95).toBe(0);
        expect(stats.asDmgL.max).toBe(0.5);
        expect(stats.asDmgL.count).toBe(100);
    });

    it('keeps zero heat, signed efficiency, and measured 999 distinct from null', () => {
        const service = new UnitSearchIndexService();
        const units = [
            createUnit({ heat: null, dissipation: null }),
            createUnit({ heat: 0, dissipation: 20 }),
            createUnit({ heat: 20, dissipation: 0 }),
            createUnit({ heat: 999, dissipation: 999 }),
        ];
        service.prepareUnits(units);
        expect(units.map(unit => unit._dissipationEfficiency)).toEqual([null, 20, -20, 0]);
        const stats = service.getUnitStats(units[0]);
        expect(stats.heat.count).toBe(3);
        expect(stats.heat.min).toBe(0);
        expect(stats.heat.max).toBe(999);
        expect(stats.dissipation.count).toBe(3);
        expect(stats.dissipation.max).toBe(999);
        expect(stats.dissipationEfficiency).toEqual({ min: -20, max: 20, average: 0, p95: 20, count: 3 });
    });

    it('does not interpret aerospace named range bands as zero range', () => {
        const service = new UnitSearchIndexService();
        const unit = createUnit({ as: { TP: 'AF', TMM: null },
            comp: [{ id: 'laser', q: 1, n: 'Laser', t: 'E', p: 1, l: 'Nose', md: '5', r: 'Long' }] });
        service.prepareUnits([unit]);
        expect(service.getUnitStats(unit).weightedMaxRange.count).toBe(0);
        expect(service.getUnitStats(unit).maxRange.count).toBe(0);
        expect(service.getUnitStats(unit).asTmm.count).toBe(0);
    });

    it('uses UUID postings while expanding duplicate MUL ids for era and faction membership', () => {
        const service = new UnitSearchIndexService();
        const first = createUnit({ id: 42, uuid: 'uuid-a', name: 'Duplicate Name' });
        const second = createUnit({ id: 42, uuid: 'uuid-b', name: 'Duplicate Name' });
        const era = {
            id: 1,
            name: 'Test Era',
            img: '',
            years: { from: 3000, to: 3100 },
            units: new Set([42]),
            factions: new Set<number>(),
        };
        const faction = {
            id: 1,
            name: 'Test Faction',
            group: 'Other' as const,
            img: '',
            eras: { 1: new Set([42]) },
        };

        service.rebuildIndexes([first, second], [era], [faction]);

        const expectedUuids = new Set([first.uuid, second.uuid]);
        expect(service.getIndexedUnitIds('type', 'Mek')).toEqual(expectedUuids);
        expect(service.getIndexedUnitIds('era', era.name)).toEqual(expectedUuids);
        expect(service.getIndexedUnitIds('faction', faction.name)).toEqual(expectedUuids);
        expect(service.getFactionEraUnitUuids([era.name], [faction.name])).toEqual(expectedUuids);
    });

    it('indexes canonical Alpha Strike special tokens, nested turret abilities, and observed parameter shapes', () => {
        const service = new UnitSearchIndexService();
        service.rebuildIndexes([
            createUnit({
                name: 'Special Unit',
                as: {
                    specials: ['AC2/2/2', 'TAG', 'TSM', 'TUR(3/3/3,IF2,LRM3/3/2)'],
                },
            }),
        ], [], []);

        expect(service.getIndexedFilterValues('as.specials')).toEqual([
            'AC',
            'IF',
            'LRM',
            'TAG',
            'TSM',
            'TUR',
        ]);
        expect(service.getIndexedUnitIds('as.specials', 'IF')).toEqual(new Set(['Special Unit']));
        expect(service.getIndexedUnitIds('as.specials', 'TUR(3/3/3,IF2,LRM3/3/2)')).toBeUndefined();
        const indexedSpecials = service.getIndexedASSpecials('Special Unit');
        expect(indexedSpecials?.occurrences.find(occurrence => occurrence.token === 'AC')?.values)
            .toEqual([
                { text: '2', rank: 2 },
                { text: '2', rank: 2 },
                { text: '2', rank: 2 },
            ]);
        expect(indexedSpecials?.occurrences.find(occurrence => occurrence.token === 'IF'))
            .toEqual(jasmine.objectContaining({
                token: 'IF',
                values: [{ text: '2', rank: 2 }],
                topLevel: false,
            }));
        expect(service.getDropdownOptionUniverse('as.specials')).toEqual([
            { name: 'AC', minimumFieldLabels: ['S', 'M', 'L'] },
            { name: 'IF', minimumFieldLabels: [''] },
            { name: 'LRM', minimumFieldLabels: ['S', 'M', 'L'] },
            { name: 'TAG' },
            { name: 'TSM' },
            { name: 'TUR', minimumFieldLabels: ['S', 'M', 'L'] },
        ]);
    });

    it('indexes implicit values and digit-bearing artillery tokens with contextual fields', () => {
        const service = new UnitSearchIndexService();
        service.rebuildIndexes([
            createUnit({
                name: 'Implicit Unit',
                as: { specials: ['SNARC', 'CNARC', 'ARTCM5-1', 'TAG'] },
            }),
        ], [], []);

        expect(service.getIndexedUnitIds('as.specials', 'SNARC')).toEqual(new Set(['Implicit Unit']));
        expect(service.getIndexedUnitIds('as.specials', 'ARTCM5')).toEqual(new Set(['Implicit Unit']));
        expect(service.getIndexedASSpecials('Implicit Unit')?.occurrences
            .find(occurrence => occurrence.token === 'SNARC')?.values)
            .toEqual([{ text: '1', rank: 1 }]);
        expect(service.getDropdownOptionUniverse('as.specials')).toEqual([
            { name: 'ARTCM5', minimumFieldLabels: [''] },
            { name: 'CNARC', minimumFieldLabels: [''] },
            { name: 'SNARC', minimumFieldLabels: [''] },
            { name: 'TAG' },
        ]);
    });

    it('indexes mixed and nonmixed units as distinct tech-base filter values', () => {
        const service = new UnitSearchIndexService();

        service.rebuildIndexes([
            createUnit({ name: 'Inner Sphere Unit', techBase: 'Inner Sphere', mixed: false }),
            createUnit({ name: 'Clan Unit', techBase: 'Clan', mixed: false }),
            createUnit({ name: 'Mixed Inner Sphere Unit', techBase: 'Inner Sphere', mixed: true }),
            createUnit({ name: 'Mixed Clan Unit', techBase: 'Clan', mixed: true }),
        ], [], []);

        expect(service.getIndexedFilterValues('_techBaseDisplay')).toEqual([
            'Clan',
            'Inner Sphere',
            'Mixed (Clan)',
            'Mixed (Inner Sphere)',
        ]);
        expect(service.getIndexedUnitIds('_techBaseDisplay', 'Inner Sphere')).toEqual(new Set(['Inner Sphere Unit']));
        expect(service.getIndexedUnitIds('_techBaseDisplay', 'Clan')).toEqual(new Set(['Clan Unit']));
        expect(service.getIndexedUnitIds('_techBaseDisplay', 'Mixed (Inner Sphere)')).toEqual(new Set(['Mixed Inner Sphere Unit']));
        expect(service.getIndexedUnitIds('_techBaseDisplay', 'Mixed (Clan)')).toEqual(new Set(['Mixed Clan Unit']));
        expect(service.getIndexedFilterValues('techBase')).toEqual([]);
        expect(service.getIndexedUnitIds('techBase', 'Clan')).toBeUndefined();
    });

    it('indexes Alpha Strike zero-star damage between zero and one', () => {
        const service = new UnitSearchIndexService();
        const unit = createUnit({
            name: 'Zero Star Mek',
            subtype: 'BattleMek',
            as: {
                TP: 'BM',
                dmg: { dmgS: '0*', dmgM: '1', dmgL: '0', dmgE: '0*' },
            },
        });

        service.prepareUnits([unit]);

        expect(unit.as.dmg._dmgS).toBe(0.5);
        expect(unit.as.dmg._dmgM).toBe(1);
        expect(unit.as.dmg._dmgL).toBe(0);
        expect(unit.as.dmg._dmgE).toBe(0.5);
        expect(service.getUnitStats(createUnit({})).asDmgS).toEqual({ min: 0.5, max: 0.5, average: 0.5, p95: 0.5, count: 1 });
    });

    it('tracks min, max, and average stats by subtype and alpha strike type', () => {
        const service = new UnitSearchIndexService();

        service.prepareUnits([
            createUnit({
                id: 1,
                name: 'Mek A',
                subtype: 'BattleMek',
                armor: 10,
                internal: 5,
                dpt: 4,
                run2: 6,
                comp: [
                    { id: 'laser-a', q: 1, n: 'Weapon A', t: 'E', p: 1, l: 'RA', md: '10', r: '5/10' },
                    { id: 'laser-b', q: 1, n: 'Weapon B', t: 'E', p: 1, l: 'LA', md: '10', r: '4/8' },
                    { id: 'missile-a', q: 1, n: 'Weapon C', t: 'M', p: 1, l: 'LT', md: '2', r: '8/16/24' },
                ],
                as: {
                    TP: 'BM',
                    PV: 0,
                    SZ: 2,
                    TMM: 2,
                    usesOV: false,
                    OV: 0,
                    MV: '0',
                    MVm: { '': 0 },
                    usesTh: false,
                    Th: 0,
                    Arm: 3,
                    Str: 2,
                    specials: [],
                    dmg: { dmgS: '2', dmgM: '1', dmgL: '0', dmgE: '0' },
                    usesE: false,
                    usesArcs: false,
                },
            }),
            createUnit({
                id: 2,
                name: 'Mek B',
                subtype: 'BattleMek',
                armor: 30,
                internal: 9,
                dpt: 8,
                run2: 4,
                comp: [
                    { id: 'laser-c', q: 1, n: 'Weapon D', t: 'E', p: 1, l: 'RA', md: '5', r: '3/6/9' },
                    { id: 'ac-a', q: 2, n: 'Weapon E', t: 'B', p: 1, l: 'LT', md: '2', r: '8/16/24' },
                    { id: 'laser-d', q: 1, n: 'Weapon F', t: 'E', p: 1, l: 'LA', md: 'variable', r: '4/8/12' },
                ],
                as: {
                    TP: 'BM',
                    PV: 0,
                    SZ: 2,
                    TMM: 4,
                    usesOV: false,
                    OV: 0,
                    MV: '0',
                    MVm: { '': 0 },
                    usesTh: false,
                    Th: 0,
                    Arm: 5,
                    Str: 4,
                    specials: [],
                    dmg: { dmgS: '4', dmgM: '3', dmgL: '1', dmgE: '0' },
                    usesE: false,
                    usesArcs: false,
                },
            }),
            createUnit({
                id: 3,
                name: 'Ship A',
                type: 'Naval',
                subtype: 'WarShip',
                moveType: 'Naval',
                as: {
                    TP: 'WS',
                    PV: 0,
                    SZ: 4,
                    TMM: 1,
                    usesOV: false,
                    OV: 0,
                    MV: '0',
                    MVm: { '': 0 },
                    usesTh: false,
                    Th: 0,
                    Arm: 8,
                    Str: 6,
                    specials: [],
                    dmg: { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' },
                    usesE: false,
                    usesArcs: false,
                },
                capital: {
                    dropshipCapacity: 2,
                    escapePods: 4,
                    lifeBoats: 1,
                    gravDecks: [30],
                    sailIntegrity: 10,
                    kfIntegrity: 4,
                },
            }),
            createUnit({
                id: 4,
                name: 'Ship B',
                type: 'Naval',
                subtype: 'WarShip',
                moveType: 'Naval',
                as: {
                    TP: 'WS',
                    PV: 0,
                    SZ: 4,
                    TMM: 1,
                    usesOV: false,
                    OV: 0,
                    MV: '0',
                    MVm: { '': 0 },
                    usesTh: false,
                    Th: 0,
                    Arm: 10,
                    Str: 8,
                    specials: [],
                    dmg: { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' },
                    usesE: false,
                    usesArcs: false,
                },
                capital: {
                    dropshipCapacity: 6,
                    escapePods: 10,
                    lifeBoats: 3,
                    gravDecks: [20, 20, 20],
                    sailIntegrity: 14,
                    kfIntegrity: 8,
                },
            }),
        ]);

        expect(service.getUnitStats(createUnit({})).armor).toEqual({ min: 10, max: 30, average: 20, p95: 30, count: 2 });
        expect(service.getUnitStats(createUnit({})).dpt).toEqual({ min: 4, max: 8, average: 6, p95: 8, count: 2 });
        expect(service.getUnitStats(createUnit({})).run2MP).toEqual({ min: 4, max: 6, average: 5, p95: 6, count: 2 });
        expect(service.getUnitStats(createUnit({})).weightedMaxRange).toEqual({ min: 10, max: 12, average: 11, p95: 12, count: 2 });
        expect(service.getUnitStats(createUnit({})).asTmm).toEqual({ min: 2, max: 4, average: 3, p95: 4, count: 2 });
        expect(service.getUnitStats(createUnit({})).asDmgM).toEqual({ min: 1, max: 3, average: 2, p95: 3, count: 2 });
        expect(service.getUnitStats(createUnit({ as: { TP: 'WS' } })).dropshipCapacity).toEqual({ min: 2, max: 6, average: 4, p95: 6, count: 2 });
        expect(service.getUnitStats(createUnit({ as: { TP: 'WS' } })).gravDecks).toEqual({ min: 1, max: 3, average: 2, p95: 3, count: 2 });
    });

    it('returns zeroed min, max, and average values for missing buckets', () => {
        const service = new UnitSearchIndexService();

        expect(service.getUnitStats(createUnit({ as: { TP: 'XX' } })).armor).toEqual({ min: 0, max: 0, average: 0, p95: 0, count: 0 });
        expect(service.getUnitStats(createUnit({ as: { TP: 'XX' } })).weightedMaxRange).toEqual({ min: 0, max: 0, average: 0, p95: 0, count: 0 });
        expect(service.getUnitStats(createUnit({ as: { TP: 'XX' } })).asTmm).toEqual({ min: 0, max: 0, average: 0, p95: 0, count: 0 });
        expect(service.getUnitStats(createUnit({ as: { TP: 'XX' } })).gravDecks).toEqual({ min: 0, max: 0, average: 0, p95: 0, count: 0 });
    });

    it('indexes the exported source filter without duplicating published values', () => {
        const service = new UnitSearchIndexService();
        const unit = createUnit({
            name: 'Atlas AS7-D',
            source: ['TR:3039', 'TR:SW', 'RSFP:Wave 2', 'RS:Gothic'],
            published: ['RSFP:Wave 2', 'RS:Gothic'],
        });

        service.rebuildIndexes([unit], [], []);

        expect(service.getIndexedFilterValues('source')).toEqual(['RS:Gothic', 'RSFP:Wave 2', 'TR:3039', 'TR:SW']);
        expect(service.getIndexedUnitIds('source', 'TR:3039')).toEqual(new Set(['Atlas AS7-D']));
        expect(service.getIndexedUnitIds('source', 'RS:Gothic')).toEqual(new Set(['Atlas AS7-D']));
        expect(service.getDropdownOptionUniverse('source')).toEqual([
            { name: 'RS:Gothic' },
            { name: 'RSFP:Wave 2' },
            { name: 'TR:3039' },
            { name: 'TR:SW' },
        ]);
    });

    it('indexes every unit rules reference as a dropdown value', () => {
        const service = new UnitSearchIndexService();

        service.rebuildIndexes([
            createUnit({ name: 'Atlas AS7-D', rulesRefs: [['TM', 'TO']] }),
            createUnit({ name: 'Locust LCT-1V', rulesRefs: [['TM']] }),
            createUnit({ name: 'Legacy Unit' }),
        ], [], []);

        expect(service.getIndexedFilterValues('rulesRefs')).toEqual(['TM', 'TO']);
        expect(service.getIndexedUnitIds('rulesRefs', 'TM')).toEqual(new Set(['Atlas AS7-D', 'Locust LCT-1V']));
        expect(service.getIndexedUnitIds('rulesRefs', 'TO')).toEqual(new Set(['Atlas AS7-D']));
        expect(service.getDropdownOptionUniverse('rulesRefs')).toEqual([
            { name: 'TM' },
            { name: 'TO' },
        ]);
    });

    it('indexes canon and published status as yes/no values', () => {
        const service = new UnitSearchIndexService();

        service.rebuildIndexes([
            createUnit({ name: 'Canon Published', canon: true, published: ['RS:3050'] }),
            createUnit({ name: 'Non-Canon Unpublished', canon: false, published: [] }),
        ], [], []);

        expect(service.getIndexedFilterValues('canon')).toEqual(['no', 'yes']);
        expect(service.getIndexedUnitIds('canon', 'yes')).toEqual(new Set(['Canon Published']));
        expect(service.getIndexedUnitIds('canon', 'no')).toEqual(new Set(['Non-Canon Unpublished']));
        expect(service.getIndexedFilterValues('published')).toEqual(['no', 'yes']);
        expect(service.getIndexedUnitIds('published', 'yes')).toEqual(new Set(['Canon Published']));
        expect(service.getIndexedUnitIds('published', 'no')).toEqual(new Set(['Non-Canon Unpublished']));
    });

    it('indexes mounted quantities for every intrinsic weapon type', () => {
        const service = new UnitSearchIndexService();
        const areaEffectAntiInfantryWeapon = new WeaponEquipment({
            id: 'test-vgl',
            name: 'Test VGL',
            type: 'weapon',
            flags: ['F_VGL', 'F_MG'],
        });
        const unit = createUnit({
            name: 'Typed Unit',
            comp: [
                { id: 'test-vgl', q: 2, n: 'Test VGL', t: 'B', p: 1, l: 'RA', eq: areaEffectAntiInfantryWeapon },
                { id: 'test-vgl', q: 1, n: 'Test VGL', t: 'B', p: 2, l: 'LA', eq: areaEffectAntiInfantryWeapon },
            ],
        });

        service.rebuildIndexes([unit], [], []);

        expect(unit._weaponTypes).toEqual(['AE', 'AI', 'DB']);
        expect(unit._weaponTypeCounts).toEqual({ AE: 3, AI: 3, DB: 3 });
        expect(service.getIndexedFilterValues('weaponType')).toEqual(['AE', 'AI', 'DB']);
        expect(service.getIndexedUnitIds('weaponType', 'AI')).toEqual(new Set(['Typed Unit']));
        expect(service.getDropdownOptionUniverse('weaponType')).toEqual([{ name: 'AE' }, { name: 'AI' }, { name: 'DB' }]);
    });

    it('counts bay weapons without counting wrappers and ignores non-weapons', () => {
        const service = new UnitSearchIndexService();
        const antiInfantryWeapon = new WeaponEquipment({
            id: 'test-mg',
            name: 'Test MG',
            type: 'weapon',
            flags: ['F_MG'],
        });
        const nonWeapon = new Equipment({ id: 'test-case', name: 'Test CASE', type: 'misc' });
        const unit = createUnit({
            name: 'Bay Unit',
            comp: [
                {
                    id: 'weapon-bay', q: 10, n: 'Weapon Bay', t: 'B', p: 1, l: 'N', eq: antiInfantryWeapon,
                    bay: [{ id: 'test-mg', q: 2, n: 'Test MG', t: 'B', p: 1, l: 'N', eq: antiInfantryWeapon }],
                },
                { id: 'test-case', q: 5, n: 'Test CASE', t: 'C', p: 2, l: 'CT', eq: nonWeapon },
                { id: 'unknown', q: 4, n: 'Unknown Weapon', t: 'B', p: 3, l: 'LT' },
            ],
        });

        service.rebuildIndexes([unit], [], []);

        expect(unit._weaponTypeCounts?.AI).toBe(2);
        expect(unit._weaponTypeCounts?.DB).toBe(2);
    });

    it('replaces stale weapon-type data when indexes are rebuilt', () => {
        const service = new UnitSearchIndexService();
        const unit = createUnit({
            name: 'Relinked Unit',
            _weaponTypes: ['AI'],
            _weaponTypeCounts: { AI: 4 },
            comp: [{ id: 'unknown', q: 4, n: 'Unknown Weapon', t: 'B', p: 1, l: 'RA' }],
        });

        service.rebuildIndexes([unit], [], []);

        expect(unit._weaponTypes).toEqual([]);
        expect(unit._weaponTypeCounts).toEqual({});
        expect(service.getIndexedFilterValues('weaponType')).toEqual([]);
    });
});
