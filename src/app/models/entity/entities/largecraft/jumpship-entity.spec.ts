// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { createEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import { JumpShipEntity } from './jumpship-entity';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { addTestEquipment } from '../../testing/test-mounted-equipment';

describe('JumpShipEntity implicit equipment', () => {
  it('derives and deduplicates weapon-bay systems from bay-leading weapons', () => {
    const laserBay = createEquipment({ id: 'Laser Bay', name: 'Laser Bay', type: 'misc' });
    const laser = createEquipment({
      id: 'Large Laser', name: 'Large Laser', type: 'weapon', flags: ['F_ENERGY'],
      weapon: { damage: 8, ranges: [5, 10, 15, 20], atClass: 'LASER' },
    }) as WeaponEquipment;
    const entity = new JumpShipEntity(createTestEquipmentRegistry({
      [laserBay.id]: laserBay,
      [laser.id]: laser,
    }));

    const firstBay = addTestEquipment(entity, laser, { location: 'Nose' });
    const secondBay = addTestEquipment(entity, laser, { location: 'Nose' });
    entity.addEquipmentBay('weapon-bay', { mounts: [firstBay] });
    entity.addEquipmentBay('weapon-bay', { mounts: [secondBay] });

    expect(entity.implicitSystemEquipment()).toEqual([laserBay]);
  });

  it('exports printable misc equipment as deduplicated feature labels', () => {
    const hpg = new MiscEquipment({
      id: 'mobile-hpg', name: 'Mobile HPG', type: 'misc', flags: ['F_MOBILE_HPG'],
    });
    const atac = new MiscEquipment({
      id: 'atac', name: 'ATAC', type: 'misc', flags: ['F_ATAC', 'F_VARIABLE_SIZE'],
    });
    const entity = new JumpShipEntity(createTestEquipmentRegistry({}));
    addTestEquipment(entity, hpg, { location: 'Hull' });
    addTestEquipment(entity, hpg, { location: 'Hull' });
    addTestEquipment(entity, atac, { location: 'Hull', size: 50 });

    expect(entity.entityFeatures()).toEqual(['Mobile HPG', 'ATAC (50 drones)']);
  });
});
