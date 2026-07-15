import type { Unit } from '../models/units.model';

type TestAlphaStrikeOverrides = Partial<Omit<Unit['as'], 'dmg'>> & {
    dmg?: Partial<Unit['as']['dmg']>;
};

export type TestUnitOverrides = Partial<Omit<Unit, 'as'>> & {
    as?: TestAlphaStrikeOverrides;
};

function createEmptyAlphaStrikeStats(overrides: TestAlphaStrikeOverrides = {}): Unit['as'] {
    const base: Unit['as'] = {
        TP: 'BM',
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
    };

    return {
        ...base,
        ...overrides,
        MVm: overrides.MVm ? { ...overrides.MVm } : base.MVm,
        specials: overrides.specials ? [...overrides.specials] : base.specials,
        dmg: {
            ...base.dmg,
            ...overrides.dmg,
        },
    };
}

export function createEmptyUnit(overrides: TestUnitOverrides = {}): Unit {
    const { as: asOverrides, ...unitOverrides } = overrides;
    const unit: Unit = {
        name: 'Test Unit',
        id: -1,
        chassis: 'Test',
        model: 'TST-1',
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
        type: 'Mek',
        subtype: 'BattleMek',
        omni: 0,
        engine: 'Fusion',
        engineRating: 0,
        engineHS: 0,
        engineHSType: 'Heat Sink',
        source: [],
        published: [],
        canon: true,
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
        as: createEmptyAlphaStrikeStats(asOverrides),
        _searchKey: '',
        _displayType: '',
        _maxRange: 0,
        _weightedMaxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
        ...unitOverrides,
    };

    unit.source = unitOverrides.source ? [...unitOverrides.source] : [];
    unit.published = unitOverrides.published ? [...unitOverrides.published] : [];
    unit.comp = unitOverrides.comp ? [...unitOverrides.comp] : [];
    unit.quirks = unitOverrides.quirks ? [...unitOverrides.quirks] : [];
    unit.features = unitOverrides.features ? [...unitOverrides.features] : [];
    unit.sheets = unitOverrides.sheets ? [...unitOverrides.sheets] : [];
    unit._nameTags = unitOverrides._nameTags ? [...unitOverrides._nameTags] : [];
    unit._chassisTags = unitOverrides._chassisTags ? [...unitOverrides._chassisTags] : [];

    return unit;
}