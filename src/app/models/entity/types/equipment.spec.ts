import { AmmoEquipment, WeaponEquipment } from '../../equipment.model';
import { TestBipedMekEntity as BipedMekEntity } from '../testing/test-entities';
import { EntityMountedEquipment } from './equipment';

describe('EntityMountedEquipment characteristics', () => {
  it('derives occupied locations and size-dependent critical slots from mount context', () => {
    const entity = new BipedMekEntity();
    const equipment = new WeaponEquipment({
      id: 'split-weapon', name: 'Split Weapon', type: 'weapon',
      stats: { criticalSlots: 8 },
      flags: ['F_BALLISTIC'],
      weapon: { ammoType: 'AC', damage: 10, ranges: [5, 10, 15, 20], minRange: 3 },
    });
    const mount = mounted(equipment, {
      allocation: {
        kind: 'location',
        location: 'RT',
        placements: [
          { location: 'RT', slotIndex: 0 },
          { location: 'RA', slotIndex: 0 },
          { location: 'RT', slotIndex: 1 },
        ],
      },
    });

    expect(mount.getOccupiedLocations()).toEqual(['RT', 'RA']);
    expect(mount.getCriticalSlotRequirement(entity)).toBe(8);
    expect(mount.getWeaponCharacteristics(entity)).toEqual({
      name: 'Split Weapon',
      heat: 0,
      category: 'ballistic',
      ranges: [5, 10, 15, 20],
      minimumRange: 3,
      damage: { kind: 'fixed', damage: 10, maximum: 10, perShot: false },
      hitModifiers: [0],
      criticalSlots: 8,
      oneShotCount: undefined,
    });
  });

  it('uses mounted ammo shots when present and definition shots otherwise', () => {
    const ammo = new AmmoEquipment({
      id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', shots: 20 },
    });

    expect(mounted(ammo).getAmmoShots()).toBe(20);
    expect(mounted(ammo, { shotsCount: 7 }).getAmmoShots()).toBe(7);
  });

  it('derives engine and unallocated locations from canonical allocation', () => {
    const equipment = new AmmoEquipment({
      id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', shots: 20 },
    });

    expect(mounted(equipment, { allocation: { kind: 'engine' } }).location).toBe('Engine');
    expect(mounted(equipment, { allocation: { kind: 'unallocated' } }).location).toBe('Unallocated');
  });

  it('replaces allocation without mutating the original mount', () => {
    const equipment = new AmmoEquipment({
      id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', shots: 20 },
    });
    const integrated = mounted(equipment, { allocation: { kind: 'engine' } });

    const allocated = integrated.withAllocation({
      kind: 'location',
      location: 'RT',
      placements: [{ location: 'RT', slotIndex: 4 }],
    });

    expect(integrated.allocation).toEqual({ kind: 'engine' });
    expect(allocated.allocation).toEqual({
      kind: 'location',
      location: 'RT',
      placements: [{ location: 'RT', slotIndex: 4 }],
    });
  });
});

function mounted(
  equipment: WeaponEquipment | AmmoEquipment,
  overrides: Partial<ConstructorParameters<typeof EntityMountedEquipment>[0]> = {},
): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: `${equipment.id}-mount`,
    equipmentId: equipment.id,
    equipment,
    allocation: { kind: 'location', location: 'CT' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
    ...overrides,
  });
}