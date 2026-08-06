// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../equipment.model';
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
    expect(mount.placedCriticalSlotCount).toBe(3);
    expect(mount.isSplitAcrossLocations).toBeTrue();
    expect(mount.getNumCriticalSlots(entity)).toBe(8);
  });

  it('uses mounted ammo shots when present and definition shots otherwise', () => {
    const ammo = new AmmoEquipment({
      id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', shots: 20 },
    });

    expect(mounted(ammo).getAmmoShots()).toBe(20);
    expect(mounted(ammo, { shotsCount: 7 }).getAmmoShots()).toBe(7);
  });

  it('classifies physical weapons and resolves damage from its attached entity', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(55);
    const hatchet = mounted(new MiscEquipment({
      id: 'hatchet', name: 'Hatchet', type: 'misc', flags: ['F_CLUB', 'S_HATCHET'],
    }));
    entity.setEquipment([hatchet]);

    expect(hatchet.isPhysicalWeapon()).toBeTrue();
    expect(hatchet.getPhysicalWeaponDamage()).toEqual({ kind: 'fixed', value: 11 });

    entity.setTonnage(60);
    expect(hatchet.getPhysicalWeaponDamage()).toEqual({ kind: 'fixed', value: 12 });
  });

  it('returns no physical damage for nonphysical equipment', () => {
    const ammo = mounted(new AmmoEquipment({
      id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', shots: 20 },
    }));

    expect(ammo.isPhysicalWeapon()).toBeFalse();
    expect(ammo.getPhysicalWeaponDamage()).toBeUndefined();
  });

  it('requires entity context to resolve physical weapon damage', () => {
    const detachedHatchet = mounted(new MiscEquipment({
      id: 'hatchet', name: 'Hatchet', type: 'misc', flags: ['F_CLUB', 'S_HATCHET'],
    }));

    expect(() => detachedHatchet.getPhysicalWeaponDamage())
      .toThrowError('Physical weapon damage requires an attached entity');
  });

  it('does not partially attach mounts when setEquipment ownership validation fails', () => {
    const target = new BipedMekEntity();
    const other = new BipedMekEntity();
    const detached = mounted(new MiscEquipment({
      id: 'detached', name: 'Detached Hatchet', type: 'misc', flags: ['F_CLUB', 'S_HATCHET'],
    }), { mountId: 'detached' });
    const foreign = mounted(new MiscEquipment({
      id: 'foreign', name: 'Foreign Hatchet', type: 'misc', flags: ['F_CLUB', 'S_HATCHET'],
    }), { mountId: 'foreign' });
    other.setEquipment([foreign]);

    expect(() => target.setEquipment([detached, foreign]))
      .toThrowError('Equipment mount is already attached to another entity');
    expect(target.equipment()).toEqual([]);
    expect(() => detached.getPhysicalWeaponDamage())
      .toThrowError('Physical weapon damage requires an attached entity');
  });

  it('resolves variable critical slots from the mounted size', () => {
    const cargo = new MiscEquipment({
      id: 'cargo', name: 'Cargo', type: 'misc',
      stats: { criticalSlots: 'variable', tonnage: 'variable' }, flags: ['F_CARGO'],
    });
    const entity = new BipedMekEntity();

    expect(mounted(cargo, { size: 0.5 }).getNumCriticalSlots(entity)).toBe(1);
    expect(mounted(cargo, { size: 3 }).getNumCriticalSlots(entity)).toBe(3);
  });

  it('derives engine and unallocated locations from canonical allocation', () => {
    const equipment = new AmmoEquipment({
      id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', shots: 20 },
    });

    expect(mounted(equipment, { allocation: { kind: 'engine' } }).location).toBe('Engine');
    expect(mounted(equipment, { allocation: { kind: 'unallocated' } }).location).toBe('Unallocated');
  });

  it('adds a placement without mutating the original mount', () => {
    const equipment = new AmmoEquipment({
      id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', shots: 20 },
    });
    const original = mounted(equipment, { allocation: {
      kind: 'location',
      location: 'RT',
      placements: [{ location: 'RT', slotIndex: 3 }],
    } });

    const updated = original.withAddedPlacement({ location: 'RT', slotIndex: 4 });

    expect(original.placements).toEqual([{ location: 'RT', slotIndex: 3 }]);
    expect(updated.placements).toEqual([
      { location: 'RT', slotIndex: 3 },
      { location: 'RT', slotIndex: 4 },
    ]);
  });

  it('updates a split mount primary location and rejects non-location allocations', () => {
    const equipment = new AmmoEquipment({
      id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', shots: 20 },
    });
    const split = mounted(equipment, { allocation: {
      kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 4 }],
    } });

    const relocated = split.withAddedPlacement({ location: 'RT', slotIndex: 0 }, 'RT');
    expect(relocated.location).toBe('RT');
    expect(relocated.placements).toEqual([
      { location: 'RA', slotIndex: 4 }, { location: 'RT', slotIndex: 0 },
    ]);
    expect(() => mounted(equipment, { allocation: { kind: 'engine' } })
      .withAddedPlacement({ location: 'CT', slotIndex: 0 }))
      .toThrowError('Cannot add a critical placement to engine-allocated equipment');
  });
});

function mounted(
  equipment: WeaponEquipment | AmmoEquipment | MiscEquipment,
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