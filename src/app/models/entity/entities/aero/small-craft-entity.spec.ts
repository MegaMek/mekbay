import { createEquipment, WeaponEquipment } from '../../../equipment.model';
import { SmallCraftEntity } from './small-craft-entity';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { addTestEquipment } from '../../testing/test-mounted-equipment';

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

    addTestEquipment(entity, weapon, { location: 'Nose' });
    expect(entity.implicitSystemEquipment()).toEqual([automaticEcm]);

    entity.setEquipment([]);
    expect(entity.implicitSystemEquipment()).toEqual([]);
  });

  it('does not derive automatic ECM when ECM is explicitly mounted', () => {
    const automaticEcm = createEquipment({
      id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
    });
    const weapon = createWeapon('Large Laser', ['F_ENERGY']);
    const entity = new SmallCraftEntity(createTestEquipmentRegistry({ [automaticEcm.id]: automaticEcm }));

    addTestEquipment(entity, weapon, { location: 'Nose' });
    addTestEquipment(entity, automaticEcm, { location: 'Nose' });

    expect(entity.implicitSystemEquipment()).toEqual([]);
  });
});

function createWeapon(id: string, flags: string[] = []): WeaponEquipment {
  return createEquipment({
    id, name: id, type: 'weapon', flags,
    weapon: { damage: 10, ranges: [5, 10, 15, 20] },
  }) as WeaponEquipment;
}