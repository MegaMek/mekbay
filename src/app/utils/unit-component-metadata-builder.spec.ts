import { AmmoEquipment, ArmorEquipment, type AmmoType, Equipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedArmor, MountedStructure } from '../models/entity/components';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestInfantryEntity as InfantryEntity,
  TestTankEntity as TankEntity,
} from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { EntityMountedEquipment } from '../models/entity/types/equipment';
import { buildUnitComponentMetadata } from './unit-component-metadata-builder';
import { EquipmentFlag } from '../models/equipment-flags.type';

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

  it('exports physically flagged weapon equipment as physical rather than ranged', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(55);
    const hatchet = weapon('hatchet', {
      damage: 99, ranges: [3, 6, 9, 12], flags: ['F_CLUB', 'S_HATCHET'],
    });
    entity.setEquipment([mount(hatchet, 'RA')]);

    const component = buildUnitComponentMetadata(entity)!.find(entry => entry.id === hatchet.id)!;
    expect(component).toEqual(jasmine.objectContaining({ t: 'P', l: 'RA', d: '11', md: '11' }));
    expect(component.r).toBeUndefined();
    expect(component.m).toBeUndefined();
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

  it('exports patchwork armor plus each distinct effective armor material without armor mounts', () => {
    const entity = new BipedMekEntity();
    const standard = new ArmorEquipment({
      id: 'Standard Armor', name: 'Standard', type: 'armor', armor: { type: 'STANDARD' },
    });
    const reactive = new ArmorEquipment({
      id: 'IS Reactive', name: 'Reactive', type: 'armor', armor: { type: 'REACTIVE' },
    });
    entity.setUniformArmor(new MountedArmor({ armor: standard, techBase: 'IS' }));
    entity.setArmorEquipmentAt('LA', reactive);
    entity.setEquipment([mount(reactive, 'LA', { placements: [{ location: 'LA', slotIndex: 0 }] })]);

    const components = buildUnitComponentMetadata(entity)!;
    expect(components.filter(component => component.id === 'Patchwork Armor')).toHaveSize(1);
    expect(components.filter(component => component.id === 'Standard Armor')).toHaveSize(1);
    expect(components.filter(component => component.id === 'IS Reactive')).toHaveSize(1);
    expect(components.find(component => component.id === 'Patchwork Armor')?.n).toBe('Patchwork Armor');
    expect(components.find(component => component.id === 'Standard Armor')?.n).toBe('Standard Armor');
    expect(components.find(component => component.id === 'IS Reactive')?.n).toBe('Reactive Armor');
    expect(components.filter(component => [
      'Patchwork Armor', 'Standard Armor', 'IS Reactive',
    ].includes(component.id)).every(component => component.p === -1)).toBeTrue();
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

  it('exports numeric zero damage for a zero-damage weapon', () => {
    const entity = new TankEntity();
    const launcher = weapon('grenade-launcher', {
      damage: 0, ranges: [1, 1, 1, 1], flags: ['F_BALLISTIC', 'F_ONE_SHOT'],
    });
    entity.setEquipment([mount(launcher, 'Front')]);

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === launcher.id))
      .toEqual(jasmine.objectContaining({ d: '0', md: '0.0', os: 1 }));
  });

  it('exports sentinel damage numerically without semantic labels', () => {
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
    const special = weapon('special-weapon', {
      damage: 'special', rackSize: 5, ranges: [1, 2, 3, 4], flags: ['F_ENERGY'],
    });
    entity.setEquipment([
      mount(plasmaCannon, 'Front'),
      mount(microBomb, 'Front'),
      mount(tubeArtillery, 'Front'),
      mount(special, 'Front'),
    ]);

    const components = buildUnitComponentMetadata(entity)!;
    expect(components.find(component => component.id === plasmaCannon.id))
      .toEqual(jasmine.objectContaining({ d: '0', md: '0.0' }));
    expect(components.find(component => component.id === microBomb.id))
      .toEqual(jasmine.objectContaining({ d: '2', md: '2.0' }));
    expect(components.find(component => component.id === tubeArtillery.id))
      .toEqual(jasmine.objectContaining({ d: '3', md: '3.0' }));
    expect(components.find(component => component.id === special.id))
      .toEqual(jasmine.objectContaining({ d: '5', md: '5.0' }));
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

  it('omits structure critical slots and keeps other split equipment locations', () => {
    const entity = new BipedMekEntity();
    const endo = new StructureEquipment({
      id: 'endo', name: 'Endo Steel', type: 'structure',
      stats: { criticalSlots: 'variable', spreadable: true }, flags: ['F_ENDO_STEEL'],
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
    expect(components.some(component => component.id === 'endo')).toBeFalse();
    expect(components.find(component => component.id === 'split-laser')?.l).toBe('LA/LT');
  });

  it('labels synthetic structure materials without duplicating an existing suffix', () => {
    const entity = new BipedMekEntity();
    const standard = new StructureEquipment({
      id: 'Standard', name: 'Standard', type: 'structure', structure: { typeId: 0 },
    });
    entity.setUniformStructure(new MountedStructure({ structure: standard, tonnage: entity.tonnage() }));

    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === 'Standard')?.n)
      .toBe('Standard Structure');

    const labeled = new StructureEquipment({
      id: 'Endo Steel', name: 'Endo Steel Structure', type: 'structure', structure: { typeId: 1 },
    });
    entity.setUniformStructure(new MountedStructure({ structure: labeled, tonnage: entity.tonnage() }));
    expect(buildUnitComponentMetadata(entity)!.find(component => component.id === 'Endo Steel')?.n)
      .toBe('Endo Steel Structure');
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
