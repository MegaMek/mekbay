import { Equipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { ProtoMekEntity } from './protomek-entity';

describe('ProtoMekEntity jumpMP', () => {
  it('adds the standard-atmosphere partial-wing bonus', () => {
    const entity = new ProtoMekEntity();
    entity.jumpingMP.set(5);

    expect(entity.jumpMP()).toBe(5);

    entity.equipment.set([mountWithFlag('F_PARTIAL_WING')]);
    expect(entity.jumpMP()).toBe(7);
    expect(entity.maxJumpMP()).toBe(5);

    entity.equipment.set([]);
    expect(entity.jumpMP()).toBe(5);
  });
});

describe('ProtoMekEntity runMP', () => {
  it('doubles walk MP when a myomer booster is mounted', () => {
    const entity = new ProtoMekEntity();
    entity.originalWalkMP.set(6);

    expect(entity.runMP()).toBe(9);

    entity.equipment.set([mountWithFlag('F_MASC')]);
    expect(entity.runMP()).toBe(12);
  });
});

function mountWithFlag(flag: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: flag,
    equipmentId: flag,
    equipment: { hasFlag: (candidate: string) => candidate === flag } as Equipment,
    location: 'Torso',
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}