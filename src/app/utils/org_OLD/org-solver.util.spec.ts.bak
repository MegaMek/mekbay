import type { Unit } from '../models/units.model';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import { getAggregatedGroupsResult } from './org-namer.util';
import type { GroupSizeResult } from './org-types';

type UnitFixture = {
    type: Unit['type'];
    subtype: Unit['subtype'];
    omni?: boolean;
    specials?: string[];
    internal?: number;
};

    function createUnit(
    name: string,
    type: Unit['type'],
    subtype: Unit['subtype'],
    isOmni: boolean = false,
    specials: string[] = [],
    internal: number = 1,
): Unit {
    return {    
        name: name,
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
            specials: specials,
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

function createCV(name: string, isOmni: boolean = false, specials: string[] = []): Unit {
    return createUnit(name, 'Tank', 'Combat Vehicle', isOmni, specials);
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

function createCI(
    name: string,
    subtype: Unit['subtype'] = 'Conventional Infantry',
    internal: number = 1,
): Unit {
    return createUnit(name, 'Infantry', subtype, false, [], internal);
}

const BLUNDER_BRIGADE_UNIT_FIXTURES: Record<string, UnitFixture> = {
    BMAnvil_ANV3M: { type: 'Mek', subtype: 'BattleMek', specials: ['ECM', 'ENE', 'JMPW1'] },
    BMAwesome_AWS9Q: { type: 'Mek', subtype: 'BattleMek', specials: ['ECM', 'ENE'] },
    BMAxman_AXM1N: { type: 'Mek', subtype: 'BattleMek', specials: ['AC2/2/-', 'CASE', 'MEL'] },
    BMDasher_H: { type: 'Mek', subtype: 'BattleMek Omni', omni: true, specials: ['ENE', 'OMNI'] },
    BMFirestarter_FS9OE: { type: 'Mek', subtype: 'BattleMek Omni', omni: true, specials: ['MEL', 'OMNI', 'REAR0*/-/-'] },
    BMGrandTitan_TITN10M: { type: 'Mek', subtype: 'BattleMek', specials: ['AMS', 'IF1', 'REAR1/-/-'] },
    BMHatchetman_HCT3F: { type: 'Mek', subtype: 'BattleMek', specials: ['AC1/1/-', 'MEL'] },
    BMHatchetman_HCT5S: { type: 'Mek', subtype: 'BattleMek', specials: ['CASE', 'FLK1/1/1', 'MEL'] },
    BMHighlanderIIC: { type: 'Mek', subtype: 'BattleMek', specials: ['CASE', 'IF1'] },
    BMHoplite_C: { type: 'Mek', subtype: 'BattleMek', specials: ['CASE', 'IF1'] },
    BMHoplite_HOP4D: { type: 'Mek', subtype: 'BattleMek', specials: ['FLK1/1/1', 'IF0*'] },
    BMHussar_HSR400D: { type: 'Mek', subtype: 'BattleMek', specials: ['FLK1/1/1'] },
    BMImp_C: { type: 'Mek', subtype: 'BattleMek', specials: ['CASE', 'IF1'] },
    BMJavelin_JVN10FFireJavelin: { type: 'Mek', subtype: 'BattleMek', specials: ['ENE'] },
    BMJavelin_JVN11AFireJavelin: { type: 'Mek', subtype: 'BattleMek', specials: ['ENE'] },
    BMKomodo_KIM2: { type: 'Mek', subtype: 'BattleMek', specials: ['AMS', 'ECM', 'TAG'] },
    BMMarauderIIC: { type: 'Mek', subtype: 'BattleMek', specials: ['ENE'] },
    BMNightsky_NGS5S: { type: 'Mek', subtype: 'BattleMek', specials: ['ENE', 'MEL'] },
    BMOrion_ON1K: { type: 'Mek', subtype: 'BattleMek', specials: ['IF1'] },
    BMOrion_ON1KMuller: { type: 'Mek', subtype: 'BattleMek', specials: ['ARTS-1'] },
    BMOrion_ON1M: { type: 'Mek', subtype: 'BattleMek', specials: ['CASE', 'FLK1/1/1', 'IF1', 'LRM1/1/1', 'SNARC'] },
    BMOstsol_OTL5M: { type: 'Mek', subtype: 'BattleMek', specials: ['AMS', 'REAR1/1/-'] },
    BMPuma_E: { type: 'Mek', subtype: 'BattleMek Omni', omni: true, specials: ['CASE', 'OMNI'] },
    BMPuma_S: { type: 'Mek', subtype: 'BattleMek Omni', omni: true, specials: ['CASE', 'ECM', 'OMNI', 'PRB', 'RCN'] },
    BMRyoken_E: { type: 'Mek', subtype: 'BattleMek Omni', omni: true, specials: ['CASE', 'OMNI', 'PRB', 'RCN'] },
    BMScarabus_SCB9A: { type: 'Mek', subtype: 'BattleMek', specials: ['ECM', 'ENE', 'MEL', 'TAG'] },
    BMShogun_C: { type: 'Mek', subtype: 'BattleMek', specials: ['CASE', 'IF2'] },
    BMStalker_STK5S: { type: 'Mek', subtype: 'BattleMek', specials: ['AMS', 'CASE', 'IF1'] },
    BMTempest_TMP3G: { type: 'Mek', subtype: 'BattleMek', specials: [] },
    BMTempest_TMP3M: { type: 'Mek', subtype: 'BattleMek', specials: [] },
    BMTempest_TMP3MA: { type: 'Mek', subtype: 'BattleMek', specials: ['AC1/1/-'] },
    BMThunder_THR1L: { type: 'Mek', subtype: 'BattleMek', specials: ['AC2/2/-', 'CASE', 'IF0*'] },
    BMThunderbolt_TDR9W: { type: 'Mek', subtype: 'BattleMek', specials: ['CASE', 'IF1'] },
    BMVenom_SDR9K: { type: 'Mek', subtype: 'BattleMek', specials: ['ENE'] },
    BMVictor_C: { type: 'Mek', subtype: 'BattleMek', specials: [] },
    BMWarDog_WRDG02FC: { type: 'Mek', subtype: 'BattleMek', specials: ['AMS', 'ECM', 'REAR0*/-/-'] },
    BMWarhammer_C2: { type: 'Mek', subtype: 'BattleMek', specials: [] },
    BMWarhammer_C3: { type: 'Mek', subtype: 'BattleMek', specials: ['CASE', 'ECM'] },
    CIFootPlatoonComStar_SRM: { type: 'Infantry', subtype: 'Conventional Infantry', internal: 24, specials: ['AM', 'CAR3'] },
    CIFootPlatoonFWLM_SRM3035: { type: 'Infantry', subtype: 'Conventional Infantry', internal: 24, specials: ['CAR3'] },
    CVBadgerCTrackedTransport_A: { type: 'Tank', subtype: 'Combat Vehicle Omni', omni: true, specials: ['CASE', 'IT5', 'OMNI', 'SRCH', 'TUR(3/2/-)'] },
    CVBadgerCTrackedTransport_B: { type: 'Tank', subtype: 'Combat Vehicle Omni', omni: true, specials: ['CASE', 'IT5', 'OMNI', 'SRCH', 'TUR(2/2/-)'] },
    CVDemolisherHeavyTank_Clan: { type: 'Tank', subtype: 'Combat Vehicle', specials: ['CASE', 'FLK3/3/-', 'SRCH', 'TUR(5/5/-,FLK3/3/-)'] },
    CVPikeSupportVehicle_Clan: { type: 'Tank', subtype: 'Combat Vehicle', specials: ['CASE', 'SRCH', 'TUR(2/2/2)'] },
    CVThumperArtilleryVehicle: { type: 'Tank', subtype: 'Combat Vehicle', specials: ['ARTT-1', 'EE', 'REAR0*/-/-', 'SRCH'] },
};

function createFixtureUnit(name: keyof typeof BLUNDER_BRIGADE_UNIT_FIXTURES): Unit {
    const fixture = BLUNDER_BRIGADE_UNIT_FIXTURES[name];
    return createUnit(
        name,
        fixture.type,
        fixture.subtype,
        fixture.omni ?? false,
        fixture.specials ?? [],
        fixture.internal ?? 1,
    );
}

const BLUNDER_BRIGADE_MAX_SOLVE_MS = 500;

const BLUNDER_BRIGADE_GROUP_ONE_NAMES: Array<keyof typeof BLUNDER_BRIGADE_UNIT_FIXTURES> = [
    'BMNightsky_NGS5S',
    'BMOstsol_OTL5M',
    'BMOrion_ON1KMuller',
    'CVThumperArtilleryVehicle',
    'CIFootPlatoonFWLM_SRM3035',
    'CIFootPlatoonComStar_SRM',
    'BMPuma_E',
    'BMPuma_S',
    'BMDasher_H',
    'BMRyoken_E',
    'BMVenom_SDR9K',
    'BMAwesome_AWS9Q',
    'BMStalker_STK5S',
    'BMKomodo_KIM2',
    'BMAnvil_ANV3M',
    'BMWarDog_WRDG02FC',
    'BMGrandTitan_TITN10M',
    'BMTempest_TMP3MA',
    'BMTempest_TMP3M',
    'BMTempest_TMP3G',
    'BMJavelin_JVN10FFireJavelin',
    'BMJavelin_JVN11AFireJavelin',
    'CVDemolisherHeavyTank_Clan',
    'CVPikeSupportVehicle_Clan',
    'CVBadgerCTrackedTransport_A',
    'CVBadgerCTrackedTransport_B',
    'BMScarabus_SCB9A',
    'BMHatchetman_HCT3F',
    'BMFirestarter_FS9OE',
    'BMAxman_AXM1N',
    'BMHatchetman_HCT5S',
    'BMHussar_HSR400D',
    'BMThunderbolt_TDR9W',
    'BMThunder_THR1L',
    'BMOrion_ON1M',
    'BMOrion_ON1K',
    'BMMarauderIIC',
    'BMHighlanderIIC',
    'BMHoplite_HOP4D',
    'BMHoplite_C',
    'BMVictor_C',
    'BMShogun_C',
    'BMImp_C',
    'BMWarhammer_C2',
    'BMWarhammer_C3',
];

function resolveBlunderBrigadeForce(): { groupResults: GroupSizeResult[]; result: GroupSizeResult[] } {
    const groupOne: Unit[] = Array.from({ length: 1 }, (_, iteration) =>
        BLUNDER_BRIGADE_GROUP_ONE_NAMES.map(name => createFixtureUnit(name)),
    ).flat();
    const groupTwo: Unit[] = [
        'BMOstsol_OTL5M',
        'BMNightsky_NGS5S',
        'BMPuma_E',
        'BMPuma_S',
        'BMDasher_H',
    ].map(name => createFixtureUnit(name));
    const groupThree: Unit[] = [
        'BMHatchetman_HCT5S',
        'BMHussar_HSR400D',
    ].map(name => createFixtureUnit(name));

    const groupResults = [
        ...resolveFromUnits(groupOne, 'Wolf\'s Dragoons', 'Mercenary'),
        ...resolveFromUnits(groupTwo, 'Wolf\'s Dragoons', 'Mercenary'),
        ...resolveFromUnits(groupThree, 'Wolf\'s Dragoons', 'Mercenary'),
    ];

    return {
        groupResults,
        result: resolveFromGroups('Wolf\'s Dragoons', 'Mercenary', groupResults),
    };
}

function createContuberniumGroup(unit: Unit, tag: 'infantry' | 'non-infantry'): GroupSizeResult {
    return {
        name: 'Contubernium',
        type: 'Contubernium',
        modifierKey: '',
        countsAsType: null,
        tier: 0,
        units: [unit],
        tag,
    };
}

function createForeignGroup(
    name: string,
    type: GroupSizeResult['type'],
    tier: number,
    countsAsType: GroupSizeResult['countsAsType'] = null,
    units?: Unit[],
): GroupSizeResult {
    return {
        name,
        type,
        modifierKey: '',
        countsAsType,
        tier,
        units,
    };
}

function createGroupResult(
    name: string,
    type: GroupSizeResult['type'],
    modifierKey: string,
    tier: number,
    children?: GroupSizeResult[],
): GroupSizeResult {
    return {
        name,
        type,
        modifierKey,
        countsAsType: null,
        tier,
        children,
    };
}

function collectDescendantGroups(group: GroupSizeResult): GroupSizeResult[] {
    const children = group.children ?? [];
    return children.flatMap(child => [child, ...collectDescendantGroups(child)]);
}

describe('resolveFromUnits', () => {

    it('resolves 4 BM in a Lance', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM3'),
            createBM('BM4'),
        ];

        const result = resolveFromUnits(units, 'Random Inner Sphere Faction', 'Inner Sphere');

        expect(result[0].name).toBe('Lance');
        expect(result[0].type).toBe('Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 3 BM in a Under-Strength Lance', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM3'),
        ];

        const result = resolveFromUnits(units, 'Random Inner Sphere Faction', 'Inner Sphere');

        expect(result[0].name).toBe('Under-Strength Lance');
        expect(result[0].type).toBe('Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 5 BM in a Reinforced Lance', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM3'),
            createBM('BM4'),
            createBM('BM5'),
        ];

        const result = resolveFromUnits(units, 'Random Inner Sphere Faction', 'Inner Sphere');

        expect(result[0].name).toBe('Reinforced Lance');
        expect(result[0].type).toBe('Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 6 BM in a Fortified Lance', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM3'),
            createBM('BM4'),
            createBM('BM5'),
            createBM('BM6'),
        ];

        const result = resolveFromUnits(units, 'Random Inner Sphere Faction', 'Inner Sphere');

        expect(result[0].name).toBe('Fortified Lance');
        expect(result[0].type).toBe('Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 7 BM as an Under-Strength Company', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM3'),
            createBM('BM4'),
            createBM('BM5'),
            createBM('BM6'),
            createBM('BM7'),
        ];

        const result = resolveFromUnits(units, 'Random Inner Sphere Faction', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].modifierKey).toBe('Under-Strength ');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 8 BM as an Under-Strength Company', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM3'),
            createBM('BM4'),
            createBM('BM5'),
            createBM('BM6'),
            createBM('BM7'),
            createBM('BM8'),
        ];

        const result = resolveFromUnits(units, 'Random Inner Sphere Faction', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('groups four lances into a Reinforced Company', () => {
        const lanceGroups = [0, 1, 2, 3].map(lanceIndex =>
            resolveFromUnits([
                createBM(`L${lanceIndex + 1}-1`),
                createBM(`L${lanceIndex + 1}-2`),
                createBM(`L${lanceIndex + 1}-3`),
                createBM(`L${lanceIndex + 1}-4`),
            ], 'Inner Sphere', 'Mercenary')[0],
        );

        const result = resolveFromGroups('Inner Sphere', 'Mercenary', lanceGroups);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Reinforced Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].modifierKey).toBe('Reinforced ');
        expect(result[0].children?.length).toBe(4);
        expect(result[0].children?.every(child => child.name === 'Lance')).toBeTrue();
        expect(result[0].children?.every(child => child.type === 'Lance')).toBeTrue();
        expect(result[0].children?.every(child => child.modifierKey === '')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('assimilates an Under-Strength Company and two lances into a Reinforced Company', () => {
        const underStrengthCompany = resolveFromUnits([
            createBM('CO-1'),
            createBM('CO-2'),
            createBM('CO-3'),
            createBM('CO-4'),
            createBM('CO-5'),
            createBM('CO-6'),
            createBM('CO-7'),
            createBM('CO-8'),
        ], 'Inner Sphere', 'Mercenary');
        const firstLance = resolveFromUnits([
            createBM('L1-1'),
            createBM('L1-2'),
            createBM('L1-3'),
            createBM('L1-4'),
        ], 'Inner Sphere', 'Mercenary');
        const secondLance = resolveFromUnits([
            createBM('L2-1'),
            createBM('L2-2'),
            createBM('L2-3'),
            createBM('L2-4'),
        ], 'Inner Sphere', 'Mercenary');

        expect(underStrengthCompany.length).toBe(1);
        expect(underStrengthCompany[0].name).toBe('Under-Strength Company');
        expect(underStrengthCompany[0].type).toBe('Company');
        expect(firstLance.length).toBe(1);
        expect(firstLance[0].name).toBe('Lance');
        expect(firstLance[0].type).toBe('Lance');
        expect(secondLance.length).toBe(1);
        expect(secondLance[0].name).toBe('Lance');
        expect(secondLance[0].type).toBe('Lance');

        const result = resolveFromGroups('Inner Sphere', 'Mercenary', [
            underStrengthCompany[0],
            firstLance[0],
            secondLance[0],
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Reinforced Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].children?.length).toBe(4);
        expect(result[0].children?.every(child => child.name === 'Lance')).toBeTrue();
        expect(result[0].children?.every(child => child.type === 'Lance')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('regularizes an Under-Strength Company before building upward from four additional lances', () => {
        const underStrengthCompany = resolveFromUnits([
            createBM('UPCO-1'),
            createBM('UPCO-2'),
            createBM('UPCO-3'),
            createBM('UPCO-4'),
            createBM('UPCO-5'),
            createBM('UPCO-6'),
            createBM('UPCO-7'),
            createBM('UPCO-8'),
        ], 'Inner Sphere', 'Mercenary');
        const lanceGroups = [0, 1, 2, 3].map(lanceIndex =>
            resolveFromUnits([
                createBM(`UPL${lanceIndex + 1}-1`),
                createBM(`UPL${lanceIndex + 1}-2`),
                createBM(`UPL${lanceIndex + 1}-3`),
                createBM(`UPL${lanceIndex + 1}-4`),
            ], 'Inner Sphere', 'Mercenary')[0],
        );

        const result = resolveFromGroups('Inner Sphere', 'Mercenary', [
            underStrengthCompany[0],
            ...lanceGroups,
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Battalion');
        expect(result[0].type).toBe('Battalion');
        expect(result[0].modifierKey).toBe('Under-Strength ');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.type === 'Company')).toBeTrue();
        expect(result[0].children?.every(child => child.name === 'Company')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('promotes a sub-regular company only to regular, not directly to reinforced', () => {
        const firstUnderStrengthCompany = resolveFromUnits([
            createBM('INV-BCO-1'),
            createBM('INV-BCO-2'),
            createBM('INV-BCO-3'),
            createBM('INV-BCO-4'),
            createBM('INV-BCO-5'),
            createBM('INV-BCO-6'),
            createBM('INV-BCO-7'),
            createBM('INV-BCO-8'),
        ], 'Inner Sphere', 'Mercenary');
        const secondUnderStrengthCompany = resolveFromUnits([
            createBM('INV-CCO-1'),
            createBM('INV-CCO-2'),
            createBM('INV-CCO-3'),
            createBM('INV-CCO-4'),
            createBM('INV-CCO-5'),
            createBM('INV-CCO-6'),
            createBM('INV-CCO-7'),
            createBM('INV-CCO-8'),
        ], 'Inner Sphere', 'Mercenary');
        const underStrengthBattalion = resolveFromGroups('Inner Sphere', 'Mercenary', [
            firstUnderStrengthCompany[0],
            secondUnderStrengthCompany[0],
        ]);
        const thirdUnderStrengthCompany = resolveFromUnits([
            createBM('INV-DCO-1'),
            createBM('INV-DCO-2'),
            createBM('INV-DCO-3'),
            createBM('INV-DCO-4'),
            createBM('INV-DCO-5'),
            createBM('INV-DCO-6'),
            createBM('INV-DCO-7'),
            createBM('INV-DCO-8'),
        ], 'Inner Sphere', 'Mercenary');
        const firstLance = resolveFromUnits([
            createBM('INV-L1-1'),
            createBM('INV-L1-2'),
            createBM('INV-L1-3'),
            createBM('INV-L1-4'),
        ], 'Inner Sphere', 'Mercenary');
        const secondLance = resolveFromUnits([
            createBM('INV-L2-1'),
            createBM('INV-L2-2'),
            createBM('INV-L2-3'),
            createBM('INV-L2-4'),
        ], 'Inner Sphere', 'Mercenary');

        const result = resolveFromGroups('Inner Sphere', 'Mercenary', [
            underStrengthBattalion[0],
            thirdUnderStrengthCompany[0],
            firstLance[0],
            secondLance[0],
        ]);

        expect(result.length).toBe(2);
        expect(result[0].name).toBe('Battalion');
        expect(result[0].type).toBe('Battalion');
        expect(result[0].modifierKey).toBe('');
        expect(result[1].name).toBe('Lance');
        expect(result[1].type).toBe('Lance');
        expect(result[1].modifierKey).toBe('');
    });

    it('assimilates an Under-Strength Battalion, an Under-Strength Company, and two lances from the lowest tier first', () => {
        const firstUnderStrengthCompany = resolveFromUnits([
            createBM('BCO-1'),
            createBM('BCO-2'),
            createBM('BCO-3'),
            createBM('BCO-4'),
            createBM('BCO-5'),
            createBM('BCO-6'),
            createBM('BCO-7'),
            createBM('BCO-8'),
        ], 'Inner Sphere', 'Mercenary');
        const secondUnderStrengthCompany = resolveFromUnits([
            createBM('CCO-1'),
            createBM('CCO-2'),
            createBM('CCO-3'),
            createBM('CCO-4'),
            createBM('CCO-5'),
            createBM('CCO-6'),
            createBM('CCO-7'),
            createBM('CCO-8'),
        ], 'Inner Sphere', 'Mercenary');
        const underStrengthBattalion = resolveFromGroups('Inner Sphere', 'Mercenary', [
            firstUnderStrengthCompany[0],
            secondUnderStrengthCompany[0],
        ]);
        const thirdUnderStrengthCompany = resolveFromUnits([
            createBM('DCO-1'),
            createBM('DCO-2'),
            createBM('DCO-3'),
            createBM('DCO-4'),
            createBM('DCO-5'),
            createBM('DCO-6'),
            createBM('DCO-7'),
            createBM('DCO-8'),
        ], 'Inner Sphere', 'Mercenary');
        const firstLance = resolveFromUnits([
            createBM('BL1-1'),
            createBM('BL1-2'),
            createBM('BL1-3'),
            createBM('BL1-4'),
        ], 'Inner Sphere', 'Mercenary');
        const secondLance = resolveFromUnits([
            createBM('BL2-1'),
            createBM('BL2-2'),
            createBM('BL2-3'),
            createBM('BL2-4'),
        ], 'Inner Sphere', 'Mercenary');

        expect(underStrengthBattalion.length).toBe(1);
        expect(underStrengthBattalion[0].name).toBe('Under-Strength Battalion');
        expect(underStrengthBattalion[0].type).toBe('Battalion');

        const result = resolveFromGroups('Inner Sphere', 'Mercenary', [
            underStrengthBattalion[0],
            thirdUnderStrengthCompany[0],
            firstLance[0],
            secondLance[0],
        ]);

        expect(result.length).toBe(2);
        expect(result[0].name).toBe('Battalion');
        expect(result[0].type).toBe('Battalion');
        expect(result[0].children?.length).toBe(3);
        expect(result[0].children?.filter(child => child.name === 'Under-Strength Company').length).toBe(2);
        expect(result[0].children?.some(child => child.name === 'Company')).toBeTrue();
        expect(result[0].children?.every(child => child.type === 'Company')).toBeTrue();
        expect(result[1].name).toBe('Lance');
        expect(result[1].type).toBe('Lance');
        expect(result[1].leftoverUnits).toBeUndefined();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('regularizes a Thin Level II with ten Level I into two regular Level II groups', () => {
        const thinLevelII = resolveFromUnits([
            createBM('CS-TL2-1'),
            createBM('CS-TL2-2'),
        ], 'ComStar', 'Inner Sphere');
        const levelIs = Array.from({ length: 10 }, (_, index) =>
            resolveFromUnits([
                createBM(`CS-L1-${index + 1}`),
            ], 'ComStar', 'Inner Sphere')[0],
        );

        expect(thinLevelII.length).toBe(1);
        expect(thinLevelII[0].name).toBe('Thin Level II');
        expect(thinLevelII[0].type).toBe('Level II');
        expect(thinLevelII[0].modifierKey).toBe('Thin ');
        expect(levelIs.every(group => group.name === 'Level I')).toBeTrue();
        expect(levelIs.every(group => group.type === 'Level I')).toBeTrue();

        const result = resolveFromGroups('ComStar', 'Inner Sphere', [
            thinLevelII[0],
            ...levelIs,
        ]);

        expect(result.length).toBe(2);
        expect(result.every(group => group.name === 'Level II')).toBeTrue();
        expect(result.every(group => group.type === 'Level II')).toBeTrue();
        expect(result.every(group => group.modifierKey === '')).toBeTrue();
        expect(result.every(group => group.children?.length === 6)).toBeTrue();
        expect(result.every(group => group.children?.every(child => child.name === 'Level I'))).toBeTrue();
        expect(result.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('repackages two Demi-Level I groups into one regular Level I', () => {
        const demiLevelIs = [
            createGroupResult('Demi-Level I', 'Level I', 'Demi-', 0),
            createGroupResult('Demi-Level I', 'Level I', 'Demi-', 0),
        ];

        const result = resolveFromGroups('ComStar', 'Inner Sphere', demiLevelIs);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Level I');
        expect(result[0].type).toBe('Level I');
        expect(result[0].modifierKey).toBe('');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.name === 'Demi-Level I')).toBeTrue();
        expect(result[0].children?.every(child => child.modifierKey === 'Demi-')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('repackages twelve Demi-Level I groups into one regular Level II', () => {
        const demiLevelIs = Array.from({ length: 12 }, () =>
            createGroupResult('Demi-Level I', 'Level I', 'Demi-', 0),
        );

        const result = resolveFromGroups('ComStar', 'Inner Sphere', demiLevelIs);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Level II');
        expect(result[0].type).toBe('Level II');
        expect(result[0].modifierKey).toBe('');
        expect(result[0].children?.length).toBe(6);
        expect(result[0].children?.every(child => child.name === 'Level I')).toBeTrue();
        expect(result[0].children?.every(child => child.modifierKey === '')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('groups thirty-six Level I into a Level III for ComStar', () => {
        const levelIs = Array.from({ length: 36 }, (_, index) =>
            resolveFromUnits([
                createBM(`CS-L3-${index + 1}`),
            ], 'ComStar', 'Inner Sphere')[0],
        );

        expect(levelIs.every(group => group.name === 'Level I')).toBeTrue();
        expect(levelIs.every(group => group.type === 'Level I')).toBeTrue();

        const result = resolveFromGroups('ComStar', 'Inner Sphere', levelIs);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Level III');
        expect(result[0].type).toBe('Level III');
        expect(result[0].modifierKey).toBe('');
        expect(result[0].children?.length).toBe(6);
        expect(result[0].children?.every(child => child.name === 'Level II')).toBeTrue();
        expect(result[0].children?.every(child => child.type === 'Level II')).toBeTrue();
        expect(result[0].children?.every(child => child.modifierKey === '')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 4 CV and 2 BM to an Augmented Lance', () => {
        const units: Unit[] = [
            createCV('CV1'),
            createCV('CV1'),
            createCV('CV2'),
            createCV('CV2'),
            createBM('BM1'),
            createBM('BM2'),
        ];

        const result = resolveFromUnits(units, 'Capellan Confederation', 'Inner Sphere');

        expect(result[0].type).toBe('Augmented Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('prefers a complete Capellan company over an Augmented Lance with leftovers', () => {
        const units: Unit[] = [
            createCV('CV1'),
            createCV('CV2'),
            createCV('CV3'),
            createCV('CV3'),
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM3'),
            createBM('BM4'),
        ];

        const result = resolveFromUnits(units, 'Capellan Confederation', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].leftoverUnits).toBeUndefined();
        expect(result[0].children?.length).toBe(2);
    });

    it('prefers Air Lance over Under-Strength Company for 2 BM plus 2 AF', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createUnit('AF1', 'Aero', 'Aerospace Fighter'),
            createUnit('AF2', 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Air Lance');
        expect(result[0].name).toBe('Air Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 1 AF as Under-Strength Flight', () => {
        const units: Unit[] = [
            createUnit('AF1', 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Flight');
        expect(result[0].name).toBe('Under-Strength Flight');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 1 BM in Society as Un', () => {
        const units: Unit[] = [
            createBM('BM1'),
        ];

        const result = resolveFromUnits(units, 'Society', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Un');
        expect(result[0].name).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 2 BM in Society as 2x Un', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
        ];

        const result = resolveFromUnits(units, 'Society', 'HW Clan');

        expect(result.length).toBe(2);
        expect(result.every(group => group.type === 'Un')).toBeTrue();
        expect(result.every(group => group.name === 'Un')).toBeTrue();
        expect(result.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('resolves 3 BM in Society as Trey', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM1'),
            createBM('BM2'),
        ];

        const result = resolveFromUnits(units, 'Society', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Trey');
        expect(result[0].name).toBe('Trey');
        expect(result[0].children?.length).toBe(3);
        expect(result[0].children?.every(group => group.type === 'Un')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 7 CV in Society as Un', () => {
        const units: Unit[] = [
            createCV('CV1'),
            createCV('CV1'),
            createCV('CV1'),
            createCV('CV1'),
            createCV('CV1'),
            createCV('CV1'),
            createCV('CV2'),
        ];

        const result = resolveFromUnits(units, 'Society', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Un');
        expect(result[0].type).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 3 CI platoons in Society as Un', () => {
        const units: Unit[] = [
            createCI('CI1'),
            createCI('CI1'),
            createCI('CI1'),
        ];

        units.forEach(u => u.internal = 25);

        const result = resolveFromUnits(units, 'Society', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Un');
        expect(result[0].type).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 3 battle armor troopers in Society as Un', () => {
        const battleArmor = createBA('BA1', [], 3);

        const result = resolveFromUnits([battleArmor], 'Society', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Un');
        expect(result[0].type).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('attaches Society leftovers only to the top-most group', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM2'),
            createCV('CV1'),
            createCV('CV1'),
        ];

        const result = resolveFromUnits(units, 'Society', 'HW Clan');
        const descendantGroups = collectDescendantGroups(result[0]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Trey');
        expect(result[0].type).toBe('Trey');
        expect(result[0].leftoverUnits?.length).toBe(2);
        expect(result[0].leftoverUnits?.every(unit => unit.type === 'Tank')).toBeTrue();
        expect(descendantGroups.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('returns Force when customMatch enumeration exceeds the cap', () => {
        const warnSpy = spyOn(console, 'warn');
        const units: Unit[] = Array.from({ length: 18 }, (_, index) =>
            createCI(`CI-CAP-${index + 1}`, 'Conventional Infantry', index + 1),
        );

        const result = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Force');
        expect(result[0].type).toBeNull();
        expect(
            warnSpy.calls.allArgs().flatMap(args => args.map(arg => String(arg))).some(message =>
                message.includes('Too many combinations') && message.includes('returning Force'),
            ),
        ).toBeTrue();
    });

    it('does not hit the cap for many conventional infantry with identical trooper counts', () => {
        const warnSpy = spyOn(console, 'warn');
        const units: Unit[] = Array.from({ length: 18 }, (_, index) => createCI(`CI-BUCKET-${index + 1}`));

        const result = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Platoon');
        expect(result[0].type).toBe('Platoon');
        expect(result[0].units?.length).toBe(18);
        expect(
            warnSpy.calls.allArgs().flatMap(args => args.map(arg => String(arg))).some(message =>
                message.includes('Too many combinations'),
            ),
        ).toBeFalse();
    });

    it('does not hit the cap for many battle armor squads with identical trooper counts', () => {
        const warnSpy = spyOn(console, 'warn');
        const units: Unit[] = Array.from({ length: 16 }, (_, index) => createBA(`BA-BUCKET-${index + 1}`, [], 4));

        const result = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBeGreaterThan(0);
        expect(result[0].name).not.toBe('Force');
        expect(result[0].type).not.toBeNull();
        expect(
            warnSpy.calls.allArgs().flatMap(args => args.map(arg => String(arg))).some(message =>
                message.includes('Too many combinations'),
            ),
        ).toBeFalse();
    });

    it('resolves 4 BA troopers as a Single for Inner Sphere orgs', () => {
        const result = resolveFromUnits([createBA('IS-BA-1', [], 4)], 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Single');
        expect(result[0].type).toBe('Single');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 4 conventional infantry troopers as a Squad for Inner Sphere orgs', () => {
        const result = resolveFromUnits([createCI('IS-CI-SQ', 'Conventional Infantry', 4)], 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Squad');
        expect(result[0].type).toBe('Squad');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 10 conventional infantry troopers as a Platoon for Inner Sphere orgs', () => {
        const result = resolveFromUnits([createCI('IS-CI-PL', 'Conventional Infantry', 10)], 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Platoon');
        expect(result[0].type).toBe('Platoon');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 4 conventional infantry troopers as a Squad for Dragoons orgs', () => {
        const result = resolveFromUnits([createCI('WD-CI-SQ-1', 'Conventional Infantry', 4)], 'Wolf Dragoons', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Squad');
        expect(result[0].type).toBe('Squad');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 10 conventional infantry troopers as a Platoon for Dragoons orgs', () => {
        const result = resolveFromUnits([createCI('WD-CI-PL-1', 'Conventional Infantry', 10)], 'Wolf Dragoons', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Platoon');
        expect(result[0].type).toBe('Platoon');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 32 conventional infantry troopers as a Platoon for Dragoons orgs', () => {
        const result = resolveFromUnits([createCI('WD-CI-PL-2', 'Conventional Infantry', 32)], 'Wolf Dragoons', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Platoon');
        expect(result[0].type).toBe('Platoon');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 4 BA troopers as a Single for Capellan orgs', () => {
        const result = resolveFromUnits([createBA('CC-BA-1', [], 4)], 'Capellan Confederation', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Single');
        expect(result[0].type).toBe('Single');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 4 conventional infantry troopers as a Squad for Capellan orgs', () => {
        const result = resolveFromUnits([createCI('CC-CI-SQ', 'Conventional Infantry', 4)], 'Capellan Confederation', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Squad');
        expect(result[0].type).toBe('Squad');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 10 conventional infantry troopers as a Platoon for Capellan orgs', () => {
        const result = resolveFromUnits([createCI('CC-CI-PL', 'Conventional Infantry', 10)], 'Capellan Confederation', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Platoon');
        expect(result[0].type).toBe('Platoon');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('98 BM keeps 14 Sept groups under hierarchical aggregation', () => {
        const units: Unit[] = [];
        for (let i = 0; i < 98; i++) {
            units.push(createBM(`BM${i + 1}`));
        }

        const result = resolveFromUnits(units, 'Society', 'HW Clan', true);

        expect(result.length).toBe(14);
        expect(result.every(group => group.name === 'Sept')).toBeTrue();
        expect(result.every(group => group.type === 'Sept')).toBeTrue();
        expect(result.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('aggregates 14 preserved Sept groups into a 14x Sept display result', () => {
        const units: Unit[] = [];
        for (let i = 0; i < 98; i++) {
            units.push(createBM(`BM${i + 1}`));
        }

        const result = resolveFromUnits(units, 'Society', 'HW Clan', true);
        const aggregated = getAggregatedGroupsResult(result, 'Society', 'HW Clan');

        expect(result.length).toBe(14);
        expect(aggregated.name).toBe('14x Sept');
        expect(aggregated.groups).toBe(result);
        expect(aggregated.groups.length).toBe(14);
        expect(aggregated.groups.every(group => group.name === 'Sept')).toBeTrue();
        expect(aggregated.groups.every(group => group.type === 'Sept')).toBeTrue();
    });

    it('resolves 2 BM plus 1 AF as Air Lance', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createUnit('AF1', 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Air Lance');
        expect(result[0].name).toBe('Air Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('splits interleaved Marian Contubernii into valid same-tier subsets', () => {
        const groupResults: GroupSizeResult[] = [
            createContuberniumGroup(createCV('CV1'), 'non-infantry'),
            createContuberniumGroup(createCI('CI1'), 'infantry'),
            createContuberniumGroup(createCV('CV2'), 'non-infantry'),
            createContuberniumGroup(createCI('CI2'), 'infantry'),
            createContuberniumGroup(createCV('CV3'), 'non-infantry'),
            createContuberniumGroup(createCI('CI3'), 'infantry'),
            createContuberniumGroup(createCV('CV4'), 'non-infantry'),
            createContuberniumGroup(createCI('CI4'), 'infantry'),
            createContuberniumGroup(createCV('CV5'), 'non-infantry'),
        ];

        const result = resolveFromGroups('Marian Hegemony', 'Inner Sphere', groupResults);

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Maniple');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.type === 'Century')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('keeps Inner Sphere repeated group aggregation stable across multiple passes', () => {
        const companyGroups: GroupSizeResult[] = [];

        for (let companyIndex = 0; companyIndex < 9; companyIndex++) {
            const units: Unit[] = [];
            for (let unitIndex = 0; unitIndex < 12; unitIndex++) {
                units.push(createBM(`IS-BM-${companyIndex + 1}-${unitIndex + 1}`));
            }

            const companyResult = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');
            expect(companyResult.length).toBe(1);
            expect(companyResult[0].type).toBe('Company');
            companyGroups.push(companyResult[0]);
        }

        const firstPass = resolveFromGroups('Federated Suns', 'Inner Sphere', companyGroups);
        const secondPass = resolveFromGroups('Federated Suns', 'Inner Sphere', firstPass);
        const thirdPass = resolveFromGroups('Federated Suns', 'Inner Sphere', secondPass);

        for (const pass of [firstPass, secondPass, thirdPass]) {
            expect(pass.length).toBe(1);
            expect(pass[0].name).toBe('Regiment');
            expect(pass[0].type).toBe('Regiment');
            expect(pass[0].children?.length).toBe(3);
            expect(pass[0].children?.every(child => child.type === 'Battalion')).toBeTrue();
            expect(pass[0].leftoverUnits).toBeUndefined();
        }
    });

    it('repeatedly aggregates Inner Sphere Lance and Flight groups up through Air Lances and a Brigade', () => {
        function buildAirLanceCompany(companyIndex: number): GroupSizeResult {
            const airLances: GroupSizeResult[] = [];

            for (let airLanceIndex = 0; airLanceIndex < 3; airLanceIndex++) {
                const lanceUnits: Unit[] = [];
                for (let unitIndex = 0; unitIndex < 4; unitIndex++) {
                    lanceUnits.push(createBM(`IS-L-${companyIndex + 1}-${airLanceIndex + 1}-${unitIndex + 1}`));
                }

                const flightUnits: Unit[] = [
                    createUnit(`IS-AF-${companyIndex + 1}-${airLanceIndex + 1}-1`, 'Aero', 'Aerospace Fighter'),
                    createUnit(`IS-AF-${companyIndex + 1}-${airLanceIndex + 1}-2`, 'Aero', 'Aerospace Fighter'),
                ];

                const lanceResult = resolveFromUnits(lanceUnits, 'Federated Suns', 'Inner Sphere');
                const flightResult = resolveFromUnits(flightUnits, 'Federated Suns', 'Inner Sphere');

                expect(lanceResult.length).toBe(1);
                expect(lanceResult[0].type).toBe('Lance');
                expect(flightResult.length).toBe(1);
                expect(flightResult[0].type).toBe('Flight');

                const airLancePass1 = resolveFromGroups('Federated Suns', 'Inner Sphere', [lanceResult[0], flightResult[0]]);
                const airLancePass2 = resolveFromGroups('Federated Suns', 'Inner Sphere', airLancePass1);
                const airLancePass3 = resolveFromGroups('Federated Suns', 'Inner Sphere', airLancePass2);

                for (const pass of [airLancePass1, airLancePass2, airLancePass3]) {
                    expect(pass.length).toBe(1);
                    expect(pass[0].type).toBe('Air Lance');
                    expect(pass[0].name).toBe('Air Lance');
                    expect(pass[0].children?.length).toBe(2);
                    expect(pass[0].children?.some(child => child.type === 'Lance')).toBeTrue();
                    expect(pass[0].children?.some(child => child.type === 'Flight')).toBeTrue();
                    expect(pass[0].leftoverUnits).toBeUndefined();
                }

                airLances.push(airLancePass3[0]);
            }

            const companyPass1 = resolveFromGroups('Federated Suns', 'Inner Sphere', airLances);
            const companyPass2 = resolveFromGroups('Federated Suns', 'Inner Sphere', companyPass1);
            const companyPass3 = resolveFromGroups('Federated Suns', 'Inner Sphere', companyPass2);

            for (const pass of [companyPass1, companyPass2, companyPass3]) {
                expect(pass.length).toBe(1);
                expect(pass[0].type).toBe('Company');
                expect(pass[0].name).toBe('Company');
                expect(pass[0].children?.length).toBe(3);
                expect(pass[0].children?.every(child => child.type === 'Air Lance')).toBeTrue();
                expect(pass[0].leftoverUnits).toBeUndefined();
            }

            return companyPass3[0];
        }

        function buildBattalion(battalionIndex: number): GroupSizeResult {
            const companies = [
                buildAirLanceCompany(battalionIndex * 3),
                buildAirLanceCompany(battalionIndex * 3 + 1),
                buildAirLanceCompany(battalionIndex * 3 + 2),
            ];

            const battalionPass1 = resolveFromGroups('Federated Suns', 'Inner Sphere', companies);
            const battalionPass2 = resolveFromGroups('Federated Suns', 'Inner Sphere', battalionPass1);
            const battalionPass3 = resolveFromGroups('Federated Suns', 'Inner Sphere', battalionPass2);

            for (const pass of [battalionPass1, battalionPass2, battalionPass3]) {
                expect(pass.length).toBe(1);
                expect(pass[0].name).toBe('Battalion');
                expect(pass[0].type).toBe('Battalion');
                expect(pass[0].children?.length).toBe(3);
                expect(pass[0].children?.every(child => child.type === 'Company')).toBeTrue();
                expect(pass[0].leftoverUnits).toBeUndefined();
            }

            return battalionPass3[0];
        }

        function buildRegiment(regimentIndex: number): GroupSizeResult {
            const battalions = [
                buildBattalion(regimentIndex * 3),
                buildBattalion(regimentIndex * 3 + 1),
                buildBattalion(regimentIndex * 3 + 2),
            ];

            const regimentPass1 = resolveFromGroups('Federated Suns', 'Inner Sphere', battalions);
            const regimentPass2 = resolveFromGroups('Federated Suns', 'Inner Sphere', regimentPass1);
            const regimentPass3 = resolveFromGroups('Federated Suns', 'Inner Sphere', regimentPass2);

            for (const pass of [regimentPass1, regimentPass2, regimentPass3]) {
                expect(pass.length).toBe(1);
                expect(pass[0].name).toBe('Regiment');
                expect(pass[0].type).toBe('Regiment');
                expect(pass[0].children?.length).toBe(3);
                expect(pass[0].children?.every(child => child.type === 'Battalion')).toBeTrue();
                expect(pass[0].leftoverUnits).toBeUndefined();
            }

            return regimentPass3[0];
        }

        const regiments = [
            buildRegiment(0),
            buildRegiment(1),
            buildRegiment(2),
        ];

        const brigadePass1 = resolveFromGroups('Federated Suns', 'Inner Sphere', regiments);
        const brigadePass2 = resolveFromGroups('Federated Suns', 'Inner Sphere', brigadePass1);
        const brigadePass3 = resolveFromGroups('Federated Suns', 'Inner Sphere', brigadePass2);

        for (const pass of [brigadePass1, brigadePass2, brigadePass3]) {
            expect(pass.length).toBe(1);
            expect(pass[0].name).toBe('Brigade');
            expect(pass[0].type).toBe('Brigade');
            expect(pass[0].children?.length).toBe(3);
            expect(pass[0].children?.every(child => child.type === 'Regiment')).toBeTrue();
            expect(pass[0].leftoverUnits).toBeUndefined();
        }
    });

    it('resolves 5 BA (with MEC special) and 5 BM (with OMNI special) into a Nova', () => {
        const units: Unit[] = [
            createBA('BA1', ['MEC'], 5),
            createBA('BA2', ['MEC'], 5),
            createBA('BA3', ['MEC'], 5),
            createBA('BA4', ['MEC'], 5),
            createBA('BA5', ['MEC'], 5),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM2', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM3', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM4', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM5', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Clan Test', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Nova');
        expect(result[0].type).toBe('Nova');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('does not hit the Nova combination cap for a large mixed Clan force without battle armor', () => {
        const warnSpy = spyOn(console, 'warn');
        const units: Unit[] = [
            ...Array.from({ length: 36 }, (_, index) => createBM(`Clan BM ${index + 1}`)),
            ...Array.from({ length: 12 }, (_, index) =>
                createBM(`Clan Omni BM ${index + 1}`, 'BattleMek Omni', true, ['OMNI']),
            ),
            ...Array.from({ length: 18 }, (_, index) => createCV(`Clan CV ${index + 1}`)),
            ...Array.from({ length: 6 }, (_, index) => createCV(`Clan Omni CV ${index + 1}`, true, ['OMNI'])),
            ...Array.from({ length: 12 }, (_, index) =>
                createUnit(`Clan AF ${index + 1}`, 'Aero', 'Aerospace Fighter'),
            ),
            ...Array.from({ length: 6 }, (_, index) =>
                createUnit(`Clan Omni AF ${index + 1}`, 'Aero', 'Aerospace Fighter', true, ['OMNI']),
            ),
            ...Array.from({ length: 8 }, (_, index) => createCI(`Clan CI ${index + 1}`)),
        ];

        const result = resolveFromUnits(units, 'Clan Test', 'HW Clan');
        const allGroups = result.flatMap(group => [group, ...collectDescendantGroups(group)]);
        const warnedMessages = warnSpy.calls.allArgs().flatMap(args => args.map(arg => String(arg)));

        expect(result.length).toBeGreaterThan(0);
        expect(allGroups.some(group => group.type === 'Nova')).toBeFalse();
        expect(
            warnedMessages.some(message =>
                message.includes('Too many combinations') && message.includes('Nova'),
            ),
        ).toBeFalse();
    });
    
    it('resolves 10 BA (with MEC special) and 10 BM (with OMNI special) into a Supernova Binary', () => {
        const units: Unit[] = [
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
            createBM('BM5', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Clan Test', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Supernova Binary');
        expect(result[0].type).toBe('Supernova Binary');
        expect(result[0].leftoverUnits).toBeUndefined();
    });
    
    it('resolves 10BA+10BM and 5BA+5BM in Supernova Trinary', () => {
        const units1: Unit[] = [
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
            createBM('BM5', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result1 = resolveFromUnits(units1, 'Clan Test', 'HW Clan');
        
        expect(result1.length).toBe(1);
        expect(result1[0].name).toBe('Supernova Binary');
        expect(result1[0].type).toBe('Supernova Binary');
        expect(result1[0].leftoverUnits).toBeUndefined();

        const units2: Unit[] = [
            createBA('BA1', ['MEC'], 5),
            createBA('BA2', ['MEC'], 5),
            createBA('BA3', ['MEC'], 5),
            createBA('BA4', ['MEC'], 5),
            createBA('BA5', ['MEC'], 5),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM2', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM3', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM4', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM5', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result2 = resolveFromUnits(units2, 'Clan Test', 'HW Clan');

        expect(result2.length).toBe(1);
        expect(result2[0].name).toBe('Nova');
        expect(result2[0].type).toBe('Nova');
        expect(result2[0].leftoverUnits).toBeUndefined();

        const result3 = resolveFromGroups('Clan Test', 'HW Clan', [
            result1[0],
            result2[0],
        ]);

        expect(result3.length).toBe(1);
        expect(result3[0].name).toBe('Supernova Trinary');
        expect(result3[0].type).toBe('Supernova Trinary');
        expect(result3[0].leftoverUnits).toBeUndefined();
        expect(result3[0].children?.length).toBe(2);
    });
    
    it('resolves 5 BA (MEC/XMEC) and 5 BM (OMNI and not) into a Nova', () => {
        const units: Unit[] = [
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBA('BA2', ['XMEC'], 5),
            createBA('BA2', ['XMEC'], 5),
            createBA('BA3', ['XMEC'], 5),
            createBM('BM1', 'BattleMek Omni'),
            createBM('BM2', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni'),
            createBM('BM2', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM2', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Clan Test', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Nova');
        expect(result[0].type).toBe('Nova');
        expect(result[0].leftoverUnits).toBeUndefined();
    });


    it('resolves 5 BA (with MEC special) and 6 BM (with OMNI special) into a Binary instead of Nova', () => {
        const units: Unit[] = [
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Clan Test', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Binary');
        expect(result[0].type).toBe('Binary');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 10 BM and 5 full BA squads into a Trinary (Star+Star+Star) instead of a Binary (Nova+Star)', () => {
        const units: Unit[] = [
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBA('BA1', ['MEC'], 5),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI']),
            createBM('BM1', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Clan Test', 'HW Clan');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Trinary');
        expect(result[0].type).toBe('Trinary');
        expect(result[0].leftoverUnits).toBeUndefined();
        expect(result[0].children?.length).toBe(3);
        expect(result[0].children?.every(child => child.type === 'Star')).toBeTrue();
    });

    it('resolves the Blunder Brigade 7415 Wolf\'s Dragoons force without freezing', () => {
        const { groupResults, result } = resolveBlunderBrigadeForce();

        expect(groupResults.length).toBeGreaterThan(0);
        expect(result.length).toBeGreaterThan(0);
        expect(result.every(group => group.name.length > 0)).toBeTrue();
    });

    it('resolves the Blunder Brigade 7415 Wolf\'s Dragoons force within the performance guardrail', () => {
        const startedAt = Date.now();
        const { groupResults, result } = resolveBlunderBrigadeForce();
        const elapsedMs = Date.now() - startedAt;

        expect(groupResults.length).toBeGreaterThan(0);
        expect(result.length).toBeGreaterThan(0);
        expect(elapsedMs).toBeLessThan(BLUNDER_BRIGADE_MAX_SOLVE_MS);
    });

    it('crossgrades foreign groups to the nearest dynamic-tier modifier in the target org', () => {
        const result = resolveFromGroups('Federated Suns', 'Inner Sphere', [
            createForeignGroup('Sept', 'Sept', 1.6),
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].tier).toBeCloseTo(1.5, 5);
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('crossgrades a real resolved foreign group through the public APIs', () => {
        const sourceUnits: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createBM('BM3'),
            createBM('BM4'),
            createBM('BM5'),
            createBM('BM6'),
            createBM('BM7'),
        ];

        const foreignGroup = resolveFromUnits(sourceUnits, 'Society', 'HW Clan');

        expect(foreignGroup.length).toBe(1);
        expect(foreignGroup[0].name).toBe('Sept');
        expect(foreignGroup[0].type).toBe('Sept');

        const result = resolveFromGroups('Federated Suns', 'Inner Sphere', foreignGroup);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].tier).toBeCloseTo(1.5, 5);
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('re-evaluates each foreign parent group independently before upward composition', () => {
        const result = resolveFromGroups('Federated Suns', 'Inner Sphere', [
            createForeignGroup('Foreign Cell A', null, 1, null, [
                createBM('BM1'),
                createBM('BM2'),
                createBM('BM3'),
            ]),
            createForeignGroup('Foreign Cell B', null, 1, null, [
                createBM('BM4'),
                createBM('BM5'),
                createBM('BM6'),
            ]),
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.name === 'Under-Strength Lance')).toBeTrue();
        expect(result[0].children?.every(child => child.type === 'Lance')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('re-evaluates real Sept groups independently before composing them upward', () => {
        const firstSept = resolveFromUnits([
            createBM('FS-A1'),
            createBM('FS-A2'),
            createBM('FS-A3'),
            createBM('FS-A4'),
            createBM('FS-A5'),
            createBM('FS-A6'),
            createBM('FS-A7'),
        ], 'Society', 'HW Clan');
        const secondSept = resolveFromUnits([
            createBM('FS-B1'),
            createBM('FS-B2'),
            createBM('FS-B3'),
            createBM('FS-B4'),
            createBM('FS-B5'),
            createBM('FS-B6'),
            createBM('FS-B7'),
        ], 'Society', 'HW Clan');

        expect(firstSept.length).toBe(1);
        expect(firstSept[0].name).toBe('Sept');
        expect(firstSept[0].type).toBe('Sept');
        expect(secondSept.length).toBe(1);
        expect(secondSept[0].name).toBe('Sept');
        expect(secondSept[0].type).toBe('Sept');

        const result = resolveFromGroups('Federated Suns', 'Inner Sphere', [
            firstSept[0],
            secondSept[0],
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Battalion');
        expect(result[0].type).toBe('Battalion');
        expect(result[0].modifierKey).toBe('Under-Strength ');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.name === 'Under-Strength Company')).toBeTrue();
        expect(result[0].children?.every(child => child.type === 'Company')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('re-evaluates real Sept groups independently before composing them upward for Clan', () => {
        const firstSept = resolveFromUnits([
            createBM('CL-A1'),
            createBM('CL-A2'),
            createBM('CL-A3'),
            createBM('CL-A4'),
            createBM('CL-A5'),
            createBM('CL-A6'),
            createBM('CL-A7'),
        ], 'Society', 'HW Clan');
        const secondSept = resolveFromUnits([
            createBM('CL-B1'),
            createBM('CL-B2'),
            createBM('CL-B3'),
            createBM('CL-B4'),
            createBM('CL-B5'),
            createBM('CL-B6'),
            createBM('CL-B7'),
        ], 'Society', 'HW Clan');

        expect(firstSept.length).toBe(1);
        expect(firstSept[0].name).toBe('Sept');
        expect(firstSept[0].type).toBe('Sept');
        expect(secondSept.length).toBe(1);
        expect(secondSept[0].name).toBe('Sept');
        expect(secondSept[0].type).toBe('Sept');

        const result = resolveFromGroups('Clan Coyote', 'HW Clan', [
            firstSept[0],
            secondSept[0],
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Cluster');
        expect(result[0].type).toBe('Cluster');
        expect(result[0].modifierKey).toBe('Under-Strength ');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.name === 'Binary')).toBeTrue();
        expect(result[0].children?.every(child => child.type === 'Binary')).toBeTrue();
        expect(result[0].children?.every(child => child.modifierKey === '')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('crossgrades to the nearest target tier when a foreign tier sits between lower and upper targets', () => {
        const result = resolveFromGroups('Federated Suns', 'Inner Sphere', [
            createForeignGroup('Supernova Binary', 'Supernova Trinary', 2.5),
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Battalion');
        expect(result[0].type).toBe('Battalion');
        expect(result[0].tier).toBeCloseTo(2.63, 2);
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('rounds crossgrade when a foreign tier matches target tier', () => {
        const result = resolveFromGroups('Federated Suns', 'Inner Sphere', [
            createForeignGroup('Level IV', 'Level IV', 3),
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Battalion');
        expect(result[0].type).toBe('Battalion');
        expect(result[0].tier).toBeCloseTo(3, 5);
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('re-evaluates incompatible foreign units instead of tier-normalizing them', () => {
        const result = resolveFromGroups('Federated Suns', 'Inner Sphere', [
            createForeignGroup('Foreign Vehicle Cell', 'Force', 1, null, [createCV('CV1')]),
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Single');
        expect(result[0].type).toBe('Single');
        expect(result[0].tier).toBe(0);
    });

    it('crossgrades one tier above the target org ceiling into three highest-tier synthetic groups', () => {
        const result = resolveFromGroups('Society', 'HW Clan', [
            createForeignGroup('Foreign Apex Group', 'Force', 2.6),
        ]);

        expect(result.length).toBe(3);
        expect(result.every(group => group.name === 'Sept')).toBeTrue();
        expect(result.every(group => group.type === 'Sept')).toBeTrue();
        expect(result.every(group => group.tier === 1.6)).toBeTrue();
        expect(result.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('crossgrades two tiers above the target org ceiling into nine highest-tier synthetic groups', () => {
        const result = resolveFromGroups('Society', 'HW Clan', [
            createForeignGroup('Foreign Apex Group', 'Force', 3.6),
        ]);

        expect(result.length).toBe(9);
        expect(result.every(group => group.name === 'Sept')).toBeTrue();
        expect(result.every(group => group.type === 'Sept')).toBeTrue();
        expect(result.every(group => group.tier === 1.6)).toBeTrue();
        expect(result.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

});