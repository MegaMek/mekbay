import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { MountedEngine } from '../components';
import { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { ProtoMekEntity } from '../entities/protomek/protomek-entity';
import { SupportTankEntity } from '../entities/vehicle/support-tank-entity';
import { EntityMountedEquipment } from '../types';

describe('EntityMountedEquipment.getCost', () => {
    const entity = new BipedMekEntity();
    entity.tonnage.set(75);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'IS' }));

    const cases: Array<[string, string[], number]> = [
        ['hatchet', ['F_CLUB', 'S_HATCHET'], 25000],
        ['sword', ['F_CLUB', 'S_SWORD'], 40000],
        ['lance', ['F_CLUB', 'S_LANCE'], 11250],
        ['retractable blade', ['F_CLUB', 'S_RETRACTABLE_BLADE'], 50000],
        ['claw', ['F_HAND_WEAPON', 'S_CLAW'], 15000],
        ['talons', ['F_TALON'], 1500],
        ['ram plate', ['F_RAM_PLATE'], 80000],
    ];

    for (const [name, flags, expectedCost] of cases) {
        it(`resolves ${name}`, () => {
            expect(mount(variableEquipment(name, flags)).getCost(entity)).toBe(expectedCost);
        });
    }

    it('passes through fixed cost', () => {
        const mace = new MiscEquipment({
            id: 'mace',
            name: 'mace',
            type: 'misc',
            flags: ['F_CLUB', 'S_MACE'],
            stats: { cost: 130000 },
        });

        expect(mount(mace, true).getCost(entity)).toBe(130000);
    });

    it('adds the armored surcharge to variable-cost equipment', () => {
        const hatchet = variableEquipment('hatchet', ['F_CLUB', 'S_HATCHET']);

        expect(mount(hatchet, true).getCost(entity)).toBe(775000);
    });

    const chassisCases: Array<[string, string[], number]> = [
        ['partial wing', ['F_PARTIAL_WING', 'F_MEK_EQUIPMENT'], 275000],
        ['limited amphibious', ['F_LIMITED_AMPHIBIOUS'], 30000],
        ['fully amphibious', ['F_FULLY_AMPHIBIOUS'], 75000],
        ['dune buggy', ['F_DUNE_BUGGY'], 562.5],
        ['environmental sealing', ['F_ENVIRONMENTAL_SEALING'], 16875],
        ['tracks', ['F_TRACKS'], 150000],
        ['QuadVee wheels', ['F_TRACKS', 'S_QUADVEE_WHEELS'], 225000],
        ['spikes', ['F_SPIKES'], 3750],
        ['mechanical jump booster', ['F_MECHANICAL_JUMP_BOOSTER'], 150000],
        ['drone operating system', ['F_DRONE_OPERATING_SYSTEM'], 85000],
    ];

    for (const [name, flags, expectedCost] of chassisCases) {
        it(`resolves ${name} cost`, () => {
            expect(mount(variableEquipment(name, flags)).getCost(entity)).toBe(expectedCost);
        });
    }

    it('returns zero for support-vehicle environmental sealing', () => {
        const supportTank = new SupportTankEntity();
        supportTank.tonnage.set(75);

        expect(mount(variableEquipment('sealing', ['F_ENVIRONMENTAL_SEALING'])).getCost(supportTank)).toBe(0);
    });

    it('resolves IS and Clan MASC cost', () => {
        expect(mount(variableEquipment('renamed IS MASC', ['F_MASC'], 'IS')).getCost(entity)).toBe(1200000);
        expect(mount(variableEquipment('renamed Clan MASC', ['F_MASC'], 'Clan')).getCost(entity)).toBe(900000);
    });

    it('resolves ProtoMek myomer-booster cost', () => {
        const protoMek = new ProtoMekEntity();
        protoMek.tonnage.set(6);
        protoMek.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'Clan' }));

        expect(mount(variableEquipment('CLMyomerBooster', ['F_MASC', 'F_PROTOMEK_EQUIPMENT'])).getCost(protoMek))
            .toBe(15000);
    });

    it('uses enhanced run MP for Battle Armor myomer-booster cost', () => {
        const battleArmor = new BattleArmorEntity();
        battleArmor.originalWalkMP.set(5);
        const booster = mount(variableEquipment('CLBAMyomerBooster', ['F_MASC', 'F_BA_EQUIPMENT']));
        battleArmor.equipment.set([booster]);

        expect(booster.getCost(battleArmor)).toBe(525000);
    });

    it('resolves standard supercharger cost from engine rating', () => {
        expect(mount(variableEquipment('supercharger', ['F_MASC', 'S_SUPERCHARGER'])).getCost(entity))
            .toBe(3000000);
    });

    it('defers support and VTOL jet-booster engine-weight costs', () => {
        const supportTank = new SupportTankEntity();
        expect(mount(variableEquipment('supercharger', ['F_MASC', 'S_SUPERCHARGER'])).getCost(supportTank))
            .toBeUndefined();
        expect(mount(variableEquipment('jet booster', ['F_MASC', 'F_JET_BOOSTER'])).getCost(entity))
            .toBeUndefined();
    });

    const variableSizeCases: Array<[string, string[], number, number]> = [
        ['drone carrier control', ['F_DRONE_CARRIER_CONTROL'], 4, 40000],
        ['MASH', ['F_MASH'], 4, 65000],
        ['communications', ['F_COMMUNICATIONS'], 2.2, 22000],
        ['ladder', ['F_LADDER'], 20, 100],
    ];

    for (const [name, flags, size, expectedCost] of variableSizeCases) {
        it(`resolves variable-size ${name} cost`, () => {
            expect(mount(variableEquipment(name, flags), false, size).getCost(entity)).toBe(expectedCost);
        });
    }

    it('resolves variable-size BA cargo-lifter cost', () => {
        const cargoLifter = variableEquipment('renamed BA cargo lifter', ['F_BA_MANIPULATOR', 'F_CARGO_LIFTER']);

        expect(mount(cargoLifter, false, 1.5).getCost(entity)).toBe(750);
    });

    it('resolves targeting-computer cost from its tech base and relevant weapon weight', () => {
        const isTargetingComputer = mount(variableEquipment(
            'renamed IS targeting computer', ['F_TARGETING_COMPUTER'], 'IS'));
        const clanTargetingComputer = mount(variableEquipment(
            'renamed Clan targeting computer', ['F_TARGETING_COMPUTER'], 'Clan'));
        entity.equipment.set([
            weaponMount('direct fire', 10, ['F_DIRECT_FIRE']),
            weaponMount('taser', 6, ['F_DIRECT_FIRE', 'F_TASER']),
            isTargetingComputer,
            clanTargetingComputer,
        ]);

        expect(isTargetingComputer.getCost(entity)).toBe(30000);
        expect(clanTargetingComputer.getCost(entity)).toBe(20000);
    });
});

function variableEquipment(name: string, flags: string[], techBase: 'IS' | 'Clan' | 'All' = 'IS'): MiscEquipment {
    return new MiscEquipment({
        id: name,
        name,
        type: 'misc',
        flags,
        stats: { cost: 'variable', tonnage: 'variable', criticalSlots: 'variable' },
        tech: { base: techBase },
    });
}

function mount(equipment: MiscEquipment, armored = false, size?: number): EntityMountedEquipment {
    return new EntityMountedEquipment({
        mountId: equipment.id,
        equipmentId: equipment.id,
        equipment,
        location: 'RA',
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored,
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