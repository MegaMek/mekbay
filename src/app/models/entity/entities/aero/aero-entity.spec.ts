import {
  TestConvFighterEntity as ConvFighterEntity,
  TestFixedWingSupportEntity as FixedWingSupportEntity,
} from '../../testing/test-entities';
import { addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';

describe('AeroEntity movement', () => {
  it('reduces safe thrust by one for modular armor', () => {
    const entity = new ConvFighterEntity();
    entity.originalWalkMP.set(6);

    expect(entity.walkMP()).toBe(6);
    expect(entity.runMP()).toBe(9);

    addTestEquipmentWithFlags(entity, 'F_MODULAR_ARMOR', { location: 'Nose' });
    expect(entity.walkMP()).toBe(5);
    expect(entity.runMP()).toBe(8);
    expect(entity.maxWalkMP()).toBe(6);
    expect(entity.maxRunMP()).toBe(9);
  });

  it('automatically derives fighter structural integrity from weight and thrust', () => {
    const entity = new ConvFighterEntity();
    entity.setTonnage(70);
    entity.originalWalkMP.set(5);

    entity.autoSetStructuralIntegrity();

    expect(entity.structuralIntegrity()).toBe(7);
    expect(entity.totalInternalPoints()).toBe(7);
  });

  it('uses safe thrust as fixed-wing support structural integrity', () => {
    const entity = new FixedWingSupportEntity();
    entity.setTonnage(100);
    entity.originalWalkMP.set(4);

    entity.autoSetStructuralIntegrity();

    expect(entity.structuralIntegrity()).toBe(4);
  });
});