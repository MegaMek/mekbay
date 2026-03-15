import type { ASUnitTypeCode, MoveType, Unit, UnitSubtype, UnitType } from '../../models/units.model';
import {
    CC_AUGMENTED_LANCE,
    CC_AUGMENTED_BATTALION,
    CC_AUGMENTED_COMPANY,
    CC_AUGMENTED_REGIMENT,
    CC_CORE_ORG,
    CLAN_CI_POINT,
    CLAN_CI_SQUAD,
    CLAN_CLUSTER,
    IS_AIR_LANCE,
    IS_BA_SQUAD,
    IS_COMPANY,
    IS_CORE_ORG,
    IS_FLIGHT,
    IS_LANCE,
    IS_PLATOON,
    IS_SQUAD,
    CLAN_CORE_ORG,
    CLAN_NOVA,
    CLAN_POINT,
    CLAN_SUPERNOVA_TRINARY,
    CLAN_TRINARY,
    COMSTAR_CORE_ORG,
    COMSTAR_CI_SQUAD,
    COMSTAR_LEVEL_II,
    COMSTAR_CHOIR,
    MH_CENTURY_INFANTRY,
    MH_CENTURY_NON_INFANTRY,
    MH_CORE_ORG,
    MH_LEGION,
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
    COMSTAR_LEVEL_I_FROM_SQUADS,
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
    evaluateFactionOrgDefinition,
    evaluateComposedCountRule,
    evaluateLeafCountRule,
    evaluateLeafPatternRule,
    evaluateOrgDefinition,
    materializeComposedCountRule,
    materializeLeafCountRule,
    materializeLeafPatternRule,
    resolveFromGroups,
    resolveFromUnits,
} from './org-solver.util';
import { getAggregatedGroupsResult } from './org-namer.util';
import type {
    GroupSizeResult,
    OrgComposedCountRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
    OrgLeafPatternRule,
    PromotionBasicBucketValue,
} from './org-types';

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
        if (type === 'Aero') {
            return subtype === 'Conventional Fighter' ? 'CF' : 'AF';
        }
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
    identity: string,
    alphaStrikeType: ASUnitTypeCode,
    unitType: UnitType,
    moveProfile: NonNullable<Unit['as']>['MVm'] = {},
): Unit {
    const unit = createUnit(name, unitType, alphaStrikeType === 'CF' ? 'Conventional Fighter' : 'Aerospace Fighter');

    return {
        ...unit,
        type: unitType,
        chassis: `Chassis ${identity}`,
        model: `Model ${identity}`,
        as: {
            ...unit.as,
            TP: alphaStrikeType,
            MVm: moveProfile,
        },
    };
}

function createBattleMekGroup(
    name: string,
    type: Exclude<GroupSizeResult['type'], null>,
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
        units: Array.from({ length: unitCount }, (_, index) =>
            createUnit(`${name}-${index + 1}`, 'Mek', 'BattleMek'),
        ),
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
            createFlightEligibleUnit('SV Flyer 2', 'Jet', 'SV', 'Aero', { g: 8 }),
            createFlightEligibleUnit('SV Non-Flyer', 'Guardian', 'SV', 'Tank'),
        ]);

        const flightType = DEFAULT_ORG_RULE_REGISTRY.unitBuckets.flightType;

        expect(flightType?.(units[0])).toBe('not-flight');
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

    it('evaluates Flight only from identical eligible air units', () => {
        const units = compileUnitFactsList([
            createFlightEligibleUnit('AF 1', 'Seydlitz', 'AF', 'Aero'),
            createFlightEligibleUnit('AF 2', 'Seydlitz', 'AF', 'Aero'),
            createFlightEligibleUnit('AF 3', 'Seydlitz', 'AF', 'Aero'),
            createFlightEligibleUnit('CF 1', 'Lucifer', 'CF', 'Aero'),
        ]);

        const result = evaluateLeafCountRule(IS_FLIGHT, units);

        expect(result.eligibleUnits.length).toBe(4);
        expect(result.emitted).toEqual([
            { modifierKey: 'Reinforced ', perGroupCount: 3, copies: 1, tier: 1 },
            { modifierKey: 'Under-Strength ', perGroupCount: 1, copies: 1, tier: 1 },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('accepts SV units in Flight only when they have a flight-capable MVm profile', () => {
        const units = compileUnitFactsList([
            createFlightEligibleUnit('SV Flyer 1', 'Fighter', 'SV', 'Aero', { a: 8 }),
            createFlightEligibleUnit('SV Flyer 2', 'Fighter', 'SV', 'Aero', { a: 8 }),
            createFlightEligibleUnit('SV Non-Flyer', 'Hover Truck', 'SV', 'Tank'),
        ]);

        const result = evaluateLeafCountRule(IS_FLIGHT, units);

        expect(result.eligibleUnits.length).toBe(2);
        expect(result.eligibleUnits.map((facts) => facts.unit.name)).toEqual([
            'SV Flyer 1',
            'SV Flyer 2',
        ]);
        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 2, copies: 1, tier: 1 },
        ]);
        expect(result.leftoverCount).toBe(0);
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
            { modifierKey: '', perGroupCount: 3, copies: 1, tier: 2 },
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
            { modifierKey: '', perGroupCount: 2, copies: 2, tier: 2.5 },
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

    it('materializes leaf-pattern rules into concrete top-level groups', () => {
        const result = materializeLeafPatternRule(CLAN_NOVA, compileUnitFactsList([
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
        ]));

        expect(result.groups).toEqual([
            jasmine.objectContaining({ name: 'Nova', type: 'Nova', modifierKey: '' }),
        ]);
        expect(result.groups[0].units?.length).toBe(10);
        expect(result.leftoverUnitFacts).toEqual([]);
    });

    it('rejects non-5-and-5 Nova formations even when all units are otherwise eligible', () => {
        const units = compileUnitFactsList([
            createUnit('Carrier 1', 'Tank', 'Combat Vehicle Omni', true),
            createUnit('Carrier 2', 'Tank', 'Combat Vehicle', false),
            createUnit('Carrier 3', 'Tank', 'Combat Vehicle', false),
            createUnit('Carrier 4', 'Tank', 'Combat Vehicle', false),
            createUnit('Carrier 5', 'Tank', 'Combat Vehicle', false),
            createUnit('Carrier 6', 'Tank', 'Combat Vehicle', false),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 3', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 4', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
        ]);

        const result = evaluateLeafPatternRule(CLAN_NOVA, units);

        expect(result.emitted).toEqual([]);
        expect(result.leftoverCount).toBe(10);
    });

    it('rejects Nova leaf-pattern rules when battle armor is not transport-qualified', () => {
        const units = compileUnitFactsList([
            createAero('Carrier 1', true),
            createAero('Carrier 2', true),
            createAero('Carrier 3', true),
            createAero('Carrier 4', true),
            createAero('Carrier 5', true),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 3', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 4', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 5', 'Infantry', 'Battle Armor', false, [], 4),
        ]);

        const result = evaluateLeafPatternRule(CLAN_NOVA, units);

        expect(result.emitted).toEqual([]);
        expect(result.leftoverCount).toBe(10);
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

    it('evaluates an Inner Sphere CI Squad from an exact seven-trooper foot unit', () => {
        const units = compileUnitFactsList([
            createUnit('CI Squad', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
        ]);

        const result = evaluateLeafPatternRule(IS_SQUAD, units);

        expect(result.emitted).toHaveSize(1);
        expect(result.emitted[0]).toEqual(jasmine.objectContaining({
            modifierKey: '',
            perGroupCount: 1,
            copies: 1,
            score: 0,
        }));
        expect(result.leftoverCount).toBe(0);
    });

    it('rejects an Inner Sphere CI Squad when the move-class troop count is not exact', () => {
        const units = compileUnitFactsList([
            createUnit('CI Squad', 'Infantry', 'Conventional Infantry', false, [], 8, 'Tracked'),
        ]);

        const result = evaluateLeafPatternRule(IS_SQUAD, units);

        expect(result.emitted).toEqual([]);
        expect(result.leftoverCount).toBe(1);
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

    it('rejects an Inner Sphere Platoon when Squads do not share a move class', () => {
        const squads = materializeLeafPatternRule(IS_SQUAD, compileUnitFactsList([
            createUnit('Foot Squad 1', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
            createUnit('Foot Squad 2', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
            createUnit('Foot Squad 3', 'Infantry', 'Conventional Infantry', false, [], 7, 'Tracked'),
            createUnit('Jump Squad', 'Infantry', 'Conventional Infantry', false, [], 7, 'Jump'),
        ])).groups;

        const result = evaluateComposedCountRule(IS_PLATOON, compileGroupFactsList(squads));

        expect(result.emitted).toEqual([]);
        expect(result.leftoverCount).toBe(4);
    });

    it('evaluates a Clan Point from four jump Squads', () => {
        const squads = materializeLeafPatternRule(CLAN_CI_SQUAD, compileUnitFactsList([
            createUnit('Jump Squad 1', 'Infantry', 'Conventional Infantry', false, [], 5, 'Jump'),
            createUnit('Jump Squad 2', 'Infantry', 'Conventional Infantry', false, [], 5, 'Jump'),
            createUnit('Jump Squad 3', 'Infantry', 'Conventional Infantry', false, [], 5, 'Jump'),
            createUnit('Jump Squad 4', 'Infantry', 'Conventional Infantry', false, [], 5, 'Jump'),
        ])).groups;

        const result = evaluateComposedCountRule(CLAN_CI_POINT, compileGroupFactsList(squads));

        expect(result.emitted).toEqual([
            jasmine.objectContaining({ modifierKey: '', perGroupCount: 4, copies: 1, tier: 0 }),
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates a ComStar Level I from five jump Squads', () => {
        const squads = materializeLeafPatternRule(COMSTAR_CI_SQUAD, compileUnitFactsList([
            createUnit('Jump Squad 1', 'Infantry', 'Conventional Infantry', false, [], 6, 'Jump'),
            createUnit('Jump Squad 2', 'Infantry', 'Conventional Infantry', false, [], 6, 'Jump'),
            createUnit('Jump Squad 3', 'Infantry', 'Conventional Infantry', false, [], 6, 'Jump'),
            createUnit('Jump Squad 4', 'Infantry', 'Conventional Infantry', false, [], 6, 'Jump'),
            createUnit('Jump Squad 5', 'Infantry', 'Conventional Infantry', false, [], 6, 'Jump'),
        ])).groups;

        const result = evaluateComposedCountRule(COMSTAR_LEVEL_I_FROM_SQUADS, compileGroupFactsList(squads));

        expect(result.emitted).toEqual([
            jasmine.objectContaining({ modifierKey: '', perGroupCount: 5, copies: 1, tier: 0 }),
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('consumes leaf-pattern units only once across multiple modifier sizes', () => {
        const rule: OrgLeafPatternRule = {
            kind: 'leaf-pattern',
            type: 'Lance',
            modifiers: { '': 2, 'Single ': 1 },
            tier: 1,
            unitSelector: 'BM',
            bucketBy: 'classKey',
            patterns: [
                {
                    copySize: 2,
                    demands: { BM: 2 },
                },
                {
                    copySize: 1,
                    demands: { BM: 1 },
                },
            ],
        };
        const units = compileUnitFactsList([
            createUnit('Mek 1', 'Mek', 'BattleMek'),
            createUnit('Mek 2', 'Mek', 'BattleMek'),
            createUnit('Mek 3', 'Mek', 'BattleMek'),
        ]);

        const result = evaluateLeafPatternRule(rule, units);

        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 2, copies: 1, tier: 1, patternIndex: 0, score: 0, allocations: [new Map([['BM', 2]])] },
            { modifierKey: 'Single ', perGroupCount: 1, copies: 1, tier: 1, patternIndex: 1, score: 0, allocations: [new Map([['BM', 1]])] },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates Lance as a leaf-count rule while excluding conventional infantry', () => {
        const units = compileUnitFactsList([
            createUnit('Mek 1', 'Mek', 'BattleMek'),
            createUnit('Mek 2', 'Mek', 'BattleMek'),
            createUnit('Tank 1', 'Tank', 'Combat Vehicle'),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('CI 1', 'Infantry', 'Conventional Infantry', false, [], 24),
        ]);

        const result = evaluateLeafCountRule(IS_LANCE, units);

        expect(result.eligibleUnits.length).toBe(4);
        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 4, copies: 1, tier: 1 },
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
            { modifierKey: '', perGroupCount: 2, copies: 1, tier: 1.5 },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('rejects Air Lance when the lance child includes non-BM units', () => {
        const mixedLance: GroupSizeResult = {
            name: 'Mixed Lance',
            type: 'Lance',
            modifierKey: '',
            countsAsType: null,
            tier: 1,
            units: [
                createUnit('Mek 1', 'Mek', 'BattleMek'),
                createUnit('Mek 2', 'Mek', 'BattleMek'),
                createUnit('Mek 3', 'Mek', 'BattleMek'),
                createUnit('Tank 1', 'Tank', 'Combat Vehicle'),
            ],
        };

        const groups = [
            createFlight('Flight A', ['A1', 'A2']),
            mixedLance,
        ].map((group) => compileGroupFacts(group));

        const result = evaluateComposedCountRule(IS_AIR_LANCE, groups);

        expect(result.roleAvailability).toEqual([
            { role: 'flight', min: 1, max: undefined, count: 1 },
            { role: 'lance', min: 1, max: undefined, count: 0 },
        ]);
        expect(result.emitted).toEqual([]);
        expect(result.leftoverCount).toBe(1);
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
            { modifierKey: '', perGroupCount: 6, copies: 1, tier: 1 },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates Trey and Sept from Un groups', () => {
        const treyGroups = [
            createUn('Un A', ['A1']),
            createUn('Un B', ['B1']),
            createUn('Un C', ['C1']),
        ].map((group) => compileGroupFacts(group));
        const septGroups = [
            createUn('Un A', ['A1']),
            createUn('Un B', ['B1']),
            createUn('Un C', ['C1']),
            createUn('Un D', ['D1']),
            createUn('Un E', ['E1']),
            createUn('Un F', ['F1']),
            createUn('Un G', ['G1']),
        ].map((group) => compileGroupFacts(group));

        const treyResult = evaluateComposedCountRule(SOCIETY_TREY, treyGroups);
        const septResult = evaluateComposedCountRule(SOCIETY_SEPT, septGroups);

        expect(treyResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 3, copies: 1, tier: 0.8 },
        ]);
        expect(treyResult.leftoverCount).toBe(0);
        expect(septResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 7, copies: 1, tier: 1.6 },
        ]);
        expect(septResult.leftoverCount).toBe(0);
    });

    it('evaluates Marian Century variants from tagged Contubernium groups', () => {
        const nonInfantryGroups = [
            createContubernium('C1', 'non-infantry', [createUnit('Mek 1', 'Mek', 'BattleMek')]),
            createContubernium('C2', 'non-infantry', [createUnit('Mek 2', 'Mek', 'BattleMek')]),
            createContubernium('C3', 'non-infantry', [createUnit('Mek 3', 'Mek', 'BattleMek')]),
            createContubernium('C4', 'non-infantry', [createUnit('Mek 4', 'Mek', 'BattleMek')]),
            createContubernium('C5', 'non-infantry', [createUnit('Mek 5', 'Mek', 'BattleMek')]),
        ].map((group) => compileGroupFacts(group));
        const infantryGroups = [
            createContubernium('I1', 'infantry', [createUnit('CI 1', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I2', 'infantry', [createUnit('CI 2', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I3', 'infantry', [createUnit('CI 3', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I4', 'infantry', [createUnit('CI 4', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I5', 'infantry', [createUnit('CI 5', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I6', 'infantry', [createUnit('CI 6', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I7', 'infantry', [createUnit('CI 7', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I8', 'infantry', [createUnit('CI 8', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I9', 'infantry', [createUnit('CI 9', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I10', 'infantry', [createUnit('CI 10', 'Infantry', 'Conventional Infantry', false, [], 10)]),
        ].map((group) => compileGroupFacts(group));

        const nonInfantryResult = evaluateComposedCountRule(MH_CENTURY_NON_INFANTRY, nonInfantryGroups);
        const infantryResult = evaluateComposedCountRule(MH_CENTURY_INFANTRY, infantryGroups);

        expect(nonInfantryResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 5, copies: 1, tier: 1 },
        ]);
        expect(nonInfantryResult.leftoverCount).toBe(0);
        expect(infantryResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 10, copies: 1, tier: 1 },
        ]);
        expect(infantryResult.leftoverCount).toBe(0);
    });

    it('rejects Choir when battle armor cannot be carried one-for-one by the available meks', () => {
        const units = compileUnitFactsList([
            createUnit('Omni Mek 1', 'Mek', 'BattleMek Omni', true),
            createUnit('Omni Mek 2', 'Mek', 'BattleMek Omni', true),
            createUnit('Omni Mek 3', 'Mek', 'BattleMek Omni', true),
            createUnit('Omni Mek 4', 'Mek', 'BattleMek Omni', true),
            createUnit('Omni Mek 5', 'Mek', 'BattleMek Omni', true),
            createUnit('Mek 6', 'Mek', 'BattleMek'),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 3', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 4', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 5', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 6', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
        ]);

        const result = evaluateLeafPatternRule(COMSTAR_CHOIR, units);

        expect(result.emitted).toEqual([]);
        expect(result.leftoverCount).toBe(12);
    });

    it('evaluates Choir when MEC and XMEC battle armor can be carried by the available meks', () => {
        const units = compileUnitFactsList([
            createUnit('Omni Mek 1', 'Mek', 'BattleMek Omni', true),
            createUnit('Omni Mek 2', 'Mek', 'BattleMek Omni', true),
            createUnit('Omni Mek 3', 'Mek', 'BattleMek Omni', true),
            createUnit('Omni Mek 4', 'Mek', 'BattleMek Omni', true),
            createUnit('Omni Mek 5', 'Mek', 'BattleMek Omni', true),
            createUnit('Mek 6', 'Mek', 'BattleMek'),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 3', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 4', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 5', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 6', 'Infantry', 'Battle Armor', false, ['XMEC'], 4),
        ]);

        const result = evaluateLeafPatternRule(COMSTAR_CHOIR, units);

        expect(result.emitted).toHaveSize(1);
        expect(result.emitted[0]).toEqual(jasmine.objectContaining({
            modifierKey: '',
            perGroupCount: 12,
            copies: 1,
            score: 0,
        }));
        expect(result.leftoverCount).toBe(0);
    });

    it('rejects Choir when it has no transport-qualified battle armor pairing', () => {
        const units = compileUnitFactsList([
            createUnit('Mek 1', 'Mek', 'BattleMek'),
            createUnit('Mek 2', 'Mek', 'BattleMek'),
            createUnit('Mek 3', 'Mek', 'BattleMek'),
            createUnit('Mek 4', 'Mek', 'BattleMek'),
            createUnit('Mek 5', 'Mek', 'BattleMek'),
            createUnit('Mek 6', 'Mek', 'BattleMek'),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 3', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 4', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 5', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 6', 'Infantry', 'Battle Armor', false, [], 4),
        ]);

        const result = evaluateLeafPatternRule(COMSTAR_CHOIR, units);

        expect(result.emitted).toEqual([]);
        expect(result.leftoverCount).toBe(12);
    });

    it('evaluates Augmented Lance with MEC penalties against available omni carriers', () => {
        const units = compileUnitFactsList([
            createUnit('Carrier 1', 'Mek', 'BattleMek', false),
            createUnit('Carrier 2', 'Mek', 'BattleMek', false),
            createUnit('Carrier 3', 'Mek', 'BattleMek', false),
            createUnit('Carrier 4', 'Mek', 'BattleMek', false),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
        ]);

        const result = evaluateLeafPatternRule(CC_AUGMENTED_LANCE, units);

        expect(result.emitted).toHaveSize(1);
        expect(result.emitted[0]).toEqual(jasmine.objectContaining({
            modifierKey: '',
            perGroupCount: 6,
            copies: 1,
            score: 2,
        }));
        expect(result.leftoverCount).toBe(0);
    });

    it('penalizes non-qualified battle armor in Augmented Lance matching', () => {
        const units = compileUnitFactsList([
            createUnit('Carrier 1', 'Mek', 'BattleMek'),
            createUnit('Carrier 2', 'Mek', 'BattleMek'),
            createUnit('Carrier 3', 'Mek', 'BattleMek'),
            createUnit('Carrier 4', 'Mek', 'BattleMek'),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, [], 4),
        ]);

        const result = evaluateLeafPatternRule(CC_AUGMENTED_LANCE, units);

        expect(result.emitted).toHaveSize(1);
        expect(result.emitted[0]?.score).toBe(4);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates the Capellan augmented composed chain', () => {
        const augmentedLances = [
            { name: 'AL A', type: 'Augmented Lance', modifierKey: '', countsAsType: 'Lance', tier: 0.99 },
            { name: 'AL B', type: 'Augmented Lance', modifierKey: '', countsAsType: 'Lance', tier: 0.99 },
            { name: 'AL C', type: 'Augmented Lance', modifierKey: '', countsAsType: 'Lance', tier: 0.99 },
            { name: 'AL D', type: 'Augmented Lance', modifierKey: '', countsAsType: 'Lance', tier: 0.99 },
        ] as GroupSizeResult[];
        const augmentedCompanies = [
            { name: 'AC A', type: 'Augmented Company', modifierKey: '', countsAsType: 'Company', tier: 1.95 },
            { name: 'AC B', type: 'Augmented Company', modifierKey: '', countsAsType: 'Company', tier: 1.95 },
            { name: 'AC C', type: 'Augmented Company', modifierKey: '', countsAsType: 'Company', tier: 1.95 },
            { name: 'AC D', type: 'Augmented Company', modifierKey: '', countsAsType: 'Company', tier: 1.95 },
        ] as GroupSizeResult[];
        const augmentedBattalions = [
            { name: 'AB A', type: 'Augmented Battalion', modifierKey: '', countsAsType: 'Battalion', tier: 3 },
            { name: 'AB B', type: 'Augmented Battalion', modifierKey: '', countsAsType: 'Battalion', tier: 3 },
            { name: 'AB C', type: 'Augmented Battalion', modifierKey: '', countsAsType: 'Battalion', tier: 3 },
            { name: 'Battalion A', type: 'Battalion', modifierKey: '', countsAsType: null, tier: 3 },
        ] as GroupSizeResult[];

        const companyResult = evaluateComposedCountRule(CC_AUGMENTED_COMPANY, augmentedLances.map((group) => compileGroupFacts(group)));
        const battalionResult = evaluateComposedCountRule(CC_AUGMENTED_BATTALION, augmentedCompanies.map((group) => compileGroupFacts(group)));
        const regimentResult = evaluateComposedCountRule(CC_AUGMENTED_REGIMENT, augmentedBattalions.map((group) => compileGroupFacts(group)));

        expect(companyResult.emitted).toEqual([
            { modifierKey: 'Reinforced ', perGroupCount: 3, copies: 1, tier: 2.01 },
        ]);
        expect(battalionResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 4, copies: 1, tier: 3.01 },
        ]);
        expect(regimentResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 4, copies: 1, tier: 4.01 },
        ]);
    });

    it('evaluates an org definition across unit and group facts', () => {
        const pointRule: OrgLeafCountRule = {
            kind: 'leaf-count',
            type: 'Point',
            modifiers: { '': 1 },
            tier: 0,
            unitSelector: 'BM',
            pointModel: 'fixed',
        };
        const companyRule: OrgComposedCountRule = {
            kind: 'composed-count',
            type: 'Company',
            modifiers: { '': 3 },
            tier: 2,
            childRoles: [{ role: 'lance', matches: ['Lance'], min: 1 }],
        };
        const definition: OrgDefinitionSpec = {
            rules: [pointRule, companyRule],
            registry: {
                unitSelectors: {
                    BM: (facts) => facts.unit.as.TP === 'BM',
                },
                unitBuckets: {
                    classKey: (facts) => facts.classKey,
                },
                groupBuckets: {
	                    promotionBasic: (facts) => [facts.type ?? 'null', facts.countsAsType ?? 'null', facts.tag ?? ''].join('|') as PromotionBasicBucketValue,
                },
            },
            distanceFactor: 1,
            minDistance: 0,
            groupDistanceFactor: 1,
            groupMinDistance: 0,
        };

        const units = [
            createUnit('Mek 1', 'Mek', 'BattleMek'),
            createUnit('Mek 2', 'Mek', 'BattleMek'),
        ];
        const groups = [
            createLance('Lance A', ['A1', 'A2', 'A3', 'A4']),
            createLance('Lance B', ['B1', 'B2', 'B3', 'B4']),
            createLance('Lance C', ['C1', 'C2', 'C3', 'C4']),
        ];

        const result = evaluateOrgDefinition(definition, units, groups);

        expect(result.unitFacts.length).toBe(2);
        expect(result.groupFacts.length).toBe(3);
        expect(result.ruleEvaluations.get(pointRule)).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(result.ruleEvaluations.get(companyRule)).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
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

    it('evaluates the real IS core definitions module', () => {
        const units = [
            createUnit('Mek 1', 'Mek', 'BattleMek'),
            createUnit('Mek 2', 'Mek', 'BattleMek'),
            createUnit('Mek 3', 'Mek', 'BattleMek'),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('CI 1', 'Infantry', 'Conventional Infantry', false, [], 24),
        ];
        const groups = [
            createFlight('Flight A', ['A1', 'A2']),
            createLance('Lance A', ['L1', 'L2', 'L3', 'L4']),
            createLance('Lance B', ['L5', 'L6', 'L7', 'L8']),
            createLance('Lance C', ['L9', 'L10', 'L11', 'L12']),
        ];

        const result = evaluateOrgDefinition(IS_CORE_ORG, units, groups);

        const lanceEvaluation = result.ruleEvaluations.get(IS_LANCE);
        const airLanceEvaluation = result.ruleEvaluations.get(IS_AIR_LANCE);
        const companyEvaluation = result.ruleEvaluations.get(IS_COMPANY);

        expect(lanceEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(airLanceEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 2,
        }));
        expect(companyEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });

    it('evaluates the real ComStar core definitions module', () => {
        const units = [
            createUnit('Level I Unit', 'Mek', 'BattleMek'),
            createUnit('Choir Mek 1', 'Mek', 'BattleMek Omni', true),
            createUnit('Choir Mek 2', 'Mek', 'BattleMek Omni', true),
            createUnit('Choir Mek 3', 'Mek', 'BattleMek Omni', true),
            createUnit('Choir Mek 4', 'Mek', 'BattleMek Omni', true),
            createUnit('Choir Mek 5', 'Mek', 'BattleMek Omni', true),
            createUnit('Choir Mek 6', 'Mek', 'BattleMek'),
            createUnit('Choir BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('Choir BA 2', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('Choir BA 3', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('Choir BA 4', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('Choir BA 5', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('Choir BA 6', 'Infantry', 'Battle Armor', false, ['XMEC'], 4),
        ];
        const groups = [
            createLevelI('Level I A', ['A1']),
            createLevelI('Level I B', ['B1']),
            createLevelI('Level I C', ['C1']),
            createLevelI('Level I D', ['D1']),
            createLevelI('Level I E', ['E1']),
            createLevelI('Level I F', ['F1']),
            createLevelI('Level I G', ['G1']),
            createLevelI('Level I H', ['H1']),
            createLevelI('Level I I', ['I1']),
            createLevelI('Level I J', ['J1']),
            createLevelI('Level I K', ['K1']),
            createLevelI('Level I L', ['L1']),
            { name: 'Level II A', type: 'Level II', modifierKey: '', countsAsType: null, tier: 1 },
            { name: 'Level II B', type: 'Level II', modifierKey: '', countsAsType: null, tier: 1 },
            { name: 'Level II C', type: 'Level II', modifierKey: '', countsAsType: null, tier: 1 },
            { name: 'Level II D', type: 'Level II', modifierKey: '', countsAsType: null, tier: 1 },
            { name: 'Level II E', type: 'Level II', modifierKey: '', countsAsType: null, tier: 1 },
            { name: 'Level II F', type: 'Level II', modifierKey: '', countsAsType: null, tier: 1 },
        ] as GroupSizeResult[];

        const result = evaluateOrgDefinition(COMSTAR_CORE_ORG, units, groups);

        const choirEvaluation = result.ruleEvaluations.get(COMSTAR_CHOIR);
        const levelIiEvaluation = result.ruleEvaluations.get(COMSTAR_LEVEL_II);
        const levelIiiEvaluation = result.ruleEvaluations.get(COMSTAR_CORE_ORG.rules[3]);

        expect(choirEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 1,
        }));
        expect(levelIiEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(levelIiiEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });

    it('evaluates the real Society core definitions module', () => {
        const units = [
            createUnit('Un Unit', 'Mek', 'BattleMek'),
            createUnit('Battle Armor', 'Infantry', 'Battle Armor', false, ['MEC'], 3),
            createUnit('Proto', 'ProtoMek', 'ProtoMek'),
            createAero('Aero'),
        ];
        const groups = [
            createUn('Un A', ['A1']),
            createUn('Un B', ['B1']),
            createUn('Un C', ['C1']),
            createUn('Un D', ['D1']),
            createUn('Un E', ['E1']),
            createUn('Un F', ['F1']),
            createUn('Un G', ['G1']),
        ];

        const result = evaluateOrgDefinition(SOCIETY_CORE_ORG, units, groups);

        const unEvaluation = result.ruleEvaluations.get(SOCIETY_CORE_ORG.rules[0]);
        const treyEvaluation = result.ruleEvaluations.get(SOCIETY_TREY);
        const septEvaluation = result.ruleEvaluations.get(SOCIETY_SEPT);

        expect(unEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(treyEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 1,
        }));
        expect(septEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });

    it('evaluates the real Marian Hegemony core definitions module', () => {
        const units = [
            createUnit('Mek', 'Mek', 'BattleMek'),
            createUnit('BA', 'Infantry', 'Battle Armor', false, ['MEC'], 5),
            createUnit('CI', 'Infantry', 'Conventional Infantry', false, [], 10),
            createUnit('Mech CI', 'Infantry', 'Mechanized Conventional Infantry', false, [], 5),
        ];
        const groups = [
            createContubernium('C1', 'non-infantry', [createUnit('Mek 1', 'Mek', 'BattleMek')]),
            createContubernium('C2', 'non-infantry', [createUnit('Mek 2', 'Mek', 'BattleMek')]),
            createContubernium('C3', 'non-infantry', [createUnit('Mek 3', 'Mek', 'BattleMek')]),
            createContubernium('C4', 'non-infantry', [createUnit('Mek 4', 'Mek', 'BattleMek')]),
            createContubernium('C5', 'non-infantry', [createUnit('Mek 5', 'Mek', 'BattleMek')]),
            createContubernium('I1', 'infantry', [createUnit('CI 1', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I2', 'infantry', [createUnit('CI 2', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I3', 'infantry', [createUnit('CI 3', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I4', 'infantry', [createUnit('CI 4', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I5', 'infantry', [createUnit('CI 5', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I6', 'infantry', [createUnit('CI 6', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I7', 'infantry', [createUnit('CI 7', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I8', 'infantry', [createUnit('CI 8', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I9', 'infantry', [createUnit('CI 9', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            createContubernium('I10', 'infantry', [createUnit('CI 10', 'Infantry', 'Conventional Infantry', false, [], 10)]),
            { name: 'Maniple A', type: 'Maniple', modifierKey: '', countsAsType: null, tier: 2 },
            { name: 'Maniple B', type: 'Maniple', modifierKey: '', countsAsType: null, tier: 2 },
            { name: 'Cohort A', type: 'Cohort', modifierKey: '', countsAsType: null, tier: 3 },
            { name: 'Cohort B', type: 'Cohort', modifierKey: '', countsAsType: null, tier: 3 },
            { name: 'Cohort C', type: 'Cohort', modifierKey: '', countsAsType: null, tier: 3 },
            { name: 'Cohort D', type: 'Cohort', modifierKey: '', countsAsType: null, tier: 3 },
        ] as GroupSizeResult[];

        const result = evaluateOrgDefinition(MH_CORE_ORG, units, groups);

        const centuryNonInfantryEvaluation = result.ruleEvaluations.get(MH_CENTURY_NON_INFANTRY);
        const centuryInfantryEvaluation = result.ruleEvaluations.get(MH_CENTURY_INFANTRY);
        const legionEvaluation = result.ruleEvaluations.get(MH_LEGION);

        expect(centuryNonInfantryEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(centuryInfantryEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(legionEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });

    it('evaluates the real Capellan core definitions module', () => {
        const units = [
            createUnit('Mek 1', 'Mek', 'BattleMek'),
            createUnit('Mek 2', 'Mek', 'BattleMek'),
            createUnit('Mek 3', 'Mek', 'BattleMek'),
            createUnit('Mek 4', 'Mek', 'BattleMek'),
            createUnit('BA 1', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
            createUnit('BA 2', 'Infantry', 'Battle Armor', false, ['MEC'], 4),
        ];
        const groups = [
            { name: 'Augmented Company A', type: 'Augmented Company', modifierKey: '', countsAsType: 'Company', tier: 1.95 },
            { name: 'Augmented Company B', type: 'Augmented Company', modifierKey: '', countsAsType: 'Company', tier: 1.95 },
            { name: 'Augmented Company C', type: 'Augmented Company', modifierKey: '', countsAsType: 'Company', tier: 1.95 },
            { name: 'Augmented Company D', type: 'Augmented Company', modifierKey: '', countsAsType: 'Company', tier: 1.95 },
            { name: 'Augmented Battalion A', type: 'Augmented Battalion', modifierKey: '', countsAsType: 'Battalion', tier: 3 },
            { name: 'Augmented Battalion B', type: 'Augmented Battalion', modifierKey: '', countsAsType: 'Battalion', tier: 3 },
            { name: 'Augmented Battalion C', type: 'Augmented Battalion', modifierKey: '', countsAsType: 'Battalion', tier: 3 },
            { name: 'Battalion A', type: 'Battalion', modifierKey: '', countsAsType: null, tier: 3 },
        ] as GroupSizeResult[];

        const result = evaluateOrgDefinition(CC_CORE_ORG, units, groups);

        const augmentedLanceEvaluation = result.ruleEvaluations.get(CC_AUGMENTED_LANCE);
        const augmentedCompanyEvaluation = result.ruleEvaluations.get(CC_AUGMENTED_COMPANY);
        const augmentedRegimentEvaluation = result.ruleEvaluations.get(CC_AUGMENTED_REGIMENT);

        expect(augmentedLanceEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(augmentedCompanyEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(augmentedRegimentEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });

    it('evaluates the Clan supernova and cluster composed rules', () => {
        const supernovaGroups = [
            createBattleMekGroup('Supernova Binary A', 'Supernova Binary', 2, 20, 'Binary'),
            createBattleMekGroup('Nova A', 'Nova', 1.7, 10, 'Star'),
        ].map((group) => compileGroupFacts(group));
        const clusterGroups = [
            createBattleMekGroup('Binary A', 'Binary', 1.8, 10),
            createBattleMekGroup('Binary B', 'Binary', 1.8, 10),
            createBattleMekGroup('Trinary A', 'Trinary', 2, 15),
        ].map((group) => compileGroupFacts(group));

        const supernovaTrinaryResult = evaluateComposedCountRule(CLAN_SUPERNOVA_TRINARY, supernovaGroups);
        const clusterResult = evaluateComposedCountRule(CLAN_CLUSTER, clusterGroups);

        expect(supernovaTrinaryResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 2, copies: 1, tier: 2.5 },
        ]);
        expect(supernovaTrinaryResult.leftoverCount).toBe(0);
        expect(clusterResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 3, copies: 1, tier: 3 },
        ]);
        expect(clusterResult.leftoverCount).toBe(0);
    });

    it('materializes composed-count rules into parent groups with preserved children', () => {
        const groups = materializeComposedCountRule(IS_COMPANY, [
            compileGroupFacts(createLance('Lance A', ['A1', 'A2', 'A3', 'A4'])),
            compileGroupFacts(createLance('Lance B', ['B1', 'B2', 'B3', 'B4'])),
            compileGroupFacts(createLance('Lance C', ['C1', 'C2', 'C3', 'C4'])),
        ]);

        expect(groups.groups).toEqual([
            jasmine.objectContaining({ name: 'Company', type: 'Company', modifierKey: '' }),
        ]);
        expect(groups.groups[0].children?.length).toBe(3);
        expect(groups.groups[0].children?.every((child) => child.type === 'Lance')).toBeTrue();
        expect(groups.leftoverGroupFacts).toEqual([]);
    });

    it('evaluates the Wolf\'s Dragoons mixed company and battalion rules', () => {
        const companyGroups = [
            createLance('Lance A', ['L1', 'L2', 'L3', 'L4']),
            createBattleMekGroup('Star A', 'Star', 1, 5),
            createBattleMekGroup('Star B', 'Star', 1, 5),
        ].map((group) => compileGroupFacts(group));
        const battalionGroups = [
            createBattleMekGroup('Company A', 'Company', 2, 12),
            createBattleMekGroup('Binary A', 'Binary', 1.8, 10, 'Company'),
            createBattleMekGroup('Trinary A', 'Trinary', 2, 15, 'Company'),
        ].map((group) => compileGroupFacts(group));

        const companyResult = evaluateComposedCountRule(WD_COMPANY, companyGroups);
        const battalionResult = evaluateComposedCountRule(WD_BATTALION, battalionGroups);

        expect(companyResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 3, copies: 1, tier: 2 },
        ]);
        expect(companyResult.leftoverCount).toBe(0);
        expect(battalionResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 3, copies: 1, tier: 3 },
        ]);
        expect(battalionResult.leftoverCount).toBe(0);
    });

    it('evaluates the Wolf\'s Dragoons single selector without BA, CI, or aerospace', () => {
        const units = compileUnitFactsList([
            createUnit('WD Mek', 'Mek', 'BattleMek'),
            createUnit('WD Tank', 'Tank', 'Combat Vehicle'),
            createUnit('WD BA', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('WD CI', 'Infantry', 'Conventional Infantry', false, [], 10),
            createAero('WD Aero'),
        ]);

        const result = evaluateLeafCountRule(WD_SINGLE, units);

        expect(result.eligibleUnits.map((facts) => facts.unit.name)).toEqual([
            'WD Mek',
            'WD Tank',
        ]);
        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 1, copies: 2, tier: 0 },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates the Wolf\'s Dragoons point selector with BA but without CI or aerospace', () => {
        const units = compileUnitFactsList([
            createUnit('WD Mek', 'Mek', 'BattleMek'),
            createUnit('WD Tank', 'Tank', 'Combat Vehicle'),
            createUnit('WD BA', 'Infantry', 'Battle Armor', false, [], 4),
            createUnit('WD CI', 'Infantry', 'Conventional Infantry', false, [], 10),
            createAero('WD Aero'),
        ]);

        const result = evaluateLeafCountRule(WD_POINT, units);

        expect(result.eligibleUnits.map((facts) => facts.unit.name)).toEqual([
            'WD Mek',
            'WD Tank',
            'WD BA',
        ]);
        expect(result.emitted).toEqual([
            { modifierKey: '', perGroupCount: 1, copies: 3, tier: 0 },
        ]);
        expect(result.leftoverCount).toBe(0);
    });

    it('evaluates the Wolf\'s Dragoons lance from Singles, not Points', () => {
        const singleGroups = [
            createBattleMekGroup('Single A', 'Single', 0, 1),
            createBattleMekGroup('Single B', 'Single', 0, 1),
            createBattleMekGroup('Single C', 'Single', 0, 1),
            createBattleMekGroup('Single D', 'Single', 0, 1),
        ].map((group) => compileGroupFacts(group));
        const pointGroups = [
            createBattleMekGroup('Point A', 'Point', 0, 1),
            createBattleMekGroup('Point B', 'Point', 0, 1),
            createBattleMekGroup('Point C', 'Point', 0, 1),
            createBattleMekGroup('Point D', 'Point', 0, 1),
        ].map((group) => compileGroupFacts(group));

        const singleResult = evaluateComposedCountRule(WD_LANCE, singleGroups);
        const pointResult = evaluateComposedCountRule(WD_LANCE, pointGroups);

        expect(singleResult.emitted).toEqual([
            { modifierKey: '', perGroupCount: 4, copies: 1, tier: 1 },
        ]);
        expect(singleResult.leftoverCount).toBe(0);
        expect(pointResult.acceptedGroups.length).toBe(0);
        expect(pointResult.emitted).toEqual([]);
    });

    it('resolves new-path org definitions by faction registry', () => {
        expect(resolveOrgDefinitionSpec('Word of Blake', 'Inner Sphere')).toBe(COMSTAR_CORE_ORG);
        expect(resolveOrgDefinitionSpec('Wolf\'s Dragoons', 'Mercenary')).toBe(WD_CORE_ORG);
        expect(resolveOrgDefinitionSpec('Capellan Confederation', 'Inner Sphere')).toBe(CC_CORE_ORG);
        expect(resolveOrgDefinitionSpec('Unknown Clan', 'HW Clan')).toBe(CLAN_CORE_ORG);
    });

    it('falls back to the new-path default org definition', () => {
        expect(resolveOrgDefinitionSpec('Federated Suns', 'Inner Sphere')).toBe(DEFAULT_ORG_SPEC);
    });

    it('evaluates a faction org definition through the new-path registry helper', () => {
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

    it('evaluates a fallback faction org definition through the new-path registry helper', () => {
        const units = [
            createUnit('IS Mek 1', 'Mek', 'BattleMek'),
            createUnit('IS Mek 2', 'Mek', 'BattleMek'),
            createUnit('IS Mek 3', 'Mek', 'BattleMek'),
            createUnit('IS Mek 4', 'Mek', 'BattleMek'),
        ];

        const result = evaluateFactionOrgDefinition('Federated Suns', 'Inner Sphere', units);
        const lanceEvaluation = result.ruleEvaluations.get(IS_LANCE);

        expect(lanceEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });

    it('evaluates the real Wolf\'s Dragoons core definitions module', () => {
        const units = [
            ...Array.from({ length: 5 }, (_, index) =>
                createUnit(`WD BM ${index + 1}`, 'Mek', 'BattleMek Omni', true),
            ),
            ...Array.from({ length: 5 }, (_, index) =>
                createUnit(`WD BA ${index + 1}`, 'Infantry', 'Battle Armor', false, ['MEC'], 5),
            ),
            createUnit('WD CI 1', 'Infantry', 'Conventional Infantry', false, [], 10),
        ];
        const groups = [
            createLance('WD Lance A', ['WL1', 'WL2', 'WL3', 'WL4']),
            createBattleMekGroup('WD Star A', 'Star', 1, 5),
            createBattleMekGroup('WD Star B', 'Star', 1, 5),
            createBattleMekGroup('WD Company A', 'Company', 2, 12),
            createBattleMekGroup('WD Binary A', 'Binary', 1.8, 10, 'Company'),
            createBattleMekGroup('WD Trinary A', 'Trinary', 2, 15, 'Company'),
        ];

        const result = evaluateOrgDefinition(WD_CORE_ORG, units, groups);

        const novaEvaluation = result.ruleEvaluations.get(WD_NOVA);
        const platoonRule = WD_CORE_ORG.rules.find((rule) => rule.type === 'Platoon');
        const platoonEvaluation = platoonRule ? result.ruleEvaluations.get(platoonRule) : undefined;
        const companyEvaluation = result.ruleEvaluations.get(WD_COMPANY);
        const battalionEvaluation = result.ruleEvaluations.get(WD_BATTALION);

        expect(novaEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(platoonEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(companyEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
        expect(battalionEvaluation).toEqual(jasmine.objectContaining({
            leftoverCount: 0,
        }));
    });
});
describe('legacy resolver compatibility', () => {
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
    internal: number = 28,
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
    const groupOne: Unit[] = Array.from({ length: 10 }, (_, iteration) =>
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

    it('resolves 4 BA troopers as a Single for Inner Sphere orgs', () => {
        const result = resolveFromUnits([createBA('IS-BA-1', [], 4)], 'Federated Suns', 'Inner Sphere');

        expect(result.length).toBe(1);
        expect(result[0].name).toBe('Single');
        expect(result[0].type).toBe('Single');
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
});

