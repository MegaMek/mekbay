import { AmmoEquipment, WeaponEquipment } from '../../../../equipment.model';
import { TestBattleArmorEntity as BattleArmorEntity } from '../../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../testing/test-mounted-equipment';
import {
  battleArmorTroopFactor,
  calculateBattleArmorStandardDamage,
} from './battle-armor-damage';

describe('Battle Armor troop factor', () => {
  it('matches the complete boundary behavior', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 30, 31].map(battleArmorTroopFactor))
      .toEqual([0.5, 0.5, 1.5, 2.5, 3.5, 3.5, 4.5, 18.5, 18.5]);
  });

  it('rejects negative and fractional shooting strengths', () => {
    expect(() => battleArmorTroopFactor(-1)).toThrowError(RangeError);
    expect(() => battleArmorTroopFactor(1.5)).toThrowError(RangeError);
  });
});

describe('Battle Armor standard damage', () => {
  it('counts Squad and Trooper 1 mounts but ignores duplicated later troopers', () => {
    const entity = new BattleArmorEntity();
    const weapon = testWeapon('laser');
    addTestEquipment(entity, weapon, { location: 'Squad' });
    addTestEquipment(entity, weapon, { location: 'Trooper 1' });
    addTestEquipment(entity, weapon, { location: 'Trooper 2' });

    const result = calculateBattleArmorStandardDamage(entity);

    expect(result.breakdown.normal).toEqual([2, 2, 2, 0]);
    expect(result.breakdown.troopFactor).toBe(3.5);
    expect(result.standard).toEqual({ dmgS: '7', dmgM: '7', dmgL: '7', dmgE: '0' });
  });

  it('uses an explicit shooting strength instead of declared squad size', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, testWeapon('laser'), { location: 'Squad' });

    const result = calculateBattleArmorStandardDamage(entity, { shootingStrength: 2 });

    expect(result.breakdown.shootingStrength).toBe(2);
    expect(result.breakdown.troopFactor).toBe(1.5);
    expect(result.standard.dmgS).toBe('2');
  });

  it('adds squad-support damage once without troop scaling', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, testWeapon('normal'), { location: 'Squad' });
    addTestEquipment(entity, testWeapon('support'), { location: 'Trooper 4', isSSWM: true });

    const result = calculateBattleArmorStandardDamage(entity);

    expect(result.breakdown.normal[0]).toBe(1);
    expect(result.breakdown.squadSupport[0]).toBe(1);
    expect(result.breakdown.raw[0]).toBe(4.5);
    expect(result.standard.dmgS).toBe('5');
  });

  it('excludes anti-personnel mounted, artillery, and torpedo weapons', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, testWeapon('apm'), { location: 'Squad', isAPM: true });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'artillery', name: 'Artillery', type: 'weapon', flags: ['F_ARTILLERY'],
      weapon: { damage: 'artillery', ranges: [5, 10, 20, 24], ammoType: 'NA' },
    }), { location: 'Squad' });
    addTestEquipment(entity, testWeapon('torpedo', 'SRM_TORPEDO', ['F_MISSILE'], 10, 'TORPEDO'),
      { location: 'Squad' });

    expect(calculateBattleArmorStandardDamage(entity).standard)
      .toEqual({ dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' });
  });

  it('applies one armored-glove bonus in preference to AP mounts', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_AP_MOUNT', { location: 'Squad' });
    addTestEquipmentWithFlags(entity, 'F_ARMORED_GLOVE', { location: 'Trooper 1' });
    addTestEquipmentWithFlags(entity, 'F_ARMORED_GLOVE', { location: 'Trooper 2' });

    const result = calculateBattleArmorStandardDamage(entity);

    expect(result.breakdown.apOrGloveBonus).toBe(0.1);
    expect(result.breakdown.raw[0]).toBeCloseTo(0.35, 12);
    expect(result.standard.dmgS).toBe('0*');
  });

  it('adds only one AP-mount bonus when no armored glove exists', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_AP_MOUNT', { location: 'Squad' });
    addTestEquipmentWithFlags(entity, 'F_AP_MOUNT', { location: 'Trooper 1' });

    const result = calculateBattleArmorStandardDamage(entity);

    expect(result.breakdown.apOrGloveBonus).toBe(0.05);
    expect(result.breakdown.raw[0]).toBeCloseTo(0.175, 12);
  });

  it('adds operational vibroclaws after troop scaling', () => {
    const entity = new BattleArmorEntity();
    const first = addTestEquipmentWithFlags(entity, 'F_VIBROCLAW', { location: 'Trooper 1' });
    addTestEquipmentWithFlags(entity, 'F_VIBROCLAW', { location: 'Trooper 2' });

    const result = calculateBattleArmorStandardDamage(entity, {
      isOperational: mount => mount !== first,
    });

    expect(result.breakdown.vibroclawBonus).toBe(0.1);
    expect(result.breakdown.raw[0]).toBe(0.1);
    expect(result.standard.dmgS).toBe('0*');
  });

  it('does not penalize non-missile BA weapons for missing ammo', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, testWeapon('autocannon', 'AC', ['F_BALLISTIC']), { location: 'Squad' });

    expect(calculateBattleArmorStandardDamage(entity).breakdown.normal[0]).toBe(1);
  });

  it('applies BA ammo thresholds only to missile weapons', () => {
    const entity = new BattleArmorEntity();
    const missile = testWeapon('missile', 'SRM', ['F_MISSILE'], 2);
    addTestEquipment(entity, missile, { location: 'Squad' });
    addTestEquipment(entity, missile, { location: 'Trooper 1' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'missile-ammo', name: 'Missile Ammo', type: 'ammo',
      ammo: { type: 'SRM', rackSize: 2, shots: 19 },
    }), { location: 'Squad', shotsCount: 19 });

    expect(calculateBattleArmorStandardDamage(entity).breakdown.normal[0]).toBeCloseTo(0.3, 12);
  });

  it('forces extreme damage to zero and preserves dual rounding', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, testWeapon('tiny', 'NA', [], 0.1), { location: 'Squad' });

    expect(calculateBattleArmorStandardDamage(entity).standard)
      .toEqual({ dmgS: '0*', dmgM: '0*', dmgL: '0*', dmgE: '0' });
  });
});

function testWeapon(
  id: string,
  ammoType: 'NA' | 'AC' | 'SRM' | 'SRM_TORPEDO' = 'NA',
  flags: ConstructorParameters<typeof WeaponEquipment>[0]['flags'] = [],
  damage = 10,
  battleForceClass?: 'TORPEDO',
): WeaponEquipment {
  return new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    flags,
    weapon: { damage, rackSize: ammoType === 'AC' ? 10 : ammoType === 'SRM' || ammoType === 'SRM_TORPEDO' ? 2 : 0,
      ranges: [5, 10, 20, 24], ammoType,
      alphaStrike: battleForceClass ? { battleForceClass } : undefined },
  });
}
