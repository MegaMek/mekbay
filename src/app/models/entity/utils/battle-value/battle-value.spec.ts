import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import {
  TestBipedMekEntity,
  TestInfantryEntity,
  TestProtoMekEntity,
  TestTankEntity,
} from '../../testing/test-entities';
import { EntityMountedEquipment } from '../../types';
import { getBVCalculator } from './factory';
import { infantryDamageDivisor } from './infantry-rules';
import { offensiveSpeedFactor, targetMovementModifier, vehicleTypeModifier } from './rules';
import { CombatVehicleBVCalculator, MekBVCalculator, ProtoMekBVCalculator } from './family-calculators';

function mount(equipment: WeaponEquipment | AmmoEquipment, location = 'Front'): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: equipment.id, equipmentId: equipment.id, equipment,
    allocation: { kind: 'location', location }, rearMounted: false,
    turretMounted: false, omniPodMounted: false, armored: false,
  });
}

describe('battle value pure rules', () => {
  it('ports MegaMek movement and speed tables', () => {
    expect(targetMovementModifier(0)).toBe(0);
    expect(targetMovementModifier(0, true)).toBe(0);
    expect(targetMovementModifier(5)).toBe(2);
    expect(targetMovementModifier(18)).toBe(5);
    expect(targetMovementModifier(7, true)).toBe(4);
    expect(offensiveSpeedFactor(5)).toBe(1);
    expect(offensiveSpeedFactor(8)).toBe(1.37);
  });

  it('ports combat vehicle type modifiers', () => {
    expect(vehicleTypeModifier('Tracked')).toBe(0.9);
    expect(vehicleTypeModifier('Hover')).toBe(0.7);
    expect(vehicleTypeModifier('Naval')).toBe(0.6);
  });
});

describe('battle value family dispatch', () => {
  it('dispatches modeled families like MegaMek', () => {
    expect(getBVCalculator(new TestBipedMekEntity())).toBeInstanceOf(MekBVCalculator);
    expect(getBVCalculator(new TestTankEntity())).toBeInstanceOf(CombatVehicleBVCalculator);
    expect(getBVCalculator(new TestProtoMekEntity())).toBeInstanceOf(ProtoMekBVCalculator);
  });

  it('calculates from canonical equipment and ignores manual BV', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(20);
    entity.originalWalkMP.set(4);
    entity.manualBV.set(9999);
    const laser = new WeaponEquipment({
      id: 'test-laser', name: 'Test Laser', type: 'weapon', stats: { bv: 100 },
      weapon: { ammoType: 'NA', heat: 0 }, flags: ['F_ENERGY'],
    });
    entity.setEquipment([mount(laser)]);
    const bv = getBVCalculator(entity).calculateBaseBV();
    expect(bv).toBeGreaterThan(0);
    expect(bv).not.toBe(9999);
  });

  it('calculates ProtoMek melee BV before the fixed-zero equipment fallback', () => {
    const entity = new TestProtoMekEntity();
    entity.setTonnage(7);
    const qms = new MiscEquipment({
      id: 'ProtoQuadMeleeSystem', name: 'ProtoMech Quad Melee System', type: 'misc',
      stats: { bv: 0 }, flags: ['F_PROTOMEK_MELEE', 'S_PROTO_QMS'],
    });
    const qmsMount = mount(qms as never, 'Torso');
    expect(qmsMount.getBV(entity)).toBe(5);
  });

  it('composes infantry armor, augmentation, and beast damage divisors', () => {
    const entity = new TestInfantryEntity();
    entity.augmentations.set(['tsm_implant', 'dermal_armor']);
    entity.mount.set({ damageDivisor: 2 } as never);
    expect(infantryDamageDivisor(entity)).toBe(3);
  });
});
