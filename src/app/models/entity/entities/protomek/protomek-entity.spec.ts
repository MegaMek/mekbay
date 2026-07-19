import { AmmoEquipment } from '../../../equipment.model';
import { BV_MOVEMENT_CALCULATION } from '../../types';
import { TestProtoMekEntity as ProtoMekEntity } from '../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';

describe('ProtoMekEntity jumpMP', () => {
  it('adds the standard-atmosphere partial-wing bonus', () => {
    const entity = new ProtoMekEntity();
    for (let count = 0; count < 5; count++) addTestEquipmentWithFlags(entity, 'F_JUMP_JET', { location: 'Torso' });

    expect(entity.jumpMP()).toBe(5);

    addTestEquipmentWithFlags(entity, 'F_PARTIAL_WING', { location: 'Torso' });
    expect(entity.jumpMP()).toBe(7);
    expect(entity.maxJumpMP()).toBe(7);
    expect(entity.computeJumpMP(BV_MOVEMENT_CALCULATION)).toBe(5);

    entity.setEquipment([]);
    expect(entity.jumpMP()).toBe(0);
  });

  it('keeps UMU movement separate from jump movement', () => {
    const entity = new ProtoMekEntity();
    for (let count = 0; count < 3; count++) addTestEquipmentWithFlags(entity, 'F_UMU', { location: 'Torso' });

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

    addTestEquipmentWithFlags(entity, ['F_PROTOMEK_MELEE'], { location: 'Torso' });
    expect(entity.intrinsicWeapons()[0].damage).toEqual({
      kind: 'physical-fixed', primary: { damage: 5 },
    });

    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, ['F_PROTOMEK_MELEE', 'S_PROTO_QMS'], { location: 'Torso' });
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

    addTestEquipmentWithFlags(entity, 'F_MASC', { location: 'Torso' });
    expect(entity.runMP()).toBe(12);
  });
});

describe('ProtoMekEntity CASE', () => {
  it('does not derive implicit CASE for Clan ProtoMeks with explosive ammunition', () => {
    const entity = new ProtoMekEntity();
    entity.techBase.set('Clan');
    const ammo = new AmmoEquipment({
      id: 'Clan Test Ammo',
      name: 'Test Ammo',
      type: 'ammo',
      stats: { explosive: true },
    });

    addTestEquipment(entity, ammo, { location: 'Torso' });

    expect(entity.implicitClanCaseLocations()).toEqual(new Set());
    expect(entity.locationHasCaseProtection('Torso')).toBeFalse();
  });
});