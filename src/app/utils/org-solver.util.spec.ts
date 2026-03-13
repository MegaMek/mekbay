import type { Unit } from '../models/units.model';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import type { GroupSizeResult } from './org-types';

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

function createContuberniumGroup(unit: Unit, tag: 'infantry' | 'non-infantry'): GroupSizeResult {
    return {
        name: 'Contubernium',
        type: 'Contubernium',
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
        countsAsType,
        tier,
        units,
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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Random Inner Sphere Faction');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Random Inner Sphere Faction');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Random Inner Sphere Faction');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Random Inner Sphere Faction');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Random Inner Sphere Faction');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Random Inner Sphere Faction');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Capellan Confederation');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Capellan Confederation');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Federated Suns');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Air Lance');
        expect(result[0].name).toBe('Air Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 1 AF as Under-Strength Flight', () => {
        const units: Unit[] = [
            createUnit('AF1', 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Federated Suns');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Flight');
        expect(result[0].name).toBe('Under-Strength Flight');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 1 BM in Society as Un', () => {
        const units: Unit[] = [
            createBM('BM1'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Un');
        expect(result[0].type).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 3 battle armor troopers in Society as Un', () => {
        const battleArmor = createBA('BA1', [], 3);

        const result = resolveFromUnits([battleArmor], 'Inner Sphere', 'Society');

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

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');
        const descendantGroups = collectDescendantGroups(result[0]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Trey');
        expect(result[0].type).toBe('Trey');
        expect(result[0].leftoverUnits?.length).toBe(2);
        expect(result[0].leftoverUnits?.every(unit => unit.type === 'Tank')).toBeTrue();
        expect(descendantGroups.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('98 BM makes 14x Sept', () => {
        const units: Unit[] = [];
        for (let i = 0; i < 98; i++) {
            units.push(createBM(`BM${i + 1}`));
        }

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society', true);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('14x Sept');
        expect(result[0].type).toBe('Sept');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 2 BM plus 1 AF as Air Lance', () => {
        const units: Unit[] = [
            createBM('BM1'),
            createBM('BM2'),
            createUnit('AF1', 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Federated Suns');

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

        const result = resolveFromGroups('Inner Sphere', 'Marian Hegemony', groupResults);

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

            const companyResult = resolveFromUnits(units, 'Inner Sphere', 'Federated Suns');
            expect(companyResult.length).toBe(1);
            expect(companyResult[0].type).toBe('Company');
            companyGroups.push(companyResult[0]);
        }

        const firstPass = resolveFromGroups('Inner Sphere', 'Federated Suns', companyGroups);
        const secondPass = resolveFromGroups('Inner Sphere', 'Federated Suns', firstPass);
        const thirdPass = resolveFromGroups('Inner Sphere', 'Federated Suns', secondPass);

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

                const lanceResult = resolveFromUnits(lanceUnits, 'Inner Sphere', 'Federated Suns');
                const flightResult = resolveFromUnits(flightUnits, 'Inner Sphere', 'Federated Suns');

                expect(lanceResult.length).toBe(1);
                expect(lanceResult[0].type).toBe('Lance');
                expect(flightResult.length).toBe(1);
                expect(flightResult[0].type).toBe('Flight');

                const airLancePass1 = resolveFromGroups('Inner Sphere', 'Federated Suns', [lanceResult[0], flightResult[0]]);
                const airLancePass2 = resolveFromGroups('Inner Sphere', 'Federated Suns', airLancePass1);
                const airLancePass3 = resolveFromGroups('Inner Sphere', 'Federated Suns', airLancePass2);

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

            const companyPass1 = resolveFromGroups('Inner Sphere', 'Federated Suns', airLances);
            const companyPass2 = resolveFromGroups('Inner Sphere', 'Federated Suns', companyPass1);
            const companyPass3 = resolveFromGroups('Inner Sphere', 'Federated Suns', companyPass2);

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

            const battalionPass1 = resolveFromGroups('Inner Sphere', 'Federated Suns', companies);
            const battalionPass2 = resolveFromGroups('Inner Sphere', 'Federated Suns', battalionPass1);
            const battalionPass3 = resolveFromGroups('Inner Sphere', 'Federated Suns', battalionPass2);

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

            const regimentPass1 = resolveFromGroups('Inner Sphere', 'Federated Suns', battalions);
            const regimentPass2 = resolveFromGroups('Inner Sphere', 'Federated Suns', regimentPass1);
            const regimentPass3 = resolveFromGroups('Inner Sphere', 'Federated Suns', regimentPass2);

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

        const brigadePass1 = resolveFromGroups('Inner Sphere', 'Federated Suns', regiments);
        const brigadePass2 = resolveFromGroups('Inner Sphere', 'Federated Suns', brigadePass1);
        const brigadePass3 = resolveFromGroups('Inner Sphere', 'Federated Suns', brigadePass2);

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

        const result = resolveFromUnits(units, 'Clan', 'Clan Test');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Nova');
        expect(result[0].type).toBe('Nova');
        expect(result[0].leftoverUnits).toBeUndefined();
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

        const result = resolveFromUnits(units, 'Clan', 'Clan Test');

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

        const result1 = resolveFromUnits(units1, 'Clan', 'Clan Test');
        
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

        const result2 = resolveFromUnits(units2, 'Clan', 'Clan Test');

        expect(result2.length).toBe(1);
        expect(result2[0].name).toBe('Nova');
        expect(result2[0].type).toBe('Nova');
        expect(result2[0].leftoverUnits).toBeUndefined();

        const result3 = resolveFromGroups('Clan', 'Clan Test', [
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

        const result = resolveFromUnits(units, 'Clan', 'Clan Test');

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

        const result = resolveFromUnits(units, 'Clan', 'Clan Test');

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

        const result = resolveFromUnits(units, 'Clan', 'Clan Test');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Trinary');
        expect(result[0].type).toBe('Trinary');
        expect(result[0].leftoverUnits).toBeUndefined();
        expect(result[0].children?.length).toBe(3);
        expect(result[0].children?.every(child => child.type === 'Star')).toBeTrue();
    });

    it('crossgrades foreign groups to the nearest dynamic-tier modifier in the target org', () => {
        const result = resolveFromGroups('Inner Sphere', 'Federated Suns', [
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

        const foreignGroup = resolveFromUnits(sourceUnits, 'Inner Sphere', 'Society');

        expect(foreignGroup.length).toBe(1);
        expect(foreignGroup[0].name).toBe('Sept');
        expect(foreignGroup[0].type).toBe('Sept');

        const result = resolveFromGroups('Inner Sphere', 'Federated Suns', foreignGroup);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].tier).toBeCloseTo(1.5, 5);
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('re-evaluates all units from foreign groups together before falling back to tier crossgrading', () => {
        const result = resolveFromGroups('Inner Sphere', 'Federated Suns', [
            createForeignGroup('Foreign Cell A', 'Sept', 1, null, [
                createBM('BM1'),
                createBM('BM2'),
                createBM('BM3'),
            ]),
            createForeignGroup('Foreign Cell B', 'Sept', 1, null, [
                createBM('BM4'),
                createBM('BM5'),
                createBM('BM6'),
            ]),
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Fortified Lance');
        expect(result[0].type).toBe('Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('rounds crossgrade ties downward when a foreign tier sits between lower and upper targets', () => {
        const result = resolveFromGroups('Inner Sphere', 'Federated Suns', [
            createForeignGroup('Level IV', 'Level IV', ((11 / 3) + 4) / 2),
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Battalion');
        expect(result[0].type).toBe('Battalion');
        expect(result[0].tier).toBeCloseTo(11 / 3, 5);
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('re-evaluates incompatible foreign units instead of tier-normalizing them', () => {
        const result = resolveFromGroups('Inner Sphere', 'Federated Suns', [
            createForeignGroup('Foreign Vehicle Cell', 'Force', 1, null, [createCV('CV1')]),
        ]);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Single');
        expect(result[0].type).toBe('Single');
        expect(result[0].tier).toBe(0);
    });

    it('crossgrades one tier above the target org ceiling into three highest-tier synthetic groups', () => {
        const result = resolveFromGroups('Inner Sphere', 'Society', [
            createForeignGroup('Foreign Apex Group', 'Force', 2.6),
        ]);

        expect(result.length).toBe(3);
        expect(result.every(group => group.name === 'Sept')).toBeTrue();
        expect(result.every(group => group.type === 'Sept')).toBeTrue();
        expect(result.every(group => group.tier === 1.6)).toBeTrue();
        expect(result.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('crossgrades two tiers above the target org ceiling into nine highest-tier synthetic groups', () => {
        const result = resolveFromGroups('Inner Sphere', 'Society', [
            createForeignGroup('Foreign Apex Group', 'Force', 3.6),
        ]);

        expect(result.length).toBe(9);
        expect(result.every(group => group.name === 'Sept')).toBeTrue();
        expect(result.every(group => group.type === 'Sept')).toBeTrue();
        expect(result.every(group => group.tier === 1.6)).toBeTrue();
        expect(result.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

});