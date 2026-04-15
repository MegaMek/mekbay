import type { Unit } from '../models/units.model';
import { UnitSearchIndexService } from './unit-search-index.service';

function createUnit(overrides: Partial<Unit>): Unit {
    return {
        id: 1,
        name: 'Unit',
        chassis: 'Unit',
        model: 'A',
        year: 3050,
        weightClass: 'Medium',
        tons: 50,
        offSpeedFactor: 0,
        bv: 0,
        pv: 0,
        cost: 0,
        level: 0,
        techBase: 'Inner Sphere',
        techRating: 'D',
        type: 'Mek',
        subtype: 'BattleMek',
        omni: 0,
        engine: 'Fusion',
        engineRating: 250,
        engineHS: 10,
        engineHSType: 'Heat Sink',
        source: [],
        role: 'Brawler',
        armorType: 'Standard',
        structureType: 'Standard',
        armor: 0,
        armorPer: 0,
        internal: 0,
        heat: 0,
        dissipation: 0,
        moveType: 'Biped',
        walk: 0,
        walk2: 0,
        run: 0,
        run2: 0,
        jump: 0,
        jump2: 0,
        umu: 0,
        c3: '',
        dpt: 0,
        comp: [],
        su: 0,
        crewSize: 1,
        quirks: [],
        features: [],
        icon: '',
        sheets: [],
        as: {
            TP: 'BM',
            PV: 0,
            SZ: 2,
            TMM: 0,
            usesOV: false,
            OV: 0,
            MV: '0',
            MVm: { '': 0 },
            usesTh: false,
            Th: 0,
            Arm: 0,
            Str: 0,
            specials: [],
            dmg: {
                dmgS: '0',
                dmgM: '0',
                dmgL: '0',
                dmgE: '0',
            },
            usesE: false,
            usesArcs: false,
        },
        _searchKey: '',
        _displayType: 'Mek',
        _maxRange: 0,
        _weightedMaxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
        ...overrides,
    };
}

describe('UnitSearchIndexService', () => {
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

        expect(service.getUnitSubtypeMaxStats('BattleMek').armor).toEqual({ min: 10, max: 30, average: 20 });
        expect(service.getUnitSubtypeMaxStats('BattleMek').dpt).toEqual({ min: 4, max: 8, average: 6 });
        expect(service.getUnitSubtypeMaxStats('BattleMek').run2MP).toEqual({ min: 4, max: 6, average: 5 });
        expect(service.getUnitSubtypeMaxStats('BattleMek').weightedMaxRange).toEqual({ min: 10, max: 12, average: 11 });
        expect(service.getASUnitTypeMaxStats('BM').asTmm).toEqual({ min: 2, max: 4, average: 3 });
        expect(service.getASUnitTypeMaxStats('BM').asDmgM).toEqual({ min: 1, max: 3, average: 2 });
        expect(service.getUnitSubtypeMaxStats('WarShip').dropshipCapacity).toEqual({ min: 2, max: 6, average: 4 });
        expect(service.getUnitSubtypeMaxStats('WarShip').gravDecks).toEqual({ min: 1, max: 3, average: 2 });
    });

    it('returns zeroed min, max, and average values for missing buckets', () => {
        const service = new UnitSearchIndexService();

        expect(service.getUnitSubtypeMaxStats('Missing').armor).toEqual({ min: 0, max: 0, average: 0 });
        expect(service.getUnitSubtypeMaxStats('Missing').weightedMaxRange).toEqual({ min: 0, max: 0, average: 0 });
        expect(service.getASUnitTypeMaxStats('Missing').asTmm).toEqual({ min: 0, max: 0, average: 0 });
        expect(service.getUnitSubtypeMaxStats('Missing').gravDecks).toEqual({ min: 0, max: 0, average: 0 });
    });
});