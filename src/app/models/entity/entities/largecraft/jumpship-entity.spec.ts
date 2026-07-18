import { createEquipment, WeaponEquipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { JumpShipEntity } from './jumpship-entity';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';

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

    entity.equipment.set([bayMount(laser, 'first'), bayMount(laser, 'second')]);

    expect(entity.implicitSystemEquipment()).toEqual([laserBay]);
  });
});

function bayMount(equipment: WeaponEquipment, mountId: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId,
    equipmentId: equipment.id,
    equipment,
    allocation: { kind: 'location', location: 'Nose' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
    isNewBay: true,
  });
}