import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestInfantryEntity as InfantryEntity,
  TestTankEntity as TankEntity,
} from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { EntityMountedEquipment } from '../models/entity/types/equipment';
import { buildUnitComponentMetadata } from './unit-component-metadata-builder';

describe('buildUnitComponentMetadata', () => {
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

  it('exports intrinsic ammo damage for a special one-shot weapon', () => {
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
      .toEqual(jasmine.objectContaining({ d: '4', md: '4.0', os: 1 }));
  });

  it('exports no numeric damage for a zero-damage weapon', () => {
    const entity = new TankEntity();
    const launcher = weapon('grenade-launcher', {
      damage: 0, ranges: [1, 1, 1, 1], flags: ['F_BALLISTIC', 'F_ONE_SHOT'],
    });
    entity.setEquipment([mount(launcher, 'Front')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === launcher.id))
      .toEqual(jasmine.objectContaining({ d: '', md: '0.0', os: 1 }));
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

  it('groups spreadable Mek equipment by placement count and keeps the primary split location first', () => {
    const entity = new BipedMekEntity();
    const endo = new MiscEquipment({
      id: 'endo', name: 'Endo Steel', type: 'misc',
      stats: { criticalSlots: 'variable', spreadable: true }, flags: ['F_STRUCTURE'],
    });
    const laser = weapon('split-laser', {
      damage: 5, ranges: [3, 6, 9, 12], flags: ['F_ENERGY'],
    });
    entity.setEquipment([
      mount(endo, 'LA', { placements: [
        { location: 'LA', slotIndex: 0 }, { location: 'LA', slotIndex: 1 },
        { location: 'LT', slotIndex: 0 },
      ] }),
      mount(laser, 'LA', { placements: [
        { location: 'LT', slotIndex: 1 }, { location: 'LA', slotIndex: 2 },
      ] }),
    ]);

    const components = buildUnitComponentMetadata(entity)!;
    expect(components.find(component => component.id === 'endo' && component.l === 'LA'))
      .toEqual(jasmine.objectContaining({ q: 2, p: 5, c: 'V', t: 'S' }));
    expect(components.find(component => component.id === 'endo' && component.l === 'LT'))
      .toEqual(jasmine.objectContaining({ q: 1, p: 3, c: 'V', t: 'S' }));
    expect(components.find(component => component.id === 'split-laser')?.l).toBe('LA/LT');
  });
});

function weapon(
  id: string,
  options: {
    damage: number | string;
    ranges: number[];
    flags: string[];
    ammoType?: 'MINE';
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
  equipment: WeaponEquipment | AmmoEquipment | MiscEquipment,
  location: string,
  options: { shotsCount?: number; placements?: readonly { location: string; slotIndex: number }[] } = {},
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
  });
}
