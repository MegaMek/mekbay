import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import {
  TestAeroSpaceFighterEntity,
  TestBattleArmorEntity,
  TestBipedMekEntity,
  TestDropShipEntity,
  TestHandheldWeaponEntity,
  TestInfantryEntity,
  TestJumpShipEntity,
  TestProtoMekEntity,
  TestSpaceStationEntity,
  TestSupportTankEntity,
  TestTankEntity,
  TestWarShipEntity,
} from '../../testing/test-entities';
import { EntityMountedEquipment } from '../../types';
import { calculateBattleValue, calculateBattleValueDetails, getBVCalculator } from './factory';
import type { BattleValueDetail } from './bv-calculator';
import { infantryDamageDivisor } from './infantry-rules';
import { offensiveSpeedFactor, targetMovementModifier, vehicleTypeModifier } from './rules';
import { CombatVehicleBVCalculator, MekBVCalculator, ProtoMekBVCalculator } from './family-calculators';

let mountSequence = 0;

function mount(equipment: WeaponEquipment | AmmoEquipment, location = 'Front'): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: `${equipment.id}-${++mountSequence}`, equipmentId: equipment.id, equipment,
    allocation: { kind: 'location', location }, rearMounted: false,
    turretMounted: false, omniPodMounted: false, armored: false,
  });
}

function findDetail(details: readonly BattleValueDetail[], type: string): BattleValueDetail | undefined {
  for (const detail of details) {
    if (detail.type === type) return detail;
    const nested = detail.details && findDetail(detail.details, type);
    if (nested) return nested;
  }
  return undefined;
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
  it('adds MegaMek prototype laser heat bonuses', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      heatOf(item: EntityMountedEquipment): number { return this.weaponHeat(item); }
    }
    const entity = new TestBipedMekEntity();
    const prototype = new WeaponEquipment({ id: 'ISERLargeLaserPrototype',
      name: 'Prototype ER Large Laser', type: 'weapon', weapon: { heat: 12 }, stats: { bv: 136 } });
    expect(new ExposedMekCalculator(entity).heatOf(mount(prototype, 'RA'))).toBe(15);
  });

  it('applies arm AES to offensive club equipment', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      modifier(item: EntityMountedEquipment): number { return this.offensiveEquipmentModifier(item); }
    }
    const entity = new TestBipedMekEntity();
    const aes = new MiscEquipment({ id: 'aes', name: 'AES', type: 'misc',
      flags: ['F_ACTUATOR_ENHANCEMENT_SYSTEM'] });
    const club = new MiscEquipment({ id: 'club', name: 'Club', type: 'misc', flags: ['F_CLUB'] });
    const clubMount = mount(club as never, 'RA');
    entity.setEquipment([mount(aes as never, 'RA'), clubMount]);
    expect(new ExposedMekCalculator(entity).modifier(clubMount)).toBe(1.25);
  });

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

describe('structured battle value details', () => {
  it('uses the support vehicle BAR signal rather than armor material defaults', () => {
    const entity = new TestSupportTankEntity();
    entity.armorValues.set(new Map([['Front', { front: 10, rear: 0 }]]));
    entity.barRating.set(0);
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(0);
    entity.barRating.set(6);
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(15);
  });

  it('counts HarJel II and III as defensive equipment', () => {
    const entity = new TestBipedMekEntity();
    const harjel2 = new MiscEquipment({ id: 'harjel-2', name: 'HarJel II', type: 'misc',
      flags: ['F_HARJEL_II'], stats: { bv: -1 } });
    const harjel3 = new MiscEquipment({ id: 'harjel-3', name: 'HarJel III', type: 'misc',
      flags: ['F_HARJEL_III'], stats: { bv: -2 } });
    entity.setEquipment([mount(harjel2 as never, 'CT'), mount(harjel3 as never, 'CT')]);
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Defensive Equipment')?.delta).toBe(-3);
  });

  it('shares one state calculation while preserving the numeric API', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(20);
    entity.originalWalkMP.set(4);
    const laser = new WeaponEquipment({
      id: 'test-laser', name: 'Test Laser', shortName: 'Test Laser', type: 'weapon', stats: { bv: 100 },
      weapon: { ammoType: 'NA', heat: 0 }, flags: ['F_ENERGY'],
    });
    entity.setEquipment([mount(laser)]);

    const result = calculateBattleValueDetails(entity);
    expect(result.base).toBe(calculateBattleValue(entity));
    expect(result.details.map(detail => detail.type)).toEqual([
      'Effective MP', 'Defensive Battle Rating', 'Offensive Battle Rating', 'Battle Value',
    ]);
    expect(findDetail(result.details, 'Weapons')?.details?.[0].type).toBe('Test Laser (Front)');
    expect(findDetail(result.details, 'Speed Factor')?.total).toBeCloseTo(result.offensive, 3);
    expect(findDetail(result.details, 'Base Unit BV')?.total).toBe(result.base);
    expect(JSON.parse(JSON.stringify(result.details))).toEqual(result.details);
  });

  it('emits zero-safe shared sections and finite totals for an empty entity', () => {
    const result = calculateBattleValueDetails(new TestTankEntity());
    expect(findDetail(result.details, 'Armor')?.delta).toBe(0);
    expect(findDetail(result.details, 'Weapons')?.delta).toBe(0);
    expect(findDetail(result.details, 'Base Unit BV')?.total).toBe(result.base);
    expect(result.details.every(detail => detail.type.length > 0)).toBeTrue();
    expect(Number.isFinite(result.base)).toBeTrue();
  });

  it('reports the Mek labels, formulas, heat sequence, overheat, weight, and speed used by Hellion P', () => {
    const entity = new TestBipedMekEntity();
    entity.setTonnage(30);
    entity.originalWalkMP.set(12);
    const hotLaser = new WeaponEquipment({
      id: 'hot-laser', name: 'Imp. Heavy Medium Laser', shortName: 'Imp. Heavy Medium Laser',
      type: 'weapon', stats: { bv: 93 }, weapon: { ammoType: 'NA', heat: 100 }, flags: ['F_ENERGY'],
    });
    entity.setEquipment([mount(hotLaser, 'LT'), mount(hotLaser, 'LT')]);

    const result = calculateBattleValueDetails(entity);
    expect(result.details[0]).toEqual({ type: 'Effective MP', calculation: 'R: 18, J: 0, U: 0' });
    expect(findDetail(result.details, 'Defensive Battle Rating')).toBeDefined();
    expect(findDetail(result.details, 'Internal Structure')?.calculation).toContain('x 1.5');
    expect(findDetail(result.details, 'Gyro')?.calculation).toContain('+ 30 x');
    expect(findDetail(result.details, 'Heat Efficiency')?.calculation).toContain('6 +');
    const weapons = findDetail(result.details, 'Weapons')?.details ?? [];
    expect(weapons.filter(detail => detail.type === 'Imp. Heavy Medium Laser (LT)').length).toBe(2);
    expect(weapons.some(detail => detail.calculation?.includes('(Overheat)'))).toBeTrue();
    expect(findDetail(result.details, 'Weight')?.calculation).toContain('+ 30');
    expect(findDetail(result.details, 'Speed Factor')?.calculation).toContain('x 2.72');
    expect(findDetail(result.details, 'Base Unit BV')?.calculation).toContain(', rn');
  });

  it('exposes reactive BaseEntity value and details computed from current state', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(10);
    const initial = entity.battleValue();
    expect(entity.battleValueDetails()).toBe(entity.battleValueDetails());

    entity.setTonnage(30);
    expect(entity.battleValue()).not.toBe(initial);
    expect(findDetail(entity.battleValueDetails(), 'Weight')?.calculation).toContain('+ 30');
  });

  it('returns a coherent hierarchy for every calculator family', () => {
    const entities = [
      new TestBipedMekEntity(), new TestTankEntity(), new TestProtoMekEntity(),
      new TestInfantryEntity(), new TestBattleArmorEntity(), new TestAeroSpaceFighterEntity(),
      new TestDropShipEntity(), new TestJumpShipEntity(), new TestSpaceStationEntity(),
      new TestWarShipEntity(), new TestHandheldWeaponEntity(),
    ];
    for (const entity of entities) {
      const result = calculateBattleValueDetails(entity);
      expect(result.details.map(detail => detail.type)).withContext(entity.entityType).toEqual([
        'Effective MP', 'Defensive Battle Rating', 'Offensive Battle Rating', 'Battle Value',
      ]);
      expect(findDetail(result.details, 'Base Unit BV')?.total).withContext(entity.entityType).toBe(result.base);
      expect(Number.isFinite(result.base)).withContext(entity.entityType).toBeTrue();
    }
  });
});
