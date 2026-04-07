import { GameSystem } from '../models/common.model';
import { FACTION_MERCENARY, type Faction, type FactionAffinity } from '../models/factions.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { UnitGroup } from '../models/force.model';
import type { Unit } from '../models/units.model';
import type { FormationTypeDefinition } from './formation-type.model';
import { FormationNamerUtil } from './formation-namer.util';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import type { GroupSizeResult } from './org/org-types';

function createUnit(
    id: number,
    name: string,
    unitType: Unit['type'],
    subtype: string,
    tp: Unit['as']['TP'],
    overrides: Partial<Unit> = {},
): Unit {
    return {
        id,
        name,
        chassis: name,
        model: name,
        year: 3050,
        weightClass: 'Heavy',
        tons: 70,
        offSpeedFactor: 0,
        bv: 0,
        pv: 0,
        cost: 0,
        level: 0,
        techBase: 'Clan',
        techRating: 'D',
        type: unitType,
        subtype,
        omni: 0,
        engine: 'Fusion',
        engineRating: 0,
        engineHS: 0,
        engineHSType: 'Heat Sink',
        source: [],
        role: 'Brawler',
        armorType: '',
        structureType: '',
        armor: 0,
        armorPer: 0,
        internal: 1,
        heat: 0,
        dissipation: 0,
        moveType: unitType === 'Aero' ? 'a' : 'Tracked',
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
        ...overrides,
        as: {
            TP: tp,
            PV: 0,
            SZ: tp === 'AF' ? 2 : tp === 'BA' ? 1 : 3,
            TMM: 0,
            MV: '',
            ROLE: '',
            SKILL: 4,
            M: 0,
            S: 0,
            MSL: 0,
            L: 0,
            OV: 0,
            ARM: 0,
            STR: 0,
            specials: [],
            ...(overrides.as ?? {}),
        },
    } as unknown as Unit;
}

function createForceUnit(unit: Unit, gameSystem = GameSystem.ALPHA_STRIKE): ForceUnit {
    const force = {
        faction: () => createFaction('Mercenary', 'Mercenary'),
        era: () => null,
        techBase: () => 'Inner Sphere',
        gameSystem,
    };

    return {
        force,
        getUnit: () => unit,
        getBv: () => 0,
        pilotSkill: () => 4,
        gunnerySkill: () => 4,
    } as unknown as ForceUnit;
}

function createFaction(name: string, group: FactionAffinity): Faction {
    return {
        id: group === 'Mercenary' ? FACTION_MERCENARY : 1,
        name,
        group,
        img: '',
        eras: {},
    };
}

function createResolvedGroup(overrides: Partial<GroupSizeResult>): GroupSizeResult {
    return {
        name: 'Group',
        type: null,
        modifierKey: '',
        countsAsType: null,
        tier: 0,
        ...overrides,
    };
}

function createTestGroup(
    units: readonly Unit[],
    resolvedGroups: readonly GroupSizeResult[],
    faction: Faction,
): UnitGroup<ForceUnit> {
    const force = {
        faction: () => faction,
        era: () => null,
        techBase: () => (faction.group.includes('Clan') ? 'Clan' : 'Inner Sphere'),
        gameSystem: GameSystem.ALPHA_STRIKE,
    };

    const forceUnits = units.map((unit) => ({
        force,
        getUnit: () => unit,
        getBv: () => 0,
        pilotSkill: () => 4,
        gunnerySkill: () => 4,
    })) as unknown as ForceUnit[];

    return {
        force,
        units: () => forceUnits,
        organizationalResult: () => ({
            name: resolvedGroups.map((group) => group.name).join(' + '),
            tier: resolvedGroups[0]?.tier ?? 0,
            groups: resolvedGroups,
        }),
        organizationalName: () => resolvedGroups.map((group) => group.name).join(' + '),
        formationHistory: new Set<string>(),
    } as unknown as UnitGroup<ForceUnit>;
}

describe('LanceTypeIdentifierUtil organization-aware requirement filtering', () => {
    const bmOnlyStarFormation: FormationTypeDefinition = {
        id: 'test-bm-only-star',
        name: 'Test BM Star',
        description: 'Test formation that only matches five BattleMeks.',
        minUnits: 5,
        validator: (units, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
            && units.length === 5
            && units.every((unit) => unit.getUnit().as?.TP === 'BM'),
    };

    const bmOnlyLanceFormation: FormationTypeDefinition = {
        id: 'test-bm-only-lance',
        name: 'Test BM Lance',
        description: 'Test formation that only matches four BattleMeks.',
        minUnits: 4,
        validator: (units, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
            && units.length === 4
            && units.every((unit) => unit.getUnit().as?.TP === 'BM'),
    };

    const bmHeavyFormation: FormationTypeDefinition = {
        id: 'test-bm-heavy-formation',
        name: 'Test BM Heavy Formation',
        description: 'Test formation that still passes on the full list but should be marked filtered when structural units are ignored.',
        minUnits: 3,
        validator: (units, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
            && units.filter((unit) => unit.getUnit().as?.TP === 'BM').length >= 3,
    };

    it('uses Nova org metadata to ignore only the Battle Armor child star', () => {
        const faction = createFaction('Clan Test', 'HW Clan');
        const bmUnits = Array.from({ length: 5 }, (_, index) => createUnit(index + 1, `BM-${index + 1}`, 'Mek', 'BattleMek', 'BM'));
        const baUnits = Array.from({ length: 5 }, (_, index) => createUnit(index + 101, `BA-${index + 1}`, 'Infantry', 'Battle Armor', 'BA'));
        const group = createTestGroup(
            [...bmUnits, ...baUnits],
            [createResolvedGroup({
                name: 'Nova',
                type: 'Nova',
                countsAsType: 'Star',
                tier: 1.9,
                children: [
                    createResolvedGroup({ name: 'Star', type: 'Star', tier: 1, units: baUnits }),
                    createResolvedGroup({ name: 'Star', type: 'Star', tier: 1, units: bmUnits }),
                ],
            })],
            faction,
        );

        spyOn(LanceTypeIdentifierUtil, 'identifyLanceTypes').and.callFake((units, _techBase, _factionName, gameSystem) => (
            bmOnlyStarFormation.validator?.(units, gameSystem) ? [bmOnlyStarFormation] : []
        ));

        const matches = FormationNamerUtil.getAvailableFormationDefinitions(group);

        expect(matches).toEqual([
            jasmine.objectContaining({
                definition: bmOnlyStarFormation,
                requirementsFiltered: true,
                requirementsFilterNotice: 'Battle Armor child groups are ignored for formation requirements.',
            }),
        ]);
    });

    it('uses Air Lance org metadata to ignore the Flight child group', () => {
        const faction = createFaction('Federated Suns', 'Inner Sphere');
        const bmUnits = Array.from({ length: 4 }, (_, index) => createUnit(index + 1, `BM-${index + 1}`, 'Mek', 'BattleMek', 'BM'));
        const flightUnits = Array.from({ length: 2 }, (_, index) => createUnit(index + 201, `AF-${index + 1}`, 'Aero', 'Aerospace Fighter', 'AF'));
        const group = createTestGroup(
            [...bmUnits, ...flightUnits],
            [createResolvedGroup({
                name: 'Air Lance',
                type: 'Air Lance',
                countsAsType: 'Lance',
                tier: 1.5,
                children: [
                    createResolvedGroup({ name: 'Flight', type: 'Flight', tier: 1, units: flightUnits }),
                    createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: bmUnits }),
                ],
            })],
            faction,
        );

        const match = LanceTypeIdentifierUtil.isFormationValidForGroup(bmOnlyLanceFormation, group);

        expect(match).toEqual(jasmine.objectContaining({
            definition: bmOnlyLanceFormation,
            requirementsFiltered: true,
            requirementsFilterNotice: 'Flight child groups are ignored for formation requirements.',
        }));
    });

    it('marks filtered matches even when the full Nova unit list also satisfies the validator', () => {
        const faction = createFaction('Clan Test', 'HW Clan');
        const bmUnits = Array.from({ length: 5 }, (_, index) => createUnit(index + 1, `BM-${index + 1}`, 'Mek', 'BattleMek', 'BM'));
        const baUnits = Array.from({ length: 5 }, (_, index) => createUnit(index + 101, `BA-${index + 1}`, 'Infantry', 'Battle Armor', 'BA'));
        const group = createTestGroup(
            [...bmUnits, ...baUnits],
            [createResolvedGroup({
                name: 'Nova',
                type: 'Nova',
                countsAsType: 'Star',
                tier: 1.9,
                children: [
                    createResolvedGroup({ name: 'Star', type: 'Star', tier: 1, units: baUnits }),
                    createResolvedGroup({ name: 'Star', type: 'Star', tier: 1, units: bmUnits }),
                ],
            })],
            faction,
        );

        const match = LanceTypeIdentifierUtil.isFormationValidForGroup(bmHeavyFormation, group);

        expect(match).toEqual(jasmine.objectContaining({
            definition: bmHeavyFormation,
            requirementsFiltered: true,
            requirementsFilterNotice: 'Battle Armor child groups are ignored for formation requirements.',
        }));
    });

    it('does not apply requirement filtering when the group resolves to multiple top-level organizations', () => {
        const faction = createFaction('Clan Test', 'HW Clan');
        const bmUnits = Array.from({ length: 5 }, (_, index) => createUnit(index + 1, `BM-${index + 1}`, 'Mek', 'BattleMek', 'BM'));
        const baUnits = Array.from({ length: 5 }, (_, index) => createUnit(index + 101, `BA-${index + 1}`, 'Infantry', 'Battle Armor', 'BA'));
        const extraPointUnit = createUnit(999, 'PM-1', 'ProtoMek', 'ProtoMek', 'PM');
        const group = createTestGroup(
            [...bmUnits, ...baUnits, extraPointUnit],
            [
                createResolvedGroup({
                    name: 'Nova',
                    type: 'Nova',
                    countsAsType: 'Star',
                    tier: 1.9,
                    children: [
                        createResolvedGroup({ name: 'Star', type: 'Star', tier: 1, units: baUnits }),
                        createResolvedGroup({ name: 'Star', type: 'Star', tier: 1, units: bmUnits }),
                    ],
                }),
                createResolvedGroup({ name: 'Point', type: 'Point', tier: 0, units: [extraPointUnit] }),
            ],
            faction,
        );

        const match = LanceTypeIdentifierUtil.isFormationValidForGroup(bmOnlyStarFormation, group);

        expect(match).toBeNull();
    });
});

describe('LanceTypeIdentifierUtil CBT weight-class validation', () => {
    it('matches medium battle lance for classic medium meks without requiring vehicles', () => {
        const definition = LanceTypeIdentifierUtil.getDefinitionById('medium-battle-lance', GameSystem.CLASSIC);

        expect(definition).not.toBeNull();

        const units: ForceUnit[] = [
            createForceUnit(createUnit(1, 'Medium-1', 'Mek', 'BattleMek', 'BM', { weightClass: 'Medium' }), GameSystem.CLASSIC),
            createForceUnit(createUnit(2, 'Medium-2', 'Mek', 'BattleMek', 'BM', { weightClass: 'Medium' }), GameSystem.CLASSIC),
            createForceUnit(createUnit(3, 'Medium-3', 'Mek', 'BattleMek', 'BM', { weightClass: 'Medium' }), GameSystem.CLASSIC),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition!, units, GameSystem.CLASSIC)).toBeTrue();
    });

    it('matches light battle lance for classic light meks using the real CBT light class', () => {
        const definition = LanceTypeIdentifierUtil.getDefinitionById('light-battle-lance', GameSystem.CLASSIC);

        expect(definition).not.toBeNull();

        const units: ForceUnit[] = [
            createForceUnit(createUnit(11, 'Light-Scout', 'Mek', 'BattleMek', 'BM', { weightClass: 'Light', role: 'Scout' }), GameSystem.CLASSIC),
            createForceUnit(createUnit(12, 'Light-2', 'Mek', 'BattleMek', 'BM', { weightClass: 'Light' }), GameSystem.CLASSIC),
            createForceUnit(createUnit(13, 'Light-3', 'Mek', 'BattleMek', 'BM', { weightClass: 'Light' }), GameSystem.CLASSIC),
            createForceUnit(createUnit(14, 'Light-4', 'Mek', 'BattleMek', 'BM', { weightClass: 'Light' }), GameSystem.CLASSIC),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition!, units, GameSystem.CLASSIC)).toBeTrue();
    });
});