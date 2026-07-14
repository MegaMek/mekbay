import { Equipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { BipedMekEntity } from './biped-mek-entity';
import { QuadMekEntity } from './quad-mek-entity';

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

  it('reduces run MP by one for hardened armor', () => {
    const entity = new BipedMekEntity();
    entity.originalWalkMP.set(5);

    expect(entity.runMP()).toBe(8);

    entity.mountedArmor.update(armor => ({ ...armor, type: 'HARDENED' }));
    expect(entity.runMP()).toBe(7);
  });

  it('applies static shield, modular armor, and chain drape walk penalties', () => {
    const entity = new BipedMekEntity();
    entity.originalWalkMP.set(8);
    entity.equipment.set([
      mountWithFlag('S_SHIELD_MEDIUM'),
      mountWithFlag('S_SHIELD_LARGE'),
      mountWithFlag('F_MODULAR_ARMOR'),
      mountWithFlag('F_MODULAR_ARMOR'),
      mountWithFlag('F_CHAIN_DRAPE'),
    ]);

    expect(entity.walkMP()).toBe(4);
    expect(entity.runMP()).toBe(6);
  });

  it('does not apply shield walk penalties to quad Meks', () => {
    const entity = new QuadMekEntity();
    entity.originalWalkMP.set(6);
    entity.equipment.set([mountWithFlag('S_SHIELD_MEDIUM')]);

    expect(entity.walkMP()).toBe(6);
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