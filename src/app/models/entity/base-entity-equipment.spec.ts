// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed } from '@angular/core';
import { TestTankEntity } from './testing/test-entities';
import { EntityMountedEquipment, type EntityMountedEquipmentInput } from './types';

describe('BaseEntity batch equipment installation', () => {
  const input: EntityMountedEquipmentInput = {
    equipmentId: 'test-equipment', allocation: { kind: 'location', location: 'Front' },
    rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
  };

  it('keeps old snapshots and relationships while invalidating derived inventory', () => {
    const entity = new TestTankEntity();
    const first = entity.addEquipment(input);
    entity.addEquipmentBay('weapon-bay', { mounts: [first] });
    const original = entity.equipment();
    const inventorySize = computed(() => entity.getEquipmentAtLocation('Front').length);
    expect(inventorySize()).toBe(1);

    const added = entity.addEquipmentBatch([input, input]);

    expect(original).toEqual([first]);
    expect(added.map(mount => String(mount.mountId))).toEqual(['m2', 'm3']);
    expect(entity.equipment()).toEqual([first, ...added]);
    expect(inventorySize()).toBe(3);
    expect(entity.equipmentBays()[0].mounts).toEqual([first]);
    expect(() => new TestTankEntity().setEquipment(added)).toThrowError(/another entity/);
  });

  it('allocates unique identities across imported IDs, batches, removals and single additions', () => {
    const entity = new TestTankEntity();
    const imported = ['m1', 'm3', 'custom'].map(mountId => new EntityMountedEquipment({ ...input, mountId }));
    entity.setEquipment(imported);

    const added = entity.addEquipmentBatch([input, input]);
    entity.removeEquipment(added[0]);
    const last = entity.addEquipment(input);

    expect(added.map(mount => String(mount.mountId))).toEqual(['m2', 'm4']);
    expect(last.mountId).toBe('m5');
    expect(entity.equipment().map(mount => String(mount.mountId))).toEqual(['m1', 'm3', 'custom', 'm4', 'm5']);
  });

  it('leaves the installed inventory unchanged for an empty batch', () => {
    const entity = new TestTankEntity();
    const original = entity.equipment();

    expect(entity.addEquipmentBatch([])).toEqual([]);
    expect(entity.equipment()).toBe(original);
  });
});
