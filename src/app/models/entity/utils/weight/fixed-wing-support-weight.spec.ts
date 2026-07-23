import { createEquipment } from '../../../equipment.model';
import { TestFixedWingSupportEntity } from '../../testing/test-entities';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import { MountedEngine } from '../../components';
import { calculateFixedWingSupportWeightBreakdown } from './fixed-wing-support-weight';

describe('fixed-wing support construction mass', () => {
  it('uses the small fixed-wing chassis factor and kilogram rounding', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.setTonnage(4);
    entity.structuralTechRating.set(3);
    expect(calculateFixedWingSupportWeightBreakdown(entity).structure).toBe(0.32);
  });

  it('uses class/rating fuel density with the propeller reduction', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.setTonnage(4);
    entity.engineTechRating.set(3);
    entity.fuel.set(273);
    addTestEquipment(entity, createEquipment({
      id: 'Prop', name: 'Prop', type: 'misc', flags: ['F_CHASSIS_MODIFICATION', 'F_PROP'],
    }), { location: 'Fuselage' });
    expect(calculateFixedWingSupportWeightBreakdown(entity).fuel).toBe(3.276);
  });

  it('does not charge fuel for fusion-powered propeller aircraft', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.fuel.set(100);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 50, techBase: 'IS' }));
    addTestEquipment(entity, createEquipment({
      id: 'Prop', name: 'Prop', type: 'misc', flags: ['F_CHASSIS_MODIFICATION', 'F_PROP'],
    }), { location: 'Fuselage' });
    expect(calculateFixedWingSupportWeightBreakdown(entity).fuel).toBe(0);
  });
});