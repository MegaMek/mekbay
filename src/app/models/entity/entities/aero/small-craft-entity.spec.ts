import { createEquipment, Equipment, WeaponEquipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { SmallCraftEntity } from './small-craft-entity';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';

describe('SmallCraftEntity implicit equipment', () => {
  it('derives its automatic ECM from entity state', () => {
    const automaticEcm = createEquipment({
      id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
    });
    const weapon = createWeapon('Large Laser', ['F_ENERGY']);
    const entity = new SmallCraftEntity(createTestEquipmentRegistry({
      [automaticEcm.id]: automaticEcm,
      [weapon.id]: weapon,
    }));

    expect(entity.implicitSystemEquipment()).toEqual([]);

    entity.equipment.set([mount(weapon)]);
    expect(entity.implicitSystemEquipment()).toEqual([automaticEcm]);

    entity.equipment.set([]);
    expect(entity.implicitSystemEquipment()).toEqual([]);
  });

  it('does not derive automatic ECM when ECM is explicitly mounted', () => {
    const automaticEcm = createEquipment({
      id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
    });
    const weapon = createWeapon('Large Laser', ['F_ENERGY']);
    const entity = new SmallCraftEntity(createTestEquipmentRegistry({ [automaticEcm.id]: automaticEcm }));

    entity.equipment.set([mount(weapon), mount(automaticEcm, 'ecm')]);

    expect(entity.implicitSystemEquipment()).toEqual([]);
  });
});

function createWeapon(id: string, flags: string[] = []): WeaponEquipment {
  return createEquipment({
    id, name: id, type: 'weapon', flags,
    weapon: { damage: 10, ranges: [5, 10, 15, 20] },
  }) as WeaponEquipment;
}

function mount(equipment: Equipment, mountId = equipment.id): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId,
    equipmentId: equipment.id,
    equipment,
    allocation: { kind: 'location', location: 'Nose' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}