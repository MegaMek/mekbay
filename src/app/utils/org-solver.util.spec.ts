import type { Unit } from '../models/units.model';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import type { GroupSizeResult } from './org-types';

function createUnit(id: number, type: Unit['type'], subtype: Unit['subtype'], isOmni: boolean = false, specials: string[] = []): Unit {
    return {
        name: `unit-${id}`,
        id,
        chassis: `Chassis ${id}`,
        model: `Model ${id}`,
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
        internal: 1,
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
            createUnit(1, 'Tank', 'Combat Vehicle'),
            createUnit(2, 'Tank', 'Combat Vehicle'),
            createUnit(3, 'Tank', 'Combat Vehicle'),
            createUnit(4, 'Tank', 'Combat Vehicle'),
            createUnit(5, 'Mek', 'BattleMek'),
            createUnit(6, 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Capellan Confederation');

        expect(result[0].type).toBe('Augmented Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('prefers a complete Capellan company over an Augmented Lance with leftovers', () => {
        const units: Unit[] = [
            createUnit(1, 'Tank', 'Combat Vehicle'),
            createUnit(2, 'Tank', 'Combat Vehicle'),
            createUnit(3, 'Tank', 'Combat Vehicle'),
            createUnit(4, 'Tank', 'Combat Vehicle'),
            createUnit(5, 'Mek', 'BattleMek'),
            createUnit(6, 'Mek', 'BattleMek'),
            createUnit(7, 'Mek', 'BattleMek'),
            createUnit(8, 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Capellan Confederation');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Company');
        expect(result[0].leftoverUnits).toBeUndefined();
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.type === 'Lance')).toBeTrue();
    });
    
    it('leftovers only to the top-most group', () => {
        const units: Unit[] = [
            createUnit(1, 'Tank', 'Combat Vehicle'),
            createUnit(2, 'Tank', 'Combat Vehicle'),
            createUnit(3, 'Tank', 'Combat Vehicle'),
            createUnit(4, 'Tank', 'Combat Vehicle'),
            createUnit(5, 'Mek', 'BattleMek'),
            createUnit(6, 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');
        const descendantGroups = collectDescendantGroups(result[0]);

        expect(result[0].name).toBe('2x Trey');
        expect(result[0].type).toBe('Trey');
        expect(result[0].leftoverUnits?.length).toBe(1);
        expect(result[0].leftoverUnits?.[0].type).toBe('Mek');
        expect(descendantGroups.every(group => group.leftoverUnits === undefined)).toBeTrue();
    });

    it('preserves leftover count when duplicate instances share the same Unit reference', () => {
        const sharedMek = createUnit(5, 'Mek', 'BattleMek');
        sharedMek.name = 'shared-mek';

        const units: Unit[] = [
            createUnit(1, 'Tank', 'Combat Vehicle'),
            createUnit(2, 'Tank', 'Combat Vehicle'),
            createUnit(3, 'Tank', 'Combat Vehicle'),
            createUnit(4, 'Tank', 'Combat Vehicle'),
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
            createUnit(1, 'Mek', 'BattleMek'),
            createUnit(2, 'Mek', 'BattleMek'),
            createUnit(3, 'Aero', 'Aerospace Fighter'),
            createUnit(4, 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Federated Suns');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Air Lance');
        expect(result[0].name).toBe('Air Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 1 AF as Under-Strength Flight', () => {
        const units: Unit[] = [
            createUnit(1, 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Federated Suns');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Flight');
        expect(result[0].name).toBe('Under-Strength Flight');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 1 BM in Society as Un', () => {
        const units: Unit[] = [
            createUnit(1, 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Society');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Un');
        expect(result[0].name).toBe('Un');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('resolves 2 BM plus 1 AF as Air Lance', () => {
        const units: Unit[] = [
            createUnit(1, 'Mek', 'BattleMek'),
            createUnit(2, 'Mek', 'BattleMek'),
            createUnit(3, 'Aero', 'Aerospace Fighter'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Federated Suns');

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Air Lance');
        expect(result[0].name).toBe('Air Lance');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('splits interleaved Marian Contubernia into valid same-tier subsets', () => {
        const groupResults: GroupSizeResult[] = [
            createContuberniumGroup(createUnit(1, 'Tank', 'Combat Vehicle'), 'non-infantry'),
            createContuberniumGroup(createUnit(2, 'Infantry', 'Conventional Infantry'), 'infantry'),
            createContuberniumGroup(createUnit(3, 'Tank', 'Combat Vehicle'), 'non-infantry'),
            createContuberniumGroup(createUnit(4, 'Infantry', 'Conventional Infantry'), 'infantry'),
            createContuberniumGroup(createUnit(5, 'Tank', 'Combat Vehicle'), 'non-infantry'),
            createContuberniumGroup(createUnit(6, 'Infantry', 'Conventional Infantry'), 'infantry'),
            createContuberniumGroup(createUnit(7, 'Tank', 'Combat Vehicle'), 'non-infantry'),
            createContuberniumGroup(createUnit(8, 'Infantry', 'Conventional Infantry'), 'infantry'),
            createContuberniumGroup(createUnit(9, 'Tank', 'Combat Vehicle'), 'non-infantry'),
        ];

        const result = resolveFromGroups('Inner Sphere', 'Marian Hegemony', groupResults);

        expect(result.length).toBe(1);
        expect(result[0].type).toBe('Maniple');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].children?.every(child => child.type === 'Century')).toBeTrue();
        expect(result[0].leftoverUnits).toBeUndefined();
    });
});