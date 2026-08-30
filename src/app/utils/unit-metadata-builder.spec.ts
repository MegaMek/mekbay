// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { BaseEntity } from '../models/entity/base-entity';
import { MountedArmor, MountedEngine, MountedStructure, STANDARD_STRUCTURE_EQUIPMENT } from '../models/entity/components';
import { EntityMountedEquipment } from '../models/entity/types/equipment';
import { BV_MOVEMENT_CALCULATION, locationArmor } from '../models/entity/types';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestConvFighterEntity as ConvFighterEntity,
  TestDropShipEntity as DropShipEntity,
  TestFixedWingSupportEntity as FixedWingSupportEntity,
  TestHandheldWeaponEntity as HandheldWeaponEntity,
  TestInfantryEntity as InfantryEntity,
  TestJumpShipEntity as JumpShipEntity,
  TestLamEntity as LamEntity,
  TestProtoMekEntity as ProtoMekEntity,
  TestQuadMekEntity as QuadMekEntity,
  TestQuadVeeEntity as QuadVeeEntity,
  TestSmallCraftEntity as SmallCraftEntity,
  TestSpaceStationEntity as SpaceStationEntity,
  TestSupportNavalEntity as SupportNavalEntity,
  TestSupportTankEntity as SupportTankEntity,
  TestSupportVtolEntity as SupportVtolEntity,
  TestTankEntity as TankEntity,
  TestTripodMekEntity as TripodMekEntity,
  TestWarShipEntity as WarShipEntity,
} from '../models/entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../models/entity/testing/test-mounted-equipment';
import { ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../models/equipment.model';
import { UnitMetadataBuilder } from './unit-metadata-builder';
import { getOffensiveSpeedFactor, offensiveSpeedFactor } from '../models/entity/utils/battle-value';
import type { Sourcebook } from '../models/sourcebook.model';
import type { UnitSubtype } from '../models/entity/types';
import { EquipmentFlag } from '../models/equipment-flags.type';

describe('UnitMetadataBuilder', () => {
  const builder = new UnitMetadataBuilder();

  it('builds Mek metadata from the canonical entity', () => {
    const metadata = builder.build(new BipedMekEntity());
    expect(metadata.type).toBe('Mek');
    expect(metadata.as?.TP).toBe('BM');
  });

  it('exports the path returned by the unit icon resolver', () => {
    const entity = new TankEntity();
    const resolver = jasmine.createSpy('resolver').and.returnValue('units/Test.png');
    const metadata = new UnitMetadataBuilder(resolver).build(entity);

    expect(resolver).toHaveBeenCalledOnceWith(entity);
    expect(metadata.icon).toBe('units/Test.png');
    expect(builder.build(entity).icon).toBe('');
  });

  it('exports conventional infantry anti-Mek training from installed gear', () => {
    const entity = new InfantryEntity();

    expect(builder.build(entity).canAntiMech).toBeFalse();

    addTestEquipmentWithFlags(entity, 'F_ANTI_MEK_GEAR');
    expect(entity.canAntiMech()).toBeTrue();
    expect(builder.build(entity).canAntiMech).toBeTrue();
  });

  it('exports Battle Armor anti-Mek capability from its attack requirements', () => {
    const entity = new BattleArmorEntity();
    entity.declaredWeightClass.set('Medium');

    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    expect(builder.build(entity).canAntiMech).toBeFalse();

    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    expect(entity.legAttackCapable()).toBeTrue();
    expect(builder.build(entity).canAntiMech).toBeTrue();

    entity.declaredWeightClass.set('Heavy');
    expect(builder.build(entity).canAntiMech).toBeFalse();
  });

  it('exports false anti-Mek capability for non-infantry units', () => {
    expect(builder.build(new TankEntity()).canAntiMech).toBeFalse();
  });



  it('derives Aero cockpit features canonically', () => {
    const entity = new ConvFighterEntity();
    entity.cockpitType.set('Small');
    expect(entity.entityFeatures()).toEqual(jasmine.arrayWithExactContents(['Small Cockpit']));

    entity.cockpitType.set('Command Console');
    expect(entity.entityFeatures()).toEqual(jasmine.arrayWithExactContents(['Command Console']));
  });

  it('derives the remaining SVGMassPrinter feature categories', () => {
    const fighter = new ConvFighterEntity();
    fighter.vstol.set(true);
    expect(fighter.entityFeatures()).toEqual(jasmine.arrayWithExactContents(['VSTOL Equipment']));

    const fixedWing = new FixedWingSupportEntity();
    addTestEquipmentWithFlags(fixedWing, 'F_VSTOL_CHASSIS');
    expect(fixedWing.entityFeatures()).toContain('VSTOL Equipment');

    const jumpShip = new JumpShipEntity();
    jumpShip.lithiumFusion.set(true);
    expect(jumpShip.entityFeatures()).toEqual(jasmine.arrayWithExactContents(['LF Battery']));

    const vehicle = new SupportTankEntity();
    addTestEquipmentWithFlags(vehicle, 'F_CHASSIS_MODIFICATION');
    expect(vehicle.entityFeatures().some(feature => feature.startsWith('Chassis Mod: '))).toBeTrue();

    const transport = new SupportTankEntity();
    transport.transporters.set([
      { id: 'troop-space', kind: 'troop-space', totalSpace: 1, omni: false },
      {
        id: 'quarters', kind: 'bay', configuration: { type: 'crew-quarters' },
        capacity: 1, doors: 1, bayNumber: 0, omni: false,
      },
      {
        id: 'fighter-bay', kind: 'bay', configuration: { type: 'fighter', arts: false },
        capacity: 1, doors: 1, bayNumber: 0, omni: false,
      },
    ]);
    expect(transport.entityFeatures()).toEqual(jasmine.arrayWithExactContents([
      'Infantry Compartment',
      'Bay: Fighter',
    ]));
  });

  it('exports the Java offensive speed factor from BV movement', () => {
    const entity = new TankEntity();
    entity.originalWalkMP.set(4);

    expect(offensiveSpeedFactor(6)).toBe(1.12);
    expect(getOffensiveSpeedFactor(entity)).toBe(1.12);
    expect(builder.build(entity).offSpeedFactor).toBe(1.12);
  });


  it('excludes the atmospheric ProtoMek partial-wing bonus from BV speed', () => {
    const entity = new ProtoMekEntity();
    entity.originalWalkMP.set(3);
    entity.setEquipment([
      miscMount('partial-wing', ['F_PARTIAL_WING']),
      ...Array.from({ length: 5 }, (_, index) => miscMount(`jump-jet-${index}`, ['F_JUMP_JET'])),
    ]);

    expect(entity.maxJumpMP()).toBe(7);
    expect(entity.computeJumpMP(BV_MOVEMENT_CALCULATION)).toBe(5);
    expect(builder.build(entity).offSpeedFactor).toBe(1.37);
  });

  it('classifies support naval vehicles without changing their canonical entity type', () => {
    const entity = new SupportNavalEntity();
    entity.motiveType.set('Submarine');

    expect(Object.getPrototypeOf(Object.getPrototypeOf(SupportNavalEntity.prototype)).constructor.name)
      .toBe('NavalEntity');
    expect(entity.isSupportVehicle()).toBeTrue();
    expect(entity.entityType).toBe('SupportNaval');
    expect(builder.build(entity).type).toBe('Naval');
  });

  it('keeps non-naval support vehicles in the tank category', () => {
    const entity = new SupportTankEntity();
    entity.motiveType.set('Tracked');

    expect(builder.build(entity).type).toBe('Tank');
    expect(builder.build(entity).structureType).toBeNull();

    const structure = new StructureEquipment({
        id: 'Standard',
        name: 'Standard',
        type: 'structure',
        structure: { typeId: 0 },
    });
    entity.setUniformStructure(new MountedStructure({ tonnage: entity.tonnage(), structure }));
    expect(builder.build(entity).structureType).toBe('Standard');
  });

  it('exports hybrid Mek structure distribution', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(60);
    const endo = new StructureEquipment({
      id: 'IS Endo Steel',
      name: 'Endo Steel',
      type: 'structure',
      structure: { typeId: 2 },
      tech: { base: 'IS' },
    });
    entity.setUniformStructure(new MountedStructure({
      tonnage: 60,
      structure: STANDARD_STRUCTURE_EQUIPMENT,
    }));
    entity.setStructureAt('LA', new MountedStructure({ tonnage: 60, structure: endo }));

    const metadata = builder.build(entity);
    expect(metadata.structureType).toBe('Hybrid');
    expect(metadata.hybridLayout).toEqual({
      HD: { type: 0, clan: false },
      CT: { type: 0, clan: false },
      RT: { type: 0, clan: false },
      LT: { type: 0, clan: false },
      RA: { type: 0, clan: false },
      LA: { type: 2, clan: false },
      RL: { type: 0, clan: false },
      LL: { type: 0, clan: false },
    });
  });

  it('exports patchwork armor material codes and technology bases', () => {
    const entity = new BipedMekEntity();
    const impactResistant = new ArmorEquipment({
      id: 'Impact-Resistant Armor',
      name: 'Impact-Resistant',
      type: 'armor',
      armor: { type: 'IMPACT_RESISTANT' },
    });
    entity.setArmorEquipmentAt('LA', impactResistant, 'Clan');

    const metadata = builder.build(entity);
    expect(metadata.armorType).toBe('Patchwork');
    expect(metadata.patchworkLayout?.['LA']).toEqual({ type: 25, clan: true });
    expect(metadata.patchworkLayout?.['CT']).toEqual({ type: 0, clan: false });
  });

  it('exports MegaMek patchwork sentinels for fighter pseudo-locations', () => {
    const entity = new AeroSpaceFighterEntity();
    const reflective = new ArmorEquipment({
      id: 'Reflective Armor',
      name: 'Reflective',
      type: 'armor',
      armor: { type: 'REFLECTIVE' },
    });
    entity.setArmorEquipmentAt('Left Wing', reflective, 'IS');

    expect(builder.build(entity).patchworkLayout).toEqual({
      NOS: { type: 0, clan: false },
      LWG: { type: 3, clan: false },
      RWG: { type: 0, clan: false },
      AFT: { type: 0, clan: false },
      WNG: { type: 0, clan: false },
      FSLG: { type: -1, clan: false },
    });
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
    expect(builder.build(dropShip).weightClass).toBe('Medium DropShip');

    const capitalShips = [
      [new JumpShipEntity(), 'Small JumpShip'],
      [new WarShipEntity(), 'Small WarShip'],
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
    expect(builder.build(entity).loadoutTons).toBe(entity.loadoutTonnage());
    expect(entity.totalArmorPoints()).toBe(35);
    expect(builder.build(entity).armor).toBe(35);
  });

  it('exports calculated conventional infantry tonnage', () => {
    const entity = new InfantryEntity();
    entity.squadSize.set(7);
    entity.squadCount.set(4);

    expect(builder.build(entity).tons).toBe(2.5);
    expect(builder.build(entity).loadoutTons).toBe(2.5);
    expect(builder.build(entity).squadSize).toBe(7);
    expect(builder.build(entity).squads).toBe(4);

    entity.specializations.set(new Set(['bridge-engineers', 'paramedics']));
    addTestEquipmentWithFlags(entity, 'F_ANTI_MEK_GEAR', { location: 'Infantry' });
    expect(builder.build(entity).tons).toBe(7);
  });

  it('exports zero loadout tonnage for an unimplemented family', () => {
    expect(builder.build(new TankEntity()).loadoutTons).toBe(0);
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
  });

  it('exports the unit subtype, including form, motive, military, and Omni qualifiers', () => {
    const hover = new TankEntity();
    hover.motiveType.set('Hover');
    hover.omni.set(true);

    const spheroidSmallCraft = new SmallCraftEntity();
    spheroidSmallCraft.motiveType.set('Spheroid');
    spheroidSmallCraft.setEquipment([viableWeaponMount('small craft laser')]);

    const militaryStation = new SpaceStationEntity();
    militaryStation.setEquipment([viableWeaponMount('station laser')]);

    const militaryDropShip = new DropShipEntity();
    militaryDropShip.setEquipment([viableWeaponMount('dropship laser')]);

    const mechanizedInfantry = new InfantryEntity();
    mechanizedInfantry.motiveType.set('Tracked');

    const cases: Array<[BaseEntity, UnitSubtype]> = [
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

  it('exports the canonical Industrial armor display name without formatting whitespace', () => {
    const entity = new TankEntity();
    entity.setUniformArmor(new MountedArmor({
      armor: new ArmorEquipment({
        id: 'Industrial Armor',
        name: 'Industrial Armor',
        type: 'armor',
        armor: { type: 'INDUSTRIAL' },
      }),
      techBase: 'IS',
    }));

    expect(builder.build(entity).armorType).toBe('Industrial');
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

  it('starts a combat vehicle rating with combat-vehicle construction technology', () => {
    const vehicle = new TankEntity();
    vehicle.year.set(2490);
    expect(vehicle.techRating()).toBe('D/C-C-C-B');
  });

  it('combines Battle Armor construction and default BA Standard armor technology', () => {
    const battleArmor = new BattleArmorEntity();
    battleArmor.year.set(3052);
    expect(battleArmor.techRating()).toBe('E/X-X-E-D');

    battleArmor.isExoskeleton.set(true);
    battleArmor.year.set(2200);
    expect(battleArmor.techRating()).toBe('E/F-F-E-D');
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
      expect(Object.getPrototypeOf(Object.getPrototypeOf(EntityClass.prototype)).constructor.name)
        .toBe(physicalBase);
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

});

function sourcebook(abbrev: string, canon = true): Sourcebook {
  return { id: 0, sku: '', abbrev, title: abbrev, canon };
}

function miscMount(id: string, flags: readonly EquipmentFlag[]): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: id,
    equipmentId: id,
    equipment: new MiscEquipment({ id, name: id, type: 'misc', flags: [...flags] }),
    allocation: { kind: 'location', location: 'Torso' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
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
