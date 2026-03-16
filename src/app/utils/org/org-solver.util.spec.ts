import type { ASUnitTypeCode, MoveType, Unit, UnitSubtype, UnitType } from '../../models/units.model';
import {
    CC_AUGMENTED_LANCE,
    CLAN_CI_POINT,
    CLAN_CI_SQUAD,
    CLAN_CLUSTER,
    CLAN_CORE_ORG,
    CLAN_NOVA,
    CLAN_POINT,
    CLAN_SUPERNOVA_TRINARY,
    CLAN_TRINARY,
    COMSTAR_CHOIR,
    COMSTAR_CI_SQUAD,
    COMSTAR_CORE_ORG,
    COMSTAR_LEVEL_I_FROM_SQUADS,
    COMSTAR_LEVEL_II,
    IS_AIR_LANCE,
    IS_BA_SQUAD,
    IS_COMPANY,
    IS_CORE_ORG,
    IS_FLIGHT,
    IS_LANCE,
    IS_PLATOON,
    IS_SQUAD,
    MH_CENTURY_INFANTRY,
    MH_CENTURY_NON_INFANTRY,
    MH_LEGION,
    MH_CORE_ORG,
    SOCIETY_CORE_ORG,
    SOCIETY_SEPT,
    SOCIETY_TREY,
    WD_BATTALION,
    WD_COMPANY,
    WD_CORE_ORG,
    WD_LANCE,
    WD_NOVA,
    WD_POINT,
    WD_SINGLE,
} from './definitions';
import {
    compileGroupFacts,
    compileGroupFactsList,
    compileUnitFactsList,
    DEFAULT_ORG_RULE_REGISTRY,
} from './org-facts.util';
import {
    DEFAULT_ORG_SPEC,
    resolveOrgDefinitionSpec,
} from './org-registry.util';
import {
    evaluateComposedCountRule,
    evaluateFactionOrgDefinition,
    evaluateLeafCountRule,
    evaluateLeafPatternRule,
    evaluateOrgDefinition,
    materializeComposedCountRule,
    materializeLeafCountRule,
    materializeLeafPatternRule,
    resolveFromGroups,
    resolveFromUnits,
} from './org-solver.util';
import type {
    GroupSizeResult,
    OrgComposedCountRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
    OrgLeafPatternRule,
    PromotionBasicBucketValue,
} from './org-types';

type UnitFixture = {
    type: Unit['type'];
    subtype: Unit['subtype'];
    omni?: boolean;
    specials?: string[];
    internal?: number;
};

function createUnit(
    name: string,
    type: UnitType,
    subtype: UnitSubtype,
    isOmni: boolean = false,
    specials: string[] = [],
    internal: number = 1,
    moveType: MoveType = 'Tracked',
): Unit {
    const alphaStrikeType = (() => {
        if (type === 'Mek') return 'BM';
        if (type === 'ProtoMek') return 'PM';
        if (type === 'Infantry') return subtype === 'Battle Armor' ? 'BA' : 'CI';
        if (type === 'VTOL') return 'CV';
        if (type === 'Aero') return subtype === 'Conventional Fighter' ? 'CF' : 'AF';
        return 'CV';
    })();

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
        moveType,
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
            TP: alphaStrikeType,
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

function createLance(name: string, unitNames: string[]): GroupSizeResult {
    return {
        name,
        type: 'Lance',
        modifierKey: '',
        countsAsType: null,
        tier: 1,
        units: unitNames.map((unitName) => createUnit(unitName, 'Mek', 'BattleMek')),
    };
}

function createFlight(name: string, unitNames: string[]): GroupSizeResult {
    return {
        name,
        type: 'Flight',
        modifierKey: '',
        countsAsType: null,
        tier: 1,
        units: unitNames.map((unitName) => createAero(unitName)),
    };
}

function createLevelI(name: string, unitNames: string[]): GroupSizeResult {
    return {
        name,
        type: 'Level I',
        modifierKey: '',
        countsAsType: null,
        tier: 0,
        units: unitNames.map((unitName) => createUnit(unitName, 'Mek', 'BattleMek')),
    };
}

function createUn(name: string, unitNames: string[]): GroupSizeResult {
    return {
        name,
        type: 'Un',
        modifierKey: '',
        countsAsType: null,
        tier: 0,
        units: unitNames.map((unitName) => createUnit(unitName, 'Mek', 'BattleMek')),
    };
}

function createContubernium(name: string, tag: 'infantry' | 'non-infantry', units: Unit[]): GroupSizeResult {
    return {
        name,
        type: 'Contubernium',
        modifierKey: '',
        countsAsType: null,
        tier: 0,
        tag,
        units,
    };
}

function createAero(name: string, isOmni = false, specials: string[] = []): Unit {
    return createUnit(name, 'Aero', isOmni ? 'Aerospace Fighter Omni' : 'Aerospace Fighter', isOmni, specials);
}

function createFlightEligibleUnit(
    name: string,
    _identity: string,
    alphaStrikeType: ASUnitTypeCode,
    unitType: UnitType,
    moveProfile: NonNullable<Unit['as']>['MVm'] = {},
): Unit {
    const unit = createUnit(name, unitType, alphaStrikeType === 'CF' ? 'Conventional Fighter' : 'Aerospace Fighter');

    return {
        ...unit,
        type: unitType,
        as: {
            ...unit.as,
            TP: alphaStrikeType,
            MVm: moveProfile,
        },
    };
}

function createBattleMekGroup(
    name: string,
    type: GroupSizeResult['type'],
    tier: number,
    unitCount: number,
    countsAsType: GroupSizeResult['countsAsType'] = null,
): GroupSizeResult {
    return {
        name,
        type,
        modifierKey: '',
        countsAsType,
        tier,
        units: Array.from({ length: unitCount }, (_, index) => createUnit(`${name}-${index + 1}`, 'Mek', 'BattleMek')),
    };
}

describe('org-solver.util', () => {
    it('compiles unit facts with current transport and infantry semantics', () => {
        const units = compileUnitFactsList([
            createUnit('Omni Mek', 'Mek', 'BattleMek Omni', true),
            createUnit('MEC BA', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('Foot Infantry', 'Infantry', 'Conventional Infantry', false, [], 24, 'Tracked'),
        ]);

        expect(units[0].classKey).toBe('BM:omni');
        expect(units[0].unit.as.TP).toBe('BM');
        expect(units[1].classKey).toBe('BA');
        expect(units[1].tags.has('transport.mec')).toBeTrue();
        expect(units[2].classKey).toBe('CI');
        expect(units[2].tags.has('ci:foot')).toBeTrue();
        expect(units[2].scalars.troopers).toBe(24);
    });

    it('builds CI move-class buckets from motive and trooper count', () => {
        const units = compileUnitFactsList([
            createUnit('Foot Infantry', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
            createUnit('Jump Infantry', 'Infantry', 'Conventional Infantry', false, [], 7, 'Jump'),
            createUnit('Mech Infantry', 'Infantry', 'Mechanized Conventional Infantry', false, [], 5, 'Hover'),
        ]);

        expect(DEFAULT_ORG_RULE_REGISTRY.unitBuckets.ciMoveClass?.(units[0])).toBe('CI:foot');
        expect(DEFAULT_ORG_RULE_REGISTRY.unitBuckets.ciMoveClassTroopers?.(units[0])).toBe('CI:foot:7');
        expect(DEFAULT_ORG_RULE_REGISTRY.unitBuckets.ciMoveClass?.(units[1])).toBe('CI:jump');
        expect(DEFAULT_ORG_RULE_REGISTRY.unitBuckets.ciMoveClassTroopers?.(units[1])).toBe('CI:jump:7');
        expect(DEFAULT_ORG_RULE_REGISTRY.unitBuckets.ciMoveClass?.(units[2])).toBe('CI:mechanized-hover');
        expect(DEFAULT_ORG_RULE_REGISTRY.unitBuckets.ciMoveClassTroopers?.(units[2])).toBe('CI:mechanized-hover:5');
    });

    it('buckets flight identity only for units that are flight-eligible', () => {
        const units = compileUnitFactsList([
            createFlightEligibleUnit('SV Flyer 1', 'Chopper', 'SV', 'VTOL', { v: 10 }),
            createFlightEligibleUnit('SV Flyer 2', 'Jet', 'AF', 'Aero', { g: 8 }),
            createFlightEligibleUnit('SV Non-Flyer', 'Guardian', 'SV', 'Tank'),
        ]);

        const flightType = DEFAULT_ORG_RULE_REGISTRY.unitBuckets.flightType;

        expect(flightType?.(units[0])).toBe('flight:SV');
        expect(flightType?.(units[1])).toBe('flight:AF');
        expect(flightType?.(units[2])).toBe('not-flight');
    });

    it('evaluates leaf-count rules by selector and modifier sizes', () => {
        const rule: OrgLeafCountRule = {
            kind: 'leaf-count',
            type: 'Point',
            modifiers: { '': 1, 'Binary ': 2 },
            tier: 0,
            unitSelector: 'BM',
            pointModel: 'fixed',
        };
        const units = compileUnitFactsList([
            createUnit('Mek 1', 'Mek', 'BattleMek'),
            createUnit('Mek 2', 'Mek', 'BattleMek'),
            createUnit('Mek 3', 'Mek', 'BattleMek'),
            createUnit('Tank 1', 'Tank', 'Combat Vehicle'),
        ]);

        const result = evaluateLeafCountRule(rule, units);

        expect(result.eligibleUnits.length).toBe(3);
        expect(result.emitted).toEqual([
            { modifierKey: 'Binary ', perGroupCount: 2, copies: 1, tier: 0 },
            { modifierKey: '', perGroupCount: 1, copies: 1, tier: 0 },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('materializes leaf-count rules into concrete top-level groups', () => {
        const result = materializeLeafCountRule(IS_LANCE, compileUnitFactsList([
            createUnit('Mek 1', 'Mek', 'BattleMek'),
            createUnit('Mek 2', 'Mek', 'BattleMek'),
            createUnit('Mek 3', 'Mek', 'BattleMek'),
            createUnit('Mek 4', 'Mek', 'BattleMek'),
            createUnit('Mek 5', 'Mek', 'BattleMek'),
        ]));

        expect(result.groups).toEqual([
            jasmine.objectContaining({ name: 'Reinforced Lance', type: 'Lance', modifierKey: 'Reinforced ' }),
        ]);
        expect(result.groups[0].units?.length).toBe(5);
        expect(result.leftoverUnitFacts).toEqual([]);
    });

    it('evaluates composed-count rules from child group facts and role minima', () => {
        const rule: OrgComposedCountRule = {
            kind: 'composed-count',
            type: 'Company',
            modifiers: { '': 3 },
            tier: 2,
            childRoles: [
                { role: 'lance', matches: ['Lance'], min: 1 },
            ],
        };
        const groups = [
            createLance('Lance A', ['A1', 'A2', 'A3', 'A4']),
            createLance('Lance B', ['B1', 'B2', 'B3', 'B4']),
            createLance('Lance C', ['C1', 'C2', 'C3', 'C4']),
            createLance('Lance D', ['D1', 'D2', 'D3', 'D4']),
        ].map((group) => compileGroupFacts(group));

        const result = evaluateComposedCountRule(rule, groups);

        expect(result.acceptedGroups.length).toBe(4);
        expect(result.roleAvailability).toEqual([
            { role: 'lance', min: 1, max: undefined, count: 4 },
        ]);
        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 3, copies: 1, tier: 2, compositionIndex: 0 },
        ]);
        expect(result.leftoverCount).toBe(1);
    });

    it('evaluates composed-count rules with alternative child compositions', () => {
        const rule: OrgComposedCountRule = {
            kind: 'composed-count',
            type: 'Supernova Trinary',
            modifiers: { '': 3 },
            tier: 2.5,
            childRoles: [{ role: 'nova', matches: ['Nova'] }],
            alternativeCompositions: [
                {
                    modifiers: { '': 2 },
                    childRoles: [
                        { role: 'binary', matches: ['Supernova Binary'], min: 1 },
                        { role: 'nova', matches: ['Nova'], min: 1 },
                    ],
                },
            ],
        };
        const groups = [
            createBattleMekGroup('Supernova Binary A', 'Supernova Binary', 2, 20, 'Binary'),
            createBattleMekGroup('Supernova Binary B', 'Supernova Binary', 2, 20, 'Binary'),
            createBattleMekGroup('Nova A', 'Nova', 1.7, 10, 'Star'),
            createBattleMekGroup('Nova B', 'Nova', 1.7, 10, 'Star'),
            createBattleMekGroup('Nova C', 'Nova', 1.7, 10, 'Star'),
        ].map((group) => compileGroupFacts(group));

        const result = evaluateComposedCountRule(rule, groups);

        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 2, copies: 1, tier: 2.5, compositionIndex: 1 },
            { modifierKey: '', perGroupCount: 2, copies: 1, tier: 2.5, compositionIndex: 1 },
        ]);
        expect(result.leftoverCount).toBe(1);
    });

    it('requires composed-count children to share a CI move-class bucket when childMatchBucketBy is set', () => {
        const rule: OrgComposedCountRule = {
            kind: 'composed-count',
            type: 'Platoon',
            modifiers: { '': 2 },
            tier: 1,
            childRoles: [{ role: 'squad', matches: ['Squad'] }],
            childMatchBucketBy: 'ciMoveClass',
        };
        const rawGroups: GroupSizeResult[] = [
            {
                name: 'Foot Squad',
                type: 'Squad',
                modifierKey: '',
                countsAsType: null,
                tier: 0,
                units: [createUnit('Foot 1', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked')],
            },
            {
                name: 'Jump Squad',
                type: 'Squad',
                modifierKey: '',
                countsAsType: null,
                tier: 0,
                units: [createUnit('Jump 1', 'Infantry', 'Conventional Infantry', false, [], 7, 'Jump')],
            },
        ];
        const groups = rawGroups.map((group) => compileGroupFacts(group));

        const result = evaluateComposedCountRule(rule, groups);

        expect(result.emitted).toEqual([]);
        expect(result.leftoverCount).toBe(2);
    });

    it('materializes composed-count children from the same CI move-class bucket when childMatchBucketBy is set', () => {
        const rule: OrgComposedCountRule = {
            kind: 'composed-count',
            type: 'Platoon',
            modifiers: { '': 2 },
            tier: 1,
            childRoles: [{ role: 'squad', matches: ['Squad'] }],
            childMatchBucketBy: 'ciMoveClass',
        };
        const rawGroups: GroupSizeResult[] = [
            {
                name: 'Foot Squad A',
                type: 'Squad',
                modifierKey: '',
                countsAsType: null,
                tier: 0,
                units: [createUnit('Foot A', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked')],
            },
            {
                name: 'Foot Squad B',
                type: 'Squad',
                modifierKey: '',
                countsAsType: null,
                tier: 0,
                units: [createUnit('Foot B', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked')],
            },
            {
                name: 'Jump Squad',
                type: 'Squad',
                modifierKey: '',
                countsAsType: null,
                tier: 0,
                units: [createUnit('Jump A', 'Infantry', 'Conventional Infantry', false, [], 7, 'Jump')],
            },
        ];
        const groups = rawGroups.map((group) => compileGroupFacts(group));

        const result = materializeComposedCountRule(rule, groups);

        expect(result.groups).toEqual([
            jasmine.objectContaining({ name: 'Platoon', type: 'Platoon', modifierKey: '' }),
        ]);
        expect(result.groups[0].children?.map((child) => child.units?.[0].moveType)).toEqual(['Tracked', 'Tracked']);
        expect(result.leftoverGroupFacts).toHaveSize(1);
        expect(result.leftoverGroupFacts[0].group.units?.[0].moveType).toBe('Jump');
    });

    it('builds promotionWithUnitKinds from AS unit type counts', () => {
        const group = compileGroupFacts({
            name: 'Mixed Group',
            type: 'Star',
            modifierKey: '',
            countsAsType: null,
            tier: 1,
            units: [
                createUnit('Mek', 'Mek', 'BattleMek'),
                createUnit('Tank', 'Tank', 'Combat Vehicle'),
                createAero('Aero'),
                createUnit('BA', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
                createUnit('CI', 'Infantry', 'Conventional Infantry', false, [], 24),
                createUnit('Proto', 'ProtoMek', 'ProtoMek'),
            ],
        });

        const bucketKey = DEFAULT_ORG_RULE_REGISTRY.groupBuckets['promotionWithUnitKinds']?.(group);

        expect(bucketKey).toBe('Star|null||BM:1|CV:1|AF:1|CF:0|BA:1|CI:1|PM:1');
    });

    it('evaluates Nova leaf-pattern rules for a perfect omni-mek carrier formation', () => {
        const units = compileUnitFactsList([
            createUnit('Carrier 1', 'Mek', 'BattleMek Omni', true),
            createUnit('Carrier 2', 'Mek', 'BattleMek Omni', true),
            createUnit('Carrier 3', 'Mek', 'BattleMek Omni', true),
            createUnit('Carrier 4', 'Mek', 'BattleMek Omni', true),
            createUnit('Carrier 5', 'Mek', 'BattleMek Omni', true),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 3', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 4', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 5', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
        ]);

        const result = evaluateLeafPatternRule(CLAN_NOVA, units);

        expect(result.emitted).toHaveSize(1);
        expect(result.emitted[0]).toEqual(jasmine.objectContaining({
            modifierKey: '',
            perGroupCount: 10,
            copies: 1,
            patternIndex: 0,
        }));
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates Battle Armor Squad from an exact four-trooper unit', () => {
        const units = compileUnitFactsList([
            createUnit('BA Squad', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
        ]);

        const result = evaluateLeafPatternRule(IS_BA_SQUAD, units);

        expect(result.emitted).toHaveSize(1);
        expect(result.emitted[0]).toEqual(jasmine.objectContaining({
            modifierKey: '',
            perGroupCount: 1,
            copies: 1,
            score: 0,
        }));
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates an Inner Sphere Platoon from four same-motive Squads', () => {
        const squads = materializeLeafPatternRule(IS_SQUAD, compileUnitFactsList([
            createUnit('CI Squad 1', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
            createUnit('CI Squad 2', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
            createUnit('CI Squad 3', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
            createUnit('CI Squad 4', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
        ])).groups;

        const result = evaluateComposedCountRule(IS_PLATOON, compileGroupFactsList(squads));

        expect(result.emitted).toEqual([
            jasmine.objectContaining({ modifierKey: '', perGroupCount: 4, copies: 1, tier: 1 }),
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates Air Lance from one Flight and one Lance', () => {
        const groups = [
            createFlight('Flight A', ['A1', 'A2']),
            createLance('Lance A', ['L1', 'L2', 'L3', 'L4']),
        ].map((group) => compileGroupFacts(group));

        const result = evaluateComposedCountRule(IS_AIR_LANCE, groups);

        expect(result.roleAvailability).toEqual([
            { role: 'flight', min: 1, max: undefined, count: 1 },
            { role: 'lance', min: 1, max: undefined, count: 1 },
        ]);
        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 2, copies: 1, tier: 1.5, compositionIndex: 0 },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates Level II from Level I groups', () => {
        const groups = [
            createLevelI('Level I A', ['A1']),
            createLevelI('Level I B', ['B1']),
            createLevelI('Level I C', ['C1']),
            createLevelI('Level I D', ['D1']),
            createLevelI('Level I E', ['E1']),
            createLevelI('Level I F', ['F1']),
        ].map((group) => compileGroupFacts(group));

        const result = evaluateComposedCountRule(COMSTAR_LEVEL_II, groups);

        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 6, copies: 1, tier: 1, compositionIndex: 0 },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates the real Clan core definitions module', () => {
        const units = [
            createUnit('Point 1', 'Mek', 'BattleMek'),
            createUnit('Point 2', 'Tank', 'Combat Vehicle'),
            createUnit('Point 3', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('Point 4', 'ProtoMek', 'ProtoMek'),
        ];
        const groups = [
            { name: 'Star A', type: 'Star', modifierKey: '', countsAsType: null, tier: 1 },
            { name: 'Star B', type: 'Star', modifierKey: '', countsAsType: null, tier: 1 },
            { name: 'Star C', type: 'Star', modifierKey: '', countsAsType: null, tier: 1 },
        ] as GroupSizeResult[];

        const result = evaluateOrgDefinition(CLAN_CORE_ORG, units, groups);

        const pointEvaluation = result.ruleEvaluations.get(CLAN_POINT);
        const trinaryEvaluation = result.ruleEvaluations.get(CLAN_TRINARY);

        expect(pointEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(trinaryEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });

    it('resolves new-path org definitions by faction registry', () => {
        expect(resolveOrgDefinitionSpec('Word of Blake', 'Inner Sphere')).toBe(COMSTAR_CORE_ORG);
        expect(resolveOrgDefinitionSpec('Wolf\'s Dragoons', 'Mercenary')).toBe(WD_CORE_ORG);
        expect(resolveOrgDefinitionSpec('Unknown Clan', 'HW Clan')).toBe(CLAN_CORE_ORG);
    });

    it('falls back to the new-path default org definition', () => {
        expect(resolveOrgDefinitionSpec('Federated Suns', 'Inner Sphere')).toBe(DEFAULT_ORG_SPEC);
    });

    it('evaluates a faction org definition through the registry helper', () => {
        const units = [
            ...Array.from({ length: 5 }, (_, index) =>
                createUnit(`WD BM ${index + 1}`, 'Mek', 'BattleMek Omni', true),
            ),
            ...Array.from({ length: 5 }, (_, index) =>
                createUnit(`WD BA ${index + 1}`, 'Infantry', 'Battle Armor', false, ['MEC'], 5),
            ),
        ];

        const result = evaluateFactionOrgDefinition('Wolf\'s Dragoons', 'Mercenary', units);
        const novaEvaluation = result.ruleEvaluations.get(WD_NOVA);

        expect(novaEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });

    it('prefers a WHOLE Fortified Lance over a higher-tier non-WHOLE path for six units', () => {
        const units = Array.from({ length: 6 }, (_, index) =>
            createUnit(`IS BM ${index + 1}`, 'Mek', 'BattleMek'),
        );

        const result = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Fortified Lance');
        expect(result[0].type).toBe('Lance');
        expect(result[0].modifierKey).toBe('Fortified ');
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('prefers a WHOLE Heavy Level II over a regular Level II plus a weaker leftover parent', () => {
        const levelIs = Array.from({ length: 9 }, (_, index) => ({
            name: `Level I ${index + 1}`,
            type: 'Level I' as const,
            modifierKey: '',
            countsAsType: null,
            tier: 0,
            units: [createUnit(`CS BM ${index + 1}`, 'Mek', 'BattleMek')],
        }));

        const result = resolveFromGroups('ComStar', 'Inner Sphere', levelIs);

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Heavy Level II');
        expect(result[0].type).toBe('Level II');
        expect(result[0].modifierKey).toBe('Heavy ');
        expect(result[0].children?.length).toBe(9);
    });

    it('uses sub-regular leaf fallback to resolve seven battlemechs into an Under-Strength Company', () => {
        const units = Array.from({ length: 7 }, (_, index) =>
            createUnit(`IS BM ${index + 1}`, 'Mek', 'BattleMek'),
        );

        const result = resolveFromUnits(units, 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Under-Strength Company');
        expect(result[0].type).toBe('Company');
        expect(result[0].modifierKey).toBe('Under-Strength ');
        expect(result[0].children?.length).toBe(2);
        expect(result[0].leftoverUnits).toBeUndefined();
    });

    it('regularizes an Under-Strength Company before building upward from four additional lances', () => {
        const underStrengthCompany = resolveFromUnits([
            createUnit('UPCO-1', 'Mek', 'BattleMek'),
            createUnit('UPCO-2', 'Mek', 'BattleMek'),
            createUnit('UPCO-3', 'Mek', 'BattleMek'),
            createUnit('UPCO-4', 'Mek', 'BattleMek'),
            createUnit('UPCO-5', 'Mek', 'BattleMek'),
            createUnit('UPCO-6', 'Mek', 'BattleMek'),
            createUnit('UPCO-7', 'Mek', 'BattleMek'),
            createUnit('UPCO-8', 'Mek', 'BattleMek'),
        ], 'Inner Sphere', 'Mercenary');
        const lanceGroups = [0, 1, 2, 3].map((lanceIndex) =>
            resolveFromUnits([
                createUnit(`UPL${lanceIndex + 1}-1`, 'Mek', 'BattleMek'),
                createUnit(`UPL${lanceIndex + 1}-2`, 'Mek', 'BattleMek'),
                createUnit(`UPL${lanceIndex + 1}-3`, 'Mek', 'BattleMek'),
                createUnit(`UPL${lanceIndex + 1}-4`, 'Mek', 'BattleMek'),
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
        expect(result[0].children?.every((child) => child.type === 'Company')).toBeTrue();
    });

    it('assimilates an Under-Strength Battalion before leaving a leftover lance only after lower-tier repair', () => {
        const firstUnderStrengthCompany = resolveFromUnits([
            createUnit('BCO-1', 'Mek', 'BattleMek'),
            createUnit('BCO-2', 'Mek', 'BattleMek'),
            createUnit('BCO-3', 'Mek', 'BattleMek'),
            createUnit('BCO-4', 'Mek', 'BattleMek'),
            createUnit('BCO-5', 'Mek', 'BattleMek'),
            createUnit('BCO-6', 'Mek', 'BattleMek'),
            createUnit('BCO-7', 'Mek', 'BattleMek'),
            createUnit('BCO-8', 'Mek', 'BattleMek'),
        ], 'Inner Sphere', 'Mercenary');
        const secondUnderStrengthCompany = resolveFromUnits([
            createUnit('CCO-1', 'Mek', 'BattleMek'),
            createUnit('CCO-2', 'Mek', 'BattleMek'),
            createUnit('CCO-3', 'Mek', 'BattleMek'),
            createUnit('CCO-4', 'Mek', 'BattleMek'),
            createUnit('CCO-5', 'Mek', 'BattleMek'),
            createUnit('CCO-6', 'Mek', 'BattleMek'),
            createUnit('CCO-7', 'Mek', 'BattleMek'),
            createUnit('CCO-8', 'Mek', 'BattleMek'),
        ], 'Inner Sphere', 'Mercenary');
        const underStrengthBattalion = resolveFromGroups('Inner Sphere', 'Mercenary', [
            firstUnderStrengthCompany[0],
            secondUnderStrengthCompany[0],
        ]);
        const thirdUnderStrengthCompany = resolveFromUnits([
            createUnit('DCO-1', 'Mek', 'BattleMek'),
            createUnit('DCO-2', 'Mek', 'BattleMek'),
            createUnit('DCO-3', 'Mek', 'BattleMek'),
            createUnit('DCO-4', 'Mek', 'BattleMek'),
            createUnit('DCO-5', 'Mek', 'BattleMek'),
            createUnit('DCO-6', 'Mek', 'BattleMek'),
            createUnit('DCO-7', 'Mek', 'BattleMek'),
            createUnit('DCO-8', 'Mek', 'BattleMek'),
        ], 'Inner Sphere', 'Mercenary');
        const firstLance = resolveFromUnits([
            createUnit('BL1-1', 'Mek', 'BattleMek'),
            createUnit('BL1-2', 'Mek', 'BattleMek'),
            createUnit('BL1-3', 'Mek', 'BattleMek'),
            createUnit('BL1-4', 'Mek', 'BattleMek'),
        ], 'Inner Sphere', 'Mercenary');
        const secondLance = resolveFromUnits([
            createUnit('BL2-1', 'Mek', 'BattleMek'),
            createUnit('BL2-2', 'Mek', 'BattleMek'),
            createUnit('BL2-3', 'Mek', 'BattleMek'),
            createUnit('BL2-4', 'Mek', 'BattleMek'),
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
        expect(result[0].children?.length).toBe(3);
        expect(result[0].children?.every((child) => child.type === 'Company')).toBeTrue();
        expect(result[1].name).toBe('Lance');
        expect(result[1].type).toBe('Lance');
    });

    it('regularizes a Thin Level II with ten Level I groups into two regular Level II groups', () => {
        const thinLevelII = resolveFromUnits([
            createUnit('CS-TL2-1', 'Mek', 'BattleMek'),
            createUnit('CS-TL2-2', 'Mek', 'BattleMek'),
        ], 'ComStar', 'Inner Sphere');
        const levelIs = Array.from({ length: 10 }, (_, index) =>
            resolveFromUnits([
                createUnit(`CS-L1-${index + 1}`, 'Mek', 'BattleMek'),
            ], 'ComStar', 'Inner Sphere')[0],
        );

        const result = resolveFromGroups('ComStar', 'Inner Sphere', [
            thinLevelII[0],
            ...levelIs,
        ]);

        expect(result.length).toBe(2);
        expect(result.every((group) => group.name === 'Level II')).toBeTrue();
        expect(result.every((group) => group.type === 'Level II')).toBeTrue();
        expect(result.every((group) => group.modifierKey === '')).toBeTrue();
    });
});
