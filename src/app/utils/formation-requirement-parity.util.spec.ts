import { GameSystem } from '../models/common.model';
import type { Faction } from '../models/factions.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { ASUnitTypeCode, UnitComponent, UnitSubtype, UnitType, WeightClass } from '../models/units.model';
import { createEmptyUnit, type TestUnitOverrides } from '../testing/unit-test-helpers';
import { FORMATION_DEFINITIONS } from './formation-definitions';
import { FormationRequirementEngine } from './formation-requirement-engine.util';
import type { FormationTypeDefinition } from './formation-type.model';

const BOTH_GAME_SYSTEMS = [GameSystem.ALPHA_STRIKE, GameSystem.CLASSIC] as const;

const CLAN_FACTION: Faction = {
    id: 1,
    name: 'Clan Wolf',
    group: 'IS Clan',
    img: '',
    eras: {},
};

interface ForceUnitOptions {
    readonly faction?: Faction;
    readonly pilotSkill?: number;
    readonly gunnerySkill?: number;
}

interface UnitBuildOptions {
    readonly role?: string;
    readonly chassis?: string;
    readonly model?: string;
    readonly type?: UnitType;
    readonly subtype?: UnitSubtype;
    readonly asType?: ASUnitTypeCode;
    readonly size?: number;
    readonly weightClass?: WeightClass;
    readonly asArmor?: number;
    readonly armor?: number;
    readonly move?: number;
    readonly jumpMove?: number;
    readonly walk?: number;
    readonly jump?: number;
    readonly shortDamage?: number;
    readonly mediumDamage?: number;
    readonly longDamage?: number;
    readonly specials?: readonly string[];
    readonly comp?: readonly UnitComponent[];
    readonly quirks?: readonly string[];
}

type UnitFactory = (gameSystem: GameSystem) => ForceUnit[];

interface FormationParityCase {
    readonly id: string;
    readonly valid: UnitFactory;
    readonly invalid: UnitFactory;
}

function asDamage(shortDamage = 0, mediumDamage = 0, longDamage = 0) {
    return {
        dmgS: `${shortDamage}`,
        dmgM: `${mediumDamage}`,
        dmgL: `${longDamage}`,
        dmgE: '0',
        _dmgS: shortDamage,
        _dmgM: mediumDamage,
        _dmgL: longDamage,
        _dmgE: 0,
    };
}

function asMovement(move = 0, jumpMove = 0): Record<string, number> {
    const movement: Record<string, number> = {};
    if (move > 0) movement['w'] = move;
    if (jumpMove > 0) movement['j'] = jumpMove;
    return movement;
}

function weightClassForSize(size: number): WeightClass {
    if (size <= 1) return 'Light';
    if (size === 2) return 'Medium';
    if (size === 3) return 'Heavy';
    return 'Assault';
}

function weapon(
    name: string,
    damage: number,
    range: string,
    type: UnitComponent['t'] = 'B',
    eq?: UnitComponent['eq'],
): UnitComponent {
    return {
        id: name,
        q: 1,
        n: name,
        t: type,
        p: 0,
        l: 'RA',
        r: range,
        d: `${damage}`,
        ...(eq ? { eq } : {}),
    };
}

function equipmentWithFlags(flags: readonly string[]): UnitComponent['eq'] {
    return {
        hasAnyFlag: (requestedFlags: string[]) => requestedFlags.some(flag => flags.includes(flag)),
    } as UnitComponent['eq'];
}

function createTestUnit(id: number, name: string, overrides: TestUnitOverrides): ReturnType<typeof createEmptyUnit> {
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

function forceUnit(
    gameSystem: GameSystem,
    id: number,
    name: string,
    overrides: TestUnitOverrides,
    options: ForceUnitOptions = {},
): ForceUnit {
    const force = {
        faction: () => options.faction ?? null,
        era: () => null,
        techBase: () => options.faction ? 'Clan' : 'Inner Sphere',
        gameSystem,
    };

    return {
        force,
        getUnit: () => createTestUnit(id, name, overrides),
        getBv: () => 0,
        pilotSkill: () => options.pilotSkill ?? 4,
        gunnerySkill: () => options.gunnerySkill ?? 4,
    } as unknown as ForceUnit;
}

function unit(
    gameSystem: GameSystem,
    id: number,
    name: string,
    options: UnitBuildOptions = {},
    forceOptions: ForceUnitOptions = {},
): ForceUnit {
    const size = options.size ?? 2;
    const shortDamage = options.shortDamage ?? 0;
    const mediumDamage = options.mediumDamage ?? 0;
    const longDamage = options.longDamage ?? 0;

    return forceUnit(gameSystem, id, name, {
        chassis: options.chassis ?? name,
        model: options.model ?? 'Prime',
        role: options.role ?? 'Skirmisher',
        type: options.type ?? 'Mek',
        subtype: options.subtype ?? 'BattleMek',
        weightClass: options.weightClass ?? weightClassForSize(size),
        armor: options.armor ?? 0,
        walk: options.walk ?? 0,
        jump: options.jump ?? 0,
        comp: [...(options.comp ?? [])],
        quirks: [...(options.quirks ?? [])],
        as: {
            TP: options.asType ?? 'BM',
            SZ: size,
            Arm: options.asArmor ?? 0,
            MVm: asMovement(options.move ?? 0, options.jumpMove ?? 0),
            specials: [...(options.specials ?? [])],
            dmg: asDamage(shortDamage, mediumDamage, longDamage),
        },
    }, forceOptions);
}

function mek(gameSystem: GameSystem, id: number, name: string, options: UnitBuildOptions = {}, forceOptions: ForceUnitOptions = {}): ForceUnit {
    return unit(gameSystem, id, name, {
        type: 'Mek',
        subtype: 'BattleMek',
        asType: 'BM',
        ...options,
    }, forceOptions);
}

function vehicle(gameSystem: GameSystem, id: number, name: string, options: UnitBuildOptions = {}, forceOptions: ForceUnitOptions = {}): ForceUnit {
    return unit(gameSystem, id, name, {
        type: 'Tank',
        subtype: 'Combat Vehicle',
        asType: 'CV',
        ...options,
    }, forceOptions);
}

function battleArmor(gameSystem: GameSystem, id: number, name: string, options: UnitBuildOptions = {}, forceOptions: ForceUnitOptions = {}): ForceUnit {
    return unit(gameSystem, id, name, {
        type: 'Infantry',
        subtype: 'Battle Armor',
        asType: 'BA',
        size: 1,
        weightClass: 'Light',
        ...options,
    }, forceOptions);
}

function infantry(gameSystem: GameSystem, id: number, name: string, options: UnitBuildOptions = {}, forceOptions: ForceUnitOptions = {}): ForceUnit {
    return unit(gameSystem, id, name, {
        type: 'Infantry',
        subtype: 'Conventional Infantry',
        asType: 'CI',
        size: 1,
        weightClass: 'Light',
        ...options,
    }, forceOptions);
}

function aero(gameSystem: GameSystem, id: number, name: string, options: UnitBuildOptions = {}, forceOptions: ForceUnitOptions = {}): ForceUnit {
    return unit(gameSystem, id, name, {
        type: 'Aero',
        subtype: 'Aerospace Fighter',
        asType: 'AF',
        size: 2,
        weightClass: 'Small Craft',
        ...options,
    }, forceOptions);
}

function heavyDamageComponents(): UnitComponent[] {
    return [weapon('Heavy PPC', 25, '7/14/21', 'E')];
}

function longDamageComponents(damage = 10): UnitComponent[] {
    return [weapon('Large Laser', damage, '6/12/18', 'E')];
}

function mediumDamageComponents(damage = 10): UnitComponent[] {
    return [weapon('Medium Laser', damage, '3/6/9', 'E')];
}

function pursuitDamageComponents(): UnitComponent[] {
    return [weapon('LRM 5', 5, '5/10/15', 'M')];
}

function autocannonComponents(): UnitComponent[] {
    return [weapon('AC/10', 10, '5/10/15', 'B')];
}

function lrmComponents(): UnitComponent[] {
    return [weapon('LRM 15', 10, '7/14/21', 'M')];
}

function srmComponents(): UnitComponent[] {
    return [weapon('SRM 6', 8, '3/6/9', 'M')];
}

function artilleryComponents(): UnitComponent[] {
    return [weapon('Long Tom Artillery', 20, '10/20/30', 'A')];
}

function ewComponents(): UnitComponent[] {
    return [weapon('Guardian ECM', 0, '0', 'O', equipmentWithFlags(['F_ECM']))];
}

function hardAssaultUnit(gameSystem: GameSystem, id: number, name: string, role: string, options: UnitBuildOptions = {}): ForceUnit {
    return mek(gameSystem, id, name, {
        size: 3,
        weightClass: 'Heavy',
        asArmor: 5,
        armor: 135,
        move: 10,
        walk: 5,
        mediumDamage: 3,
        longDamage: 2,
        comp: heavyDamageComponents(),
        role,
        ...options,
    });
}

function battleLineUnit(gameSystem: GameSystem, id: number, name: string, role: string, options: UnitBuildOptions = {}): ForceUnit {
    return mek(gameSystem, id, name, {
        size: 3,
        weightClass: 'Heavy',
        move: 8,
        walk: 4,
        role,
        ...options,
    });
}

function directFireUnit(gameSystem: GameSystem, id: number, name: string, options: UnitBuildOptions = {}): ForceUnit {
    return mek(gameSystem, id, name, {
        size: 3,
        weightClass: 'Heavy',
        longDamage: 2,
        comp: longDamageComponents(),
        ...options,
    });
}

function clanOptions(skill = 3): ForceUnitOptions {
    return { faction: CLAN_FACTION, pilotSkill: skill, gunnerySkill: skill };
}

function definitionById(id: string): FormationTypeDefinition {
    const definition = FORMATION_DEFINITIONS.find(candidate => candidate.id === id);
    if (!definition) {
        throw new Error(`Formation definition not found: ${id}`);
    }
    return definition;
}

function legacyValidateHard(definition: FormationTypeDefinition, units: ForceUnit[], gameSystem: GameSystem): boolean {
    if (definition.parent) {
        const parentDefinition = definitionById(definition.parent);
        if (!legacyValidateHard(parentDefinition, units, gameSystem)) {
            return false;
        }
    }
    if (definition.minUnits && units.length < definition.minUnits) {
        return false;
    }
    if (definition.maxUnits && units.length > definition.maxUnits) {
        return false;
    }
    return definition.validator?.(units, gameSystem) ?? false;
}

function legacyValidateWithIdealRole(definition: FormationTypeDefinition, units: ForceUnit[], gameSystem: GameSystem): boolean {
    if (definition.parent) {
        const parentDefinition = definitionById(definition.parent);
        if (!legacyValidateWithIdealRole(parentDefinition, units, gameSystem)) {
            return false;
        }
    }
    if (definition.minUnits && units.length < definition.minUnits) {
        return false;
    }
    if (definition.maxUnits && units.length > definition.maxUnits) {
        return false;
    }
    if (definition.idealRole && units.every(forceUnit => forceUnit.getUnit().role === definition.idealRole)) {
        return true;
    }
    return definition.validator?.(units, gameSystem) ?? false;
}

function engineValidate(definition: FormationTypeDefinition, units: ForceUnit[], gameSystem: GameSystem): boolean {
    const evaluation = FormationRequirementEngine.evaluateDefinition(definition, units, gameSystem);
    expect(evaluation).withContext(`${definition.id} should have a migrated blueprint`).not.toBeNull();
    return evaluation?.valid === true;
}

function expectHardEvaluation(definition: FormationTypeDefinition, units: ForceUnit[], gameSystem: GameSystem, expected: boolean): void {
    if (definition.idealRole) {
        expect(units.some(forceUnit => forceUnit.getUnit().role !== definition.idealRole))
            .withContext(`${definition.id} ${gameSystem} hard fixture should not use idealRole shortcut`)
            .toBeTrue();
    }

    const legacyResult = legacyValidateHard(definition, units, gameSystem);
    const engineEvaluation = FormationRequirementEngine.evaluateDefinition(definition, units, gameSystem);

    expect(engineEvaluation).withContext(`${definition.id} should have a migrated blueprint`).not.toBeNull();
    expect(engineEvaluation?.shortCircuitedByIdealRole)
        .withContext(`${definition.id} ${gameSystem} hard fixture should not short-circuit`)
        .toBeFalse();
    expect(legacyResult).withContext(`${definition.id} ${gameSystem} legacy hard validation`).toBe(expected);
    expect(engineEvaluation?.valid).withContext(`${definition.id} ${gameSystem} engine validation`).toBe(expected);
}

const FORMATION_PARITY_CASES: readonly FormationParityCase[] = [
    {
        id: 'anti-mech-lance',
        valid: gameSystem => [
            battleArmor(gameSystem, 1, 'Elemental A'),
            infantry(gameSystem, 2, 'Infantry B'),
            battleArmor(gameSystem, 3, 'Elemental C'),
        ],
        invalid: gameSystem => [
            battleArmor(gameSystem, 1, 'Elemental A'),
            infantry(gameSystem, 2, 'Infantry B'),
            mek(gameSystem, 3, 'Mek C'),
        ],
    },
    {
        id: 'assault-lance',
        valid: gameSystem => [
            hardAssaultUnit(gameSystem, 1, 'Assault A', 'Juggernaut'),
            hardAssaultUnit(gameSystem, 2, 'Assault B', 'Sniper'),
            hardAssaultUnit(gameSystem, 3, 'Assault C', 'Brawler'),
        ],
        invalid: gameSystem => [
            hardAssaultUnit(gameSystem, 1, 'Assault A', 'Juggernaut', { mediumDamage: 1, comp: [] }),
            hardAssaultUnit(gameSystem, 2, 'Assault B', 'Sniper', { mediumDamage: 1, comp: [] }),
            hardAssaultUnit(gameSystem, 3, 'Assault C', 'Brawler', { mediumDamage: 1, comp: [] }),
        ],
    },
    {
        id: 'anvil-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Anvil A', { role: 'Juggernaut', size: 2, asArmor: 4, armor: 105, specials: ['AC1/1/1'], comp: autocannonComponents() }),
            mek(gameSystem, 2, 'Anvil B', { role: 'Brawler', size: 2, asArmor: 4, armor: 105, specials: ['LRM1/1/1'], comp: lrmComponents() }),
            mek(gameSystem, 3, 'Anvil C', { role: 'Skirmisher', size: 2, asArmor: 4, armor: 105 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Anvil A', { role: 'Juggernaut', size: 2, asArmor: 4, armor: 105, specials: ['AC1/1/1'], comp: autocannonComponents() }),
            mek(gameSystem, 2, 'Anvil B', { role: 'Brawler', size: 2, asArmor: 4, armor: 105 }),
            mek(gameSystem, 3, 'Anvil C', { role: 'Skirmisher', size: 2, asArmor: 4, armor: 105 }),
        ],
    },
    {
        id: 'fast-assault-lance',
        valid: gameSystem => [
            hardAssaultUnit(gameSystem, 1, 'Fast Assault A', 'Juggernaut'),
            hardAssaultUnit(gameSystem, 2, 'Fast Assault B', 'Sniper'),
            hardAssaultUnit(gameSystem, 3, 'Fast Assault C', 'Brawler'),
        ],
        invalid: gameSystem => [
            hardAssaultUnit(gameSystem, 1, 'Fast Assault A', 'Juggernaut'),
            hardAssaultUnit(gameSystem, 2, 'Fast Assault B', 'Sniper'),
            hardAssaultUnit(gameSystem, 3, 'Fast Assault C', 'Brawler', { move: 8, walk: 4 }),
        ],
    },
    {
        id: 'hunter-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Hunter A', { role: 'Ambusher' }),
            mek(gameSystem, 2, 'Hunter B', { role: 'Juggernaut' }),
            mek(gameSystem, 3, 'Hunter C', { role: 'Brawler' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Hunter A', { role: 'Ambusher' }),
            mek(gameSystem, 2, 'Hunter B', { role: 'Brawler' }),
            mek(gameSystem, 3, 'Hunter C', { role: 'Scout' }),
        ],
    },
    {
        id: 'battle-lance',
        valid: gameSystem => [
            battleLineUnit(gameSystem, 1, 'Battle A', 'Brawler'),
            battleLineUnit(gameSystem, 2, 'Battle B', 'Sniper'),
            battleLineUnit(gameSystem, 3, 'Battle C', 'Skirmisher', { size: 2, weightClass: 'Medium' }),
        ],
        invalid: gameSystem => [
            battleLineUnit(gameSystem, 1, 'Battle A', 'Brawler', { size: 2, weightClass: 'Medium' }),
            battleLineUnit(gameSystem, 2, 'Battle B', 'Sniper', { size: 2, weightClass: 'Medium' }),
            battleLineUnit(gameSystem, 3, 'Battle C', 'Skirmisher', { size: 3, weightClass: 'Heavy' }),
        ],
    },
    {
        id: 'light-battle-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Light Battle A', { role: 'Scout', size: 1, weightClass: 'Light' }),
            mek(gameSystem, 2, 'Light Battle B', { role: 'Skirmisher', size: 1, weightClass: 'Light' }),
            mek(gameSystem, 3, 'Light Battle C', { role: 'Brawler', size: 1, weightClass: 'Light' }),
            mek(gameSystem, 4, 'Light Battle D', { role: 'Sniper', size: 2, weightClass: 'Medium' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Light Battle A', { role: 'Scout', size: 1, weightClass: 'Light' }),
            mek(gameSystem, 2, 'Light Battle B', { role: 'Skirmisher', size: 1, weightClass: 'Light' }),
            mek(gameSystem, 3, 'Light Battle C', { role: 'Brawler', size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 4, 'Light Battle D', { role: 'Sniper', size: 2, weightClass: 'Medium' }),
        ],
    },
    {
        id: 'medium-battle-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Medium Battle A', { size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 2, 'Medium Battle B', { size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 3, 'Medium Battle C', { size: 3, weightClass: 'Heavy' }),
            mek(gameSystem, 4, 'Medium Battle D', { size: 1, weightClass: 'Light' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Medium Battle A', { size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 2, 'Medium Battle B', { size: 3, weightClass: 'Heavy' }),
            mek(gameSystem, 3, 'Medium Battle C', { size: 3, weightClass: 'Heavy' }),
            mek(gameSystem, 4, 'Medium Battle D', { size: 1, weightClass: 'Light' }),
        ],
    },
    {
        id: 'heavy-battle-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Heavy Battle A', { size: 3, weightClass: 'Heavy' }),
            mek(gameSystem, 2, 'Heavy Battle B', { size: 4, weightClass: 'Assault' }),
            mek(gameSystem, 3, 'Heavy Battle C', { size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 4, 'Heavy Battle D', { size: 2, weightClass: 'Medium' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Heavy Battle A', { size: 3, weightClass: 'Heavy' }),
            mek(gameSystem, 2, 'Heavy Battle B', { size: 4, weightClass: 'Assault' }),
            mek(gameSystem, 3, 'Heavy Battle C', { size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 4, 'Heavy Battle D', { size: 1, weightClass: 'Light' }),
        ],
    },
    {
        id: 'rifle-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Rifle A', { size: 2, weightClass: 'Medium', move: 8, walk: 4, specials: ['AC1/1/1'], comp: autocannonComponents() }),
            mek(gameSystem, 2, 'Rifle B', { size: 3, weightClass: 'Heavy', move: 8, walk: 4, specials: ['FLK1/1/1'], comp: autocannonComponents() }),
            mek(gameSystem, 3, 'Rifle C', { size: 2, weightClass: 'Medium', move: 8, walk: 4 }),
            mek(gameSystem, 4, 'Rifle D', { size: 1, weightClass: 'Light', move: 8, walk: 4 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Rifle A', { size: 2, weightClass: 'Medium', move: 8, walk: 4, specials: ['AC1/1/1'], comp: autocannonComponents() }),
            mek(gameSystem, 2, 'Rifle B', { size: 3, weightClass: 'Heavy', move: 8, walk: 4, specials: ['FLK1/1/1'], comp: autocannonComponents() }),
            mek(gameSystem, 3, 'Rifle C', { size: 2, weightClass: 'Medium', move: 8, walk: 4 }),
            mek(gameSystem, 4, 'Rifle D', { size: 1, weightClass: 'Light', move: 6, walk: 3 }),
        ],
    },
    {
        id: 'berserker-lance',
        valid: gameSystem => [
            battleLineUnit(gameSystem, 1, 'Berserker A', 'Brawler'),
            battleLineUnit(gameSystem, 2, 'Berserker B', 'Sniper'),
            battleLineUnit(gameSystem, 3, 'Berserker C', 'Skirmisher', { size: 2, weightClass: 'Medium' }),
        ],
        invalid: gameSystem => [
            battleLineUnit(gameSystem, 1, 'Berserker A', 'Brawler', { size: 2, weightClass: 'Medium' }),
            battleLineUnit(gameSystem, 2, 'Berserker B', 'Sniper', { size: 2, weightClass: 'Medium' }),
            battleLineUnit(gameSystem, 3, 'Berserker C', 'Skirmisher', { size: 3, weightClass: 'Heavy' }),
        ],
    },
    {
        id: 'command-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Command A', { role: 'Sniper' }),
            mek(gameSystem, 2, 'Command B', { role: 'Missile Boat' }),
            mek(gameSystem, 3, 'Command C', { role: 'Brawler' }),
            mek(gameSystem, 4, 'Command D', { role: 'Scout' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Command A', { role: 'Sniper' }),
            mek(gameSystem, 2, 'Command B', { role: 'Brawler' }),
            mek(gameSystem, 3, 'Command C', { role: 'Scout' }),
            mek(gameSystem, 4, 'Command D', { role: 'Striker' }),
        ],
    },
    {
        id: 'order-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Order A', { chassis: 'Panther', size: 2, weightClass: 'Medium', role: 'Brawler' }),
            mek(gameSystem, 2, 'Order B', { chassis: 'Panther', size: 2, weightClass: 'Medium', role: 'Sniper' }),
            mek(gameSystem, 3, 'Order C', { chassis: 'Panther', size: 2, weightClass: 'Medium', role: 'Scout' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Order A', { chassis: 'Panther', size: 2, weightClass: 'Medium', role: 'Brawler' }),
            mek(gameSystem, 2, 'Order B', { chassis: 'Panther', size: 2, weightClass: 'Medium', role: 'Sniper' }),
            mek(gameSystem, 3, 'Order C', { chassis: 'Dragon', size: 2, weightClass: 'Medium', role: 'Scout' }),
        ],
    },
    {
        id: 'vehicle-command-lance',
        valid: gameSystem => [
            vehicle(gameSystem, 1, 'Vedette', { role: 'Sniper' }),
            vehicle(gameSystem, 2, 'Vedette', { role: 'Missile Boat' }),
            vehicle(gameSystem, 3, 'Goblin', { role: 'Scout' }),
        ],
        invalid: gameSystem => [
            vehicle(gameSystem, 1, 'Vedette', { role: 'Scout' }),
            vehicle(gameSystem, 2, 'Vedette', { role: 'Brawler' }),
            vehicle(gameSystem, 3, 'Goblin', { role: 'Sniper' }),
        ],
    },
    {
        id: 'fire-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Fire A', { role: 'Missile Boat' }),
            mek(gameSystem, 2, 'Fire B', { role: 'Sniper' }),
            mek(gameSystem, 3, 'Fire C', { role: 'Sniper' }),
            mek(gameSystem, 4, 'Fire D', { role: 'Brawler' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Fire A', { role: 'Missile Boat' }),
            mek(gameSystem, 2, 'Fire B', { role: 'Sniper' }),
            mek(gameSystem, 3, 'Fire C', { role: 'Brawler' }),
            mek(gameSystem, 4, 'Fire D', { role: 'Scout' }),
        ],
    },
    {
        id: 'anti-air-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Anti Air A', { role: 'Missile Boat', specials: ['FLK1/1/1'], comp: autocannonComponents() }),
            mek(gameSystem, 2, 'Anti Air B', { role: 'Sniper', specials: ['AC1/1/1'], comp: artilleryComponents() }),
            mek(gameSystem, 3, 'Anti Air C', { role: 'Sniper' }),
            mek(gameSystem, 4, 'Anti Air D', { role: 'Brawler' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Anti Air A', { role: 'Missile Boat', specials: ['FLK1/1/1'], comp: autocannonComponents() }),
            mek(gameSystem, 2, 'Anti Air B', { role: 'Sniper' }),
            mek(gameSystem, 3, 'Anti Air C', { role: 'Sniper' }),
            mek(gameSystem, 4, 'Anti Air D', { role: 'Brawler' }),
        ],
    },
    {
        id: 'artillery-fire-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Artillery A', { specials: ['ART-AIS'], comp: artilleryComponents() }),
            mek(gameSystem, 2, 'Artillery B', { specials: ['ART-LT'], comp: artilleryComponents() }),
            mek(gameSystem, 3, 'Artillery C'),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Artillery A', { specials: ['ART-AIS'], comp: artilleryComponents() }),
            mek(gameSystem, 2, 'Artillery B'),
            mek(gameSystem, 3, 'Artillery C'),
        ],
    },
    {
        id: 'direct-fire-lance',
        valid: gameSystem => [
            directFireUnit(gameSystem, 1, 'Direct A'),
            directFireUnit(gameSystem, 2, 'Direct B'),
            directFireUnit(gameSystem, 3, 'Direct C', { size: 2, weightClass: 'Medium' }),
        ],
        invalid: gameSystem => [
            directFireUnit(gameSystem, 1, 'Direct A'),
            directFireUnit(gameSystem, 2, 'Direct B'),
            mek(gameSystem, 3, 'Direct C', { size: 2, weightClass: 'Medium', longDamage: 1, comp: [] }),
        ],
    },
    {
        id: 'fire-support-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Fire Support A', { specials: ['IF1'], comp: lrmComponents() }),
            mek(gameSystem, 2, 'Fire Support B', { specials: ['IF2'], comp: lrmComponents() }),
            mek(gameSystem, 3, 'Fire Support C', { specials: ['IF3'], comp: artilleryComponents() }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Fire Support A', { specials: ['IF1'], comp: lrmComponents() }),
            mek(gameSystem, 2, 'Fire Support B', { specials: ['IF2'], comp: lrmComponents() }),
            mek(gameSystem, 3, 'Fire Support C'),
        ],
    },
    {
        id: 'light-fire-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Light Fire A', { size: 1, weightClass: 'Light', role: 'Missile Boat' }),
            mek(gameSystem, 2, 'Light Fire B', { size: 1, weightClass: 'Light', role: 'Sniper' }),
            mek(gameSystem, 3, 'Light Fire C', { size: 2, weightClass: 'Medium', role: 'Brawler' }),
            mek(gameSystem, 4, 'Light Fire D', { size: 2, weightClass: 'Medium', role: 'Scout' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Light Fire A', { size: 1, weightClass: 'Light', role: 'Missile Boat' }),
            mek(gameSystem, 2, 'Light Fire B', { size: 1, weightClass: 'Light', role: 'Sniper' }),
            mek(gameSystem, 3, 'Light Fire C', { size: 3, weightClass: 'Heavy', role: 'Brawler' }),
            mek(gameSystem, 4, 'Light Fire D', { size: 2, weightClass: 'Medium', role: 'Scout' }),
        ],
    },
    {
        id: 'pursuit-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Pursuit A', { role: 'Striker', size: 1, weightClass: 'Light', move: 12, walk: 6, mediumDamage: 2, comp: pursuitDamageComponents() }),
            mek(gameSystem, 2, 'Pursuit B', { role: 'Scout', size: 2, weightClass: 'Medium', move: 12, walk: 6 }),
            mek(gameSystem, 3, 'Pursuit C', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 12, walk: 6 }),
            mek(gameSystem, 4, 'Pursuit D', { role: 'Skirmisher', size: 2, weightClass: 'Medium', move: 8, walk: 4 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Pursuit A', { role: 'Striker', size: 1, weightClass: 'Light', move: 12, walk: 6, mediumDamage: 2, comp: pursuitDamageComponents() }),
            mek(gameSystem, 2, 'Pursuit B', { role: 'Scout', size: 2, weightClass: 'Medium', move: 12, walk: 6 }),
            mek(gameSystem, 3, 'Pursuit C', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 8, walk: 4 }),
            mek(gameSystem, 4, 'Pursuit D', { role: 'Skirmisher', size: 2, weightClass: 'Medium', move: 8, walk: 4 }),
        ],
    },
    {
        id: 'probe-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Probe A', { size: 2, weightClass: 'Medium', move: 10, walk: 6, mediumDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 2, 'Probe B', { size: 2, weightClass: 'Medium', move: 10, walk: 6, mediumDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 3, 'Probe C', { size: 3, weightClass: 'Heavy', move: 10, walk: 6, mediumDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 4, 'Probe D', { size: 2, weightClass: 'Medium', move: 8, walk: 4, mediumDamage: 2, comp: mediumDamageComponents() }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Probe A', { size: 2, weightClass: 'Medium', move: 10, walk: 6, mediumDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 2, 'Probe B', { size: 2, weightClass: 'Medium', move: 10, walk: 6, mediumDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 3, 'Probe C', { size: 3, weightClass: 'Heavy', move: 10, walk: 6, mediumDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 4, 'Probe D', { size: 2, weightClass: 'Medium', move: 8, walk: 4, mediumDamage: 1, comp: [] }),
        ],
    },
    {
        id: 'sweep-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Sweep A', { size: 1, weightClass: 'Light', move: 10, walk: 5, shortDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 2, 'Sweep B', { size: 2, weightClass: 'Medium', move: 10, walk: 5, shortDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 3, 'Sweep C', { size: 2, weightClass: 'Medium', move: 10, walk: 5, shortDamage: 2, comp: mediumDamageComponents() }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Sweep A', { size: 1, weightClass: 'Light', move: 10, walk: 5, shortDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 2, 'Sweep B', { size: 2, weightClass: 'Medium', move: 10, walk: 5, shortDamage: 2, comp: mediumDamageComponents() }),
            mek(gameSystem, 3, 'Sweep C', { size: 2, weightClass: 'Medium', move: 8, walk: 4, shortDamage: 2, comp: mediumDamageComponents() }),
        ],
    },
    {
        id: 'recon-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Recon A', { role: 'Scout', move: 10, walk: 5 }),
            mek(gameSystem, 2, 'Recon B', { role: 'Striker', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Recon C', { role: 'Brawler', move: 10, walk: 5 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Recon A', { role: 'Scout', move: 10, walk: 5 }),
            mek(gameSystem, 2, 'Recon B', { role: 'Striker', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Recon C', { role: 'Brawler', move: 8, walk: 4 }),
        ],
    },
    {
        id: 'heavy-recon-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Heavy Recon A', { role: 'Scout', size: 3, weightClass: 'Heavy', move: 10, walk: 5 }),
            mek(gameSystem, 2, 'Heavy Recon B', { role: 'Scout', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Heavy Recon C', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 8, walk: 4 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Heavy Recon A', { role: 'Scout', size: 3, weightClass: 'Heavy', move: 10, walk: 5 }),
            mek(gameSystem, 2, 'Heavy Recon B', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Heavy Recon C', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 8, walk: 4 }),
        ],
    },
    {
        id: 'light-recon-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Light Recon A', { role: 'Scout', size: 1, weightClass: 'Light', move: 12, walk: 6 }),
            mek(gameSystem, 2, 'Light Recon B', { role: 'Scout', size: 1, weightClass: 'Light', move: 12, walk: 6 }),
            mek(gameSystem, 3, 'Light Recon C', { role: 'Scout', size: 1, weightClass: 'Light', move: 12, walk: 6 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Light Recon A', { role: 'Scout', size: 1, weightClass: 'Light', move: 12, walk: 6 }),
            mek(gameSystem, 2, 'Light Recon B', { role: 'Scout', size: 1, weightClass: 'Light', move: 12, walk: 6 }),
            mek(gameSystem, 3, 'Light Recon C', { role: 'Brawler', size: 1, weightClass: 'Light', move: 12, walk: 6 }),
        ],
    },
    {
        id: 'security-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Security A', { role: 'Scout', size: 4, weightClass: 'Assault' }),
            mek(gameSystem, 2, 'Security B', { role: 'Sniper', size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 3, 'Security C', { role: 'Brawler', size: 2, weightClass: 'Medium' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Security A', { role: 'Scout', size: 4, weightClass: 'Assault' }),
            mek(gameSystem, 2, 'Security B', { role: 'Sniper', size: 4, weightClass: 'Assault' }),
            mek(gameSystem, 3, 'Security C', { role: 'Brawler', size: 2, weightClass: 'Medium' }),
        ],
    },
    {
        id: 'striker-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Striker A', { role: 'Striker', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
            mek(gameSystem, 2, 'Striker B', { role: 'Skirmisher', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Striker C', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
            mek(gameSystem, 4, 'Striker D', { role: 'Scout', size: 1, weightClass: 'Light', move: 10, walk: 5 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Striker A', { role: 'Striker', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
            mek(gameSystem, 2, 'Striker B', { role: 'Skirmisher', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Striker C', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
            mek(gameSystem, 4, 'Striker D', { role: 'Scout', size: 4, weightClass: 'Assault', move: 10, walk: 5 }),
        ],
    },
    {
        id: 'hammer-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Hammer A', { role: 'Striker', move: 10, walk: 5 }),
            mek(gameSystem, 2, 'Hammer B', { role: 'Brawler', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Hammer C', { role: 'Scout', move: 10, walk: 5 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Hammer A', { role: 'Striker', move: 10, walk: 5 }),
            mek(gameSystem, 2, 'Hammer B', { role: 'Brawler', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Hammer C', { role: 'Scout', move: 8, walk: 4 }),
        ],
    },
    {
        id: 'light-striker-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Light Striker A', { role: 'Striker', size: 1, weightClass: 'Light', move: 10, walk: 5, longDamage: 1, comp: longDamageComponents(5) }),
            mek(gameSystem, 2, 'Light Striker B', { role: 'Skirmisher', size: 2, weightClass: 'Medium', move: 10, walk: 5, longDamage: 1, comp: longDamageComponents(5) }),
            mek(gameSystem, 3, 'Light Striker C', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Light Striker A', { role: 'Striker', size: 1, weightClass: 'Light', move: 10, walk: 5, longDamage: 1, comp: longDamageComponents(5) }),
            mek(gameSystem, 2, 'Light Striker B', { role: 'Skirmisher', size: 3, weightClass: 'Heavy', move: 10, walk: 5, longDamage: 1, comp: longDamageComponents(5) }),
            mek(gameSystem, 3, 'Light Striker C', { role: 'Brawler', size: 2, weightClass: 'Medium', move: 10, walk: 5 }),
        ],
    },
    {
        id: 'heavy-striker-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Heavy Striker A', { role: 'Striker', size: 3, weightClass: 'Heavy', move: 8, walk: 4, longDamage: 2, comp: longDamageComponents(5) }),
            mek(gameSystem, 2, 'Heavy Striker B', { role: 'Skirmisher', size: 3, weightClass: 'Heavy', move: 8, walk: 4 }),
            mek(gameSystem, 3, 'Heavy Striker C', { role: 'Brawler', size: 4, weightClass: 'Assault', move: 8, walk: 4 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Heavy Striker A', { role: 'Striker', size: 3, weightClass: 'Heavy', move: 8, walk: 4, longDamage: 2, comp: longDamageComponents(5) }),
            mek(gameSystem, 2, 'Heavy Striker B', { role: 'Skirmisher', size: 3, weightClass: 'Heavy', move: 8, walk: 4 }),
            mek(gameSystem, 3, 'Heavy Striker C', { role: 'Brawler', size: 1, weightClass: 'Light', move: 8, walk: 4 }),
        ],
    },
    {
        id: 'horde',
        valid: gameSystem => Array.from({ length: 5 }, (_, index) => mek(gameSystem, index + 1, `Horde ${index}`, {
            size: 1,
            weightClass: 'Light',
            mediumDamage: 1,
            comp: [],
        })),
        invalid: gameSystem => [
            ...Array.from({ length: 4 }, (_, index) => mek(gameSystem, index + 1, `Horde ${index}`, {
                size: 1,
                weightClass: 'Light',
                mediumDamage: 1,
                comp: [],
            })),
            mek(gameSystem, 99, 'Horde Heavy Damage', { size: 1, weightClass: 'Light', mediumDamage: 2, comp: [weapon('Short Range Battery', 11, '3/6/9', 'E')] }),
        ],
    },
    {
        id: 'ranger-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Ranger A', { role: 'Skirmisher', size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 2, 'Ranger B', { role: 'Brawler', size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 3, 'Ranger C', { role: 'Scout', size: 3, weightClass: 'Heavy' }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Ranger A', { role: 'Skirmisher', size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 2, 'Ranger B', { role: 'Brawler', size: 2, weightClass: 'Medium' }),
            mek(gameSystem, 3, 'Ranger C', { role: 'Scout', size: 4, weightClass: 'Assault' }),
        ],
    },
    {
        id: 'support-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Support A'),
            mek(gameSystem, 2, 'Support B'),
            mek(gameSystem, 3, 'Support C'),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Support A'),
            mek(gameSystem, 2, 'Support B'),
        ],
    },
    {
        id: 'urban-lance',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Urban A', { role: 'Ambusher', move: 10, walk: 5, jumpMove: 4, jump: 2 }),
            battleArmor(gameSystem, 2, 'Urban B', { role: 'Brawler', move: 10, walk: 5 }),
            mek(gameSystem, 3, 'Urban C', { role: 'Scout', move: 8, walk: 4 }),
            mek(gameSystem, 4, 'Urban D', { role: 'Skirmisher', move: 8, walk: 4 }),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Urban A', { role: 'Ambusher', move: 10, walk: 5, jumpMove: 4, jump: 2 }),
            mek(gameSystem, 2, 'Urban B', { role: 'Brawler', move: 8, walk: 4 }),
            mek(gameSystem, 3, 'Urban C', { role: 'Scout', move: 8, walk: 4 }),
            mek(gameSystem, 4, 'Urban D', { role: 'Skirmisher', move: 8, walk: 4 }),
        ],
    },
    {
        id: 'phalanx-star',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Phalanx A', {}, clanOptions()),
            mek(gameSystem, 2, 'Phalanx B', {}, clanOptions()),
            battleArmor(gameSystem, 3, 'Phalanx C', {}, clanOptions()),
        ],
        invalid: gameSystem => [
            aero(gameSystem, 1, 'Phalanx A', {}, clanOptions()),
            aero(gameSystem, 2, 'Phalanx B', {}, clanOptions()),
            aero(gameSystem, 3, 'Phalanx C', {}, clanOptions()),
        ],
    },
    {
        id: 'rogue-star',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Rogue Pair', {}, clanOptions()),
            mek(gameSystem, 2, 'Rogue Pair', {}, clanOptions()),
            mek(gameSystem, 3, 'Rogue Unique', {}, clanOptions()),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Rogue A', {}, clanOptions()),
            mek(gameSystem, 2, 'Rogue B', {}, clanOptions()),
            mek(gameSystem, 3, 'Rogue C', {}, clanOptions()),
        ],
    },
    {
        id: 'strategic-command-star',
        valid: gameSystem => [
            mek(gameSystem, 1, 'Strategic A', { size: 3, weightClass: 'Heavy' }, clanOptions(3)),
            mek(gameSystem, 2, 'Strategic B', { size: 4, weightClass: 'Assault' }, clanOptions(2)),
            aero(gameSystem, 3, 'Strategic AF A', { role: 'Interceptor' }, clanOptions(3)),
            aero(gameSystem, 4, 'Strategic AF B', { role: 'Fast Dogfighter' }, clanOptions(3)),
            battleArmor(gameSystem, 5, 'Strategic BA', {}, clanOptions(3)),
        ],
        invalid: gameSystem => [
            mek(gameSystem, 1, 'Strategic A', { size: 3, weightClass: 'Heavy' }, clanOptions(3)),
            mek(gameSystem, 2, 'Strategic B', { size: 4, weightClass: 'Assault' }, clanOptions(2)),
            aero(gameSystem, 3, 'Strategic AF A', { role: 'Interceptor' }, clanOptions(3)),
            battleArmor(gameSystem, 4, 'Strategic BA A', {}, clanOptions(3)),
            battleArmor(gameSystem, 5, 'Strategic BA B', {}, clanOptions(3)),
        ],
    },
    {
        id: 'interceptor-squadron',
        valid: gameSystem => [
            ...Array.from({ length: 4 }, (_, index) => aero(gameSystem, index + 1, `Interceptor ${index}`, { role: 'Interceptor' })),
            aero(gameSystem, 5, 'Interceptor Dogfighter A', { role: 'Fast Dogfighter' }),
            aero(gameSystem, 6, 'Interceptor Dogfighter B', { role: 'Dogfighter' }),
        ],
        invalid: gameSystem => [
            ...Array.from({ length: 3 }, (_, index) => aero(gameSystem, index + 1, `Interceptor ${index}`, { role: 'Interceptor' })),
            aero(gameSystem, 4, 'Interceptor Dogfighter A', { role: 'Fast Dogfighter' }),
            aero(gameSystem, 5, 'Interceptor Dogfighter B', { role: 'Dogfighter' }),
            aero(gameSystem, 6, 'Interceptor Attack', { role: 'Attack' }),
        ],
    },
    {
        id: 'aerospace-superiority-squadron',
        valid: gameSystem => [
            aero(gameSystem, 1, 'Aero Sup A', { role: 'Interceptor' }),
            aero(gameSystem, 2, 'Aero Sup B', { role: 'Fast Dogfighter' }),
            aero(gameSystem, 3, 'Aero Sup C', { role: 'Interceptor' }),
            aero(gameSystem, 4, 'Aero Sup D', { role: 'Fast Dogfighter' }),
            aero(gameSystem, 5, 'Aero Sup E', { role: 'Attack' }),
            aero(gameSystem, 6, 'Aero Sup F', { role: 'Transport' }),
        ],
        invalid: gameSystem => [
            aero(gameSystem, 1, 'Aero Sup A', { role: 'Interceptor' }),
            aero(gameSystem, 2, 'Aero Sup B', { role: 'Fast Dogfighter' }),
            aero(gameSystem, 3, 'Aero Sup C', { role: 'Interceptor' }),
            aero(gameSystem, 4, 'Aero Sup D', { role: 'Attack' }),
            aero(gameSystem, 5, 'Aero Sup E', { role: 'Attack' }),
            aero(gameSystem, 6, 'Aero Sup F', { role: 'Transport' }),
        ],
    },
    {
        id: 'fire-support-squadron',
        valid: gameSystem => [
            aero(gameSystem, 1, 'Aero Fire Support A', { role: 'Fire Support' }),
            aero(gameSystem, 2, 'Aero Fire Support B', { role: 'Fire Support' }),
            aero(gameSystem, 3, 'Aero Fire Support C', { role: 'Fire Support' }),
            aero(gameSystem, 4, 'Aero Fire Support D', { role: 'Dogfighter' }),
            aero(gameSystem, 5, 'Aero Fire Support E', { role: 'Attack' }),
            aero(gameSystem, 6, 'Aero Fire Support F', { role: 'Transport' }),
        ],
        invalid: gameSystem => [
            aero(gameSystem, 1, 'Aero Fire Support A', { role: 'Fire Support' }),
            aero(gameSystem, 2, 'Aero Fire Support B', { role: 'Fire Support' }),
            aero(gameSystem, 3, 'Aero Fire Support C', { role: 'Dogfighter' }),
            aero(gameSystem, 4, 'Aero Fire Support D', { role: 'Attack' }),
            aero(gameSystem, 5, 'Aero Fire Support E', { role: 'Attack' }),
            aero(gameSystem, 6, 'Aero Fire Support F', { role: 'Transport' }),
        ],
    },
    {
        id: 'strike-squadron',
        valid: gameSystem => [
            aero(gameSystem, 1, 'Strike A', { role: 'Attack' }),
            aero(gameSystem, 2, 'Strike B', { role: 'Dogfighter' }),
            aero(gameSystem, 3, 'Strike C', { role: 'Fast Dogfighter' }),
            aero(gameSystem, 4, 'Strike D', { role: 'Attack' }),
            aero(gameSystem, 5, 'Strike E', { role: 'Transport' }),
            aero(gameSystem, 6, 'Strike F', { role: 'Fire Support' }),
        ],
        invalid: gameSystem => [
            aero(gameSystem, 1, 'Strike A', { role: 'Attack' }),
            aero(gameSystem, 2, 'Strike B', { role: 'Dogfighter' }),
            aero(gameSystem, 3, 'Strike C', { role: 'Attack' }),
            aero(gameSystem, 4, 'Strike D', { role: 'Transport' }),
            aero(gameSystem, 5, 'Strike E', { role: 'Transport' }),
            aero(gameSystem, 6, 'Strike F', { role: 'Fire Support' }),
        ],
    },
    {
        id: 'electronic-warfare-squadron',
        valid: gameSystem => [
            ...Array.from({ length: 4 }, (_, index) => aero(gameSystem, index + 1, `EW ${index}`, { role: 'Electronic Warfare', specials: ['ECM'], comp: ewComponents() })),
            aero(gameSystem, 5, 'EW Plain A', { role: 'Attack' }),
            aero(gameSystem, 6, 'EW Plain B', { role: 'Transport' }),
        ],
        invalid: gameSystem => [
            ...Array.from({ length: 3 }, (_, index) => aero(gameSystem, index + 1, `EW ${index}`, { role: 'Electronic Warfare', specials: ['ECM'], comp: ewComponents() })),
            aero(gameSystem, 4, 'EW Plain A', { role: 'Attack' }),
            aero(gameSystem, 5, 'EW Plain B', { role: 'Transport' }),
            aero(gameSystem, 6, 'EW Plain C', { role: 'Fire Support' }),
        ],
    },
    {
        id: 'transport-squadron',
        valid: gameSystem => [
            aero(gameSystem, 1, 'Transport A', { role: 'Transport' }),
            aero(gameSystem, 2, 'Transport B', { role: 'Transport' }),
            aero(gameSystem, 3, 'Transport C', { role: 'Transport' }),
            aero(gameSystem, 4, 'Transport D', { role: 'Attack' }),
            aero(gameSystem, 5, 'Transport E', { role: 'Dogfighter' }),
            aero(gameSystem, 6, 'Transport F', { role: 'Fire Support' }),
        ],
        invalid: gameSystem => [
            aero(gameSystem, 1, 'Transport A', { role: 'Transport' }),
            aero(gameSystem, 2, 'Transport B', { role: 'Transport' }),
            aero(gameSystem, 3, 'Transport C', { role: 'Attack' }),
            aero(gameSystem, 4, 'Transport D', { role: 'Attack' }),
            aero(gameSystem, 5, 'Transport E', { role: 'Dogfighter' }),
            aero(gameSystem, 6, 'Transport F', { role: 'Fire Support' }),
        ],
    },
];

describe('FormationRequirementEngine legacy parity', () => {
    it('has one parity fixture for every formation definition', () => {
        expect(FORMATION_PARITY_CASES.map(testCase => testCase.id)).toEqual(FORMATION_DEFINITIONS.map(definition => definition.id));
    });

    for (const testCase of FORMATION_PARITY_CASES) {
        it(`matches legacy hard validation for ${testCase.id}`, () => {
            const definition = definitionById(testCase.id);

            for (const gameSystem of BOTH_GAME_SYSTEMS) {
                expectHardEvaluation(definition, testCase.valid(gameSystem), gameSystem, true);
                expectHardEvaluation(definition, testCase.invalid(gameSystem), gameSystem, false);
            }
        });
    }

    it('preserves the Assault Lance idealRole shortcut separately from hard validation', () => {
        const definition = definitionById('assault-lance');

        for (const gameSystem of BOTH_GAME_SYSTEMS) {
            const units = [
                mek(gameSystem, 1, 'Ideal Assault A', { role: 'Juggernaut', size: 1, weightClass: 'Light', asArmor: 1, armor: 40 }),
                mek(gameSystem, 2, 'Ideal Assault B', { role: 'Juggernaut', size: 1, weightClass: 'Light', asArmor: 1, armor: 40 }),
                mek(gameSystem, 3, 'Ideal Assault C', { role: 'Juggernaut', size: 1, weightClass: 'Light', asArmor: 1, armor: 40 }),
            ];

            expect(legacyValidateHard(definition, units, gameSystem)).withContext(`${gameSystem} hard validation`).toBeFalse();
            expect(legacyValidateWithIdealRole(definition, units, gameSystem)).withContext(`${gameSystem} legacy shortcut validation`).toBeTrue();
            expect(engineValidate(definition, units, gameSystem)).withContext(`${gameSystem} engine shortcut validation`).toBeTrue();
            expect(FormationRequirementEngine.evaluateDefinition(definition, units, gameSystem)?.shortCircuitedByIdealRole)
                .withContext(`${gameSystem} engine shortcut flag`)
                .toBeTrue();
        }
    });
});
