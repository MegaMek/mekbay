import { GameSystem } from '../models/common.model';
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
    gameSystem = GameSystem.ALPHA_STRIKE,
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
        getUnit: () => unit,
        getBv: () => 0,
        pilotSkill: () => options.pilotSkill ?? 4,
        gunnerySkill: () => options.gunnerySkill ?? 4,
    } as unknown as ForceUnit;
}

function definition(id: string, gameSystem = GameSystem.ALPHA_STRIKE) {
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
        const missingBlueprintIds = getFormationDefinitions()
            .filter((formationDefinition) => !FormationRequirementEngine.hasBlueprint(formationDefinition.id))
            .map((formationDefinition) => formationDefinition.id);

        expect(missingBlueprintIds).toEqual([]);
    });

    it('validates Anti-Mech Lance infantry requirements for Alpha Strike and Classic', () => {
        const alphaStrikeUnits = [
            createForceUnit(createUnit(1, 'BA-1', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } })),
            createForceUnit(createUnit(2, 'CI-1', { type: 'Infantry', subtype: 'Conventional Infantry', as: { TP: 'CI' } })),
            createForceUnit(createUnit(3, 'PM-1', { type: 'ProtoMek', subtype: 'ProtoMek', as: { TP: 'PM' } })),
        ];
        const classicUnits = [
            createForceUnit(createUnit(4, 'Inf-1', { type: 'Infantry', subtype: 'Conventional Infantry' }), GameSystem.CLASSIC),
            createForceUnit(createUnit(5, 'Inf-2', { type: 'Infantry', subtype: 'Conventional Infantry' }), GameSystem.CLASSIC),
            createForceUnit(createUnit(6, 'Inf-3', { type: 'Infantry', subtype: 'Battle Armor' }), GameSystem.CLASSIC),
        ];
        const invalidUnits = [
            ...alphaStrikeUnits.slice(0, 2),
            createForceUnit(createUnit(7, 'Mek-1', { as: { TP: 'BM' } })),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('anti-mech-lance'), alphaStrikeUnits, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('anti-mech-lance', GameSystem.CLASSIC), classicUnits, GameSystem.CLASSIC)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('anti-mech-lance'), invalidUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
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

        expect(LanceTypeIdentifierUtil.isValid(definition('anti-air-lance'), validUnits, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('anti-air-lance'), missingFireRoleUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('anti-air-lance'), missingEquipmentUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
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
            GameSystem.ALPHA_STRIKE,
        );

        expect(evaluation?.shortCircuitedByIdealRole).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('battle-lance'), lightBrawlers, GameSystem.ALPHA_STRIKE)).toBeTrue();
    });

    it('enforces vehicle matched pairs for Battle Lance when idealRole does not short-circuit', () => {
        const validVehiclePairs = [
            createForceUnit(createUnit(1, 'Vehicle-A', { type: 'Tank', subtype: 'Combat Vehicle', role: 'Brawler', as: { TP: 'CV', SZ: 3 } })),
            createForceUnit(createUnit(2, 'Vehicle-A', { type: 'Tank', subtype: 'Combat Vehicle', role: 'Sniper', as: { TP: 'CV', SZ: 3 } })),
            createForceUnit(createUnit(3, 'Vehicle-B', { type: 'Tank', subtype: 'Combat Vehicle', role: 'Skirmisher', as: { TP: 'CV', SZ: 3 } })),
            createForceUnit(createUnit(4, 'Vehicle-B', { type: 'Tank', subtype: 'Combat Vehicle', role: 'Scout', as: { TP: 'CV', SZ: 3 } })),
        ];
        const unmatchedVehicles = validVehiclePairs.map((forceUnit, index) => {
            const unit = forceUnit.getUnit();
            return createForceUnit(createUnit(index + 10, `${unit.name}-${index}`, {
                type: 'Tank',
                subtype: 'Combat Vehicle',
                role: unit.role,
                as: { TP: 'CV', SZ: 3 },
            }));
        });

        expect(LanceTypeIdentifierUtil.isValid(definition('battle-lance'), validVehiclePairs, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('battle-lance'), unmatchedVehicles, GameSystem.ALPHA_STRIKE)).toBeFalse();
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

        expect(LanceTypeIdentifierUtil.isValid(definition('order-lance'), validUnits, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('order-lance'), mixedSizeUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('order-lance'), mixedChassisUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
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
            GameSystem.ALPHA_STRIKE,
        );
        const wrongChassisDecision = FormationRequirementEngine.evaluateSearchCandidate(
            definition('order-lance'),
            currentUnits,
            wrongChassisCandidate,
            GameSystem.ALPHA_STRIKE,
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
            GameSystem.ALPHA_STRIKE,
            { maxUnits: 4 },
        );
        const lineDecision = FormationRequirementEngine.evaluateSearchCandidate(
            definition('artillery-fire-lance'),
            [],
            lineCandidate,
            GameSystem.ALPHA_STRIKE,
            { maxUnits: 4 },
        );

        expect(artilleryDecision.allowed).toBeTrue();
        expect(artilleryDecision.fillsDeficit).toBeTrue();
        expect(lineDecision.allowed).toBeTrue();
        expect(lineDecision.fillsDeficit).toBeFalse();
    });

    it('validates Rogue Star same-model pair requirements', () => {
        const validUnits = [
            createForceUnit(createUnit(1, 'Adder Prime', { as: { TP: 'BM' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(2, 'Adder Prime', { as: { TP: 'BM' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(3, 'Kit Fox Prime', { as: { TP: 'BM' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(4, 'Nova Prime', { as: { TP: 'BM' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(5, 'Stormcrow Prime', { as: { TP: 'BM' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
        ];
        const invalidUnits = validUnits.map((forceUnit, index) => createForceUnit(createUnit(index + 10, `${forceUnit.getUnit().name}-${index}`, {
            as: { TP: 'BM' },
        }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }));

        expect(LanceTypeIdentifierUtil.isValid(definition('rogue-star'), validUnits, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('rogue-star'), invalidUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
    });

    it('validates Strategic Command Star aerospace, skill, and heavy Mek constraints', () => {
        const validUnits = [
            createForceUnit(createUnit(1, 'Timber Wolf', { weightClass: 'Heavy', as: { TP: 'BM', SZ: 3 } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(2, 'Dire Wolf', { weightClass: 'Assault', as: { TP: 'BM', SZ: 4 } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 2 }),
            createForceUnit(createUnit(3, 'Visigoth', { type: 'Aero', subtype: 'Aerospace Fighter', role: 'Interceptor', as: { TP: 'AF' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(4, 'Batu', { type: 'Aero', subtype: 'Aerospace Fighter', role: 'Fast Dogfighter', as: { TP: 'AF' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(5, 'Elemental', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];
        const oneAeroUnit = [
            validUnits[0],
            validUnits[1],
            validUnits[2],
            validUnits[4],
            createForceUnit(createUnit(6, 'Executioner', { weightClass: 'Assault', as: { TP: 'BM', SZ: 4 } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];
        const lowSkillUnits = validUnits.map((forceUnit, index) => createForceUnit(forceUnit.getUnit(), GameSystem.ALPHA_STRIKE, {
            faction: CLAN_FACTION,
            pilotSkill: index === 0 ? 4 : 3,
        }));
        const warshipUnits = [
            ...validUnits,
            createForceUnit(createUnit(6, 'Vincent Corvette', { type: 'Aero', subtype: 'WarShip', as: { TP: 'WS', SZ: 5 } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];
        const industrialMekUnits = [
            createForceUnit(createUnit(7, 'Visigoth II', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(8, 'Batu II', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(9, 'IndustrialMech A', { weightClass: 'Heavy', as: { TP: 'IM', SZ: 3 } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(10, 'IndustrialMech B', { weightClass: 'Assault', as: { TP: 'IM', SZ: 4 } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];

        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), validUnits, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), oneAeroUnit, GameSystem.ALPHA_STRIKE)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), lowSkillUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), warshipUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('strategic-command-star'), industrialMekUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
    });

    it('allows Strategic Command search to pick a first heavy Mek setup unit', () => {
        const definitionUnderTest = definition('strategic-command-star');
        const currentUnits = [
            createForceUnit(createUnit(1, 'Visigoth', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(2, 'Batu', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];
        const heavyMek = createForceUnit(createUnit(3, 'Timber Wolf', { weightClass: 'Heavy', as: { TP: 'BM', SZ: 3 } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 });
        const lightMek = createForceUnit(createUnit(4, 'Adder', { weightClass: 'Light', as: { TP: 'BM', SZ: 1 } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 });
        const heavyMekDecision = FormationRequirementEngine.evaluateSearchCandidate(definitionUnderTest, currentUnits, heavyMek, GameSystem.ALPHA_STRIKE, { maxUnits: 12 });

        expect(heavyMekDecision.allowed).toBeTrue();
        expect(heavyMekDecision.fillsDeficit).toBeTrue();
        expect(FormationRequirementEngine.evaluateSearchCandidate(definitionUnderTest, currentUnits, lightMek, GameSystem.ALPHA_STRIKE, { maxUnits: 12 }).allowed).toBeFalse();
    });

    it('guides Strategic Command search away from extra aerospace after the AF requirement is met', () => {
        const definitionUnderTest = definition('strategic-command-star');
        const currentUnits = [
            createForceUnit(createUnit(1, 'Visigoth', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
            createForceUnit(createUnit(2, 'Batu', { type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION, pilotSkill: 3 }),
        ];

        const filter = FormationRequirementEngine.getSearchCandidatePredicateFilter(definitionUnderTest, currentUnits, GameSystem.ALPHA_STRIKE);

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
            createForceUnit(createUnit(1, 'Warhawk', { as: { TP: 'BM' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(2, 'Summoner', { as: { TP: 'BM' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(3, 'Elemental A', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(4, 'Elemental B', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
            createForceUnit(createUnit(5, 'Elemental C', { type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA' } }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }),
        ];
        const invalidAerospaceUnits = validUnits.map((_, index) => createForceUnit(createUnit(index + 10, `Aero-${index}`, {
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            as: { TP: 'AF' },
        }), GameSystem.ALPHA_STRIKE, { faction: CLAN_FACTION }));

        expect(LanceTypeIdentifierUtil.isValid(definition('phalanx-star'), validUnits, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('phalanx-star'), invalidAerospaceUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
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

        expect(LanceTypeIdentifierUtil.isValid(definition('interceptor-squadron'), fourOfSevenInterceptors, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('interceptor-squadron'), threeOfSevenInterceptors, GameSystem.ALPHA_STRIKE)).toBeFalse();
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

        expect(LanceTypeIdentifierUtil.isValid(definition('horde'), validUnits, GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(LanceTypeIdentifierUtil.isValid(definition('horde'), tooManyUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
        expect(LanceTypeIdentifierUtil.isValid(definition('horde'), highDamageUnits, GameSystem.ALPHA_STRIKE)).toBeFalse();
    });
});
