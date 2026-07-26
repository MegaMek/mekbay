import { type BaseEntity, JumpShipEntity, SmallCraftEntity, WarShipEntity } from '../../../entities';
import type { EntityMountedWeapon } from '../../../types/equipment';
import type { AlphaStrikeArcName } from './damage-types';

export const LARGE_AEROSPACE_ARCS: readonly AlphaStrikeArcName[] = [
  'frontArc', 'leftArc', 'rightArc', 'rearArc',
];

/** MegaMek ASLocationMapper damage-location weighting for arced units. */
export function largeAerospaceArcMultiplier(
  entity: BaseEntity,
  arc: AlphaStrikeArcName,
  mount: Pick<EntityMountedWeapon, 'location' | 'rearMounted'>,
): number {
  const { location, rearMounted } = mount;
  if (entity instanceof WarShipEntity) {
    if (arc === 'frontArc') return ['Nose', 'FLS', 'FRS'].includes(location) ? 1 : 0;
    if (arc === 'leftArc') return ['Left Broadside', 'ALS'].includes(location) ? 1 : 0;
    if (arc === 'rightArc') return ['Right Broadside', 'ARS'].includes(location) ? 1 : 0;
    return location === 'Aft' ? 1 : 0;
  }
  if (entity instanceof JumpShipEntity) {
    if (arc === 'frontArc') return location === 'Nose' ? 1 : ['FLS', 'FRS'].includes(location) ? 0.5 : 0;
    if (arc === 'leftArc') return ['FLS', 'ALS'].includes(location) ? 0.5 : 0;
    if (arc === 'rightArc') return ['FRS', 'ARS'].includes(location) ? 0.5 : 0;
    return location === 'Aft' ? 1 : ['ALS', 'ARS'].includes(location) ? 0.5 : 0;
  }
  if (entity instanceof SmallCraftEntity) {
    const spheroid = entity.motiveType() === 'Spheroid';
    if (arc === 'frontArc') {
      return location === 'Nose' ? 1
        : spheroid && ['Left Side', 'Right Side'].includes(location) && !rearMounted ? 0.5 : 0;
    }
    if (arc === 'leftArc' || arc === 'rightArc') {
      const side = arc === 'leftArc' ? 'Left Side' : 'Right Side';
      return location === side && (spheroid || !rearMounted) ? spheroid ? 0.5 : 1 : 0;
    }
    return location === 'Aft' ? 1
      : rearMounted && ['Left Side', 'Right Side'].includes(location) ? spheroid ? 0.5 : 1 : 0;
  }
  return arc === 'frontArc' && location !== 'Rear' ? 1
    : arc === 'rearArc' && location === 'Rear' ? 1 : 0;
}
