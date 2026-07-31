import { createEquipment, WeaponEquipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { JumpShipEntity } from './jumpship-entity';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { addTestEquipment } from '../../testing/test-mounted-equipment';

describe('JumpShipEntity implicit equipment', () => {
  it('derives and deduplicates weapon-bay systems from bay-leading weapons', () => {
    const laserBay = createEquipment({ id: 'Laser Bay', name: 'Laser Bay', type: 'misc' });
    const laser = createEquipment({
      id: 'Large Laser', name: 'Large Laser', type: 'weapon', flags: ['F_ENERGY'],
      weapon: { damage: 8, ranges: [5, 10, 15, 20] },
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
});