import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { MountedEngine } from '../components';
import {
    TestBattleArmorEntity as BattleArmorEntity,
    TestBipedMekEntity as BipedMekEntity,
    TestDropShipEntity as DropShipEntity,
    TestJumpShipEntity as JumpShipEntity,
    TestProtoMekEntity as ProtoMekEntity,
    TestQuadMekEntity as QuadMekEntity,
    TestSmallCraftEntity as SmallCraftEntity,
    TestSpaceStationEntity as SpaceStationEntity,
    TestSupportTankEntity as SupportTankEntity,
    TestWarShipEntity as WarShipEntity,
} from '../testing/test-entities';
import { EntityMountedEquipment } from '../types';
import { TestBipedMekEntity, TestHandheldWeaponEntity } from '../testing/test-entities';
import { calculateMountedEquipmentCost } from './cost';

describe('entity cost', () => {
    it('classifies all large aerospace families through their common entity hierarchy', () => {
        const entities = [
            new SmallCraftEntity(),
            new DropShipEntity(),
            new JumpShipEntity(),
            new WarShipEntity(),
            new SpaceStationEntity(),
        ];

        expect(entities.every(entity => entity.isLargeCraft())).toBeTrue();
    });

    it('derives Space Station KF-adapter and modular classifications from tonnage', () => {
        const entity = new SpaceStationEntity();
        entity.modularOrKFAdapter.set(true);

        entity.setTonnage(100000);
        expect(entity.hasKFAdapter()).toBeTrue();
        expect(entity.isModular()).toBeFalse();

        entity.setTonnage(100001);
        expect(entity.hasKFAdapter()).toBeFalse();
        expect(entity.isModular()).toBeTrue();
    });

    it('applies Space Station ordinary, KF-adapter, and modular cost multipliers', () => {
        const entity = new SpaceStationEntity();
        entity.setTonnage(100000);
        const ordinaryAdapterWeightCost = entity.cost();
        entity.modularOrKFAdapter.set(true);
        expect(entity.cost()).toBe(ordinaryAdapterWeightCost * 4);

        entity.modularOrKFAdapter.set(false);
        entity.setTonnage(100001);
        const ordinaryModularWeightCost = entity.cost();
        entity.modularOrKFAdapter.set(true);
        expect(entity.cost()).toBe(ordinaryModularWeightCost * 10);
    });

  it('uses fixed prices from the equipment database', () => {
    const entity = new TestBipedMekEntity();
    entity.equipment.set([mount(new MiscEquipment({
      id: 'ISMediumShield',
      name: 'Shield (Medium)',
      type: 'misc',
      stats: { cost: 100000 },
    }))]);

    expect(calculateMountedEquipmentCost(entity)).toBe(100000);
  });

  it('prices handheld equipment as structure and payload', () => {
    const entity = new TestHandheldWeaponEntity();
    entity.equipment.set([mount(new MiscEquipment({
      id: 'test-equipment',
      name: 'Test Equipment',
      type: 'misc',
      stats: { cost: 1250 },
    }))]);

    expect(entity.cost()).toBe(2500);
  });

    it('prices support-vehicle chassis and motive systems', () => {
        const entity = new SupportTankEntity();
        entity.setTonnage(10);
        entity.motiveType.set('Tracked');
        entity.structuralTechRating.set(3);

        expect(entity.cost()).toBe(5156);
    });

    it('includes seating and transport bay door costs', () => {
        const entity = new SupportTankEntity();
        entity.setTonnage(10);
        entity.motiveType.set('Tracked');
        entity.structuralTechRating.set(3);
        entity.transporters.set([
            {
                id: 'seats', kind: 'bay', configuration: { type: 'standard-seats' },
                capacity: 5, doors: 0, bayNumber: -1, omni: false,
            },
            {
                id: 'cargo', kind: 'bay', configuration: { type: 'cargo' },
                capacity: 2, doors: 1, bayNumber: 1, omni: false,
            },
        ]);

        expect(entity.cost()).toBe(6806);
    });
});

function mount(equipment: MiscEquipment, armored = false, size?: number): EntityMountedEquipment {
    return new EntityMountedEquipment({
        mountId: equipment.id,
        equipmentId: equipment.id,
        equipment,
        allocation: { kind: 'location', location: 'RA' },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored,
        size,
    });
}

describe('EntityMountedEquipment.getCost', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(75);
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
        ['IS armored motive system', ['F_ARMORED_MOTIVE_SYSTEM'], 1150000],
        ['actuator enhancement system', ['F_ACTUATOR_ENHANCEMENT_SYSTEM'], 37500],
        ['light sail', ['F_LIGHT_SAIL'], 75000],
        ['naval C3', ['F_NAVAL_C3'], 75000],
    ];

    for (const [name, flags, expectedCost] of chassisCases) {
        it(`resolves ${name} cost`, () => {
            expect(mount(variableEquipment(name, flags)).getCost(entity)).toBe(expectedCost);
        });
    }

    it('returns zero for support-vehicle environmental sealing', () => {
        const supportTank = new SupportTankEntity();
        supportTank.setTonnage(75);

        expect(mount(variableEquipment('sealing', ['F_ENVIRONMENTAL_SEALING'])).getCost(supportTank)).toBe(0);
    });

    it('uses equipment tech base for armored motive-system cost', () => {
        const clanSystem = variableEquipment('renamed Clan armored motive system',
            ['F_ARMORED_MOTIVE_SYSTEM'], 'Clan');

        expect(mount(clanSystem).getCost(entity)).toBe(750000);
    });

    it('uses the AES leg-location cost multiplier', () => {
        const aes = mount(variableEquipment('AES', ['F_ACTUATOR_ENHANCEMENT_SYSTEM']));
        const quad = new QuadMekEntity();
        quad.setTonnage(75);

        expect(aes.clone({ allocation: { kind: 'location', location: 'RL' } }).getCost(entity)).toBe(52500);
        expect(aes.clone({ allocation: { kind: 'location', location: 'FLL' } }).getCost(quad)).toBe(52500);
    });

    it('resolves basic and advanced fire-control cost from all weapons', () => {
        const basic = mount(variableEquipment('basic fire control', ['F_BASIC_FIRE_CONTROL']));
        const advanced = mount(variableEquipment('advanced fire control', ['F_ADVANCED_FIRE_CONTROL']));
        entity.equipment.set([
            weaponMount('weapon', 10, [], 100000),
            weaponMount('AMS', 5, ['F_AMS'], 50000),
            weaponMount('light infantry', 1, ['F_INFANTRY'], 10000),
            weaponMount('infantry support', 2, ['F_INFANTRY', 'F_INF_SUPPORT'], 20000),
            basic,
            advanced,
        ]);

        expect(basic.getCost(entity)).toBe(9000);
        expect(advanced.getCost(entity)).toBe(18000);
    });

    it('resolves IS and Clan MASC cost', () => {
        expect(mount(variableEquipment('renamed IS MASC', ['F_MASC'], 'IS')).getCost(entity)).toBe(1200000);
        expect(mount(variableEquipment('renamed Clan MASC', ['F_MASC'], 'Clan')).getCost(entity)).toBe(900000);
    });

    it('resolves ProtoMek myomer-booster cost', () => {
        const protoMek = new ProtoMekEntity();
        protoMek.setTonnage(6);
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

    it('resolves support and VTOL jet-booster engine-weight costs', () => {
        const supportTank = new SupportTankEntity();
        expect(mount(variableEquipment('supercharger', ['F_MASC', 'S_SUPERCHARGER'])).getCost(supportTank))
            .toBe(0);
        expect(mount(variableEquipment('jet booster', ['F_MASC', 'F_JET_BOOSTER'])).getCost(entity))
            .toBe(3000000);
    });

    it('resolves zero-cost chassis markers and anti-Mek gear', () => {
        expect(mount(variableEquipment('flotation hull', ['F_FLOTATION_HULL'])).getCost(entity)).toBe(0);
        expect(mount(variableEquipment('off-road chassis', ['F_OFF_ROAD'])).getCost(entity)).toBe(0);
        expect(mount(variableEquipment('anti-Mek gear', ['F_ANTI_MEK_GEAR'])).getCost(entity)).toBe(0);
    });

    it('resolves large-craft control-system costs', () => {
        const cases: Array<[string, string[], number]> = [
            ['SRCS', ['F_SRCS'], 25000],
            ['shielded SRCS', ['F_SASRCS'], 31250],
            ['CASPAR', ['F_CASPAR'], 600000],
            ['CASPAR II', ['F_CASPAR_II'], 90000],
        ];
        for (const [name, flags, expected] of cases) {
            expect(mount(variableCostEquipment(name, flags, 2)).getCost(entity)).toBe(expected);
        }
    });

    it('resolves turret and power-generator costs', () => {
        expect(mount(variableCostEquipment('head turret', ['F_HEAD_TURRET'], 2)).getCost(entity)).toBe(20000);
        expect(mount(variableCostEquipment('sponson turret', ['F_SPONSON_TURRET'], 2)).getCost(entity)).toBe(8000);
        expect(mount(variableCostEquipment('pintle turret', ['F_PINTLE_TURRET'], 2)).getCost(entity)).toBe(2000);
        expect(mount(variableEquipment('FUSION PowerGenerator', ['F_POWER_GENERATOR']), false, 3).getCost(entity))
            .toBe(30000);
    });

    const variableSizeCases: Array<[string, string[], number, number]> = [
        ['drone carrier control', ['F_DRONE_CARRIER_CONTROL'], 4, 40000],
        ['MASH', ['F_MASH'], 4, 65000],
        ['communications', ['F_COMMUNICATIONS'], 2.2, 22000],
        ['ladder', ['F_LADDER'], 20, 100],
        ['ATAC', ['F_ATAC'], 4, 60150000],
        ['DTAC', ['F_DTAC'], 4, 30125000],
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

function weaponMount(name: string, tonnage: number, flags: string[], cost = 0): EntityMountedEquipment {
    return new EntityMountedEquipment({
        mountId: name,
        equipmentId: name,
        equipment: new WeaponEquipment({
            id: name,
            name,
            type: 'weapon',
            flags,
            stats: { tonnage, cost },
        }),
        allocation: { kind: 'location', location: 'RA' },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
    });
}

function variableCostEquipment(name: string, flags: string[], tonnage: number): MiscEquipment {
    return new MiscEquipment({
        id: name,
        name,
        type: 'misc',
        flags,
        stats: { cost: 'variable', tonnage },
    });
}