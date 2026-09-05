// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
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

function prepareCatalog(service: UnitSearchIndexService, units: UnitSummary[]): void {
    service.commitPreparedCatalogIndexes(service.prepareCatalogIndexes(units, [], []));
}

function expectUnitIds(
    actual: ReadonlySet<UnitSummary['uuid']> | undefined,
    expected: Iterable<UnitSummary['uuid']>,
): void {
    expect(new Set(actual)).toEqual(new Set(expected));
}

describe('UnitSearchIndexService', () => {
    it('uses native categories for units without Alpha Strike support', () => {
        const service = new UnitSearchIndexService();
        const building = createUnit({ name: 'Building', entityType: 'BuildingEntity', armor: 100, as: { TP: 'XX' } });
        const gun = createUnit({ name: 'Gun', entityType: 'GunEmplacement', armor: 10, as: { TP: 'XX' } });
        const handheld = createUnit({ name: 'Handheld', entityType: 'HandheldWeapon', armor: 2, as: { TP: 'XX' } });
        prepareCatalog(service, [building, gun, handheld]);
        for (const unit of [building, gun, handheld]) {
            const stats = service.getUnitStats(unit);
            expect(stats.armor).toEqual({ min: unit.armor, max: unit.armor, average: unit.armor, p95: unit.armor, count: 1 });
            expect(stats.asArm.count).toBe(0);
            expect(stats.asEndurance.count).toBe(0);
            expect(stats.asDmgS.count).toBe(0);
        }
    });

    it('preserves 999 and derives signed heat efficiency with measured zeros', () => {
        const service = new UnitSearchIndexService();
        const noHeat = createUnit({ name: 'No heat', heat: 0, dissipation: 10, armor: 999, dpt: 999 });
        const noSinks = createUnit({ name: 'No sinks', heat: 10, dissipation: 0 });
        const untracked = createUnit({ name: 'Untracked', heat: null, dissipation: null });
        prepareCatalog(service, [noHeat, noSinks, untracked]);
        const stats = service.getUnitStats(noHeat);
        expect(stats.armor.max).toBe(999);
        expect(stats.dpt.max).toBe(999);
        expect(stats.heat.count).toBe(2);
        expect(stats.dissipation.count).toBe(2);
        expect(stats.dissipationEfficiency).toEqual({ min: -10, max: 10, average: 0, p95: 10, count: 2 });
        expect(noHeat._dissipationEfficiency).toBe(10);
        expect(noSinks._dissipationEfficiency).toBe(-10);
        expect(untracked._dissipationEfficiency).toBeUndefined();
    });

    it('keeps unmeasured AS damage distinct from zero after parsing during preparation', () => {
        const service = new UnitSearchIndexService();
        const unit = createUnit({ as: { dmg: { dmgS: '', dmgM: '0', dmgL: '0*' } } });
        prepareCatalog(service, [unit]);
        const stats = service.getUnitStats(unit);
        expect(unit.as.dmg._dmgS).toBeUndefined();
        expect(stats.asDmgS.count).toBe(0);
        expect(stats.asDmgM).toEqual({ min: 0, max: 0, average: 0, p95: 0, count: 1 });
        expect(stats.asDmgL.p95).toBe(0.5);
    });

    it('keeps statistics and UUID postings on the active catalog until the candidate is committed', () => {
        const service = new UnitSearchIndexService();
        const active = createUnit({ uuid: 'active', name: 'Active', armor: 100 });
        const replacement = createUnit({ uuid: 'replacement', name: 'Replacement', armor: 250 });
        prepareCatalog(service, [active]);
        const activeStats = service.getUnitStats(active);

        const candidate = service.prepareCatalogIndexes([replacement], [], []);

        expect(service.getUnitStats(active)).toBe(activeStats);
        expect(service.getUnitStats(active).armor.p95).toBe(100);
        expectUnitIds(service.getIndexedUnitIds('type', 'Mek'), [active.uuid]);

        service.commitPreparedCatalogIndexes(candidate);

        expect(service.getUnitStats(replacement).armor.p95).toBe(250);
        expectUnitIds(service.getIndexedUnitIds('type', 'Mek'), [replacement.uuid]);
        prepareCatalog(service, []);
        expect(service.getUnitStats(replacement).armor.count).toBe(0);
        expect(service.getIndexedUnitIds('type', 'Mek')).toBeUndefined();
    });

    it('stores p95 once per TP/superheavy bucket while retaining absolute maxima', () => {
        const service = new UnitSearchIndexService();
        const units = Array.from({ length: 100 }, (_, i) => createUnit({
            name: `BM ${i}`, armor: i + 1,
            subtype: i % 2 ? 'BattleMek Omni' : 'BattleMek',
        }));
        const superheavy = createUnit({ name: 'SH', armor: 800, weightClass: 'Colossal/Super-Heavy' });
        const vehicle = createUnit({ name: 'CV', armor: 500, as: { TP: 'CV' } });
        prepareCatalog(service, [...units, superheavy, vehicle]);
        const bucket = service.getUnitStats(units[0]);
        expect(bucket.armor).toEqual({ min: 1, max: 100, average: 50.5, p95: 95, count: 100 });
        expect(service.getUnitStats(units[1])).toBe(bucket);
        expect(service.getUnitStats(superheavy).armor.p95).toBe(800);
        expect(service.getUnitStats(vehicle).armor.p95).toBe(500);
        prepareCatalog(service, [superheavy]);
        expect(service.getUnitStats(units[0]).armor.count).toBe(0);
    });

    it('measures composite axes before taking percentiles', () => {
        const service = new UnitSearchIndexService();
        const first = createUnit({ armor: 100, internal: 10, run2: 20, jump: 0,
            as: { Arm: 8, Str: 2 } });
        const second = createUnit({ armor: 10, internal: 100, run2: 0, jump: 20,
            as: { Arm: 2, Str: 8 } });
        prepareCatalog(service, [first, second]);
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
        prepareCatalog(service, units);
        const stats = service.getUnitStats(units[0]);
        expect(stats.heat.count).toBe(0);
        expect(stats.asTmm.count).toBe(99);
        expect(stats.asTmm.p95).toBe(0);
        expect(stats.asDmgL.p95).toBe(0);
        expect(stats.asDmgL.max).toBe(0.5);
        expect(stats.asDmgL.count).toBe(100);
    });

    it('does not interpret aerospace named range bands as zero range', () => {
        const service = new UnitSearchIndexService();
        const unit = createUnit({ type: 'Aero', entityType: 'Aero', as: { TP: 'AF', TMM: null },
            comp: [{ id: 'laser', q: 1, n: 'Laser', t: 'E', p: 1, l: 'Nose', md: '5', r: 'Long' }] });
        prepareCatalog(service, [unit]);
        expect(service.getUnitStats(unit).weightedMaxRange.count).toBe(0);
        expect(service.getUnitStats(unit).maxRange.count).toBe(0);
        expect(service.getUnitStats(unit).asTmm.count).toBe(0);
    });

    it('uses UUID postings while expanding duplicate MUL ids for era and faction membership', () => {
        const service = new UnitSearchIndexService();
        const first = createUnit({ id: 42, uuid: 'duplicate-mul-a', name: 'Duplicate Name' });
        const second = createUnit({ id: 42, uuid: 'duplicate-mul-b', name: 'Duplicate Name' });
        const era = {
            id: 1,
            name: 'Test Era',
            units: new Set([42]),
        } as unknown as Era;
        const faction = {
            id: 1,
            name: 'Test Faction',
            eras: { 1: new Set([42]) },
        } as unknown as Faction;

        service.rebuildIndexes([first, second], [era], [faction]);

        const expectedUuids = new Set([first.uuid, second.uuid]);
        expectUnitIds(service.getIndexedUnitIds('type', 'Mek'), expectedUuids);
        expectUnitIds(service.getIndexedUnitIds('era', era.name), expectedUuids);
        expectUnitIds(service.getIndexedUnitIds('faction', faction.name), expectedUuids);
        expect(service.getFactionEraUnitUuids([era.name], [faction.name])).toEqual(expectedUuids);
    });

    it('indexes canonical Alpha Strike special tokens, nested turret abilities, and observed parameter shapes', () => {
        const service = new UnitSearchIndexService();
        const unit = createUnit({
            name: 'Special Unit',
            as: { specials: ['AC2/2/2', 'TAG', 'TSM', 'TUR(3/3/3,IF2,LRM3/3/2)'] },
        });

        service.rebuildIndexes([unit], [], []);

        expect(service.getIndexedFilterValues('as.specials')).toEqual(['AC', 'IF', 'LRM', 'TAG', 'TSM', 'TUR']);
        expectUnitIds(service.getIndexedUnitIds('as.specials', 'IF'), [unit.uuid]);
        expect(service.getIndexedUnitIds('as.specials', 'TUR(3/3/3,IF2,LRM3/3/2)')).toBeUndefined();
        const indexedSpecials = service.getIndexedASSpecials(unit.uuid);
        expect(indexedSpecials?.occurrences.find(occurrence => occurrence.token === 'AC')?.values).toEqual([
            { text: '2', rank: 2 },
            { text: '2', rank: 2 },
            { text: '2', rank: 2 },
        ]);
        expect(indexedSpecials?.occurrences.find(occurrence => occurrence.token === 'IF')).toEqual(
            jasmine.objectContaining({ token: 'IF', values: [{ text: '2', rank: 2 }], topLevel: false }),
        );
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
        const unit = createUnit({
            name: 'Implicit Unit',
            as: { specials: ['SNARC', 'CNARC', 'ARTCM5-1', 'TAG'] },
        });

        service.rebuildIndexes([unit], [], []);

        expectUnitIds(service.getIndexedUnitIds('as.specials', 'SNARC'), [unit.uuid]);
        expectUnitIds(service.getIndexedUnitIds('as.specials', 'ARTCM5'), [unit.uuid]);
        expect(service.getIndexedASSpecials(unit.uuid)?.occurrences
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

        const units = [
            createUnit({ name: 'Inner Sphere Unit', techBase: 'Inner Sphere', mixed: false }),
            createUnit({ name: 'Clan Unit', techBase: 'Clan', mixed: false }),
            createUnit({ name: 'Mixed Inner Sphere Unit', techBase: 'Inner Sphere', mixed: true }),
            createUnit({ name: 'Mixed Clan Unit', techBase: 'Clan', mixed: true }),
        ];
        service.rebuildIndexes(units, [], []);

        expect(service.getIndexedFilterValues('_techBaseDisplay')).toEqual([
            'Clan',
            'Inner Sphere',
            'Mixed (Clan)',
            'Mixed (Inner Sphere)',
        ]);
        expectUnitIds(service.getIndexedUnitIds('_techBaseDisplay', 'Inner Sphere'), [units[0].uuid]);
        expectUnitIds(service.getIndexedUnitIds('_techBaseDisplay', 'Clan'), [units[1].uuid]);
        expectUnitIds(service.getIndexedUnitIds('_techBaseDisplay', 'Mixed (Inner Sphere)'), [units[2].uuid]);
        expectUnitIds(service.getIndexedUnitIds('_techBaseDisplay', 'Mixed (Clan)'), [units[3].uuid]);
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

        prepareCatalog(service, [unit]);

        expect(unit.as.dmg._dmgS).toBe(0.5);
        expect(unit.as.dmg._dmgM).toBe(1);
        expect(unit.as.dmg._dmgL).toBe(0);
        expect(unit.as.dmg._dmgE).toBe(0.5);
        expect(service.getUnitStats(createUnit({})).asDmgS).toEqual({ min: 0.5, max: 0.5, average: 0.5, p95: 0.5, count: 1 });
    });

    it('tracks min, max, and average stats by subtype and alpha strike type', () => {
        const service = new UnitSearchIndexService();

        prepareCatalog(service, [
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
        expectUnitIds(service.getIndexedUnitIds('source', 'TR:3039'), [unit.uuid]);
        expectUnitIds(service.getIndexedUnitIds('source', 'RS:Gothic'), [unit.uuid]);
        expect(service.getDropdownOptionUniverse('source')).toEqual([
            { name: 'RS:Gothic' },
            { name: 'RSFP:Wave 2' },
            { name: 'TR:3039' },
            { name: 'TR:SW' },
        ]);
    });

    it('indexes every unit rules reference as a dropdown value', () => {
        const service = new UnitSearchIndexService();
        const atlas = createUnit({ name: 'Atlas AS7-D', rulesRefs: [['TM', 'TO']] });
        const locust = createUnit({ name: 'Locust LCT-1V', rulesRefs: [['TM']] });

        service.rebuildIndexes([atlas, locust, createUnit({ name: 'Legacy Unit' })], [], []);

        expect(service.getIndexedFilterValues('rulesRefs')).toEqual(['TM', 'TO']);
        expectUnitIds(service.getIndexedUnitIds('rulesRefs', 'TM'), [atlas.uuid, locust.uuid]);
        expectUnitIds(service.getIndexedUnitIds('rulesRefs', 'TO'), [atlas.uuid]);
        expect(service.getDropdownOptionUniverse('rulesRefs')).toEqual([{ name: 'TM' }, { name: 'TO' }]);
    });

    it('indexes canon and published status as yes/no values', () => {
        const service = new UnitSearchIndexService();

        const publishedCanon = createUnit({ name: 'Canon Published', canon: true, published: ['RS:3050'] });
        const unpublishedNonCanon = createUnit({ name: 'Non-Canon Unpublished', canon: false, published: [] });
        service.rebuildIndexes([publishedCanon, unpublishedNonCanon], [], []);

        expect(service.getIndexedFilterValues('canon')).toEqual(['no', 'yes']);
        expectUnitIds(service.getIndexedUnitIds('canon', 'yes'), [publishedCanon.uuid]);
        expectUnitIds(service.getIndexedUnitIds('canon', 'no'), [unpublishedNonCanon.uuid]);
        expect(service.getIndexedFilterValues('published')).toEqual(['no', 'yes']);
        expectUnitIds(service.getIndexedUnitIds('published', 'yes'), [publishedCanon.uuid]);
        expectUnitIds(service.getIndexedUnitIds('published', 'no'), [unpublishedNonCanon.uuid]);
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
        expectUnitIds(service.getIndexedUnitIds('weaponType', 'AI'), [unit.uuid]);
        expect(service.getDropdownOptionUniverse('weaponType')).toEqual([{ name: 'AE' }, { name: 'AI' }, { name: 'DB' }]);
    });

    it('includes component indexes in the atomically prepared catalog', () => {
        const service = new UnitSearchIndexService();
        const antiInfantryWeapon = new WeaponEquipment({
            id: 'test-mg',
            name: 'Test MG',
            type: 'weapon',
            flags: ['F_MG'],
        });
        const unit = createUnit({
            name: 'Deferred Unit',
            comp: [
                { id: 'test-mg', q: 2, n: 'Test MG', t: 'B', p: 1, l: 'RA', eq: antiInfantryWeapon },
            ],
        });

        const prepared = service.prepareCatalogIndexes([unit], [], []);

        expect(prepared.searchFilterIndex.has('componentName')).toBeTrue();
        expect(prepared.searchFilterIndex.has('weaponType')).toBeTrue();
        expect(unit._weaponTypes).toEqual(['AI', 'DB']);
        expect(prepared.preparationTimings.componentIndexesMs).toBeGreaterThanOrEqual(0);

        service.commitPreparedCatalogIndexes(prepared);
        expect(unit._weaponTypeCounts).toEqual({ AI: 2, DB: 2 });
        expectUnitIds(service.getIndexedUnitIds('componentName', 'Test MG'), [unit.uuid]);
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

    it('keeps same-name units distinct by UUID across filters, tags, and faction-era membership', () => {
        const service = new UnitSearchIndexService();
        const unitSummary = createUnit({
            uuid: 'core-shared-name',
            id: 101,
            name: 'Shared Name',
            type: 'Mek',
            _nameTags: [],
        });
        const custom = createUnit({
            uuid: 'other-shared-name',
            id: 202,
            name: 'Shared Name',
            type: 'Tank',
            _nameTags: [{ tag: 'custom-only', quantity: 1 }],
        });
        const era = {
            id: 1,
            name: 'Test Era',
            units: new Set([unitSummary.id]),
        } as unknown as Era;
        const faction = {
            id: 7,
            name: 'Test Faction',
            eras: { [era.id]: new Set([unitSummary.id]) },
        } as unknown as Faction;

        service.rebuildIndexes([unitSummary, custom], [era], [faction]);
        service.rebuildTagSearchIndex([unitSummary, custom]);

        const unitKey = unitSummary.uuid;
        const customKey = custom.uuid;
        expect(unitKey).not.toBe(customKey);
        expectUnitIds(service.getIndexedUnitIds('type', 'Mek'), [unitKey]);
        expectUnitIds(service.getIndexedUnitIds('type', 'Tank'), [customKey]);
        expectUnitIds(service.getIndexedUnitIds('_tags', 'custom-only'), [customKey]);
        expectUnitIds(service.getIndexedUnitIds('era', era.name), [unitKey]);
        expectUnitIds(service.getIndexedUnitIds('faction', faction.name), [unitKey]);
        expect(service.getFactionEraUnitUuids([era.name], [faction.name])).toEqual(new Set([unitKey]));
    });
});
