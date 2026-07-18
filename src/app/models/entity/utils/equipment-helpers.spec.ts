import { ArmorEquipment, MiscEquipment } from '../../equipment.model';
import { MountedArmor, MountedEngine } from '../components';
import {
    TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
    TestBipedMekEntity as BipedMekEntity,
    TestQuadVeeEntity as QuadVeeEntity,
    TestSupportTankEntity as SupportTankEntity,
    TestTankEntity as TankEntity,
    TestTripodMekEntity as TripodMekEntity,
} from '../testing/test-entities';
import type { ArmorType } from '../types';

describe('Equipment.getNumCriticalSlots', () => {
    it('prefers support-vehicle and tank slot values over generic critical slots', () => {
        const equipment = new MiscEquipment({
            id: 'vehicle equipment',
            name: 'vehicle equipment',
            type: 'misc',
            stats: { criticalSlots: 3, tankSlots: 2, svSlots: 1 },
        });

        expect(equipment.getNumCriticalSlots(new SupportTankEntity())).toBe(1);
        expect(equipment.getNumCriticalSlots(new TankEntity())).toBe(2);
        expect(equipment.getNumCriticalSlots(new BipedMekEntity())).toBe(3);
    });

    it('compresses fixed critical slots for a superheavy Mek', () => {
        const entity = new BipedMekEntity();
        entity.setTonnage(120);
        const equipment = miscEquipment('fixed', [], 3);

        expect(equipment.getNumCriticalSlots(entity)).toBe(2);
    });

    it('uses the equipment tech base for MASC and internal structure', () => {
        const entity = new BipedMekEntity();
        entity.setTonnage(100);
        entity.techBase.set('IS');

        expect(variableEquipment('Clan MASC', ['F_MASC'], 'Clan').getNumCriticalSlots(entity)).toBe(4);
        expect(variableEquipment('Clan Endo Steel', ['F_ENDO_STEEL'], 'Clan').getNumCriticalSlots(entity)).toBe(7);

        entity.techBase.set('Clan');
        expect(variableEquipment('IS Endo Steel', ['F_ENDO_STEEL'], 'IS').getNumCriticalSlots(entity)).toBe(14);
    });

    it('uses installed uniform armor tech instead of entity tech', () => {
        const entity = new BipedMekEntity();
        entity.techBase.set('Clan');
        entity.setUniformArmor(new MountedArmor({
            techBase: 'IS',
            armor: armorEquipment('IS Ferro-Fibrous', 'FERRO_FIBROUS', 'IS'),
        }));

        expect(variableEquipment('Ferro-Fibrous', ['F_FERRO_FIBROUS'])
            .getNumCriticalSlots(entity)).toBe(14);
    });

    it('sums matching patchwork Ferro-Fibrous and Reactive locations by location tech base', () => {
        const entity = new BipedMekEntity();
        const ferro = armorEquipment('Ferro-Fibrous', 'FERRO_FIBROUS', 'All');
        const reactive = armorEquipment('Reactive', 'REACTIVE', 'All');
        const standard = armorEquipment('Standard', 'STANDARD', 'All');
        entity.setArmorEquipmentAt('LA', ferro, 'IS');
        entity.setArmorEquipmentAt('RA', reactive, 'Clan');
        entity.setArmorEquipmentAt('LT', standard, 'IS');

        expect(variableEquipment('Ferro-Fibrous', ['F_FERRO_FIBROUS'])
            .getNumCriticalSlots(entity)).toBe(3);
        expect(variableEquipment('Reactive', ['F_REACTIVE'])
            .getNumCriticalSlots(entity)).toBe(3);
    });

    const patchworkCases: Array<[string, ArmorType, string, number]> = [
        ['Reflective', 'REFLECTIVE', 'F_REFLECTIVE', 3],
        ['Light Ferro-Fibrous', 'LIGHT_FERRO', 'F_LIGHT_FERRO', 2],
        ['Heavy Ferro-Fibrous', 'HEAVY_FERRO', 'F_HEAVY_FERRO', 6],
        ['Ferro-Lamellor', 'FERRO_LAMELLOR', 'F_FERRO_LAMELLOR', 4],
        ['Prototype Ferro-Fibrous', 'FERRO_FIBROUS_PROTO', 'F_FERRO_FIBROUS_PROTO', 4],
    ];

    for (const [name, armorType, flag, expectedSlots] of patchworkCases) {
        it(`resolves ${name} patchwork slots`, () => {
            const entity = new BipedMekEntity();
            const armor = armorEquipment(name, armorType, 'All');
            entity.setArmorEquipmentAt('LA', armor, 'IS');
            entity.setArmorEquipmentAt('RA', armor, 'Clan');

            expect(variableEquipment(name, [flag]).getNumCriticalSlots(entity)).toBe(expectedSlots);
        });
    }

    it('halves the summed patchwork slots for a superheavy Mek', () => {
        const entity = new BipedMekEntity();
        entity.setTonnage(120);
        const armor = armorEquipment('Heavy Ferro-Fibrous', 'HEAVY_FERRO', 'IS');
        entity.setArmorEquipmentAt('LA', armor);
        entity.setArmorEquipmentAt('RA', armor);
        entity.setArmorEquipmentAt('LT', armor);

        expect(variableEquipment('Heavy Ferro-Fibrous', ['F_HEAVY_FERRO'])
            .getNumCriticalSlots(entity)).toBe(5);
    });

    it('distinguishes QuadVee, biped, and tripod track layouts', () => {
        const tracks = variableEquipment('Tracks', ['F_TRACKS']);
        const jumpBooster = variableEquipment('Jump Booster', ['F_JUMP_BOOSTER']);

        expect(tracks.getNumCriticalSlots(new QuadVeeEntity())).toBe(4);
        expect(jumpBooster.getNumCriticalSlots(new QuadVeeEntity())).toBe(8);
        expect(tracks.getNumCriticalSlots(new BipedMekEntity())).toBe(2);
        expect(tracks.getNumCriticalSlots(new TripodMekEntity())).toBe(1);
    });

    it('uses Java weight-class codes for nonstandard AES weight classes', () => {
        const aes = variableEquipment('AES', ['F_ACTUATOR_ENHANCEMENT_SYSTEM']);
        const entity = new BipedMekEntity();

        entity.setTonnage(15);
        expect(aes.getNumCriticalSlots(entity)).toBe(0);
        entity.setTonnage(120);
        expect(aes.getNumCriticalSlots(entity)).toBe(5);
    });

    it('uses entity locations for Blue Shield and zero slots for Aero armor', () => {
        const mek = new BipedMekEntity();
        const aero = new AeroSpaceFighterEntity();

        expect(variableEquipment('Blue Shield', ['F_BLUE_SHIELD']).getNumCriticalSlots(mek)).toBe(7);
        expect(variableEquipment('Reactive', ['F_REACTIVE']).getNumCriticalSlots(aero)).toBe(0);
    });

    it('falls back to superheavy structure formulas when no tank slot value exists', () => {
        const entity = new TankEntity();
        entity.motiveType.set('Tracked');
        entity.setTonnage(101);
        const endoSteel = new MiscEquipment({
            id: 'Clan Endo Steel',
            name: 'Clan Endo Steel',
            type: 'misc',
            flags: ['F_ENDO_STEEL'],
            stats: { criticalSlots: 'variable', tankSlots: -1 },
            tech: { base: 'Clan' },
        });

        expect(endoSteel.getNumCriticalSlots(entity)).toBe(4);
    });

    it('derives fuel slots from engine weight and preserves zero variable size', () => {
        const entity = new BipedMekEntity();
        const fuel = variableEquipment('Fuel', ['F_FUEL']);
        const engine = new MountedEngine({ type: 'Fusion', rating: 400, techBase: 'IS' });
        entity.mountedEngine.set(engine);
        const roundedFuelTonnage = Math.ceil(engine.getWeight() * 0.1 * 2) / 2;

        expect(fuel.getNumCriticalSlots(entity, 99)).toBe(Math.ceil(roundedFuelTonnage));
        expect(variableEquipment('Cargo', ['F_CARGO']).getNumCriticalSlots(entity, 0)).toBe(0);
        expect(variableEquipment('Liquid Cargo', ['F_LIQUID_CARGO']).getNumCriticalSlots(entity, 0)).toBe(0);
        expect(variableEquipment('Communications', ['F_COMMUNICATIONS']).getNumCriticalSlots(entity, 0)).toBe(0);

        entity.mountedEngine.set(new MountedEngine({
            type: 'None', rating: 0, techBase: 'IS', installed: false,
        }));
        expect(fuel.getNumCriticalSlots(entity)).toBe(0);
    });

    it('falls back to one slot for an unknown variable formula', () => {
        expect(variableEquipment('Unknown', []).getNumCriticalSlots(new BipedMekEntity())).toBe(1);
    });
});

function variableEquipment(
    name: string,
    flags: string[],
    techBase: 'IS' | 'Clan' | 'All' = 'IS',
): MiscEquipment {
    return miscEquipment(name, flags, 'variable', techBase);
}

function miscEquipment(
    name: string,
    flags: string[],
    criticalSlots: number | 'variable',
    techBase: 'IS' | 'Clan' | 'All' = 'IS',
): MiscEquipment {
    return new MiscEquipment({
        id: name,
        name,
        type: 'misc',
        flags,
        stats: { criticalSlots },
        tech: { base: techBase },
    });
}

function armorEquipment(
    name: string,
    armorType: ArmorType,
    techBase: 'IS' | 'Clan' | 'All',
): ArmorEquipment {
    return new ArmorEquipment({
        id: name,
        name,
        type: 'armor',
        armor: { type: armorType },
        tech: { base: techBase },
    });
}
