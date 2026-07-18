import type { Equipment } from '../../../equipment.model';
import { EntityMountedEquipment } from '../../types';
import { TestBattleArmorEntity as BattleArmorEntity } from '../../testing/test-entities';

describe('BattleArmorEntity movement', () => {
  it('uses one canonical signal for squad size and trooper count', () => {
    const entity = new BattleArmorEntity();

    expect(entity.squadCount()).toBe(1);
    expect(entity.squadSize()).toBe(5);
    expect(entity.squadSize).toBe(entity.trooperCount);
    entity.trooperCount.set(6);
    expect(entity.squadSize()).toBe(6);
  });

  it('derives jump and UMU movement from slotless propulsion equipment', () => {
    const entity = new BattleArmorEntity();
    entity.originalWalkMP.set(1);
    entity.propulsionMP.set(3);
    entity.motiveType.set('Jump');
    entity.equipment.set([mountWithFlag('F_JUMP_JET')]);

    expect(entity.walkMP()).toBe(1);
    expect(entity.runMP()).toBe(1);
    expect(entity.jumpMP()).toBe(3);
    expect(entity.umuMP()).toBe(0);
    expect(entity.equipment()[0].location).toBe('None');
    expect(entity.equipment()[0].placements).toBeUndefined();

    entity.motiveType.set('UMU');
    entity.propulsionMP.set(2);
    entity.equipment.set([mountWithFlag('F_UMU')]);
    expect(entity.jumpMP()).toBe(0);
    expect(entity.umuMP()).toBe(2);
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
    entity.equipment.set([mountWithFlag('F_MECHANICAL_JUMP_BOOSTER')]);
    expect(entity.jumpMP()).toBe(1);
  });
});

function mountWithFlag(flag: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: flag,
    equipmentId: flag,
    equipment: { hasFlag: (candidate: string) => candidate === flag } as Equipment,
    allocation: { kind: 'location', location: 'None' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}