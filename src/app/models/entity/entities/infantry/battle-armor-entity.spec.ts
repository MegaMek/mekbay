import type { Equipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { BattleArmorEntity } from './battle-armor-entity';

describe('BattleArmorEntity movement', () => {
  it('uses declared jump MP with slotless movement equipment', () => {
    const entity = new BattleArmorEntity();
    entity.originalWalkMP.set(1);
    entity.jumpingMP.set(3);
    entity.motiveType.set('Jump');
    entity.equipment.set([mountWithFlag('F_JUMP_JET')]);

    expect(entity.walkMP()).toBe(1);
    expect(entity.runMP()).toBe(1);
    expect(entity.jumpMP()).toBe(3);
    expect(entity.equipment()[0].location).toBe('None');
    expect(entity.equipment()[0].placements).toBeUndefined();
  });

  it('reacts to BA movement modifiers without changing source walk MP', () => {
    const entity = new BattleArmorEntity();
    entity.originalWalkMP.set(5);
    entity.declaredWeightClass.set('Light');
    entity.equipment.set([mountWithFlag('F_MASC')]);

    expect(entity.walkMP()).toBe(7);
    expect(entity.runMP()).toBe(7);
    expect(entity.originalWalkMP()).toBe(5);

    entity.motiveType.set('UMU');
    entity.jumpingMP.set(3);
    entity.equipment.set([mountWithFlag('F_MECHANICAL_JUMP_BOOSTER')]);
    expect(entity.jumpMP()).toBe(1);
  });
});

function mountWithFlag(flag: string): EntityMountedEquipment {
  return {
    mountId: flag,
    equipmentId: flag,
    equipment: { hasFlag: (candidate: string) => candidate === flag } as Equipment,
    location: 'None',
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  };
}