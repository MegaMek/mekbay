import {
  TestDropShipEntity as DropShipEntity,
  TestJumpShipEntity as JumpShipEntity,
  TestWarShipEntity as WarShipEntity,
} from '../../../testing/test-entities';
import { largeAerospaceArcMultiplier } from './large-aerospace-location-mapper';

const mount = (location: string, rearMounted = false) => ({ location, rearMounted });

describe('large aerospace location mapping', () => {
  it('maps WarShip nose-side and broadside locations to canonical arcs', () => {
    const entity = new WarShipEntity();
    expect(largeAerospaceArcMultiplier(entity, 'frontArc', mount('FLS'))).toBe(1);
    expect(largeAerospaceArcMultiplier(entity, 'leftArc', mount('Left Broadside'))).toBe(1);
    expect(largeAerospaceArcMultiplier(entity, 'rightArc', mount('ARS'))).toBe(1);
    expect(largeAerospaceArcMultiplier(entity, 'rearArc', mount('Aft'))).toBe(1);
    expect(largeAerospaceArcMultiplier(entity, 'leftArc', mount('Nose'))).toBe(0);
  });

  it('splits JumpShip side locations between adjacent arcs', () => {
    const entity = new JumpShipEntity();
    expect(largeAerospaceArcMultiplier(entity, 'frontArc', mount('FLS'))).toBe(0.5);
    expect(largeAerospaceArcMultiplier(entity, 'leftArc', mount('FLS'))).toBe(0.5);
    expect(largeAerospaceArcMultiplier(entity, 'leftArc', mount('ALS'))).toBe(0.5);
    expect(largeAerospaceArcMultiplier(entity, 'rearArc', mount('ALS'))).toBe(0.5);
  });

  it('splits spheroid side weapons by facing and rear mount', () => {
    const entity = new DropShipEntity();
    entity.motiveType.set('Spheroid');
    expect(largeAerospaceArcMultiplier(entity, 'frontArc', mount('Left Side'))).toBe(0.5);
    expect(largeAerospaceArcMultiplier(entity, 'leftArc', mount('Left Side'))).toBe(0.5);
    expect(largeAerospaceArcMultiplier(entity, 'leftArc', mount('Left Side', true))).toBe(0.5);
    expect(largeAerospaceArcMultiplier(entity, 'rearArc', mount('Left Side', true))).toBe(0.5);
    expect(largeAerospaceArcMultiplier(entity, 'frontArc', mount('Left Side', true))).toBe(0);
  });

  it('keeps aerodyne side and aft weapons in one arc', () => {
    const entity = new DropShipEntity();
    entity.motiveType.set('Aerodyne');
    expect(largeAerospaceArcMultiplier(entity, 'leftArc', mount('Left Side'))).toBe(1);
    expect(largeAerospaceArcMultiplier(entity, 'rearArc', mount('Left Side', true))).toBe(1);
    expect(largeAerospaceArcMultiplier(entity, 'rearArc', mount('Aft'))).toBe(1);
  });
});
