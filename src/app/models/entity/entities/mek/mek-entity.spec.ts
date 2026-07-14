import { Equipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { BipedMekEntity } from './biped-mek-entity';

describe('MekEntity jumpMP', () => {
  it('reacts to jump jets, partial wings, and shields', () => {
    const entity = new BipedMekEntity();
    entity.tonnage.set(55);
    entity.equipment.set([
      ...mountsWithFlag('F_JUMP_JET', 6),
      mountWithFlag('F_PARTIAL_WING'),
    ]);

    expect(entity.jumpMP()).toBe(8);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('S_SHIELD_MEDIUM')]);
    expect(entity.jumpMP()).toBe(7);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('F_MODULAR_ARMOR')]);
    expect(entity.jumpMP()).toBe(6);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('S_SHIELD_LARGE')]);
    expect(entity.jumpMP()).toBe(0);
  });

  it('uses the smaller partial-wing bonus for heavy Meks', () => {
    const entity = new BipedMekEntity();
    entity.tonnage.set(75);
    entity.equipment.set([
      ...mountsWithFlag('F_JUMP_JET', 4),
      mountWithFlag('F_PARTIAL_WING'),
    ]);

    expect(entity.jumpMP()).toBe(5);
  });
});

function mountsWithFlag(flag: string, count: number): EntityMountedEquipment[] {
  return Array.from({ length: count }, () => mountWithFlag(flag));
}

function mountWithFlag(flag: string): EntityMountedEquipment {
  const mountId = `${flag}-${nextMountId++}`;
  return {
    mountId,
    equipmentId: flag,
    equipment: { hasFlag: (candidate: string) => candidate === flag } as Equipment,
    location: 'CT',
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  };
}

let nextMountId = 0;