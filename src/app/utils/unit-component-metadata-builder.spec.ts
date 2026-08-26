// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, ArmorEquipment, type AmmoType, Equipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedArmor, MountedStructure } from '../models/entity/components';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestInfantryEntity as InfantryEntity,
  TestTankEntity as TankEntity,
} from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { EntityMountedEquipment } from '../models/entity/types/equipment';
import { buildUnitComponentMetadata } from './unit-component-metadata-builder';
import { EquipmentFlag } from '../models/equipment-flags.type';

describe('buildUnitComponentMetadata', () => {
  it('exports Mek systems from the canonical entity', () => {
    const components = buildUnitComponentMetadata(new BipedMekEntity())!;
    expect(components.find(component => component.id === 'cockpit')).toBeDefined();
    expect(components.find(component => component.id === 'gyro')).toBeDefined();
  });

  it('exports ordinary non-Mek weapons and aggregates ammunition by location', () => {
    const entity = new TankEntity();
    const laser = weapon('laser', { damage: 5, ranges: [3, 6, 9, 12], flags: ['F_ENERGY'] });
    const ammo = new AmmoEquipment({
      id: 'ammo', name: 'AC/5 Ammo', type: 'ammo', ammo: { shots: 20 },
    });
    entity.setEquipment([
      mount(laser, 'Front'),
      mount(ammo, 'Body', { shotsCount: 10 }),
      mount(ammo, 'Body', { shotsCount: 15 }),
    ]);

    const components = buildUnitComponentMetadata(entity)!;
    expect(components.find(component => component.id === 'laser')).toEqual(jasmine.objectContaining({
      t: 'E', p: 1, l: 'FR', r: '3/6/9', m: '0', d: '5', md: '5.0', q: 1,
    }));
    expect(components.find(component => component.id === 'ammo')).toEqual(jasmine.objectContaining({
      t: 'X', p: 0, l: 'BD', q: 2, q2: 25,
    }));
  });

  it('uses the chassis tech base for a uniform structure and Standard for a hybrid', () => {
    const endo = new StructureEquipment({
      id: 'Clan Endo Steel', name: 'Endo Steel', type: 'structure',
      stats: { criticalSlots: 'variable' }, tech: { base: 'Clan' }, structure: { typeId: 1 },
    });
    const entity = new BipedMekEntity();
    entity.techBase.set('IS');
    entity.setUniformStructure(new MountedStructure({ tonnage: 50, structure: endo }));

    expect(buildUnitComponentMetadata(entity)!.find(component => component.t === 'S' && component.p === -1))
      .toEqual(jasmine.objectContaining({ id: 'IS Endo Steel', n: 'Endo Steel Structure', c: 'V' }));

    const standard = new StructureEquipment({
      id: 'Standard', name: 'Standard', type: 'structure', structure: { typeId: 0 },
    });
    entity.setStructureAt('LA', new MountedStructure({ tonnage: 50, structure: standard }));
    expect(buildUnitComponentMetadata(entity)!.find(component => component.t === 'S' && component.p === -1))
      .toEqual(jasmine.objectContaining({ id: 'Standard', n: 'Standard Structure', c: '0' }));
  });

  it('exports raw fixed criticals for a superheavy Mek', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(135);
    const gauss = new WeaponEquipment({
      id: 'gauss', name: 'Gauss Rifle', type: 'weapon', stats: { criticalSlots: 7 },
      flags: ['F_BALLISTIC'], weapon: { damage: 15, ranges: [7, 15, 22, 30] },
    });
    entity.setEquipment([mount(gauss, 'LA')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === gauss.id)?.c).toBe('7');
  });

  it('uses aerospace AV and bracket names', () => {
    const entity = new AeroSpaceFighterEntity();
    const laser = weapon('aero-laser', {
      damage: 8, ranges: [5, 10, 15, 20], av: [8, 6, 0, 0], maxRangeBracket: 'medium',
      flags: ['F_ENERGY'],
    });
    entity.setEquipment([mount(laser, 'Nose')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === laser.id))
      .toEqual(jasmine.objectContaining({ l: 'NOS', p: 0, r: 'Medium', m: '-', d: '8/6', md: '8.0' }));
  });


  it('preserves the Special damage label for a special one-shot weapon', () => {
    const ammo = new AmmoEquipment({
      id: 'mine-ammo', name: 'Pop-up Mine Ammo', type: 'ammo',
      ammo: { type: 'MINE', rackSize: 1, damagePerShot: 4, munitionType: ['M_STANDARD'] },
    });
    const entity = new TankEntity(createTestEquipmentRegistry({ [ammo.id]: ammo }));
    const launcher = weapon('mine-launcher', {
      damage: 'special', ranges: [1, 0, 0, 0], flags: ['F_ONE_SHOT'], ammoType: 'MINE', rackSize: 1,
    });
    entity.setEquipment([mount(launcher, 'Front')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === launcher.id))
      .toEqual(jasmine.objectContaining({ d: 'Special', md: '0.0', os: 1 }));
  });

  it('keeps numeric damage for the double-one-shot IATM Fusillade', () => {
    const entity = new TankEntity();
    const fusillade = weapon('Fusillade', {
      damage: 6, ranges: [5, 10, 15, 20], rackSize: 3, ammoType: 'IATM',
      flags: ['F_MISSILE', 'F_ONE_SHOT', 'F_DOUBLE_ONE_SHOT'],
    });
    entity.setEquipment([mount(fusillade, 'Front')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === fusillade.id))
      .toEqual(jasmine.objectContaining({ d: '6', md: '6.0', os: 2 }));
  });

  it('exports Narc damage per missile instead of its ammunition explosion damage', () => {
    const ammo = new AmmoEquipment({
      id: 'BA-Compact Narc Ammo', name: 'Compact Narc Ammo', type: 'ammo',
      flags: ['F_BATTLEARMOR'],
      ammo: { type: 'NARC', rackSize: 4, damagePerShot: 2, munitionType: ['M_STANDARD'] },
    });
    const entity = new BattleArmorEntity(createTestEquipmentRegistry({ [ammo.id]: ammo }));
    const narc = weapon('CLBACompactNarc', {
      damage: 'cluster', ranges: [2, 4, 5, 7], rackSize: 4, ammoType: 'NARC',
      flags: ['F_MISSILE', 'F_BA_WEAPON', 'F_NARC'],
    });
    entity.setEquipment([mount(narc, 'Squad', { baMountLocation: 'Body' })]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === narc.id))
      .toEqual(jasmine.objectContaining({ d: '1/Msl', md: '4.0' }));
  });

  it('exports the maximum MML, ATM, and machine-gun-array damage', () => {
    const mmlAmmo = new AmmoEquipment({
      id: 'MML LRM Ammo', name: 'MML LRM Ammo', type: 'ammo',
      flags: ['F_MML_LRM'],
      ammo: { type: 'MML', rackSize: 7, damagePerShot: 1, munitionType: ['M_STANDARD'] },
    });
    const atmAmmo = new AmmoEquipment({
      id: 'ATM HE Ammo', name: 'ATM HE Ammo', type: 'ammo',
      ammo: { type: 'ATM', rackSize: 6, damagePerShot: 3, munitionType: ['M_HIGH_EXPLOSIVE'] },
    });
    const entity = new TankEntity(createTestEquipmentRegistry({
      [mmlAmmo.id]: mmlAmmo,
      [atmAmmo.id]: atmAmmo,
    }));
    const mml = weapon('MML7', {
      damage: 'cluster', ranges: [3, 6, 9, 12], rackSize: 7, ammoType: 'MML',
      flags: ['F_MISSILE', 'F_MML'],
    });
    const atm = weapon('ATM6', {
      damage: 'cluster', ranges: [5, 10, 15, 20], rackSize: 6, ammoType: 'ATM',
      flags: ['F_MISSILE', 'F_ATM'],
    });
    const array = weapon('MGA', {
      damage: 2, ranges: [1, 2, 3, 4], flags: ['F_BALLISTIC', 'F_MGA'],
    });
    entity.setEquipment([
      mount(mml, 'Front'),
      mount(atm, 'Front'),
      mount(array, 'Front'),
      mount(atmAmmo, 'Body'),
    ]);

    const components = buildUnitComponentMetadata(entity)!;
    expect(components.find(component => component.id === mml.id)?.md).toBe('14.0');
    expect(components.find(component => component.id === atm.id)?.md).toBe('18.0');
    expect(components.find(component => component.id === array.id)?.md).toBe('0.0');
  });

  it('exports generated Clan CASE once per explosive Mek location', () => {
    const clanCase = new MiscEquipment({
      id: 'CLCASE', name: 'CASE', type: 'misc', tech: { base: 'Clan' }, flags: ['F_CASE'],
    });
    const explosive = new MiscEquipment({
      id: 'volatile', name: 'Volatile Equipment', type: 'misc', stats: { explosive: true },
    });
    const entity = new BipedMekEntity(createTestEquipmentRegistry({
      [clanCase.id]: clanCase,
      [explosive.id]: explosive,
    }));
    entity.techBase.set('Clan');
    entity.setEquipment([
      mount(explosive, 'LT'),
      mount(explosive, 'RT'),
    ]);

    expect(buildUnitComponentMetadata(entity)!.filter(component => component.id === 'CLCASE'))
      .toEqual(jasmine.arrayWithExactContents([
        jasmine.objectContaining({ id: 'CLCASE', n: 'CASE', t: 'C', l: 'LT', c: '0', q: 1 }),
        jasmine.objectContaining({ id: 'CLCASE', n: 'CASE', t: 'C', l: 'RT', c: '0', q: 1 }),
      ]) as never);
  });

  it('exports numeric zero damage for a zero-damage weapon', () => {
    const entity = new TankEntity();
    const launcher = weapon('grenade-launcher', {
      damage: 0, ranges: [1, 1, 1, 1], flags: ['F_BALLISTIC', 'F_ONE_SHOT'],
    });
    entity.setEquipment([mount(launcher, 'Front')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === launcher.id))
      .toEqual(jasmine.objectContaining({ d: '0', md: '0.0', os: 1 }));
  });

  it('exports variable and cluster sentinel damage numerically', () => {
    const entity = new TankEntity();
    const plasmaCannon = weapon('CLPlasmaCannon', {
      damage: 'variable', rackSize: 2, ammoType: 'PLASMA', ranges: [6, 12, 18, 24],
      flags: ['F_DIRECT_FIRE', 'F_ENERGY', 'F_PLASMA'],
    });
    const microBomb = weapon('CLBAMicroBomb', {
      damage: 'variable', rackSize: 2, ammoType: 'BA_MICRO_BOMB',
      ranges: [0, 0, 0, 0], flags: ['F_ONE_SHOT', 'F_BA_WEAPON'],
    });
    const tubeArtillery = weapon('ISBATubeArtillery', {
      damage: 'cluster', rackSize: 3, ammoType: 'BA_TUBE',
      ranges: [2, 2, 2, 2], flags: ['F_MISSILE', 'F_ARTILLERY', 'F_MEK_MORTAR', 'F_BA_WEAPON'],
    });
    entity.setEquipment([
      mount(plasmaCannon, 'Front'),
      mount(microBomb, 'Front'),
      mount(tubeArtillery, 'Front'),
    ]);

    const components = buildUnitComponentMetadata(entity)!;
    expect(components.find(component => component.id === plasmaCannon.id))
      .toEqual(jasmine.objectContaining({ d: '0', md: '0.0' }));
    expect(components.find(component => component.id === microBomb.id))
      .toEqual(jasmine.objectContaining({ d: '0', md: '0.0' }));
    expect(components.find(component => component.id === tubeArtillery.id))
      .toEqual(jasmine.objectContaining({ d: 'Cluster', md: '3.0' }));
  });

  it('exports large-missile damage from its matching ammunition', () => {
    const ammo = new AmmoEquipment({
      id: 'thunderbolt-ammo', name: 'Thunderbolt 5 Ammo', type: 'ammo',
      ammo: { type: 'TBOLT_5', rackSize: 1, damagePerShot: 5, munitionType: ['M_STANDARD'] },
    });
    const entity = new TankEntity(createTestEquipmentRegistry({ [ammo.id]: ammo }));
    const thunderbolt = weapon('thunderbolt-5', {
      damage: 'cluster', ranges: [6, 12, 18, 24], flags: ['F_MISSILE', 'F_LARGE_MISSILE'],
      ammoType: 'TBOLT_5', rackSize: 1,
    });
    entity.setEquipment([mount(thunderbolt, 'Front')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === thunderbolt.id))
      .toEqual(jasmine.objectContaining({ d: '5', md: '5.0' }));
  });

  it('doubles Backhoe damage when industrial TSM is installed', () => {
    const entity = new BipedMekEntity();
    const backhoe = new MiscEquipment({
      id: 'Backhoe', name: 'Backhoe', type: 'misc', stats: { criticalSlots: 6 },
      flags: ['F_CLUB', 'S_BACKHOE'],
    });
    const industrialTsm = new MiscEquipment({
      id: 'Industrial TSM', name: 'Industrial TSM', type: 'misc', flags: ['F_INDUSTRIAL_TSM'],
    });
    entity.setEquipment([mount(backhoe, 'RA'), mount(industrialTsm, 'None')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === backhoe.id))
      .toEqual(jasmine.objectContaining({ d: '12', md: '12' }));
  });

  it('exports conventional infantry synthetic weapons with the Java primary damage cap', () => {
    const entity = new InfantryEntity();
    const primary = weapon('rifle', {
      damage: 0, ranges: [0, 0, 0, 0], flags: ['F_INFANTRY', 'F_BALLISTIC'],
      infantry: { damage: 0.75, range: 1 },
    });
    const secondary = weapon('support', {
      damage: 0, ranges: [0, 0, 0, 0], flags: ['F_INFANTRY', 'F_BALLISTIC'],
      infantry: { damage: 1.2, range: 2 },
    });
    entity.squadSize.set(5);
    entity.squadCount.set(4);
    entity.secondaryCount.set(1);
    entity.primaryWeapon.set(primary as never);
    entity.secondaryWeapon.set(secondary as never);

    const components = buildUnitComponentMetadata(entity)!;
    expect(components.find(component => component.id === 'rifle')).toEqual(jasmine.objectContaining({
      q: 16, l: 'Troop', d: '0.6', md: '0.6', r: '1',
    }));
    expect(components.find(component => component.id === 'support')).toEqual(jasmine.objectContaining({
      q: 4, l: 'Troop', d: '1.2', md: '1.2', r: '2',
    }));
  });


});

function weapon(
  id: string,
  options: {
    damage: number | string;
    ranges: number[];
    flags: EquipmentFlag[];
    ammoType?: AmmoType;
    rackSize?: number;
    av?: number[];
    maxRangeBracket?: 'short' | 'medium' | 'long' | 'extreme';
    infantry?: { damage: number; range: number };
  },
): WeaponEquipment {
  return new WeaponEquipment({
    id, name: id, type: 'weapon', flags: options.flags,
    weapon: {
      damage: options.damage, ranges: options.ranges, av: options.av,
      ammoType: options.ammoType, rackSize: options.rackSize,
      maxRangeBracket: options.maxRangeBracket ?? 'long',
    },
    infantry: options.infantry,
  });
}

function mount(
  equipment: Equipment,
  location: string,
  options: {
    shotsCount?: number;
    placements?: readonly { location: string; slotIndex: number }[];
    baMountLocation?: 'Body' | 'LA' | 'RA' | 'Turret';
  } = {},
): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: `${equipment.id}-${location}-${Math.random()}`,
    equipmentId: equipment.id,
    equipment,
    allocation: { kind: 'location', location, placements: options.placements },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
    shotsCount: options.shotsCount,
    baMountLocation: options.baMountLocation,
  });
}
