import { FixedWingSupportEntity } from '../models/entity/entities/aero/fixed-wing-support-entity';
import { BaseEntity } from '../models/entity/base-entity';
import { ConvFighterEntity } from '../models/entity/entities/aero/conv-fighter-entity';
import { DropShipEntity } from '../models/entity/entities/aero/dropship-entity';
import { HandheldWeaponEntity } from '../models/entity/entities/misc/handheld-weapon-entity';
import { BattleArmorEntity } from '../models/entity/entities/infantry/battle-armor-entity';
import { InfantryEntity } from '../models/entity/entities/infantry/infantry-entity';
import { BipedMekEntity } from '../models/entity/entities/mek/biped-mek-entity';
import { ProtoMekEntity } from '../models/entity/entities/protomek/protomek-entity';
import { MountedEngine } from '../models/entity/components';
import { EntityMountedEquipment } from '../models/entity/types/equipment';
import { JumpShipEntity } from '../models/entity/entities/largecraft/jumpship-entity';
import { SpaceStationEntity } from '../models/entity/entities/largecraft/space-station-entity';
import { WarShipEntity } from '../models/entity/entities/largecraft/warship-entity';
import { SmallCraftEntity } from '../models/entity/entities/aero/small-craft-entity';
import { AeroSpaceFighterEntity } from '../models/entity/entities/aero/aero-space-fighter-entity';
import { QuadMekEntity } from '../models/entity/entities/mek/quad-mek-entity';
import { TripodMekEntity } from '../models/entity/entities/mek/tripod-mek-entity';
import { QuadVeeEntity } from '../models/entity/entities/mek/quad-vee-entity';
import { LamEntity } from '../models/entity/entities/mek/lam-entity';
import { TankEntity } from '../models/entity/entities/vehicle/tank-entity';
import { locationArmor } from '../models/entity/types';
import { SupportNavalEntity } from '../models/entity/entities/vehicle/support-naval-entity';
import { SupportTankEntity } from '../models/entity/entities/vehicle/support-tank-entity';
import { SupportVtolEntity } from '../models/entity/entities/vehicle/support-vtol-entity';
import { Equipment, EquipmentRawData, MiscEquipment, StructureEquipment, WeaponEquipment } from '../models/equipment.model';
import { UnitMetadataBuilder } from './unit-metadata-builder';
import type { Sourcebook } from '../models/sourcebook.model';
import type { UnitSubtype } from '../models/entity/types';

describe('UnitMetadataBuilder', () => {
  const builder = new UnitMetadataBuilder();

  it('classifies support naval vehicles without changing their canonical entity type', () => {
    const entity = new SupportNavalEntity();
    entity.motiveType.set('Submarine');

    expect(Object.getPrototypeOf(SupportNavalEntity.prototype).constructor.name).toBe('NavalEntity');
    expect(entity.isSupportVehicle()).toBeTrue();
    expect(entity.entityType).toBe('SupportNaval');
    expect(builder.build(entity).type).toBe('Naval');
  });

  it('keeps non-naval support vehicles in the tank category', () => {
    const entity = new SupportTankEntity();
    entity.motiveType.set('Tracked');

    expect(builder.build(entity).type).toBe('Tank');
    expect(builder.build(entity).structureType).toBeNull();

    entity.mountedStructure.set(
      new StructureEquipment({
        id: 'Standard',
        name: 'Standard',
        type: 'structure',
        structure: { typeId: 0 },
      }),
    );
    expect(builder.build(entity).structureType).toBe('Standard');
  });

  it('exports Java weight class display names without changing canonical categories', () => {
    const conventionalFighter = new ConvFighterEntity();
    conventionalFighter.setTonnage(50);
    expect(conventionalFighter.weightClass()).toBe('Medium');
    expect(builder.build(conventionalFighter).weightClass).toBe('Medium');

    const supportVehicle = new SupportTankEntity();
    supportVehicle.motiveType.set('Tracked');
    supportVehicle.setTonnage(4);
    expect(supportVehicle.weightClass()).toBe('Small Support');
    expect(builder.build(supportVehicle).weightClass).toBe('Small Support Vehicle');

    const dropShip = new DropShipEntity();
    dropShip.setTonnage(5000);
    expect(dropShip.weightClass()).toBe('Medium DropShip');
    expect(builder.build(dropShip).weightClass).toBe('Medium Dropship');

    const capitalShips = [
      [new JumpShipEntity(), 'Small Jumpship'],
      [new WarShipEntity(), 'Small Warship'],
      [new SpaceStationEntity(), 'Small Space Station'],
    ] as const;
    for (const [entity, expected] of capitalShips) {
      entity.setTonnage(500000);
      expect(entity.weightClass()).toBe('Small Capital');
      expect(builder.build(entity).weightClass).toBe(expected);
    }
  });

  it('exports derived capital-ship data with WarShip integrity overrides', () => {
    const jumpShip = new JumpShipEntity();
    jumpShip.setTonnage(100000);
    jumpShip.transporters.set([
      { id: 'collar-1', kind: 'docking-collar', collarNumber: 1, omni: false },
      { id: 'collar-2', kind: 'docking-collar', collarNumber: 2, omni: false },
    ]);
    jumpShip.escapePods.set(4);
    jumpShip.lifeboats.set(6);
    jumpShip.gravDecks.set([95, 55]);

    expect(builder.build(jumpShip).capital).toEqual({
      dropshipCapacity: 2,
      escapePods: 4,
      lifeBoats: 6,
      gravDecks: [95, 55],
      sailIntegrity: 4,
      kfIntegrity: 3,
    });
    expect(jumpShip.dockingCollarCount()).toBe(2);

    const warShip = new WarShipEntity();
    warShip.setTonnage(100000);
    expect(builder.build(warShip).capital?.sailIntegrity).toBe(3);
    expect(builder.build(warShip).capital?.kfIntegrity).toBe(6);
  });

  it('zeros absent capital sail and drive integrity', () => {
    const entity = new SpaceStationEntity();
    entity.setTonnage(100000);

    expect(entity.sail()).toBeFalse();
    expect(entity.driveCoreType()).toBe('None');
    expect(builder.build(entity).capital?.sailIntegrity).toBe(0);
    expect(builder.build(entity).capital?.kfIntegrity).toBe(0);

    entity.driveCoreType.set('Standard');
    expect(entity.jumpDriveWeight()).toBe(0);

    expect(builder.build(new SupportTankEntity()).capital).toBeUndefined();
  });

  it('uses Java primitive jump-range drive weight defaults', () => {
    const entity = new JumpShipEntity();
    entity.setTonnage(100000);
    entity.driveCoreType.set('Primitive');

    expect(entity.jumpRange()).toBe(30);
    expect(entity.jumpDriveWeight()).toBe(95000);
    expect(entity.kfIntegrity()).toBe(3);

    entity.jumpRange.set(20);
    expect(entity.jumpDriveWeight()).toBe(65000);
  });

  it('exports Java role values for undetermined and explicit roles', () => {
    const entity = new SupportTankEntity();

    expect(builder.build(entity).role).toBe('None');

    entity.role.set('Scout');
    expect(builder.build(entity).role).toBe('Scout');
  });

  it('exports source and publication lists without reparsing them', () => {
    const entity = new SupportTankEntity();
    entity.source.set([
      sourcebook('TR:3050'),
      { abbrev: 'Unknown', canon: false, unresolved: true },
    ]);
    entity.published.set([sourcebook('RS:3050')]);

    expect(builder.build(entity).source).toEqual(['TR:3050', 'Unknown']);
    expect(builder.build(entity).published).toEqual(['RS:3050']);
  });

  it('derives canon state from sourcebook references', () => {
    const entity = new SupportTankEntity();

    expect(builder.build(entity).canon).toBeFalse();

    const canonSource = sourcebook('TR:3050');
    entity.source.set([canonSource]);
    expect(entity.source()[0]).toBe(canonSource);
    expect(builder.build(entity).canon).toBeTrue();

    entity.source.set([{ abbrev: 'Unknown', canon: false, unresolved: true }]);
    expect(builder.build(entity).canon).toBeFalse();
  });

  it('exports Battle Armor squad armor from its per-trooper value', () => {
    const entity = new BattleArmorEntity();
    entity.trooperCount.set(5);
    entity.armorValues.set(new Map([['Squad', locationArmor(7)]]));

    expect(entity.tonnage()).toBe(5);
    expect(builder.build(entity).tons).toBe(5);
    expect(entity.totalArmorPoints()).toBe(35);
    expect(builder.build(entity).armor).toBe(35);
  });

  it('exports calculated conventional infantry tonnage', () => {
    const entity = new InfantryEntity();
    entity.squadSize.set(7);
    entity.squadCount.set(4);

    expect(builder.build(entity).tons).toBe(2.5);
    expect(builder.build(entity).squadSize).toBe(7);
    expect(builder.build(entity).squads).toBe(4);

    entity.specializations.set(new Set(['bridge-engineers', 'paramedics']));
    entity.addEquipment({
      mountId: 'anti-mek-gear', equipmentId: 'AntiMekGear',
      allocation: { kind: 'location', location: 'Infantry' },
      rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
      equipment: new Equipment({
        id: 'AntiMekGear', name: 'Anti-Mek Gear', type: 'misc', flags: ['F_ANTI_MEK_GEAR'],
      } as EquipmentRawData),
    });
    expect(builder.build(entity).tons).toBe(7);
  });

  it('exports Battle Armor as one squad with one member per trooper', () => {
    const entity = new BattleArmorEntity();
    entity.trooperCount.set(5);

    expect(entity.totalInternalPoints()).toBe(5);
    expect(builder.build(entity).internal).toBe(5);
    expect(builder.build(entity).squadSize).toBe(5);
    expect(builder.build(entity).squads).toBe(1);
  });

  it('marks infantry, Battle Armor, and ProtoMeks as small units', () => {
    expect(builder.build(new InfantryEntity()).su).toBe(1);
    expect(builder.build(new BattleArmorEntity()).su).toBe(1);
    expect(builder.build(new ProtoMekEntity()).su).toBe(1);
    expect(builder.build(new BipedMekEntity()).su).toBe(0);
  });

  it('exports the unit subtype, including form, motive, military, and Omni qualifiers', () => {
    const omniMek = new BipedMekEntity();
    omniMek.omni.set(true);

    const industrialQuad = new QuadMekEntity();
    industrialQuad.mountedStructure.set(new StructureEquipment({
      id: 'Industrial',
      name: 'Industrial',
      type: 'structure',
      flags: ['F_INDUSTRIAL_STRUCTURE'],
      structure: { typeId: 1 },
    }));

    const hover = new TankEntity();
    hover.motiveType.set('Hover');
    hover.omni.set(true);

    const spheroidSmallCraft = new SmallCraftEntity();
    spheroidSmallCraft.motiveType.set('Spheroid');
    spheroidSmallCraft.equipment.set([viableWeaponMount('small craft laser')]);

    const militaryStation = new SpaceStationEntity();
    militaryStation.equipment.set([viableWeaponMount('station laser')]);

    const militaryDropShip = new DropShipEntity();
    militaryDropShip.equipment.set([viableWeaponMount('dropship laser')]);

    const mechanizedInfantry = new InfantryEntity();
    mechanizedInfantry.motiveType.set('Tracked');

    const cases: Array<[BaseEntity, UnitSubtype]> = [
      [new BipedMekEntity(), 'BattleMek'],
      [omniMek, 'BattleMek Omni'],
      [industrialQuad, 'Quad Industrial Mek'],
      [new TripodMekEntity(), 'Tripod BattleMek'],
      [new QuadVeeEntity(), 'QuadVee BattleMek'],
      [new LamEntity(), 'Land-Air BattleMek'],
      [new ProtoMekEntity(), 'ProtoMek'],
      [new BattleArmorEntity(), 'Battle Armor'],
      [mechanizedInfantry, 'Mechanized Conventional Infantry'],
      [hover, 'Hovercraft Omni'],
      [new SupportTankEntity(), 'Support Vehicle'],
      [new AeroSpaceFighterEntity(), 'Aerospace Fighter'],
      [new ConvFighterEntity(), 'Conventional Fighter'],
      [new SmallCraftEntity(), 'Civilian Aerodyne Small Craft'],
      [spheroidSmallCraft, 'Spheroid Small Craft'],
      [militaryDropShip, 'Aerodyne DropShip'],
      [new JumpShipEntity(), 'JumpShip'],
      [new WarShipEntity(), 'WarShip'],
      [militaryStation, 'Military Space Station'],
      [new HandheldWeaponEntity(), 'Handheld Weapon'],
    ];

    for (const [entity, expected] of cases) {
      expect(entity.unitSubtype()).withContext(entity.constructor.name).toBe(expected);
      expect(builder.build(entity).subtype).withContext(`${entity.constructor.name} metadata`).toBe(expected);
    }
  });

  it('lets entities report their exported unit type directly', () => {
    expect(new BipedMekEntity().unitType()).toBe('Mek');
    expect(new BattleArmorEntity().unitType()).toBe('Infantry');
    expect(new SupportTankEntity().unitType()).toBe('Tank');
    expect(new SupportNavalEntity().unitType()).toBe('Naval');
    expect(new SupportVtolEntity().unitType()).toBe('VTOL');
    expect(new AeroSpaceFighterEntity().unitType()).toBe('Aero');
    expect(new HandheldWeaponEntity().unitType()).toBe('Handheld Weapon');
  });

  it('exports the entity composite technology rating', () => {
    const entity = new BipedMekEntity();
    entity.equipment.set([ratedWeaponMount('experimental laser')]);

    expect(entity.techRating()).toBe('F/X-X-X-X');
    expect(builder.build(entity).techRating).toBe('F/X-X-X-X');
  });

  it('includes entity-specific systems in the composite technology rating', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(50);
    entity.year.set(2500);

    expect(entity.techRating()).toBe('D/C-E-D-C');

    entity.year.set(3080);
    entity.cockpitType.set('Small');

    expect(entity.techRating()).toBe('E/X-X-E-D');
  });

  it('starts a Mek composite technology rating with its construction technology', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(50);
    entity.year.set(2500);

    expect(entity.techRating()).toBe('D/C-E-D-C');
  });

  it('starts a combat vehicle rating with combat-vehicle construction technology', () => {
    const vehicle = new TankEntity();
    vehicle.year.set(2490);
    expect(vehicle.techRating()).toBe('D/C-C-C-B');
  });

  it('starts Battle Armor ratings with weight-class construction technology', () => {
    const battleArmor = new BattleArmorEntity();
    battleArmor.year.set(3052);
    expect(battleArmor.techRating()).toBe('E/X-X-D-D');

    battleArmor.isExoskeleton.set(true);
    battleArmor.year.set(2200);
    expect(battleArmor.techRating()).toBe('C/B-B-B-B');
  });

  it('includes aerospace fighter construction and cockpit technology', () => {
    const fighter = new AeroSpaceFighterEntity();
    fighter.year.set(2490);
    expect(fighter.techRating()).toBe('D/C-E-D-C');

    fighter.year.set(3080);
    fighter.cockpitType.set('Small');
    expect(fighter.techRating()).toBe('E/X-X-E-D');

    fighter.year.set(2300);
    fighter.cockpitType.set('Primitive');
    expect(fighter.techRating()).toBe('D/D-X-X-F');

    const conventionalFighter = new ConvFighterEntity();
    conventionalFighter.year.set(2490);
    expect(conventionalFighter.techRating()).toBe('D/C-D-C-C');
  });

  it('exports calculated beast-mounted infantry tonnage', () => {
    const entity = new InfantryEntity();
    entity.squadSize.set(4);
    entity.squadCount.set(2);
    entity.mount.set({
      name: 'Test Beast', size: 'Very Large', weight: 1.2,
      movementPoints: 3, movementMode: 'Leg', burstDamage: 0,
      vehicleDamage: 0, damageDivisor: 1, maxWaterDepth: 0,
      secondaryGroundMP: 0, uwEndurance: 0,
    });

    expect(builder.build(entity).tons).toBe(4);
  });

  it('combines physical inheritance with the shared support capability', () => {
    const cases = [
      [SupportTankEntity, 'TankEntity'],
      [SupportNavalEntity, 'NavalEntity'],
      [SupportVtolEntity, 'VtolEntity'],
      [FixedWingSupportEntity, 'AeroEntity'],
    ] as const;

    for (const [EntityClass, physicalBase] of cases) {
      const entity = new EntityClass();
      expect(Object.getPrototypeOf(EntityClass.prototype).constructor.name).toBe(physicalBase);
      expect(entity.isSupportVehicle()).toBeTrue();
    }
  });

  it('uses Java Alpha Strike prefixes for DropShip forms', () => {
    const dropShip = new DropShipEntity();
    dropShip.chassis.set('Leopard');

    dropShip.motiveType.set('Aerodyne');
    expect(builder.buildName(dropShip)).toBe('DALeopard');

    dropShip.motiveType.set('Spheroid');
    expect(builder.buildName(dropShip)).toBe('DSLeopard');
  });

  it('does not prefix handheld weapons with a non-Java unit type', () => {
    const handheld = new HandheldWeaponEntity();
    handheld.chassis.set('ER Medium Laser Weapon');

    expect(builder.buildName(handheld)).toBe('ERMediumLaserWeapon');
  });

  it('projects the Mek integral heat-sink capability into component metadata', () => {
    const entity = new BipedMekEntity();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'Clan' }));
    const heatSink = new MiscEquipment({
      id: 'CLDoubleHeatSink', name: 'Double Heat Sink', type: 'misc',
      flags: ['F_DOUBLE_HEAT_SINK'], stats: { criticalSlots: 2 },
    });
    entity.configureHeatSinks(heatSink, 10);

    const heatSinkComponents = builder.build(entity).comp?.filter(component => component.id === heatSink.id);
    expect(heatSinkComponents?.length).toBe(1);
    expect(heatSinkComponents).toContain(jasmine.objectContaining({
      id: 'CLDoubleHeatSink',
      q: 10,
      n: 'Double Heat Sink',
      t: 'C',
      p: -1,
      c: '2',
    }));
  });
});

function sourcebook(abbrev: string, canon = true): Sourcebook {
  return { id: 0, sku: '', abbrev, title: abbrev, canon };
}

function viableWeaponMount(id: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: id,
    equipmentId: id,
    equipment: new WeaponEquipment({
      id,
      name: id,
      type: 'weapon',
      weapon: { damage: 5, ranges: [3, 6, 9, 12] },
    }),
    allocation: { kind: 'location', location: 'Nose' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}

function ratedWeaponMount(id: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: id,
    equipmentId: id,
    equipment: new WeaponEquipment({
      id,
      name: id,
      type: 'weapon',
      tech: {
        base: 'IS',
        rating: 'F',
        level: 'Experimental',
        availability: { sl: 'X', sw: 'X', clan: 'X', da: 'X' },
        advancement: {},
      },
      weapon: { damage: 5, ranges: [3, 6, 9, 12] },
    }),
    allocation: { kind: 'location', location: 'RA' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}
