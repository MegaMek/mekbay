import { GameSystem } from '../models/common.model';
import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import type { RestrictionForceSnapshot, RestrictionListDefinition } from '../models/restriction-lists.model';
import type { Unit } from '../models/units.model';
import {
    filterUnitsByRestrictionLists,
    parseRestrictionListSlugsParam,
    serializeRestrictionListSlugsParam,
    validateForceAgainstRestrictionLists,
} from './restriction-lists.util';

function createUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        name: overrides.name ?? 'unit',
        id: overrides.id ?? 1,
        chassis: overrides.chassis ?? 'Atlas',
        model: overrides.model ?? 'AS7-D',
        year: overrides.year ?? 3025,
        weightClass: overrides.weightClass ?? 'Assault',
        tons: overrides.tons ?? 100,
        offSpeedFactor: overrides.offSpeedFactor ?? 0,
        bv: overrides.bv ?? 0,
        pv: overrides.pv ?? 0,
        cost: overrides.cost ?? 0,
        level: overrides.level ?? 0,
        techBase: overrides.techBase ?? 'IS',
        techRating: overrides.techRating ?? 'D',
        type: overrides.type ?? 'Mek',
        subtype: overrides.subtype ?? 'BattleMek',
        omni: overrides.omni ?? 0,
        engine: overrides.engine ?? 'Fusion',
        engineRating: overrides.engineRating ?? 300,
        engineHS: overrides.engineHS ?? 10,
        engineHSType: overrides.engineHSType ?? 'Heat Sink',
        source: overrides.source ?? [],
        role: overrides.role ?? '',
        armorType: overrides.armorType ?? '',
        structureType: overrides.structureType ?? '',
        armor: overrides.armor ?? 0,
        armorPer: overrides.armorPer ?? 0,
        internal: overrides.internal ?? 0,
        heat: overrides.heat ?? 0,
        dissipation: overrides.dissipation ?? 0,
        moveType: overrides.moveType ?? 'Biped',
        walk: overrides.walk ?? 4,
        walk2: overrides.walk2 ?? 4,
        run: overrides.run ?? 6,
        run2: overrides.run2 ?? 6,
        jump: overrides.jump ?? 0,
        jump2: overrides.jump2 ?? 0,
        umu: overrides.umu ?? 0,
        c3: overrides.c3 ?? '',
        dpt: overrides.dpt ?? 0,
        comp: overrides.comp ?? [],
        su: overrides.su ?? 0,
        crewSize: overrides.crewSize ?? 1,
        quirks: overrides.quirks ?? [],
        features: overrides.features ?? [],
        icon: overrides.icon ?? '',
        sheets: overrides.sheets ?? [],
        as: overrides.as ?? ({ TP: 'BM', PV: 0, Arm: 0, Str: 0 } as Unit['as']),
        _searchKey: overrides._searchKey ?? 'atlas as7 d',
        _displayType: overrides._displayType ?? 'BattleMech',
        _maxRange: overrides._maxRange ?? 0,
        _weightedMaxRange: overrides._weightedMaxRange ?? 0,
        _dissipationEfficiency: overrides._dissipationEfficiency ?? 0,
        _mdSumNoPhysical: overrides._mdSumNoPhysical ?? 0,
        _mdSumNoPhysicalNoOneshots: overrides._mdSumNoPhysicalNoOneshots ?? 0,
    } as Unit;
}

function createRestrictionList(): RestrictionListDefinition {
    return {
        slug: 'custom-classic-profile',
        name: 'Classic Restriction Profile',
        description: 'Generic custom validation profile used for tests.',
        updatedAt: '2026-04-15T00:00:00.000Z',
        gameSystem: GameSystem.CLASSIC,
        catalog: {
            allowClassicUnitTypes: ['Mek'],
            allowClassicUnitSubtypes: ['BattleMek'],
            allowAlphaStrikeUnitTypes: [],
            requireCanon: true,
            forbidQuirks: true,
            forbidAmmoTypes: ['ARROW_IV'],
            forbidArrowIVHoming: true,
        },
        roster: {
            minUnits: 3,
            maxUnits: 6,
            uniqueChassis: true,
            maxUnitsWithJumpAtLeast: {
                minimumJump: 7,
                maxUnits: 2,
            },
        },
        live: {
            classic: {
                crewSkillMin: 0,
                crewSkillMax: 5,
                maxGunneryPilotingDelta: 1,
            },
        },
        notes: ['Test-only profile'],
    };
}

describe('restriction lists util', () => {
    const classicProfile = createRestrictionList();

    it('normalizes restriction slug params without assuming built-in tourney slugs', () => {
        expect(parseRestrictionListSlugsParam('CUSTOM-LOCAL,custom-local,another-profile')).toEqual([
            'custom-local',
            'another-profile',
        ]);
        expect(serializeRestrictionListSlugsParam(['custom-local', 'another-profile', 'custom-local'])).toBe('custom-local,another-profile');
    });

    it('filters units that violate catalog rules', () => {
        const arrowWeapon = new WeaponEquipment({
            id: 'ISArrowIV',
            name: 'Arrow IV',
            type: 'weapon',
            weapon: { ammoType: 'ARROW_IV' },
        });

        const validUnit = createUnit({ name: 'valid', chassis: 'Atlas', model: 'AS7-D' });
        const nonCanon = createUnit({ name: 'custom', id: 0, chassis: 'Atlas', model: 'Custom' });
        const quirky = createUnit({ name: 'quirky', chassis: 'Catapult', model: 'CPLT-C1', quirks: ['bad reputation'] });
        const industrial = createUnit({ name: 'industrial', chassis: 'Crosscut', model: 'CCU-10', subtype: 'Industrial Mek' });
        const arrow = createUnit({
            name: 'arrow',
            chassis: 'Longbow',
            model: 'LGB-7Q',
            comp: [{ id: 'ISArrowIV', q: 1, n: 'Arrow IV', t: 'A', p: 0, l: 'RA', eq: arrowWeapon }],
        });

        const filtered = filterUnitsByRestrictionLists([validUnit, nonCanon, quirky, industrial, arrow], [classicProfile]);

        expect(filtered.map((unit) => unit.name)).toEqual(['valid']);
    });

    it('filters Alpha Strike catalog rules against unit.as.TP', () => {
        const alphaStrikeProfile: RestrictionListDefinition = {
            ...createRestrictionList(),
            slug: 'custom-alpha-profile',
            name: 'Alpha Strike Restriction Profile',
            gameSystem: GameSystem.ALPHA_STRIKE,
            catalog: {
                allowClassicUnitTypes: [],
                allowClassicUnitSubtypes: [],
                allowAlphaStrikeUnitTypes: ['BM'],
                requireCanon: false,
                forbidQuirks: false,
                forbidAmmoTypes: [],
                forbidArrowIVHoming: false,
            },
            live: {
                alphaStrike: {
                    allowManualPilotAbilities: true,
                    allowFormationAbilities: true,
                },
            },
        };

        const battleMek = createUnit({ name: 'battlemek', as: { TP: 'BM', PV: 30, Arm: 4, Str: 4 } as Unit['as'] });
        const combatVehicle = createUnit({ name: 'combatvehicle', type: 'Tank', subtype: 'Combat Vehicle', as: { TP: 'CV', PV: 25, Arm: 3, Str: 3 } as Unit['as'] });

        const filtered = filterUnitsByRestrictionLists([battleMek, combatVehicle], [alphaStrikeProfile]);

        expect(filtered.map((unit) => unit.name)).toEqual(['battlemek']);
    });

    it('validates forces against latest active rules', () => {
        const force: RestrictionForceSnapshot = {
            name: 'Test Force',
            gameSystem: GameSystem.CLASSIC,
            units: [
                {
                    displayName: 'Atlas AS7-D',
                    unit: createUnit({ chassis: 'Atlas', model: 'AS7-D', jump: 7 }),
                    classicCrewSkills: [{ label: 'Pilot 1', gunnery: 3, piloting: 5 }],
                },
                {
                    displayName: 'Atlas AS7-K',
                    unit: createUnit({ chassis: 'Atlas', model: 'AS7-K', jump: 7 }),
                    classicCrewSkills: [{ label: 'Pilot 2', gunnery: 4, piloting: 5 }],
                },
                {
                    displayName: 'Phoenix Hawk PXH-1',
                    unit: createUnit({ chassis: 'Phoenix Hawk', model: 'PXH-1', jump: 7 }),
                    classicCrewSkills: [{ label: 'Pilot 3', gunnery: 4, piloting: 5 }],
                },
                {
                    displayName: 'Warhammer WHM-6R',
                    unit: createUnit({ chassis: 'Warhammer', model: 'WHM-6R', jump: 0 }),
                    classicCrewSkills: [{ label: 'Pilot 4', gunnery: 4, piloting: 5 }],
                },
                {
                    displayName: 'Marauder MAD-3R',
                    unit: createUnit({ chassis: 'Marauder', model: 'MAD-3R', jump: 0 }),
                    classicCrewSkills: [{ label: 'Pilot 5', gunnery: 4, piloting: 5 }],
                },
                {
                    displayName: 'Rifleman RFL-3N',
                    unit: createUnit({ chassis: 'Rifleman', model: 'RFL-3N', jump: 0 }),
                    classicCrewSkills: [{ label: 'Pilot 6', gunnery: 4, piloting: 5 }],
                },
                {
                    displayName: 'Shadow Hawk SHD-2H',
                    unit: createUnit({ chassis: 'Shadow Hawk', model: 'SHD-2H', jump: 0 }),
                    classicCrewSkills: [{ label: 'Pilot 7', gunnery: 4, piloting: 5 }],
                },
            ],
        };

        const [result] = validateForceAgainstRestrictionLists(force, [classicProfile]);
        const messages = result.violations.map((violation) => violation.message);

        expect(messages.some((message) => message.includes('allows at most 6 units'))).toBeTrue();
        expect(messages.some((message) => message.includes('only one unit per chassis'))).toBeTrue();
        expect(messages.some((message) => message.includes('Jump MP 7+'))).toBeTrue();
        expect(messages.some((message) => message.includes('Gunnery/Piloting farther apart than 1'))).toBeTrue();
    });
});