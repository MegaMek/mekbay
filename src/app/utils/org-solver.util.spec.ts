import type { Unit } from '../models/units.model';
import { resolveFromUnits } from './org-solver.util';

function createUnit(id: number, type: Unit['type'], subtype: Unit['subtype']): Unit {
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
        omni: 0,
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
        _displayType: '',
        _maxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
    };
}

describe('resolveFromUnits', () => {
    it('prefers a complete Capellan company over an augmented lance with leftovers', () => {
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

    it('attaches leftover units only to the topmost result', () => {
        const units: Unit[] = [
            createUnit(1, 'Tank', 'Combat Vehicle'),
            createUnit(2, 'Tank', 'Combat Vehicle'),
            createUnit(3, 'Tank', 'Combat Vehicle'),
            createUnit(4, 'Tank', 'Combat Vehicle'),
            createUnit(5, 'Mek', 'BattleMek'),
            createUnit(6, 'Mek', 'BattleMek'),
            createUnit(7, 'Mek', 'BattleMek'),
        ];

        const result = resolveFromUnits(units, 'Inner Sphere', 'Capellan Confederation');

        expect(result[0].type).toBe('Augmented Lance');
        expect(result[0].leftoverUnits?.map(unit => unit.id)).toEqual([7]);
        expect(result.slice(1).every(group => group.leftoverUnits === undefined)).toBeTrue();
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
});