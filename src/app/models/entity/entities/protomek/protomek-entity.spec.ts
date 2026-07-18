import { Equipment } from '../../../equipment.model';
import { BV_MOVEMENT_CALCULATION, EntityMountedEquipment } from '../../types';
import { TestProtoMekEntity as ProtoMekEntity } from '../../testing/test-entities';

describe('ProtoMekEntity jumpMP', () => {
  it('adds the standard-atmosphere partial-wing bonus', () => {
    const entity = new ProtoMekEntity();
    entity.equipment.set(Array.from({ length: 5 }, () => mountWithFlag('F_JUMP_JET')));

    expect(entity.jumpMP()).toBe(5);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('F_PARTIAL_WING')]);
    expect(entity.jumpMP()).toBe(7);
    expect(entity.maxJumpMP()).toBe(7);
    expect(entity.computeJumpMP(BV_MOVEMENT_CALCULATION)).toBe(5);

    entity.equipment.set([]);
    expect(entity.jumpMP()).toBe(0);
  });

  it('keeps UMU movement separate from jump movement', () => {
    const entity = new ProtoMekEntity();
    entity.equipment.set(Array.from({ length: 3 }, () => mountWithFlag('F_UMU')));

    expect(entity.jumpMP()).toBe(0);
    expect(entity.installedUmuMP()).toBe(3);
    expect(entity.umuMP()).toBe(3);
  });
});

describe('ProtoMekEntity intrinsic weapons', () => {
  it('exposes frenzy damage from chassis and melee equipment', () => {
    const entity = new ProtoMekEntity();
    entity.setTonnage(10);

    expect(entity.intrinsicWeapons()[0].damage).toEqual({
      kind: 'physical-fixed', primary: { damage: 3 },
    });

    entity.equipment.set([mountWithFlags(['F_PROTOMEK_MELEE'])]);
    expect(entity.intrinsicWeapons()[0].damage).toEqual({
      kind: 'physical-fixed', primary: { damage: 5 },
    });

    entity.equipment.set([mountWithFlags(['F_PROTOMEK_MELEE', 'S_PROTO_QMS'])]);
    expect(entity.intrinsicWeapons()[0].damage).toEqual({
      kind: 'physical-fixed', primary: { damage: 7 },
    });
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
  return mountWithFlags([flag]);
}

function mountWithFlags(flags: readonly string[]): EntityMountedEquipment {
  const flagSet = new Set(flags);
  return new EntityMountedEquipment({
    mountId: flags.join(':'),
    equipmentId: flags.join(':'),
    equipment: { hasFlag: (candidate: string) => flagSet.has(candidate) } as Equipment,
    allocation: { kind: 'location', location: 'Torso' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}