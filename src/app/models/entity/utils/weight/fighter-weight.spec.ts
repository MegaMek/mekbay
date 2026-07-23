import { MountedEngine } from '../../components';
import { TestAeroSpaceFighterEntity, TestConvFighterEntity } from '../../testing/test-entities';
import { calculateFighterWeightBreakdown } from './fighter-weight';

describe('fighter construction mass', () => {
  it('converts fuel points and aerospace cockpit types to tons', () => {
    const entity = new TestAeroSpaceFighterEntity();
    entity.fuel.set(80);
    entity.cockpitType.set('Small');
    const result = calculateFighterWeightBreakdown(entity);
    expect(result.fuel).toBe(1);
    expect(result.controls).toBe(2);
  });

  it('uses nearest-half controls and upward-half VSTOL mass for conventional fighters', () => {
    const entity = new TestConvFighterEntity();
    entity.setTonnage(25);
    entity.vstol.set(true);
    entity.fuel.set(160);
    const result = calculateFighterWeightBreakdown(entity);
    expect(result.controls).toBe(2.5);
    expect(result.vstol).toBe(1.5);
    expect(result.fuel).toBe(1);
  });

  it('adds shielding mass for fusion-powered conventional fighters', () => {
    const entity = new TestConvFighterEntity();
    entity.setTonnage(50);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 200, techBase: 'IS' }));
    expect(calculateFighterWeightBreakdown(entity).engine).toBe(13);
  });
});