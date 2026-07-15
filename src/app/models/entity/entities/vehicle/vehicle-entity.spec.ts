import { Equipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { SupportTankEntity } from './support-tank-entity';

describe('VehicleEntity movement', () => {
  it('applies hydrofoil, modular armor, and dune buggy modifiers', () => {
    const entity = new SupportTankEntity();
    entity.originalWalkMP.set(6);

    expect(entity.walkMP()).toBe(6);

    entity.equipment.set([mountWithFlag('F_HYDROFOIL')]);
    expect(entity.walkMP()).toBe(8);

    entity.equipment.set([mountWithFlag('F_MODULAR_ARMOR')]);
    expect(entity.walkMP()).toBe(5);
    expect(entity.maxWalkMP()).toBe(6);

    entity.equipment.set([mountWithFlag('F_DUNE_BUGGY')]);
    expect(entity.walkMP()).toBe(5);
  });
});

function mountWithFlag(flag: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: flag,
    equipmentId: flag,
    equipment: { hasFlag: (candidate: string) => candidate === flag } as Equipment,
    location: 'Body',
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}