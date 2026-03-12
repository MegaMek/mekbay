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

function collectDescendantGroups(group: GroupSizeResult): GroupSizeResult[] {
    const children = group.children ?? [];
    return children.flatMap(child => [child, ...collectDescendantGroups(child)]);
}

describe('resolveFromUnits', () => {

    it('resolves 4 CV and 2 BM to an Augmented Lance', () => {
        const units: Unit[] = [
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV2', 'Tank', 'Combat Vehicle'),
            createUnit('CV2', 'Tank', 'Combat Vehicle'),
            createUnit('BM1', 'Mek', 'BattleMek'),
            createUnit('BM2', 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Capellan Confederation');

        expect(result[0].type).toBe('Augmented Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('prefers a complete Capellan company over an Augmented Lance with leftovers', () => {
        const units: Unit[] = [
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV2', 'Tank', 'Combat Vehicle'),
            createUnit('CV3', 'Tank', 'Combat Vehicle'),
            createUnit('CV3', 'Tank', 'Combat Vehicle'),
            createUnit('BM1', 'Mek', 'BattleMek'),
            createUnit('BM2', 'Mek', 'BattleMek'),
            createUnit('BM3', 'Mek', 'BattleMek'),
            createUnit('BM4', 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Capellan Confederation');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].leftoverUnits).toBeUndefined();
        expect(result[0].children?.length).toBe(2);
    });
    
    it('preserves leftover count when duplicate instances share the same Unit reference', () => {
        const sharedMek = createUnit('BM1', 'Mek', 'BattleMek');
        sharedMek.name = 'shared-mek';

        const units: Unit[] = [
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV2', 'Tank', 'Combat Vehicle'),
            createUnit('CV3', 'Tank', 'Combat Vehicle'),
            createUnit('CV4', 'Tank', 'Combat Vehicle'),
            sharedMek,
            sharedMek,
            sharedMek,
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Capellan Confederation');

        expect(result[0].type).toBe('Augmented Lance');
        expect(result[0].leftoverUnits?.length).toBe(1);
        expect(result[0].leftoverUnits?.[0]).toBe(sharedMek);
    });

    it('prefers Air Lance over Under-Strength Company for 2 BM plus 2 AF', () => {
        const units: Unit[] = [
            createUnit('BM1', 'Mek', 'BattleMek'),
            createUnit('BM2', 'Mek', 'BattleMek'),
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
            createUnit('BM1', 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Un');
        expect(result[0].name).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 2 BM in Society as 2x Un', () => {
        const units: Unit[] = [
            createUnit('BM1', 'Mek', 'BattleMek'),
            createUnit('BM2', 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

        expect(result.length).toBe(2);
        expect(result.every(group => group.type === 'Un')).toBeTrue();
        expect(result.every(group => group.name === 'Un')).toBeTrue();
        expect(result.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('resolves 3 BM in Society as Trey', () => {
        const units: Unit[] = [
            createUnit('BM1', 'Mek', 'BattleMek'),
            createUnit('BM1', 'Mek', 'BattleMek'),
            createUnit('BM2', 'Mek', 'BattleMek'),
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
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV2', 'Tank', 'Combat Vehicle'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Un');
        expect(result[0].type).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 3 CI platoons in Society as Un', () => {
        const units: Unit[] = [
            createUnit('CI1', 'Infantry', 'Conventional Infantry'),
            createUnit('CI1', 'Infantry', 'Conventional Infantry'),
            createUnit('CI1', 'Infantry', 'Conventional Infantry'),
        ];

        units.forEach(u => u.internal = 25);

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Un');
        expect(result[0].type).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 3 battle armor troopers in Society as Un', () => {
        const battleArmor = createUnit('BA1', 'Infantry', 'Battle Armor', false, [], 3);

        const result = resolveFromUnits([battleArmor], 'Inner Sphere', 'Society');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Un');
        expect(result[0].type).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('attaches Society leftovers only to the top-most group', () => {
        const units: Unit[] = [
            createUnit('BM1', 'Mek', 'BattleMek'),
            createUnit('BM2', 'Mek', 'BattleMek'),
            createUnit('BM2', 'Mek', 'BattleMek'),
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
            createUnit('CV1', 'Tank', 'Combat Vehicle'),
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

    it('resolves 2 BM plus 1 AF as Air Lance', () => {
        const units: Unit[] = [
            createUnit('BM1', 'Mek', 'BattleMek'),
            createUnit('BM2', 'Mek', 'BattleMek'),
            createUnit('AF1', 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Federated Suns');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Air Lance');
        expect(result[0].name).toBe('Air Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('splits interleaved Marian Contubernia into valid same-tier subsets', () => {
        const groupResults: GroupSizeResult[] = [
            createContuberniumGroup(createUnit('CV1', 'Tank', 'Combat Vehicle'), 'non-infantry'),
            createContuberniumGroup(createUnit('CI1', 'Infantry', 'Conventional Infantry'), 'infantry'),
            createContuberniumGroup(createUnit('CV2', 'Tank', 'Combat Vehicle'), 'non-infantry'),
            createContuberniumGroup(createUnit('CI2', 'Infantry', 'Conventional Infantry'), 'infantry'),
            createContuberniumGroup(createUnit('CV3', 'Tank', 'Combat Vehicle'), 'non-infantry'),
            createContuberniumGroup(createUnit('CI3', 'Infantry', 'Conventional Infantry'), 'infantry'),
            createContuberniumGroup(createUnit('CV4', 'Tank', 'Combat Vehicle'), 'non-infantry'),
            createContuberniumGroup(createUnit('CI4', 'Infantry', 'Conventional Infantry'), 'infantry'),
            createContuberniumGroup(createUnit('CV5', 'Tank', 'Combat Vehicle'), 'non-infantry'),
        ];

        const result = resolveFromGroups('Inner Sphere', 'Marian Hegemony', groupResults);

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Maniple');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.type === 'Century')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 5 BA (with MEC special) and 5 BM (with OMNI special) into a Nova', () => {
        const units: Unit[] = [
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA2', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA3', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA4', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA5', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM2', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM3', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM4', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM5', 'Mek', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Clan Test');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Nova');
        expect(result[0].type).toBe('Nova');
        expect(result[0].leftoverUnits).toBeUndefined();
    });
    
    it('resolves 5 BA (MEC/XMEC) and 5 BM (OMNI and not) into a Nova', () => {
        const units: Unit[] = [
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA2', 'Infantry', 'Battle Armor', false, ['XMEC']),
            createUnit('BA3', 'Infantry', 'Battle Armor', false, ['XMEC']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', false),
            createUnit('BM2', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', false),
            createUnit('BM2', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM2', 'Mek', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Clan Test');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Nova');
        expect(result[0].type).toBe('Nova');
        expect(result[0].leftoverUnits).toBeUndefined();
    });


    it('resolves 5 BA (with MEC special) and 6 BM (with OMNI special) into a Binary instead of Nova', () => {
        const units: Unit[] = [
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Clan Test');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Binary');
        expect(result[0].type).toBe('Binary');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 10 BM and 5 BA into a Trinary instead of a Binary promoted by internal Nova priority', () => {
        const units: Unit[] = [
            createUnit('BA1', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA2', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA3', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA4', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BA5', 'Infantry', 'Battle Armor', false, ['MEC']),
            createUnit('BM1', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM2', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM3', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM4', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM5', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM6', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM7', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM8', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM9', 'Mek', 'BattleMek Omni', true, ['OMNI']),
            createUnit('BM10', 'Mek', 'BattleMek Omni', true, ['OMNI'])
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Clan Test');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Trinary');
        expect(result[0].type).toBe('Trinary');
        expect(result[0].leftoverUnits).toBeUndefined();
    });
});