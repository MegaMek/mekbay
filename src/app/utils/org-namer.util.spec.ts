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
            modifierKey: '',
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
                modifierKey: '',
                countsAsType: null,
                tier: 1,
                units: [],
            },
            {
                name: 'Lance',
                type: 'Lance',
                modifierKey: '',
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

    it('cycles multiplier names across regular-and-above modifiers after the highest modifier is exceeded', () => {
        const makeBrigades = (count: number): GroupSizeResult[] => Array.from({ length: count }, () => ({
            name: 'Reinforced Brigade',
            type: 'Brigade',
            modifierKey: 'Reinforced ',
            countsAsType: null,
            tier: 5.26,
        }));

        expect(getAggregatedGroupsResult(makeBrigades(1), 'Inner Sphere', 'Mercenary').name).toBe('Reinforced Brigade');
        expect(getAggregatedGroupsResult(makeBrigades(2), 'Inner Sphere', 'Mercenary').name).toBe('2x Reinforced Brigade');
        expect(getAggregatedGroupsResult(makeBrigades(3), 'Inner Sphere', 'Mercenary').name).toBe('3x Reinforced Brigade');
        expect(getAggregatedGroupsResult(makeBrigades(4), 'Inner Sphere', 'Mercenary').name).toBe('4x Reinforced Brigade');
        expect(getAggregatedGroupsResult(makeBrigades(5), 'Inner Sphere', 'Mercenary').name).toBe('5x Reinforced Brigade');
    });

    it('aggregates repeated Under-Strength Brigade groups into the reinforced multiplier track', () => {
        const makeUnderStrengthBrigades = (count: number): GroupSizeResult[] => Array.from({ length: count }, () => ({
            name: 'Under-Strength Brigade',
            type: 'Brigade',
            modifierKey: 'Under-Strength ',
            countsAsType: null,
            tier: 4.63,
        }));

        expect(getAggregatedGroupsResult(makeUnderStrengthBrigades(1), 'Inner Sphere', 'Mercenary').name).toBe('Under-Strength Brigade');
        expect(getAggregatedGroupsResult(makeUnderStrengthBrigades(2), 'Inner Sphere', 'Mercenary').name).toBe('Reinforced Brigade');
        expect(getAggregatedGroupsResult(makeUnderStrengthBrigades(3), 'Inner Sphere', 'Mercenary').name).toBe('2x Brigade');
        expect(getAggregatedGroupsResult(makeUnderStrengthBrigades(4), 'Inner Sphere', 'Mercenary').name).toBe('2x Reinforced Brigade');
        expect(getAggregatedGroupsResult(makeUnderStrengthBrigades(5), 'Inner Sphere', 'Mercenary').name).toBe('3x Brigade');
    });

    it('keeps mixed Brigade tiers when collapsing display groups', () => {
        const result = getAggregatedGroupsResult([
            { name: 'Reinforced Brigade', type: 'Brigade', modifierKey: 'Reinforced ', countsAsType: null, tier: 5.26 },
            { name: 'Brigade', type: 'Brigade', modifierKey: '', countsAsType: null, tier: 5 },
        ], 'Inner Sphere', 'Mercenary');

        expect(result.name).toBe('2x Reinforced Brigade');
        expect(result.tier).toBeCloseTo(5.77, 2);
    });

    it('aggregates same-type groups even when their display names differ', () => {
        const result = getAggregatedGroupsResult([
            { name: 'Under-Strength Brigade', type: 'Brigade', modifierKey: 'Under-Strength ', countsAsType: null, tier: 4.63 },
            { name: 'Reinforced Brigade', type: 'Brigade', modifierKey: 'Reinforced ', countsAsType: null, tier: 5.26 },
        ], 'Inner Sphere', 'Mercenary');

        expect(result.name).toBe('2x Brigade');
        expect(result.tier).toBeCloseTo(5.62, 2);
    });

    it('assimilates lower-tier groups into the top aggregated display instead of listing them separately', () => {
        const result = getAggregatedGroupsResult([
            { name: 'Brigade', type: 'Brigade', modifierKey: '', countsAsType: null, tier: 5 },
            { name: 'Brigade', type: 'Brigade', modifierKey: '', countsAsType: null, tier: 5 },
            { name: 'Under-Strength Battalion', type: 'Battalion', modifierKey: 'Under-Strength ', countsAsType: null, tier: 2.63 },
            { name: 'Single', type: 'Single', modifierKey: '', countsAsType: null, tier: 0 },
        ], 'Inner Sphere', 'Mercenary');

        expect(result.name).toBe('2x Brigade');
        expect(result.name.includes(' + ')).toBeFalse();
        expect(result.tier).toBeCloseTo(5.66, 2);
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

interface AggregatedForceStage {
    entries: LoadForceEntry[];
    rawGroups: GroupSizeResult[];
    aggregated: ReturnType<typeof getAggregatedGroupsResult>;
}

function createMercenaryForce(forceIndex: number): LoadForceEntry {
    const groupCount = 2 + (forceIndex % 4);
    const groups: LoadForceGroup[] = [];

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
        const units: Unit[] = [];
        for (let unitIndex = 0; unitIndex < 4; unitIndex++) {
            units.push(createBM(`MERC-${forceIndex + 1}-${groupIndex + 1}-${unitIndex + 1}`));
        }
        groups.push(createLoadForceGroup(units));
    }

    return new LoadForceEntry({
        instanceId: `merc-${forceIndex + 1}`,
        name: `Mercenary Force ${forceIndex + 1}`,
        type: GameSystem.CLASSIC,
        groups,
    });
}

function resolveAggregatedForceStage(entry: LoadForceEntry): AggregatedForceStage {
    const rawGroups = getOrgFromForce(entry, 'Mercenary');
    const aggregated = getAggregatedGroupsResult(rawGroups, 'Inner Sphere', 'Mercenary');

    return {
        entries: [entry],
        rawGroups,
        aggregated,
    };
}

function mergeAggregatedForceStages(stages: AggregatedForceStage[], batchSize: number): AggregatedForceStage[] {
    const mergedStages: AggregatedForceStage[] = [];

    for (let start = 0; start < stages.length; start += batchSize) {
        const batch = stages.slice(start, start + batchSize);
        const entries = batch.flatMap(stage => stage.entries);
        const childGroupResults = batch.flatMap(stage => stage.aggregated.groups);
        const rawGroups = getOrgFromForceCollection(entries, 'Mercenary', childGroupResults);
        const aggregated = getAggregatedGroupsResult(rawGroups, 'Inner Sphere', 'Mercenary');

        mergedStages.push({
            entries,
            rawGroups,
            aggregated,
        });
    }

    return mergedStages;
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
            { name: 'Under-Strength Cluster', type: 'Cluster', modifierKey: 'Under-Strength ', countsAsType: null, tier: 3 },
            { name: 'Binary', type: 'Binary', modifierKey: '', countsAsType: null, tier: 1.8 },
        ];

        const display = getAggregatedGroupsResult(rawGroups, 'Clan', 'Clan Test');

        expect(display.name).toBe('Cluster');
        expect(display.groups).toBe(rawGroups);
    });

    it('uses hierarchical display aggregation for mixed Marian child groups', () => {
        const rawGroups: GroupSizeResult[] = [
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'non-infantry' },
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'infantry' },
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'non-infantry' },
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'infantry' },
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'non-infantry' },
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'infantry' },
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'non-infantry' },
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'infantry' },
            { name: 'Contubernium', type: 'Contubernium', modifierKey: '', countsAsType: null, tier: 0, tag: 'non-infantry' },
        ];

        const display = getAggregatedGroupsResult(rawGroups, 'Inner Sphere', 'Marian Hegemony');

        expect(display.name).toBe('Maniple');
        expect(display.groups).toBe(rawGroups);
    });

    it('aggregates 400 multi-group forces and merges them in batches of 10 down to one force', () => {
        let stages = Array.from({ length: 400 }, (_, index) => resolveAggregatedForceStage(createMercenaryForce(index)));
        const roundSizes = [stages.length];
        const firstStage = stages[0];

        expect(stages.every(stage => stage.rawGroups.length > 0)).toBeTrue();
        expect(stages.every(stage => stage.aggregated.groups === stage.rawGroups)).toBeTrue();
        expect(new Set(stages.map(stage => stage.aggregated.name)).size).toBeGreaterThan(1);

        expect(firstStage.rawGroups.length).toBe(1);
        expect(firstStage.rawGroups[0].name).toBe('Under-Strength Company');
        expect(firstStage.rawGroups[0].type).toBe('Company');
        expect(firstStage.rawGroups[0].tier).toBe(1.5);
        expect(firstStage.aggregated.name).toBe('Under-Strength Company');
        expect(firstStage.aggregated.tier).toBe(1.5);

        while (stages.length > 1) {
            stages = mergeAggregatedForceStages(stages, 10);
            roundSizes.push(stages.length);

            expect(stages.every(stage => stage.entries.length > 0)).toBeTrue();
            expect(stages.every(stage => stage.rawGroups.length > 0)).toBeTrue();
            expect(stages.every(stage => stage.aggregated.groups === stage.rawGroups)).toBeTrue();
            expect(stages.every(stage => stage.aggregated.name.length > 0)).toBeTrue();
        }

        expect(roundSizes).toEqual([400, 40, 4, 1]);
        expect(stages[0].entries.length).toBe(400);
        expect(stages[0].rawGroups.length).toBe(12);
        expect(stages[0].aggregated.groups).toBe(stages[0].rawGroups);
        expect(stages[0].aggregated.name).toBe('10x Reinforced Brigade');
        expect(stages[0].aggregated.tier).toBeCloseTo(7.35, 2);
    });
});