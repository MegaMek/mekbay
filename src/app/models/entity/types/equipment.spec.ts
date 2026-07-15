import { AmmoEquipment, WeaponEquipment } from '../../equipment.model';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
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
      location: 'RT',
      placements: [
        { location: 'RT', slotIndex: 0 },
        { location: 'RA', slotIndex: 0 },
        { location: 'RT', slotIndex: 1 },
      ],
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
});

function mounted(
  equipment: WeaponEquipment | AmmoEquipment,
  overrides: Partial<ConstructorParameters<typeof EntityMountedEquipment>[0]> = {},
): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: `${equipment.id}-mount`,
    equipmentId: equipment.id,
    equipment,
    location: 'CT',
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
    ...overrides,
  });
}