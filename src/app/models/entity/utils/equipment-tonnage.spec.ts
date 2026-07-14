import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { ProtoMekEntity } from '../entities/protomek/protomek-entity';
import { SupportTankEntity } from '../entities/vehicle/support-tank-entity';
import { TankEntity } from '../entities/vehicle/tank-entity';
import { EntityMountedEquipment } from '../types';
import { MountedEngine } from '../components';

describe('EntityMountedEquipment.getTonnage', () => {
    const entity = new BipedMekEntity();
    entity.tonnage.set(75);

    const cases: Array<[string, string[], number]> = [
        ['hatchet', ['F_CLUB', 'S_HATCHET'], 5],
        ['sword', ['F_CLUB', 'S_SWORD'], 4],
        ['lance', ['F_CLUB', 'S_LANCE'], 4],
        ['mace', ['F_CLUB', 'S_MACE'], 8],
        ['retractable blade', ['F_CLUB', 'S_RETRACTABLE_BLADE'], 4.5],
        ['claw', ['F_HAND_WEAPON', 'S_CLAW'], 5],
        ['talons', ['F_TALON'], 5],
        ['ram plate', ['F_RAM_PLATE'], 8],
    ];

    for (const [name, flags, expectedTonnage] of cases) {
        it(`resolves ${name}`, () => {
            expect(mount(variableEquipment(name, flags)).getTonnage(entity)).toBe(expectedTonnage);
        });
    }

    it('passes through fixed tonnage', () => {
        const equipment = new MiscEquipment({
            id: 'fixed',
            name: 'fixed',
            type: 'misc',
            stats: { tonnage: 2.5 },
        });

        expect(mount(equipment).getTonnage(entity)).toBe(2.5);
    });

    const chassisCases: Array<[string, string[], number]> = [
        ['IS partial wing', ['F_PARTIAL_WING', 'F_MEK_EQUIPMENT'], 5.5],
        ['chain drape', ['F_CHAIN_DRAPE'], 7.5],
        ['industrial structure', ['F_INDUSTRIAL_STRUCTURE'], 15],
        ['endo steel', ['F_ENDO_STEEL'], 4],
        ['reinforced structure', ['F_REINFORCED'], 15],
        ['endo-composite', ['F_ENDO_COMPOSITE'], 6],
        ['dune buggy', ['F_DUNE_BUGGY'], 7.5],
        ['jump booster', ['F_JUMP_BOOSTER'], 4],
        ['tracks', ['F_TRACKS'], 7.5],
        ['QuadVee wheels', ['F_TRACKS', 'S_QUADVEE_WHEELS'], 11.5],
        ['limited amphibious', ['F_LIMITED_AMPHIBIOUS'], 3],
        ['fully amphibious', ['F_FULLY_AMPHIBIOUS'], 7.5],
        ['booby trap', ['F_BOOBY_TRAP'], 7.5],
        ['drone operating system', ['F_DRONE_OPERATING_SYSTEM'], 8],
    ];

    for (const [name, flags, expectedTonnage] of chassisCases) {
        it(`resolves ${name}`, () => {
            expect(mount(variableEquipment(name, flags)).getTonnage(entity)).toBe(expectedTonnage);
        });
    }

    it('uses equipment tech base for Mek partial wings', () => {
        const clanWing = variableEquipment('Clan partial wing', ['F_PARTIAL_WING', 'F_MEK_EQUIPMENT'], 'Clan');

        expect(mount(clanWing).getTonnage(entity)).toBe(4);
    });

    it('uses kilogram rounding for ProtoMek partial wings', () => {
        const protoMek = new ProtoMekEntity();
        protoMek.tonnage.set(6.003);
        const wing = variableEquipment('ProtoMek partial wing', ['F_PARTIAL_WING', 'F_PROTOMEK_EQUIPMENT'], 'Clan');

        expect(mount(wing).getTonnage(protoMek)).toBe(1.201);
    });

    it('resolves IS and Clan MASC tonnage', () => {
        expect(mount(variableEquipment('ISMASC', ['F_MASC'])).getTonnage(entity)).toBe(4);
        expect(mount(variableEquipment('CLMASC', ['F_MASC'], 'Clan')).getTonnage(entity)).toBe(3);
    });

    it('resolves ProtoMek and Battle Armor myomer-booster tonnage', () => {
        const protoMek = new ProtoMekEntity();
        protoMek.tonnage.set(6);
        const battleArmor = new BattleArmorEntity();

        expect(mount(variableEquipment('proto booster', ['F_MASC'], 'Clan')).getTonnage(protoMek)).toBe(0.15);
        expect(mount(variableEquipment('BA booster', ['F_MASC', 'F_BA_EQUIPMENT'], 'Clan')).getTonnage(battleArmor))
            .toBeCloseTo(0.083333, 6);
    });

    it('resolves supercharger tonnage for Meks and combat vehicles', () => {
        entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'IS' }));
        const tank = new TankEntity();
        tank.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'IS' }));
        const supercharger = mount(variableEquipment('supercharger', ['F_MASC', 'S_SUPERCHARGER']));

        expect(supercharger.getTonnage(entity)).toBe(2);
        expect(supercharger.getTonnage(tank)).toBe(3);
    });

    it('defers support and VTOL jet-booster engine-weight variants', () => {
        const supportTank = new SupportTankEntity();
        expect(mount(variableEquipment('supercharger', ['F_MASC', 'S_SUPERCHARGER'])).getTonnage(supportTank))
            .toBeUndefined();
        expect(mount(variableEquipment('jet booster', ['F_MASC', 'F_JET_BOOSTER'])).getTonnage(entity))
            .toBeUndefined();
    });

    it('uses weight class for mechanical jump boosters', () => {
        expect(mount(variableEquipment('booster', ['F_MECHANICAL_JUMP_BOOSTER'])).getTonnage(entity)).toBe(0.25);
    });

    it('does not charge support vehicles for environmental sealing tonnage', () => {
        const sealing = mount(variableEquipment('sealing', ['F_ENVIRONMENTAL_SEALING']));
        const supportTank = new SupportTankEntity();
        supportTank.tonnage.set(75);

        expect(sealing.getTonnage(entity)).toBe(7.5);
        expect(sealing.getTonnage(supportTank)).toBe(0);
    });

    const variableSizeCases: Array<[string, string[], number, number]> = [
        ['drone carrier control', ['F_DRONE_CARRIER_CONTROL'], 4, 4],
        ['MASH', ['F_MASH'], 4, 6.5],
        ['cargo', ['F_CARGO'], 2.2, 2.5],
        ['liquid cargo', ['F_LIQUID_CARGO'], 2.2, 2.5],
        ['communications', ['F_COMMUNICATIONS'], 2.2, 2.5],
        ['ladder', ['F_LADDER'], 20, 0.1],
        ['BA mission storage', ['F_BA_MISSION_EQUIPMENT'], 200, 0.2],
    ];

    for (const [name, flags, size, expectedTonnage] of variableSizeCases) {
        it(`resolves variable-size ${name}`, () => {
            expect(mount(variableEquipment(name, flags), size).getTonnage(entity)).toBe(expectedTonnage);
        });
    }

    it('resolves variable-size BA cargo lifter tonnage', () => {
        expect(mount(variableEquipment('renamed BA cargo lifter', ['F_BA_MANIPULATOR', 'F_CARGO_LIFTER']), 1.5)
            .getTonnage(entity)).toBe(0.09);
    });

    it('resolves IS and Clan targeting computers from relevant equipment weight', () => {
        const directFireWeapon = weaponMount('direct fire', 10, ['F_DIRECT_FIRE']);
        const taser = weaponMount('taser', 6, ['F_DIRECT_FIRE', 'F_TASER']);
        const pulseModule = mount(new MiscEquipment({
            id: 'pulse module',
            name: 'pulse module',
            type: 'misc',
            flags: ['F_RISC_LASER_PULSE_MODULE'],
            stats: { tonnage: 1 },
        }));
        const isTargetingComputer = mount(variableEquipment(
            'ISTargeting Computer', ['F_TARGETING_COMPUTER'], 'IS'));
        const clanTargetingComputer = mount(variableEquipment(
            'CLTargeting Computer', ['F_TARGETING_COMPUTER'], 'Clan'));
        entity.equipment.set([directFireWeapon, taser, pulseModule, isTargetingComputer]);

        expect(isTargetingComputer.getTonnage(entity)).toBe(3);
        expect(isTargetingComputer.equipment?.getNumCriticalSlots(entity)).toBe(3);
        expect(clanTargetingComputer.getTonnage(entity)).toBe(3);
    });
});

function variableEquipment(name: string, flags: string[], techBase: 'IS' | 'Clan' | 'All' = 'IS'): MiscEquipment {
    return new MiscEquipment({
        id: name,
        name,
        type: 'misc',
        flags,
        stats: { tonnage: 'variable', criticalSlots: 'variable' },
        tech: { base: techBase },
    });
}

function mount(equipment: MiscEquipment, size?: number): EntityMountedEquipment {
    return new EntityMountedEquipment({
        mountId: equipment.id,
        equipmentId: equipment.id,
        equipment,
        location: 'RA',
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
        size,
    });
}

function weaponMount(name: string, tonnage: number, flags: string[]): EntityMountedEquipment {
    return new EntityMountedEquipment({
        mountId: name,
        equipmentId: name,
        equipment: new WeaponEquipment({
            id: name,
            name,
            type: 'weapon',
            flags,
            stats: { tonnage },
        }),
        location: 'RA',
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
    });
}