import { GameSystem } from '../models/common.model';
import { LoadForceEntry, type LoadForceGroup } from '../models/load-force-entry.model';
import type { Unit } from '../models/units.model';
import type { GroupSizeResult } from './org-types';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import { aggregateGroupsResult, getAggregatedGroupsResult, getOrgFromForce, getOrgFromForceCollection, getOrgFromGroup } from './org-namer.util';

describe('getAggregatedGroupsResult', () => {
    it('passes through a single input group without upgrades or conversions', () => {
        const groups: GroupSizeResult[] = [{
            name: 'Force',
            type: null,
            countsAsType: null,
            tier: 0,
        }];

        const result = getAggregatedGroupsResult(groups, 'Inner Sphere', 'Mercenary');

        expect(result.name).toBe('Force');
        expect(result.tier).toBe(0);
        expect(result.groups).toBe(groups);
        expect(result.groups[0]).toBe(groups[0]);
    });

    it('preserves the original structural groups when computing an aggregated display result', () => {
        const groups: GroupSizeResult[] = [
            {
                name: 'Lance',
                type: 'Lance',
                countsAsType: null,
                tier: 1,
                units: [],
            },
            {
                name: 'Lance',
                type: 'Lance',
                countsAsType: null,
                tier: 1,
                units: [],
            },
        ];

        const result = getAggregatedGroupsResult(groups, 'Inner Sphere', 'Mercenary');

        expect(result.name).toBe('Under-Strength Company');
        expect(result.tier).toBe(1.5);
        expect(result.groups).toBe(groups);
        expect(result.groups.length).toBe(2);
        expect(result.groups.every(group => group.type === 'Lance')).toBeTrue();
    });
});

function createUnit(
    name: string,
    type: Unit['type'],
    subtype: Unit['subtype'],
    isOmni: boolean = false,
    specials: string[] = [],
    internal: number = 1,
): Unit {
    return {
        name,
        id: -1,
        chassis: `Chassis ${name}`,
        model: `Model ${name}`,
        year: 3151,
        weightClass: 'Medium',
        tons: 50,
        offSpeedFactor: 0,
        bv: 0,
        pv: 0,
        cost: 0,
        level: 0,
        techBase: 'Inner Sphere',
        techRating: 'D',
        type,
        subtype,
        omni: isOmni ? 1 : 0,
        engine: 'Fusion',
        engineRating: 0,
        engineHS: 0,
        engineHSType: 'Heat Sink',
        source: [],
        role: '',
        armorType: '',
        structureType: '',
        armor: 0,
        armorPer: 0,
        internal,
        heat: 0,
        dissipation: 0,
        moveType: 'Tracked',
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
            TP: type === 'Mek' ? 'BM' : 'CV',
            PV: 0,
            SZ: 0,
            TMM: 0,
            usesOV: false,
            OV: 0,
            MV: '0',
            MVm: {},
            usesTh: false,
            Th: 0,
            Arm: 0,
            Str: 0,
            specials,
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
        _displayType: '',
        _maxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
    };
}

function createBM(
    name: string,
    subtype: Unit['subtype'] = 'BattleMek',
    isOmni: boolean = false,
    specials: string[] = [],
): Unit {
    return createUnit(name, 'Mek', subtype, isOmni, specials);
}

function createBA(name: string, specials: string[] = [], internal: number = 1): Unit {
    return createUnit(name, 'Infantry', 'Battle Armor', false, specials, internal);
}

function createLoadForceGroup(units: Unit[]): LoadForceGroup {
    return {
        units: units.map(unit => ({ unit, destroyed: false })),
    };
}

describe('org-namer aggregation flow', () => {
    it('keeps raw Sept groups in getOrgFromGroup and aggregates only for display', () => {
        const units: Unit[] = [];
        for (let i = 0; i < 98; i++) {
            units.push(createBM(`SOC-BM-${i + 1}`));
        }

        const result = getOrgFromGroup(createLoadForceGroup(units), 'Society', 'Inner Sphere');

        expect(result.length).toBe(14);
        expect(result.every(group => group.name === 'Sept')).toBeTrue();
        expect(result.every(group => group.type === 'Sept')).toBeTrue();
        expect(aggregateGroupsResult(result).name).toBe('14x Sept');
    });

    it('keeps raw Sept groups in getOrgFromForce and aggregates only for display', () => {
        const units: Unit[] = [];
        for (let i = 0; i < 98; i++) {
            units.push(createBM(`SOC-BM-${i + 1}`));
        }

        const entry = new LoadForceEntry({
            name: 'Society Stack',
            type: GameSystem.CLASSIC,
            groups: [createLoadForceGroup(units)],
        });

        const result = getOrgFromForce(entry, 'Society');

        expect(result.length).toBe(14);
        expect(result.every(group => group.name === 'Sept')).toBeTrue();
        expect(result.every(group => group.type === 'Sept')).toBeTrue();
        expect(aggregateGroupsResult(result).name).toBe('14x Sept');
    });

    it('lets display aggregation grow when a Society stack is merged with a foreign Supernova Trinary', () => {
        const societyUnits: Unit[] = [];
        for (let i = 0; i < 98; i++) {
            societyUnits.push(createBM(`SOC-BM-${i + 1}`));
        }

        const societyEntry = new LoadForceEntry({
            name: 'Society Stack',
            type: GameSystem.CLASSIC,
            groups: [createLoadForceGroup(societyUnits)],
        });
        const societyResult = getOrgFromForce(societyEntry, 'Society');

        expect(societyResult.length).toBe(14);

        const supernovaBinaryUnits: Unit[] = [
            createBA('BA1', ['MEC'], 5),
            createBA('BA2', ['MEC'], 5),
            createBA('BA3', ['MEC'], 5),
            createBA('BA4', ['MEC'], 5),
            createBA('BA5', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBA('BA2', ['MEC'], 5),
            createBA('BA3', ['MEC'], 5),
            createBA('BA4', ['MEC'], 5),
            createBA('BA5', ['MEC'], 5),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM2', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM3', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM4', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM5', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM2', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM3', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM4', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM5', 'BattleMek Omni', true, ['OMNI']),
        ];
        const novaUnits: Unit[] = [
            createBA('NBA1', ['MEC'], 5),
            createBA('NBA2', ['MEC'], 5),
            createBA('NBA3', ['MEC'], 5),
            createBA('NBA4', ['MEC'], 5),
            createBA('NBA5', ['MEC'], 5),
            createBM('NBM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('NBM2', 'BattleMek Omni', true, ['OMNI']),
            createBM('NBM3', 'BattleMek Omni', true, ['OMNI']),
            createBM('NBM4', 'BattleMek Omni', true, ['OMNI']),
            createBM('NBM5', 'BattleMek Omni', true, ['OMNI']),
        ];

        const supernovaBinary = resolveFromUnits(supernovaBinaryUnits, 'Clan', 'Clan Test');
        const nova = resolveFromUnits(novaUnits, 'Clan', 'Clan Test');
        const supernovaTrinary = resolveFromGroups('Clan', 'Clan Test', [supernovaBinary[0], nova[0]]);

        expect(supernovaTrinary.length).toBe(1);
        expect(supernovaTrinary[0].type).toBe('Supernova Trinary');

        const merged = getOrgFromForceCollection(
            [societyEntry],
            'Society',
            [...societyResult, supernovaTrinary[0]],
        );

        expect(merged.length).toBe(19);
        expect(merged.every(group => group.name === 'Sept')).toBeTrue();
        expect(merged.every(group => group.type === 'Sept')).toBeTrue();
        expect(aggregateGroupsResult(merged).name).toBe('19x Sept');
    });

    it('promotes display names using leftover child groups without changing raw org results', () => {
        const rawGroups: GroupSizeResult[] = [
            { name: 'Under-Strength Cluster', type: 'Cluster', countsAsType: null, tier: 3 },
            { name: 'Binary', type: 'Binary', countsAsType: null, tier: 1.8 },
        ];

        const display = getAggregatedGroupsResult(rawGroups, 'Clan', 'Clan Test');

        expect(display.name).toBe('Cluster');
        expect(display.groups).toBe(rawGroups);
    });

    it('uses hierarchical display aggregation for mixed Marian child groups', () => {
        const rawGroups: GroupSizeResult[] = [
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'non-infantry' },
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'infantry' },
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'non-infantry' },
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'infantry' },
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'non-infantry' },
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'infantry' },
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'non-infantry' },
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'infantry' },
            { name: 'Contubernium', type: 'Contubernium', countsAsType: null, tier: 0, tag: 'non-infantry' },
        ];

        const display = getAggregatedGroupsResult(rawGroups, 'Inner Sphere', 'Marian Hegemony');

        expect(display.name).toBe('Maniple');
        expect(display.groups).toBe(rawGroups);
    });
});