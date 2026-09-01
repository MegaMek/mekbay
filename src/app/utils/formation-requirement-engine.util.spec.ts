// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem, Rulebook } from '../models/common.model';
import type { Faction } from '../models/factions.model';
import type { ForceUnit } from '../models/force-unit.model';
import { createEmptyUnit, type TestUnitOverrides } from '../testing/unit-test-helpers';
import { getFormationDefinitions } from './formation-blueprints';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import { FormationRequirementEngine } from './formation-requirement-engine.util';

const CLAN_FACTION: Faction = {
    id: 1,
    name: 'Clan Wolf',
    group: 'IS Clan',
    img: '',
    eras: {},
};

function createUnit(id: number, name: string, overrides: TestUnitOverrides = {}) {
    const { as: asOverrides, ...unitOverrides } = overrides;

    return createEmptyUnit({
        id,
        name,
        chassis: name,
        model: 'Prime',
        year: 3050,
        type: 'Mek',
        subtype: 'BattleMek',
        weightClass: 'Medium',
        role: 'Skirmisher',
        ...unitOverrides,
        as: {
            TP: 'BM',
            SZ: 2,
            ...asOverrides,
        },
    });
}

function createForceUnit(
    unit: ReturnType<typeof createUnit>,
    gameSystem = GameSystem.AS,
    options: { faction?: Faction; pilotSkill?: number; gunnerySkill?: number } = {},
): ForceUnit {
    const force = {
        faction: () => options.faction ?? null,
        era: () => null,
        techBase: () => 'Inner Sphere',
        gameSystem,
    };

    return {
        force,
        getSummary: () => unit,
        getFormationSummary: () => unit,
        getBv: () => 0,
        pilotSkill: () => options.pilotSkill ?? 4,
        gunnerySkill: () => options.gunnerySkill ?? 4,
    } as unknown as ForceUnit;
}

function definition(id: string, gameSystem = GameSystem.AS) {
    const result = LanceTypeIdentifierUtil.getDefinitionById(id, gameSystem);
    expect(result).not.toBeNull();
    return result!;
}

describe('FormationRequirementEngine', () => {
    it('exposes blueprints for the first migrated formation slice', () => {
        expect(FormationRequirementEngine.hasBlueprint('anti-mech-lance')).toBeTrue();
        expect(FormationRequirementEngine.hasBlueprint('anti-air-lance')).toBeTrue();
        expect(FormationRequirementEngine.hasBlueprint('not-migrated')).toBeFalse();
    });

    it('has a blueprint for every current formation definition', () => {
        const missingBlueprintIds = [GameSystem.CBT, GameSystem.AS]
            .flatMap(gameSystem => getFormationDefinitions(gameSystem))
            .filter((formationDefinition) => !FormationRequirementEngine.hasBlueprint(formationDefinition.id))
            .map((formationDefinition) => formationDefinition.id);

        expect(missingBlueprintIds).toEqual([]);
    });

    it('validates Anti-Mech Lance infantry requirements for Alpha Strike and CBT', () => {
        const alphaStrikeUnits = [
            createForceUnit(createUnit(1, 'BA-1', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } })),
            createForceUnit(createUnit(2, 'CI-1', { type: 'Infantry', subtype: 'Conventional Infantry', as: { TP: 'CI' } })),
            createForceUnit(createUnit(3, 'PM-1', { type: 'ProtoMek', subtype: 'ProtoMek', as: { TP: 'PM' } })),
        ];
        const cbtUnits = [
            createForceUnit(createUnit(4, 'Inf-1', { type: 'Infantry', subtype: 'Conventional Infantry' }), GameSystem.CBT),
            createForceUnit(createUnit(5, 'Inf-2', { type: 'Infantry', subtype: 'Conventional Infantry' }), GameSystem.CBT),
            createForceUnit(createUnit(6, 'Inf-3', { type: 'Infantry', subtype: 'Battle Armor' }), GameSystem.CBT),
        ];
        const invalidUnits = [
            ...alphaStrikeUnits.slice(0, 2),
            createForceUnit(createUnit(7, 'Mek-1', { as: { TP: 'BM' } })),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('anti-mech-lance'), alphaStrikeUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('anti-mech-lance', GameSystem.CBT), cbtUnits, GameSystem.CBT)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('anti-mech-lance'), invalidUnits, GameSystem.AS)).toBeFalse();
    });

    it('validates flattened Anti-Air Lance parent and equipment requirements', () => {
        const validUnits = [
            createForceUnit(createUnit(1, 'Fire-1', { role: 'Missile Boat', as: { specials: ['FLK1/1/1'] } })),
            createForceUnit(createUnit(2, 'Fire-2', { role: 'Sniper', as: { specials: ['AC1/1/1'] } })),
            createForceUnit(createUnit(3, 'Fire-3', { role: 'Sniper' })),
            createForceUnit(createUnit(4, 'Line-1', { role: 'Brawler' })),
        ];
        const missingFireRoleUnits = [
            createForceUnit(createUnit(5, 'AA-1', { role: 'Missile Boat', as: { specials: ['FLK1/1/1'] } })),
            createForceUnit(createUnit(6, 'AA-2', { role: 'Brawler', as: { specials: ['AC1/1/1'] } })),
            createForceUnit(createUnit(7, 'AA-3', { role: 'Brawler' })),
            createForceUnit(createUnit(8, 'AA-4', { role: 'Brawler' })),
        ];
        const missingEquipmentUnits = [
            createForceUnit(createUnit(9, 'Fire-4', { role: 'Missile Boat', as: { specials: ['FLK1/1/1'] } })),
            createForceUnit(createUnit(10, 'Fire-5', { role: 'Sniper' })),
            createForceUnit(createUnit(11, 'Fire-6', { role: 'Sniper' })),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('anti-air-lance'), validUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('anti-air-lance'), missingFireRoleUnits, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('anti-air-lance'), missingEquipmentUnits, GameSystem.AS)).toBeFalse();
    });

    it('preserves idealRole short-circuiting before detailed constraints', () => {
        const lightBrawlers = [
            createForceUnit(createUnit(1, 'Light-1', { role: 'Brawler', weightClass: 'Light', as: { SZ: 1 } })),
            createForceUnit(createUnit(2, 'Light-2', { role: 'Brawler', weightClass: 'Light', as: { SZ: 1 } })),
            createForceUnit(createUnit(3, 'Light-3', { role: 'Brawler', weightClass: 'Light', as: { SZ: 1 } })),
        ];
        const evaluation = FormationRequirementEngine.evaluateDefinition(
            definition('battle-lance'),
            lightBrawlers,
            GameSystem.AS,
        );

        expect(evaluation?.shortCircuitedByIdealRole).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('battle-lance'), lightBrawlers, GameSystem.AS)).toBeTrue();
    });

    it('enforces Battle Lance vehicle pairs only in CBT', () => {
        const validVehiclePairs = [
            createForceUnit(createUnit(1, 'Vehicle-A', { type: 'Tank', subtype: 'Combat Vehicle', weightClass: 'Heavy', role: 'Brawler', as: { TP: 'CV', SZ: 3 } })),
            createForceUnit(createUnit(2, 'Vehicle-A', { type: 'Tank', subtype: 'Combat Vehicle', weightClass: 'Heavy', role: 'Sniper', as: { TP: 'CV', SZ: 3 } })),
            createForceUnit(createUnit(3, 'Vehicle-B', { type: 'Tank', subtype: 'Combat Vehicle', weightClass: 'Heavy', role: 'Skirmisher', as: { TP: 'CV', SZ: 3 } })),
            createForceUnit(createUnit(4, 'Vehicle-B', { type: 'Tank', subtype: 'Combat Vehicle', weightClass: 'Heavy', role: 'Scout', as: { TP: 'CV', SZ: 3 } })),
        ];
        const unmatchedVehicles = validVehiclePairs.map((forceUnit, index) => {
            const unit = forceUnit.getSummary();
            return createForceUnit(createUnit(index + 10, `${unit.name}-${index}`, {
                type: 'Tank',
                subtype: 'Combat Vehicle',
                weightClass: 'Heavy',
                role: unit.role,
                as: { TP: 'CV', SZ: 3 },
            }));
        });

        expect(LanceTypeIdentifierUtil.isValid(definition('battle-lance', GameSystem.CBT), validVehiclePairs, GameSystem.CBT)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('battle-lance', GameSystem.CBT), unmatchedVehicles, GameSystem.CBT)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('battle-lance'), unmatchedVehicles, GameSystem.AS)).toBeTrue();
    });

    it('requires every non-Fire-Support fighter in a Fire Support Squadron to be a Dogfighter', () => {
        const validUnits = Array.from({ length: 6 }, (_, index) => createForceUnit(createUnit(index + 1, `Fighter-${index}`, {
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            role: index < 3 ? 'Fire Support' : 'Dogfighter',
            as: { TP: 'AF' },
        })));
        const invalidUnits = [
            ...validUnits.slice(0, 5),
            createForceUnit(createUnit(10, 'Interceptor', {
                type: 'Aero',
                subtype: 'Aerospace Fighter',
                role: 'Interceptor',
                as: { TP: 'AF' },
            })),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('fire-support-squadron'), validUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('fire-support-squadron'), invalidUnits, GameSystem.AS)).toBeFalse();
    });

    it('does not count the distinct Fast Dogfighter role toward a Strike Squadron majority', () => {
        const units = Array.from({ length: 6 }, (_, index) => createForceUnit(createUnit(index + 1, `Strike-${index}`, {
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            role: index < 4 ? 'Fast Dogfighter' : 'Interceptor',
            as: { TP: 'AF' },
        })));

        expect(LanceTypeIdentifierUtil.isValid(definition('strike-squadron'), units, GameSystem.AS)).toBeFalse();
    });

    it('limits standard aerospace squadrons to aerospace and conventional fighters', () => {
        const alphaStrikeFighters = Array.from({ length: 6 }, (_, index) => createForceUnit(createUnit(index + 1, `AS-Fighter-${index}`, {
            type: 'Aero',
            subtype: index === 5 ? 'Conventional Fighter' : 'Aerospace Fighter',
            role: index < 4 ? 'Interceptor' : 'Fast Dogfighter',
            as: { TP: index === 5 ? 'CF' : 'AF' },
        })));
        const alphaStrikeWithWarShip = [
            ...alphaStrikeFighters.slice(0, 5),
            createForceUnit(createUnit(10, 'WarShip', {
                type: 'Aero',
                subtype: 'WarShip',
                role: 'Fast Dogfighter',
                as: { TP: 'WS' },
            })),
        ];
        const classicFighters = Array.from({ length: 6 }, (_, index) => createForceUnit(createUnit(index + 20, `CBT-Fighter-${index}`, {
            type: 'Aero',
            subtype: index === 5 ? 'Conventional Fighter' : 'Aerospace Fighter',
            role: index < 4 ? 'Interceptor' : 'Fast Dogfighter',
            as: { TP: index === 5 ? 'CF' : 'AF' },
        }), GameSystem.CBT));
        const classicWithDropShip = [
            ...classicFighters.slice(0, 5),
            createForceUnit(createUnit(30, 'DropShip', {
                type: 'Aero',
                subtype: 'Spheroid DropShip',
                role: 'Fast Dogfighter',
                as: { TP: 'DS' },
            }), GameSystem.CBT),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('interceptor-squadron'), alphaStrikeFighters, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('interceptor-squadron'), alphaStrikeWithWarShip, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('interceptor-squadron', GameSystem.CBT), classicFighters, GameSystem.CBT)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('interceptor-squadron', GameSystem.CBT), classicWithDropShip, GameSystem.CBT)).toBeFalse();
    });

    it('allows only the listed Transport Squadron craft and airborne support vehicles', () => {
        const permittedTransportUnits: Array<{ name: string; overrides: TestUnitOverrides }> = [
            { name: 'Aerospace Fighter', overrides: { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } } },
            { name: 'Conventional Fighter', overrides: { type: 'Aero', subtype: 'Conventional Fighter', as: { TP: 'CF' } } },
            { name: 'Small Craft', overrides: { type: 'Aero', subtype: 'Spheroid Small Craft', as: { TP: 'SC' } } },
            { name: 'Spheroid DropShip', overrides: { type: 'Aero', subtype: 'Spheroid DropShip', as: { TP: 'DS' } } },
            { name: 'Aerodyne DropShip', overrides: { type: 'Aero', subtype: 'Aerodyne DropShip', as: { TP: 'DA' } } },
            { name: 'Fixed-Wing Support Vehicle', overrides: { type: 'Aero', subtype: 'Fixed Wing Support Vehicle', as: { TP: 'SV' } } },
        ];
        const alphaStrikeUnits = permittedTransportUnits.map(({ name, overrides }, index) => createForceUnit(createUnit(index + 40, name, {
            ...overrides,
            role: 'Transport',
        })));
        const cbtUnits = permittedTransportUnits.map(({ name, overrides }, index) => createForceUnit(createUnit(index + 50, name, {
            ...overrides,
            role: 'Transport',
        }), GameSystem.CBT));
        const alphaStrikeWithGroundSupportVehicle = [
            ...alphaStrikeUnits.slice(0, 6),
            createForceUnit(createUnit(60, 'Ground Support Vehicle', {
                type: 'Tank',
                subtype: 'Support Vehicle',
                moveType: 'Wheeled',
                role: 'Transport',
                as: { TP: 'SV' },
            })),
        ];
        const classicWithJumpShip = [
            ...cbtUnits.slice(0, 6),
            createForceUnit(createUnit(61, 'JumpShip', {
                type: 'Aero',
                subtype: 'JumpShip',
                role: 'Transport',
                as: { TP: 'JS' },
            }), GameSystem.CBT),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('transport-squadron'), alphaStrikeUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('transport-squadron'), alphaStrikeWithGroundSupportVehicle, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('transport-squadron', GameSystem.CBT), cbtUnits, GameSystem.CBT)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('transport-squadron', GameSystem.CBT), classicWithJumpShip, GameSystem.CBT)).toBeFalse();
    });

    it('does not require a same-model pair in a Vehicle Command Lance', () => {
        const units = [
            createForceUnit(createUnit(1, 'Command Vehicle A', { type: 'Tank', subtype: 'Combat Vehicle', role: 'Sniper', as: { TP: 'CV' } })),
            createForceUnit(createUnit(2, 'Command Vehicle B', { type: 'Tank', subtype: 'Combat Vehicle', role: 'Juggernaut', as: { TP: 'CV' } })),
            createForceUnit(createUnit(3, 'Escort Vehicle', { type: 'Tank', subtype: 'Combat Vehicle', role: 'Scout', as: { TP: 'CV' } })),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('vehicle-command-lance'), units, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('vehicle-command-lance', GameSystem.CBT), units, GameSystem.CBT)).toBeTrue();
    });

    it('validates Order Lance same tier and same chassis constraints', () => {
        const validUnits = [
            createForceUnit(createUnit(1, 'Panther-1', { chassis: 'Panther', as: { SZ: 2 } })),
            createForceUnit(createUnit(2, 'Panther-2', { chassis: 'Panther', as: { SZ: 2 } })),
            createForceUnit(createUnit(3, 'Panther-3', { chassis: 'Panther', as: { SZ: 2 } })),
        ];
        const mixedSizeUnits = [
            ...validUnits.slice(0, 2),
            createForceUnit(createUnit(4, 'Panther-4', { chassis: 'Panther', as: { SZ: 3 } })),
        ];
        const mixedChassisUnits = [
            ...validUnits.slice(0, 2),
            createForceUnit(createUnit(5, 'Dragon-1', { chassis: 'Dragon', as: { SZ: 2 } })),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('order-lance'), validUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('order-lance'), mixedSizeUnits, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('order-lance'), mixedChassisUnits, GameSystem.AS)).toBeFalse();
    });

    it('uses candidate decisions to preserve or obtain an Order Lance', () => {
        const currentUnits = [
            createForceUnit(createUnit(1, 'Panther-1', { chassis: 'Panther', as: { SZ: 2 } })),
            createForceUnit(createUnit(2, 'Panther-2', { chassis: 'Panther', as: { SZ: 2 } })),
        ];
        const matchingCandidate = createForceUnit(createUnit(3, 'Panther-3', { chassis: 'Panther', as: { SZ: 2 } }));
        const wrongChassisCandidate = createForceUnit(createUnit(4, 'Dragon-1', { chassis: 'Dragon', as: { SZ: 2 } }));

        const matchingDecision = FormationRequirementEngine.evaluateSearchCandidate(
            definition('order-lance'),
            currentUnits,
            matchingCandidate,
            GameSystem.AS,
        );
        const wrongChassisDecision = FormationRequirementEngine.evaluateSearchCandidate(
            definition('order-lance'),
            currentUnits,
            wrongChassisCandidate,
            GameSystem.AS,
        );

        expect(matchingDecision.allowed).toBeTrue();
        expect(matchingDecision.fillsDeficit).toBeTrue();
        expect(wrongChassisDecision.allowed).toBeFalse();
        expect(wrongChassisDecision.violatesHardConstraint).toBeTrue();
    });

    it('does not treat minimum unit count progress as filling Artillery Fire requirements', () => {
        const artilleryCandidate = createForceUnit(createUnit(1, 'Artillery-1', { as: { specials: ['ART-LT'] } }));
        const lineCandidate = createForceUnit(createUnit(2, 'Line-1'));

        const artilleryDecision = FormationRequirementEngine.evaluateSearchCandidate(
            definition('artillery-fire-lance'),
            [],
            artilleryCandidate,
            GameSystem.AS,
            { maxUnits: 4 },
        );
        const lineDecision = FormationRequirementEngine.evaluateSearchCandidate(
            definition('artillery-fire-lance'),
            [],
            lineCandidate,
            GameSystem.AS,
            { maxUnits: 4 },
        );

        expect(artilleryDecision.allowed).toBeTrue();
        expect(artilleryDecision.fillsDeficit).toBeTrue();
        expect(lineDecision.allowed).toBeTrue();
        expect(lineDecision.fillsDeficit).toBeFalse();
    });

    it('validates Rogue Star same-model pair requirements', () => {
        const validUnits = [
            createForceUnit(createUnit(1, 'Adder Prime', { as: { TP: 'BM' } }), GameSystem.AS, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(2, 'Adder Prime', { as: { TP: 'BM' } }), GameSystem.AS, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(3, 'Kit Fox Prime', { as: { TP: 'BM' } }), GameSystem.AS, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(4, 'Nova Prime', { as: { TP: 'BM' } }), GameSystem.AS, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(5, 'Stormcrow Prime', { as: { TP: 'BM' } }), GameSystem.AS, { faction: CLAN_FACTION }),
        ];
        const invalidUnits = validUnits.map((forceUnit, index) => createForceUnit(createUnit(index + 10, `${forceUnit.getSummary().name}-${index}`, {
            as: { TP: 'BM' },
        }), GameSystem.AS, { faction: CLAN_FACTION }));

        expect(LanceTypeIdentifierUtil.isValid(definition('rogue-star'), validUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('rogue-star'), invalidUnits, GameSystem.AS)).toBeFalse();
    });

    it('validates Strategic Command Star aerospace, skill, and heavy Mek constraints', () => {
        const validUnits = [
            createForceUnit(createUnit(1, 'Timber Wolf', { weightClass: 'Heavy', as: { TP: 'BM', SZ: 3 } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(2, 'Dire Wolf', { weightClass: 'Assault', as: { TP: 'BM', SZ: 4 } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 2 }),
            createForceUnit(createUnit(3, 'Visigoth', { type: 'Aero', subtype: 'Aerospace Fighter', role: 'Interceptor', as: { TP: 'AF' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(4, 'Batu', { type: 'Aero', subtype: 'Aerospace Fighter', role: 'Fast Dogfighter', as: { TP: 'AF' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(5, 'Elemental', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];
        const oneAeroUnit = [
            validUnits[0],
            validUnits[1],
            validUnits[2],
            validUnits[4],
            createForceUnit(createUnit(6, 'Executioner', { weightClass: 'Assault', as: { TP: 'BM', SZ: 4 } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];
        const lowSkillUnits = validUnits.map((forceUnit, index) => createForceUnit(forceUnit.getSummary(), GameSystem.AS, {
            faction: CLAN_FACTION,
            pilotSkill: index === 0 ? 4 : 3,
        }));
        const warshipUnits = [
            ...validUnits,
            createForceUnit(createUnit(6, 'Vincent Corvette', { type: 'Aero', subtype: 'WarShip', as: { TP: 'WS', SZ: 5 } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];
        const industrialMekUnits = [
            createForceUnit(createUnit(7, 'Visigoth II', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(8, 'Batu II', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(9, 'IndustrialMech A', { weightClass: 'Heavy', as: { TP: 'IM', SZ: 3 } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(10, 'IndustrialMech B', { weightClass: 'Assault', as: { TP: 'IM', SZ: 4 } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), validUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), oneAeroUnit, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), lowSkillUnits, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), warshipUnits, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), industrialMekUnits, GameSystem.AS)).toBeFalse();
    });

    it('allows Strategic Command search to pick a first heavy Mek setup unit', () => {
        const definitionUnderTest = definition('strategic-command-star');
        const currentUnits = [
            createForceUnit(createUnit(1, 'Visigoth', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(2, 'Batu', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];
        const heavyMek = createForceUnit(createUnit(3, 'Timber Wolf', { weightClass: 'Heavy', as: { TP: 'BM', SZ: 3 } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 });
        const lightMek = createForceUnit(createUnit(4, 'Adder', { weightClass: 'Light', as: { TP: 'BM', SZ: 1 } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 });
        const heavyMekDecision = FormationRequirementEngine.evaluateSearchCandidate(definitionUnderTest, currentUnits, heavyMek, GameSystem.AS, { maxUnits: 12 });

        expect(heavyMekDecision.allowed).toBeTrue();
        expect(heavyMekDecision.fillsDeficit).toBeTrue();
        expect(FormationRequirementEngine.evaluateSearchCandidate(definitionUnderTest, currentUnits, lightMek, GameSystem.AS, { maxUnits: 12 }).allowed).toBeFalse();
    });

    it('guides Strategic Command search away from extra aerospace after the AF requirement is met', () => {
        const definitionUnderTest = definition('strategic-command-star');
        const currentUnits = [
            createForceUnit(createUnit(1, 'Visigoth', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(2, 'Batu', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.AS, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];

        const filter = FormationRequirementEngine.getSearchCandidatePredicateFilter(definitionUnderTest, currentUnits, GameSystem.AS);

        expect(filter.requiredPredicates).toEqual(jasmine.arrayContaining(['clan-force', 'strategic-skill-3', 'aerospace-fighter-bm-ba-unit']));
        expect(filter.helpfulPredicates).toEqual(jasmine.arrayContaining(['bm-or-mek-unit', 'battle-armor-unit']));
        expect(filter.forbiddenPredicates).toContain('strategic-aero');
        expect(filter.conditionalForbiddenPredicates).toContain(jasmine.objectContaining({
            when: 'bm-or-mek-unit',
            predicate: 'light-bm-or-mek',
        }));
    });

    it('validates Phalanx Star allowed unit types and combined-arms shape', () => {
        const validUnits = [
            createForceUnit(createUnit(1, 'Warhawk', { as: { TP: 'BM' } }), GameSystem.AS, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(2, 'Summoner', { as: { TP: 'BM' } }), GameSystem.AS, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(3, 'Elemental A', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } }), GameSystem.AS, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(4, 'Elemental B', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } }), GameSystem.AS, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(5, 'Elemental C', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } }), GameSystem.AS, { faction: CLAN_FACTION }),
        ];
        const invalidAerospaceUnits = validUnits.map((_, index) => createForceUnit(createUnit(index + 10, `Aero-${index}`, {
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            as: { TP: 'AF' },
        }), GameSystem.AS, { faction: CLAN_FACTION }));

        expect(LanceTypeIdentifierUtil.isValid(definition('phalanx-star'), validUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('phalanx-star'), invalidAerospaceUnits, GameSystem.AS)).toBeFalse();
    });

    it('uses proper strict majority for Interceptor Squadron role requirements', () => {
        const fourOfSevenInterceptors = Array.from({ length: 7 }, (_, index) => createForceUnit(createUnit(index + 1, `Aero-${index}`, {
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            role: index < 4 ? 'Interceptor' : 'Fast Dogfighter',
            as: { TP: 'AF' },
        })));
        const threeOfSevenInterceptors = fourOfSevenInterceptors.map((forceUnit, index) => createForceUnit(createUnit(index + 11, `Aero-B-${index}`, {
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            role: index < 3 ? 'Interceptor' : 'Fast Dogfighter',
            as: { TP: 'AF' },
        })));

        expect(LanceTypeIdentifierUtil.isValid(definition('interceptor-squadron'), fourOfSevenInterceptors, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('interceptor-squadron'), threeOfSevenInterceptors, GameSystem.AS)).toBeFalse();
    });

    it('validates Horde size, light unit, and low damage constraints', () => {
        const validUnits = Array.from({ length: 5 }, (_, index) => createForceUnit(createUnit(index + 1, `Horde-${index}`, {
            weightClass: 'Light',
            as: { SZ: 1, dmg: { _dmgM: 1 } },
        })));
        const tooManyUnits = [...validUnits, ...Array.from({ length: 6 }, (_, index) => createForceUnit(createUnit(index + 20, `Extra-${index}`, {
            weightClass: 'Light',
            as: { SZ: 1, dmg: { _dmgM: 1 } },
        })))];
        const highDamageUnits = [
            ...validUnits.slice(0, 4),
            createForceUnit(createUnit(99, 'High-Damage', { weightClass: 'Light', as: { SZ: 1, dmg: { _dmgM: 2 } } })),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('horde'), validUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('horde'), tooManyUnits, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('horde'), highDamageUnits, GameSystem.AS)).toBeFalse();
    });

    it('validates Swarm VTOL and size constraints and exposes Coordinated Fire', () => {
        const validUnits = Array.from({ length: 4 }, (_, index) => createForceUnit(createUnit(index + 1, `Swarm-${index}`, {
            type: 'VTOL',
            subtype: 'Combat Vehicle',
            weightClass: 'Medium',
            as: { TP: 'CV', SZ: 2 },
        })));
        const tooFewUnits = validUnits.slice(0, 3);
        const mixedUnitType = [
            ...validUnits.slice(0, 3),
            createForceUnit(createUnit(10, 'Ground Unit', { as: { TP: 'CV', SZ: 2 } })),
        ];
        const heavyVtol = [
            ...validUnits.slice(0, 3),
            createForceUnit(createUnit(11, 'Heavy VTOL', {
                type: 'VTOL',
                subtype: 'Combat Vehicle',
                weightClass: 'Heavy',
                as: { TP: 'CV', SZ: 3 },
            })),
        ];
        const swarm = definition('swarm');

        expect(LanceTypeIdentifierUtil.isValid(swarm, validUnits, GameSystem.AS)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(swarm, validUnits, GameSystem.CBT)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(swarm, tooFewUnits, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(swarm, tooFewUnits, GameSystem.CBT)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(swarm, mixedUnitType, GameSystem.AS)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(swarm, heavyVtol, GameSystem.AS)).toBeFalse();
        expect(swarm.effectDescription).toContain('standard weapon attack');
        const swarmEffectGroup = swarm.effectGroups?.[0];
        expect(swarmEffectGroup?.distribution).toBe('formation-wide');
        if (swarmEffectGroup?.distribution === 'formation-wide') {
            expect(swarmEffectGroup.formationWideAbilities[0]).toEqual(jasmine.objectContaining({
                id: 'coordinated_fire',
                name: 'Coordinated Fire',
                summary: jasmine.arrayContaining(['The formation may make a standard weapon attack against a target within Short Range and Line of Sight of all members as if it were a single Unit.']),
                rulesRef: [{ book: Rulebook.FMMERC, page: 52 }],
            }));
        }
    });
});
