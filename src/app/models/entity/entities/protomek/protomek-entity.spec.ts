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