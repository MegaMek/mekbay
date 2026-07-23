import { createEquipment } from '../../../equipment.model';
import { TestHandheldWeaponEntity } from '../../testing/test-entities';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import { calculateHandheldWeaponWeightBreakdown } from './handheld-weapon-weight';

describe('handheld weapon construction mass', () => {
  it('adds one ton of sinks per heat-neutral requirement', () => {
    const entity = new TestHandheldWeaponEntity();
    addTestEquipment(entity, createEquipment({
      id: 'Laser', name: 'Laser', type: 'weapon', flags: ['F_LASER'],
      stats: { tonnage: 2 }, weapon: { heat: 3, ammoType: 'NA' },
    }), { location: 'Gun' });
    const result = calculateHandheldWeaponWeightBreakdown(entity);
    expect(result.heatSinks).toBe(3);
    expect(result.rounded).toBe(5);
  });

  it('adds ballistic weapon and ammo mass without heat sinks', () => {
    const entity = new TestHandheldWeaponEntity();
    addTestEquipment(entity, createEquipment({
      id: 'Gun', name: 'Gun', type: 'weapon', stats: { tonnage: 1 },
      weapon: { heat: 0, ammoType: 'AC' },
    }), { location: 'Gun' });
    const result = calculateHandheldWeaponWeightBreakdown(entity);
    expect(result.heatSinks).toBe(0);
    expect(result.rounded).toBe(1);
  });
});