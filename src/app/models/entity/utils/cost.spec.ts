import { ArmorEquipment, Equipment, MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { MountedArmor, MountedEngine } from '../components';
import {
    TestBattleArmorEntity as BattleArmorEntity,
    TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
    TestBipedMekEntity as BipedMekEntity,
    TestDropShipEntity as DropShipEntity,
    TestJumpShipEntity as JumpShipEntity,
    TestProtoMekEntity as ProtoMekEntity,
    TestQuadMekEntity as QuadMekEntity,
    TestSmallCraftEntity as SmallCraftEntity,
    TestSpaceStationEntity as SpaceStationEntity,
    TestSupportTankEntity as SupportTankEntity,
    TestTankEntity as TankEntity,
    TestWarShipEntity as WarShipEntity,
} from '../testing/test-entities';
import { EntityMountedEquipment } from '../types';
import { TestBipedMekEntity, TestHandheldWeaponEntity } from '../testing/test-entities';
import { calculateMountedEquipmentCost } from './cost';
import { calculateEntityCost, calculateEntityCostDetails } from './cost/entity-cost';
import { amount, buildCostReport, multiplier } from './cost/cost-report';

describe('entity cost', () => {
    it('applies additive and multiplier steps with running subtotals', () => {
        expect(buildCostReport([
            { type: 'Structure', amount: 100 },
            { type: 'Equipment', amount: 50 },
            { type: 'Weight Multiplier', factor: 1.5 },
        ])).toEqual({
            steps: [
                { type: 'Structure', amount: 100, subtotal: 100 },
                { type: 'Equipment', amount: 50, subtotal: 150 },
                { type: 'Weight Multiplier', factor: 1.5, subtotal: 225 },
            ],
            total: 225,
        });
    });

    it('preserves negative additive adjustments in report subtotals', () => {
        expect(buildCostReport([
            amount('Base', 10000),
            amount('Adjustment', -2000),
            multiplier('Multiplier', 1.5),
        ])).toEqual({
            steps: [
                { type: 'Base', amount: 10000, subtotal: 10000 },
                { type: 'Adjustment', amount: -2000, subtotal: 8000 },
                { type: 'Multiplier', factor: 1.5, subtotal: 12000 },
            ],
            total: 12000,
        });
    });

    it('keeps the numeric API and report total identical for every modeled family', () => {
        const entities = [
            new BipedMekEntity(), new SupportTankEntity(), new SmallCraftEntity(),
            new DropShipEntity(), new JumpShipEntity(), new WarShipEntity(),
            new SpaceStationEntity(), new ProtoMekEntity(), new BattleArmorEntity(),
            new TestHandheldWeaponEntity(),
        ];

        for (const entity of entities) {
            expect(calculateEntityCost(entity)).withContext(entity.entityType)
                .toBe(calculateEntityCostDetails(entity).total);
            expect(entity.cost()).withContext(entity.entityType).toBe(entity.costDetails().total);
        }
    });

    it('aggregates mounted equipment using MegaMek report labels', () => {
        const entity = new BipedMekEntity();
        entity.setEquipment([
            mount(new MiscEquipment({ id: 'laser-a', name: 'Test Laser', type: 'misc', stats: { cost: 1250 } })),
            mount(new MiscEquipment({ id: 'laser-b', name: 'Test Laser', type: 'misc', stats: { cost: 1750 } })),
        ]);

        const step = entity.costDetails().steps.find(candidate => candidate.type === '2 Test Laser');
        expect(step).toEqual(jasmine.objectContaining({ amount: 3000 }));
    });

    it('reports seating and bays separately', () => {
        const entity = new SupportTankEntity();
        entity.transporters.set([
            { id: 'seats', kind: 'bay', configuration: { type: 'standard-seats' },
                capacity: 5, doors: 0, bayNumber: -1, omni: false },
            { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' },
                capacity: 2, doors: 1, bayNumber: 1, omni: false },
        ]);

        expect(entity.costDetails().steps).toContain(jasmine.objectContaining({ type: 'Seating', amount: 500 }));
        expect(entity.costDetails().steps).toContain(jasmine.objectContaining({ type: 'Bays', amount: 1000 }));
    });

    it('charges DropShip seats as bay equipment but excludes structural troop accommodations', () => {
        const entity = new DropShipEntity();
        entity.transporters.set([
            { id: 'seats', kind: 'bay', configuration: { type: 'standard-seats' },
                capacity: 5, doors: 1, bayNumber: 1, omni: false },
            { id: 'infantry', kind: 'bay', configuration: { type: 'infantry', infantryType: 'Motorized' },
                capacity: 2, doors: 1, bayNumber: 2, omni: false },
            { id: 'quarters', kind: 'bay', configuration: { type: 'crew-quarters' },
                capacity: 3, doors: 0, bayNumber: -1, omni: false },
        ]);

        expect(entity.costDetails().steps.find(step => step.type === 'Bays'))
            .toEqual(jasmine.objectContaining({ amount: 2500 }));
    });

    it('uses original build year for pre-2500 Inner Sphere DropShip engines', () => {
        const entity = new DropShipEntity();
        entity.setTonnage(1000);
        entity.originalWalkMP.set(2);
        entity.originalBuildYear.set(2400);
        entity.techBase.set('IS');

        expect(entity.costDetails().steps.find(step => step.type === 'Engine'))
            .toEqual(jasmine.objectContaining({ amount: 143000 }));
    });

    it('uses original build year for pre-2500 Inner Sphere Small Craft engines', () => {
        const entity = new SmallCraftEntity();
        entity.setTonnage(150);
        entity.originalWalkMP.set(5);
        entity.originalBuildYear.set(2478);
        entity.techBase.set('IS');

        expect(entity.costDetails().steps.find(step => step.type === 'Engine'))
            .toEqual(jasmine.objectContaining({ amount: 58500 }));
    });

    it('subtracts four locations of free SI armor from DropShip armor cost', () => {
        const entity = new DropShipEntity();
        const armor = new ArmorEquipment({
            id: 'Standard Aerospace', name: 'Standard Aerospace', type: 'armor',
            stats: { cost: 10000 },
            armor: { type: 'AEROSPACE', pptMultiplier: 1, pptDropship: [20, 17, 14, 12, 10, 7] },
        });
        entity.setTonnage(1000);
        entity.structuralIntegrity.set(10);
        entity.setUniformArmor(new MountedArmor({ armor, techBase: 'IS' }));
        entity.setArmorValue('Nose', 'front', 100);

        expect(entity.costDetails().steps.find(step => step.type === 'Armor'))
            .toEqual(jasmine.objectContaining({ amount: 30000 }));
    });

    it('prices an unspecified DropShip docking collar as standard', () => {
        const entity = new DropShipEntity();

        expect(entity.collarType()).toBe('Unspecified');
        expect(entity.costDetails().steps.find(step => step.type === 'Docking Collar'))
            .toEqual(jasmine.objectContaining({ amount: 10000 }));
    });

    it('uses tonnage-dependent aerospace armor coverage for Small Craft', () => {
        const entity = new SmallCraftEntity();
        const armor = new ArmorEquipment({
            id: 'Clan Standard Aerospace', name: 'Standard Aerospace', type: 'armor',
            stats: { cost: 10000 },
            armor: { type: 'AEROSPACE', pptMultiplier: 1, pptDropship: [20, 17, 14, 12, 10, 7] },
        });
        entity.setTonnage(1000);
        entity.structuralIntegrity.set(6);
        entity.setUniformArmor(new MountedArmor({ armor, techBase: 'Clan' }));
        entity.setArmorValue('Nose', 'front', 404);

        expect(entity.costDetails().steps.find(step => step.type === 'Armor'))
            .toEqual(jasmine.objectContaining({ amount: 190000 }));

        entity.setTonnage(6000);
        expect(entity.costDetails().steps.find(step => step.type === 'Armor'))
            .toEqual(jasmine.objectContaining({ amount: 225000 }));
    });

    it('combines aerospace Omni and tonnage price adjustments before applying them', () => {
        const entity = new AeroSpaceFighterEntity();
        entity.setTonnage(75);
        entity.omni.set(true);

        const factors = entity.costDetails().steps.filter(step => 'factor' in step);
        expect(factors).toEqual([
            jasmine.objectContaining({ type: 'Weight Multiplier', factor: 1.71875 }),
        ]);
    });

    it('throws instead of silently reporting an unresolved variable equipment cost', () => {
        const entity = new BipedMekEntity();
        entity.setEquipment([mount(variableEquipment('unknown', []))]);

        expect(() => calculateEntityCostDetails(entity)).toThrowError(/Unable to calculate variable cost/);
    });

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
        entity.setEquipment([mount(new MiscEquipment({
      id: 'ISMediumShield',
      name: 'Shield (Medium)',
      type: 'misc',
      stats: { cost: 100000 },
    }))]);

    expect(calculateMountedEquipmentCost(entity)).toBe(100000);
  });

    it('includes explosive capacitors and rotary ACs in implicit Clan CASE', () => {
        const entity = new TestBipedMekEntity();
        entity.techBase.set('Clan');
        entity.setEquipment([
            mount(new MiscEquipment({
                id: 'capacitor', name: 'PPC Capacitor', type: 'misc',
                flags: ['F_PPC_CAPACITOR'], stats: { explosive: true },
            })),
            mount(new WeaponEquipment({
                id: 'rac', name: 'Rotary AC', type: 'weapon', weapon: { ammoType: 'AC_ROTARY' },
                stats: { explosive: true },
            })),
            mount(new MiscEquipment({
                id: 'ammo', name: 'Explosive Ammo', type: 'misc', stats: { explosive: true },
            })),
        ]);

        expect(entity.implicitClanCaseLocations()).toEqual(new Set(['RA']));
        expect(calculateMountedEquipmentCost(entity)).toBe(50000);
    });

    it('charges generated Clan CASE only for locations without explicit protection', () => {
        const entity = new TestBipedMekEntity();
        entity.techBase.set('Clan');
        const explosive = mount(new MiscEquipment({
            id: 'explosive', name: 'Explosive Equipment', type: 'misc', stats: { explosive: true },
        }));
        const protectedExplosive = mount(new MiscEquipment({
            id: 'protected-explosive', name: 'Protected Explosive', type: 'misc', stats: { explosive: true },
        })).clone({ allocation: { kind: 'location', location: 'LA' } });
        const explicitCase = mount(new MiscEquipment({
            id: 'CLCASE', name: 'Clan CASE', type: 'misc', flags: ['F_CASE'], stats: { cost: 50000 },
        })).clone({ allocation: { kind: 'location', location: 'LA' } });
        entity.setEquipment([explosive, protectedExplosive, explicitCase]);

        expect(entity.automaticClanCaseLocations()).toEqual(new Set(['RA']));
        expect(calculateMountedEquipmentCost(entity)).toBe(100000);
    });


  it('prices handheld equipment as structure and payload', () => {
    const entity = new TestHandheldWeaponEntity();
        entity.setEquipment([mount(new MiscEquipment({
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

    it('does not grant support vehicles weight-free engine heat sinks', () => {
        const mediumLaser = new WeaponEquipment({
            id: 'medium-laser', name: 'Medium Laser', type: 'weapon',
            flags: ['F_LASER'], stats: { cost: 40000 },
            weapon: { heat: 3, ammoType: 'NA' },
        });
        const supportVehicle = new SupportTankEntity();
        supportVehicle.mountedEngine.set(new MountedEngine({
            type: 'Fusion', rating: 100, techBase: 'IS',
        }));
        supportVehicle.setEquipment([
            mount(mediumLaser, false, undefined, 'laser-1'),
            mount(mediumLaser, false, undefined, 'laser-2'),
        ]);

        expect(supportVehicle.costDetails().steps.find(step => step.type === 'Heatsinks'))
            .toEqual(jasmine.objectContaining({ amount: 12000 }));

        const combatVehicle = new TankEntity();
        combatVehicle.mountedEngine.set(new MountedEngine({
            type: 'Fusion', rating: 100, techBase: 'IS',
        }));
        combatVehicle.setEquipment([
            mount(mediumLaser, false, undefined, 'laser-1'),
            mount(mediumLaser, false, undefined, 'laser-2'),
        ]);

        expect(combatVehicle.costDetails().steps.find(step => step.type === 'Heatsinks'))
            .toEqual(jasmine.objectContaining({ amount: 0 }));
    });

    it('includes operating misc heat after applying engine heat-sink allowances', () => {
        const entity = new TankEntity();
        entity.mountedEngine.set(new MountedEngine({
            type: 'Fusion', rating: 100, techBase: 'IS',
        }));
        entity.setEquipment([mount(new MiscEquipment({
            id: 'mobile-hpg', name: 'Ground-Mobile HPG', type: 'misc',
            flags: ['F_MOBILE_HPG', 'F_MEK_EQUIPMENT'], stats: { cost: 0 },
        }))]);

        expect(entity.costDetails().steps.find(step => step.type === 'Heatsinks'))
            .toEqual(jasmine.objectContaining({ amount: 20000 }));
    });

    it('does not add spot-welder heat with fusion or fission engines', () => {
        const spotWelder = new MiscEquipment({
            id: 'spot-welder', name: 'Spot Welder', type: 'misc',
            flags: ['F_CLUB', 'S_SPOT_WELDER'], stats: { cost: 0 },
        });
        const entity = new TankEntity();
        entity.mountedEngine.set(new MountedEngine({
            type: 'Fusion', rating: 100, techBase: 'IS',
        }));
        entity.setEquipment([mount(spotWelder)]);

        expect(entity.costDetails().steps.find(step => step.type === 'Heatsinks'))
            .toEqual(jasmine.objectContaining({ amount: 0 }));

        entity.mountedEngine.set(new MountedEngine({
            type: 'ICE', rating: 100, techBase: 'IS',
        }));
        expect(entity.costDetails().steps.find(step => step.type === 'Heatsinks'))
            .toEqual(jasmine.objectContaining({ amount: 4000 }));
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

    it('does not charge legacy troop-space transporters', () => {
        const entity = new SupportTankEntity();
        entity.setTonnage(10);
        entity.motiveType.set('Tracked');
        entity.structuralTechRating.set(3);
        entity.transporters.set([
            { id: 'troops', kind: 'troop-space', totalSpace: 5, omni: false },
        ]);

        expect(entity.cost()).toBe(5156);
    });

    it('uses standard jump-system cost for prototype improved jump jets', () => {
        const entity = new BipedMekEntity();
        entity.setTonnage(60);
        const prototypeImprovedJumpJet = new MiscEquipment({
            id: 'prototype-improved-jump-jet', name: 'Prototype Improved Jump Jet', type: 'misc',
            flags: ['F_JUMP_JET', 'S_IMPROVED', 'S_PROTOTYPE'], stats: { cost: 0 },
        });
        entity.setEquipment(Array.from({ length: 6 }, (_, index) =>
            mount(prototypeImprovedJumpJet, false, undefined, `prototype-jump-jet-${index}`)));

        expect(entity.costDetails().steps.find(step => step.type === 'Jump Jets'))
            .toEqual(jasmine.objectContaining({ amount: 432000 }));
    });

});

function mount(equipment: Equipment, armored = false, size?: number, mountId = equipment.id): EntityMountedEquipment {
    return new EntityMountedEquipment({
        mountId,
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
        entity.setEquipment([
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

    it('truncates support infantry weapon and ammunition cost only after summing them', () => {
        const supportTank = new SupportTankEntity();
        const infantryWeapon = new WeaponEquipment({
            id: 'fractional-infantry-weapon', name: 'Fractional Infantry Weapon', type: 'weapon',
            flags: ['F_INFANTRY'], stats: { cost: 80.75 },
            infantry: { ammoCost: 0.75 },
        });
        supportTank.setEquipment([mount(infantryWeapon, false, 3)]);

        expect(calculateMountedEquipmentCost(supportTank)).toBe(82);
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
        battleArmor.setEquipment([booster]);

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
        const armoredHeadTurret = new MiscEquipment({
            id: 'armored head turret', name: 'armored head turret', type: 'misc',
            flags: ['F_HEAD_TURRET'], stats: { cost: 'variable', tonnage: 2, criticalSlots: 1 },
        });
        expect(mount(armoredHeadTurret, true).getCost(entity)).toBe(170000);
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
        entity.setEquipment([
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

function weaponMount(
    name: string,
    tonnage: number,
    flags: string[],
    cost = 0,
): EntityMountedEquipment {
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