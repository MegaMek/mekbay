import { Equipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { ConvFighterEntity } from './conv-fighter-entity';
import { FixedWingSupportEntity } from './fixed-wing-support-entity';

describe('AeroEntity movement', () => {
  it('reduces safe thrust by one for modular armor', () => {
    const entity = new ConvFighterEntity();
    entity.originalWalkMP.set(6);

    expect(entity.walkMP()).toBe(6);
    expect(entity.runMP()).toBe(9);

    entity.equipment.set([mountWithFlag('F_MODULAR_ARMOR')]);
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

function mountWithFlag(flag: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: flag,
    equipmentId: flag,
    equipment: { hasFlag: (candidate: string) => candidate === flag } as Equipment,
    location: 'Nose',
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}