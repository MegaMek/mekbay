import { createEquipment, type WeaponEquipment } from '../../equipment.model';
import { addTestEquipment, addTestEquipmentWithFlags } from '../testing/test-mounted-equipment';
import { TestSmallCraftEntity } from '../testing/test-entities';
import {
  calculateBayPersonnel,
  calculateRequiredGunners,
  normalizeLoadedSmallCraft,
} from './normalize-loaded-small-craft';

describe('normalizeLoadedSmallCraft', () => {
  it('raises minimum crew and synthesizes officer and crew quarters', () => {
    const entity = new TestSmallCraftEntity();
    entity.crew.set(1);
    entity.transporters.set([bay('cargo', 0.48)]);

    normalizeLoadedSmallCraft(entity);

    expect(entity.crew()).toBe(3);
    expect(entity.officers()).toBe(1);
    expect(entity.transporters().filter(item => item.kind === 'bay').map(item =>
      item.kind === 'bay' ? [item.configuration.type, item.capacity] : [])).toEqual([
      ['cargo', 0.48],
      ['first-class-quarters', 1],
      ['second-class-quarters', 0],
      ['crew-quarters', 2],
    ]);
    expect(entity.costDetails().steps.find(step => step.type === 'Life Support')?.amount).toBe(15000);
    expect(entity.costDetails().steps.find(step => step.type === 'Quarters')?.amount).toBe(60000);
  });

  it('preserves excess crew and creates passenger quarters', () => {
    const entity = new TestSmallCraftEntity();
    entity.crew.set(8);
    entity.passengers.set(3);

    normalizeLoadedSmallCraft(entity);

    expect(entity.crew()).toBe(8);
    expect(entity.officers()).toBe(2);
    expect(entity.transporters().some(item => item.kind === 'bay'
      && item.configuration.type === 'second-class-quarters' && item.capacity === 3)).toBeTrue();
  });

  it('does not synthesize quarters when a zero-capacity quarters bay exists', () => {
    const entity = new TestSmallCraftEntity();
    entity.transporters.set([bay('crew-quarters', 0)]);

    normalizeLoadedSmallCraft(entity);

    expect(entity.transporters()).toEqual([bay('crew-quarters', 0)]);
  });

  it('includes infantry bay and miscellaneous-equipment personnel', () => {
    const entity = new TestSmallCraftEntity();
    entity.transporters.set([{
      ...bay('cargo', 5),
      configuration: { type: 'infantry', infantryType: 'Foot' },
    }]);
    addTestEquipmentWithFlags(entity, 'F_FIELD_KITCHEN', { location: 'Nose' });

    expect(calculateBayPersonnel(entity)).toBe(28);
    normalizeLoadedSmallCraft(entity);
    expect(entity.crew()).toBe(34);
    expect(entity.officers()).toBe(2);
  });

  it('counts capital weapons individually and standard weapons per six', () => {
    const entity = new TestSmallCraftEntity();
    for (let index = 0; index < 7; index++) addTestEquipment(entity, weapon(`Laser ${index}`), { location: 'Nose' });
    addTestEquipment(entity, weapon('Capital Laser', true), { location: 'Nose' });

    expect(calculateRequiredGunners(entity)).toBe(3);
  });

  it('ignores short-ranged weapons and suppresses required gunners for drones', () => {
    const entity = new TestSmallCraftEntity();
    addTestEquipment(entity, weapon('Short Weapon', false, [1, 1, 1, 1]), { location: 'Nose' });
    addTestEquipmentWithFlags(entity, 'F_DRONE_OPERATING_SYSTEM', { location: 'Nose' });

    expect(calculateRequiredGunners(entity)).toBe(0);
  });
});

function bay(type: 'cargo' | 'crew-quarters', capacity: number) {
  return {
    id: 'transporter-1', kind: 'bay' as const, configuration: { type },
    capacity, doors: 0, bayNumber: 0, omni: false,
  };
}

function weapon(id: string, capital = false, ranges = [5, 10, 15, 20]): WeaponEquipment {
  return createEquipment({
    id, name: id, type: 'weapon', weapon: { damage: 1, ranges, capital },
  }) as WeaponEquipment;
}