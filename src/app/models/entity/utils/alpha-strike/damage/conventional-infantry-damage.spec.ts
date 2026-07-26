import { WeaponEquipment } from '../../../../equipment.model';
import { TestInfantryEntity } from '../../../testing/test-entities';
import { addTestEquipment } from '../../../testing/test-mounted-equipment';
import { calculateConventionalInfantryDamage } from './conventional-infantry-damage';

describe('Conventional infantry damage', () => {
  it('uses field guns without applying a troop factor', () => {
    const entity = new TestInfantryEntity();
    const gun = new WeaponEquipment({
      id: 'field-gun', name: 'Field Gun', type: 'weapon',
      weapon: { damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA' },
    });
    addTestEquipment(entity, gun, { location: 'Field Guns' });
    addTestEquipment(entity, gun, { location: 'Field Guns' });

    expect(calculateConventionalInfantryDamage(entity)).toEqual(jasmine.objectContaining({
      standard: { dmgS: '2', dmgM: '2', dmgL: '2', dmgE: '0' },
      overheat: 0,
      heatSpecials: [],
    }));
  });

  it('returns zero damage for infantry without a ranged infantry weapon', () => {
    const result = calculateConventionalInfantryDamage(new TestInfantryEntity());
    expect(result.standard).toEqual({ dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' });
    expect(result.heatSpecials).toEqual([]);
  });
});