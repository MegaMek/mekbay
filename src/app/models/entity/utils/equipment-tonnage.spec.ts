import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import { ProtoMekEntity } from '../entities/protomek/protomek-entity';
import { SupportTankEntity } from '../entities/vehicle/support-tank-entity';
import { SupportVtolEntity } from '../entities/vehicle/support-vtol-entity';
import { TankEntity } from '../entities/vehicle/tank-entity';
import { DropShipEntity } from '../entities/aero/dropship-entity';
import { JumpShipEntity } from '../entities/largecraft/jumpship-entity';
import { WarShipEntity } from '../entities/largecraft/warship-entity';
import { EntityMountedEquipment } from '../types';
import { MountedEngine } from '../components';

describe('EntityMountedEquipment.getTonnage', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(75);

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
        ['IS armored motive system', ['F_ARMORED_MOTIVE_SYSTEM'], 11.5],
        ['actuator enhancement system', ['F_ACTUATOR_ENHANCEMENT_SYSTEM'], 2.5],
        ['naval tug adaptor', ['F_NAVAL_TUG_ADAPTOR'], 107.5],
        ['light sail', ['F_LIGHT_SAIL'], 7.5],
        ['lithium-fusion battery', ['F_LF_STORAGE_BATTERY'], 0.75],
        ['naval C3', ['F_NAVAL_C3'], 0.75],
        ['SDS destruct system', ['F_SDS_DESTRUCT'], 8],
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

    it('uses equipment tech base for armored motive systems', () => {
        const clanSystem = variableEquipment('renamed Clan armored motive system',
            ['F_ARMORED_MOTIVE_SYSTEM'], 'Clan');

        expect(mount(clanSystem).getTonnage(entity)).toBe(7.5);
    });

    it('uses the Quad AES divisor', () => {
        const quad = new QuadMekEntity();
        quad.setTonnage(75);

        expect(mount(variableEquipment('AES', ['F_ACTUATOR_ENHANCEMENT_SYSTEM'])).getTonnage(quad)).toBe(1.5);
    });

    it('uses ProtoMek magnetic-clamp weight thresholds', () => {
        const protoMek = new ProtoMekEntity();
        const clamp = mount(variableEquipment('renamed ProtoMek magnetic clamp',
            ['F_MAGNETIC_CLAMP', 'F_PROTOMEK_EQUIPMENT'], 'Clan'));

        protoMek.setTonnage(5.999);
        expect(clamp.getTonnage(protoMek)).toBe(0.25);
        protoMek.setTonnage(6);
        expect(clamp.getTonnage(protoMek)).toBe(0.5);
        protoMek.setTonnage(10);
        expect(clamp.getTonnage(protoMek)).toBe(1);
    });

    it('resolves fire-control weight with weapon exclusions and chassis override', () => {
        const basic = mount(variableEquipment('basic fire control', ['F_BASIC_FIRE_CONTROL']));
        const advanced = mount(variableEquipment('advanced fire control', ['F_ADVANCED_FIRE_CONTROL']));
        entity.equipment.set([
            weaponMount('weapon', 10, []),
            weaponMount('AMS', 5, ['F_AMS']),
            weaponMount('light infantry', 1, ['F_INFANTRY']),
            weaponMount('infantry support', 2, ['F_INFANTRY', 'F_INF_SUPPORT']),
            basic,
            advanced,
        ]);

        expect(basic.getTonnage(entity)).toBe(1);
        expect(advanced.getTonnage(entity)).toBe(1.5);

        const supportTank = new SupportTankEntity();
        supportTank.baseChassisFireConWeight.set(3);
        expect(basic.getTonnage(supportTank)).toBe(3);
    });

    it('resolves Mek turret weight from turret-mounted equipment', () => {
        const headTurret = mount(variableEquipment('head turret', ['F_HEAD_TURRET']));
        entity.equipment.set([
            headTurret,
            weaponMount('head weapon', 10, []).clone({
                allocation: { kind: 'location', location: 'HD' }, turretMounted: true,
            }),
            weaponMount('other weapon', 20, []).clone({
                allocation: { kind: 'location', location: 'RA' }, turretMounted: true,
            }),
        ]);

        expect(headTurret.getTonnage(entity)).toBe(1);
    });

    it('resolves and splits sponson turret weight', () => {
        const tank = new TankEntity();
        const rightTurret = mount(variableEquipment('right sponson', ['F_SPONSON_TURRET']));
        const leftTurret = mount(variableEquipment('left sponson', ['F_SPONSON_TURRET']));
        tank.equipment.set([
            rightTurret,
            leftTurret,
            weaponMount('right weapon', 5, []).clone({ turretType: 'sponson' }),
            weaponMount('left weapon', 5, []).clone({ turretType: 'sponson' }),
        ]);

        expect(rightTurret.getTonnage(tank)).toBe(0.5);

        tank.omni.set(true);
        tank.baseChassisSponsonPintleWeight.set(4);
        expect(rightTurret.getTonnage(tank)).toBe(2);
    });

    it('resolves pintle turret weight from weapons in the same location', () => {
        const supportTank = new SupportTankEntity();
        supportTank.setTonnage(75);
        const pintle = mount(variableEquipment('pintle', ['F_PINTLE_TURRET']));
        supportTank.equipment.set([
            pintle,
            weaponMount('pintle weapon', 5, []).clone({
                allocation: { kind: 'location', location: 'RA' }, turretType: 'pintle',
            }),
            weaponMount('other pintle weapon', 20, []).clone({
                allocation: { kind: 'location', location: 'LA' }, turretType: 'pintle',
            }),
        ]);

        expect(pintle.getTonnage(supportTank)).toBe(0.5);
    });

    it('resolves SRCS and CASPAR tonnage by large-craft type', () => {
        const dropShip = new DropShipEntity();
        dropShip.setTonnage(1000);
        const jumpShip = new JumpShipEntity();
        jumpShip.setTonnage(100000);
        const warShip = new WarShipEntity();
        warShip.setTonnage(100000);
        warShip.driveCoreType.set('Compact');

        expect(mount(variableEquipment('SRCS', ['F_SRCS'])).getTonnage(dropShip)).toBe(70);
        expect(mount(variableEquipment('improved SRCS', ['F_SRCS', 'S_IMPROVED'])).getTonnage(jumpShip)).toBe(600);
        expect(mount(variableEquipment('CASPAR', ['F_CASPAR'])).getTonnage(warShip)).toBe(6000);
        expect(mount(variableEquipment('improved CASPAR II', ['F_CASPAR_II', 'S_IMPROVED']))
            .getTonnage(dropShip)).toBe(120);
    });

    it('resolves extended fuel tanks from engine weight', () => {
        entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'IS' }));
        expect(mount(variableEquipment('extended fuel tank', ['F_FUEL'])).getTonnage(entity)).toBe(2);
    });

    it('matches Java variable-tonnage fallback for power generators and dumpers', () => {
        expect(mount(variableEquipment('power generator', ['F_POWER_GENERATOR'])).getTonnage(entity)).toBe(1);
        expect(mount(variableEquipment('dumper', ['F_DUMPER'])).getTonnage(entity)).toBe(1);
    });

    it('uses kilogram rounding for ProtoMek partial wings', () => {
        const protoMek = new ProtoMekEntity();
        protoMek.setTonnage(6.003);
        const wing = variableEquipment('ProtoMek partial wing', ['F_PARTIAL_WING', 'F_PROTOMEK_EQUIPMENT'], 'Clan');

        expect(mount(wing).getTonnage(protoMek)).toBe(1.201);
    });

    it('resolves standard, improved, and prototype-improved jump jets', () => {
        const standard = mount(variableEquipment('jump jet', ['F_JUMP_JET']));
        const improved = mount(variableEquipment('improved jump jet', ['F_JUMP_JET', 'S_IMPROVED']));
        const prototypeImproved = mount(variableEquipment(
            'prototype improved jump jet', ['F_JUMP_JET', 'S_IMPROVED', 'S_PROTOTYPE']));

        expect(standard.getTonnage(entity)).toBe(1);
        expect(improved.getTonnage(entity)).toBe(2);
        expect(prototypeImproved.getTonnage(entity)).toBe(1);
    });

    it('uses ProtoMek jump-jet thresholds', () => {
        const protoMek = new ProtoMekEntity();
        const jumpJet = mount(variableEquipment('ProtoMek jump jet',
            ['F_JUMP_JET', 'F_PROTOMEK_EQUIPMENT'], 'Clan'));

        protoMek.setTonnage(5.999);
        expect(jumpJet.getTonnage(protoMek)).toBe(0.05);
        protoMek.setTonnage(6);
        expect(jumpJet.getTonnage(protoMek)).toBe(0.1);
        protoMek.setTonnage(10);
        expect(jumpJet.getTonnage(protoMek)).toBe(0.15);
    });

    it('uses FrankenMek location tonnage capped by the center torso', () => {
        const frankenMek = new BipedMekEntity();
        frankenMek.setTonnage(100);
        frankenMek.isFrankenMek.set(true);
        frankenMek.frankenMekLocations.set(new Map([
            ['CT', { tonnage: 60 }],
            ['RA', { tonnage: 40 }],
        ]));

        expect(mount(variableEquipment('jump jet', ['F_JUMP_JET'])).getTonnage(frankenMek)).toBe(0.5);
    });

    it('resolves IS and Clan MASC tonnage', () => {
        expect(mount(variableEquipment('ISMASC', ['F_MASC'])).getTonnage(entity)).toBe(4);
        expect(mount(variableEquipment('CLMASC', ['F_MASC'], 'Clan')).getTonnage(entity)).toBe(3);
    });

    it('resolves ProtoMek and Battle Armor myomer-booster tonnage', () => {
        const protoMek = new ProtoMekEntity();
        protoMek.setTonnage(6);
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

    it('resolves support vehicle supercharger and jet-booster tonnage', () => {
        const supportTank = new SupportTankEntity();
        supportTank.setTonnage(20);
        supportTank.originalWalkMP.set(4);
        supportTank.engineTechRating.set(3);
        supportTank.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 80, techBase: 'IS' }));
        const supportVtol = new SupportVtolEntity();
        supportVtol.setTonnage(4);
        supportVtol.originalWalkMP.set(3);
        supportVtol.engineTechRating.set(3);
        supportVtol.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 20, techBase: 'IS' }));

        expect(mount(variableEquipment('supercharger', ['F_MASC', 'S_SUPERCHARGER'])).getTonnage(supportTank))
            .toBe(0.5);
        expect(mount(variableEquipment('jet booster', ['F_MASC', 'F_JET_BOOSTER'])).getTonnage(supportVtol))
            .toBe(0.025);
    });

    it('includes the Java hovercraft engine-weight minimum for superchargers', () => {
        const hover = new TankEntity();
        hover.setTonnage(50);
        hover.motiveType.set('Hover');
        hover.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 10, techBase: 'IS' }));

        expect(mount(variableEquipment('supercharger', ['F_MASC', 'S_SUPERCHARGER'])).getTonnage(hover)).toBe(1);
    });

    it('uses weight class for mechanical jump boosters', () => {
        expect(mount(variableEquipment('booster', ['F_MECHANICAL_JUMP_BOOSTER'])).getTonnage(entity)).toBe(0.25);
    });

    it('does not charge support vehicles for environmental sealing tonnage', () => {
        const sealing = mount(variableEquipment('sealing', ['F_ENVIRONMENTAL_SEALING']));
        const supportTank = new SupportTankEntity();
        supportTank.setTonnage(75);

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
        ['ATAC', ['F_ATAC'], 4, 601.5],
        ['DTAC', ['F_DTAC'], 4, 602.5],
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
        allocation: { kind: 'location', location: 'RA' },
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
        allocation: { kind: 'location', location: 'RA' },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
    });
}