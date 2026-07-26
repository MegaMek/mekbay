import { WeaponEquipment } from '../../../../equipment.model';
import { TestBipedMekEntity as BipedMekEntity } from '../../../testing/test-entities';
import { addTestEquipment } from '../../../testing/test-mounted-equipment';
import {
  alphaStrikeHeatDamageForWeapon,
  alphaStrikeHeatLevel,
  alphaStrikeHeatSpecial,
  sumAlphaStrikeHeatDamage,
} from './heat-damage';

describe('Alpha Strike weapon heat damage', () => {
  it('ports every Java flamer override from semantic Classic fields', () => {
    expect(alphaStrikeHeatDamageForWeapon(weapon('flamer', ['F_FLAMER']))).toEqual([2, 0, 0]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('er-flamer', ['F_FLAMER', 'F_ER_FLAMER']))).toEqual([2, 2, 0]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('heavy-flamer', ['F_FLAMER'], {
      ammoType: 'HEAVY_FLAMER', heat: 5, damage: 4,
    }))).toEqual([4, 0, 0]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('ba-heavy-flamer', ['F_FLAMER', 'F_BA_WEAPON'], {
      heat: 5, damage: 4,
    }))).toEqual([4, 0, 0]);
  });

  it('ports every Java plasma override from semantic Classic fields', () => {
    expect(alphaStrikeHeatDamageForWeapon(weapon('is-plasma', ['F_PLASMA'], {
      ammoType: 'PLASMA', damage: 10, rackSize: 1,
    }))).toEqual([3, 3, 0]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('clan-plasma-cannon', ['F_PLASMA'], {
      ammoType: 'PLASMA', damage: 'variable', rackSize: 2,
    }))).toEqual([7, 7, 7]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('ba-plasma', ['F_PLASMA', 'F_BA_WEAPON'], {
      damage: 2,
    }))).toEqual([2, 2, 0]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('mfuk-plasma', ['F_PLASMA_MFUK'], {
      damage: 10, rackSize: 1, heat: 15,
    }))).toEqual([3, 3, 0]);
  });

  it('returns no heat damage for ordinary weapons and unrecognized plasma signatures', () => {
    expect(alphaStrikeHeatDamageForWeapon(weapon('laser'))).toEqual([0, 0, 0]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('plasma-infantry', ['F_PLASMA', 'F_INFANTRY'], {
      ammoType: 'INFANTRY', damage: 2,
    }))).toEqual([0, 0, 0]);
  });

  it('sums eligible mounts and excludes other locations', () => {
    const entity = new BipedMekEntity();
    const front = addTestEquipment(entity, weapon('flamer', ['F_FLAMER']), { location: 'RA' });
    addTestEquipment(entity, weapon('rear-flamer', ['F_FLAMER']), { location: 'RT', rearMounted: true });

    expect(sumAlphaStrikeHeatDamage(entity.mountedWeapons())).toEqual([4, 0, 0]);
    expect(sumAlphaStrikeHeatDamage(entity.mountedWeapons(), mount => mount === front)).toEqual([2, 0, 0]);
  });

  it('uses Java HT thresholds and dash serialization', () => {
    expect([0, 4, 5, 10, 11].map(alphaStrikeHeatLevel)).toEqual([0, 0, 1, 1, 2]);
    expect(alphaStrikeHeatSpecial([4, 0, 0])).toBeNull();
    expect(alphaStrikeHeatSpecial([5, 10, 11])).toBe('HT1/1/2');
    expect(() => alphaStrikeHeatLevel(-1)).toThrowError(RangeError);
  });
});

function weapon(
  id: string,
  flags: ConstructorParameters<typeof WeaponEquipment>[0]['flags'] = [],
  data: Partial<ConstructorParameters<typeof WeaponEquipment>[0]['weapon']> = {},
): WeaponEquipment {
  return new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    flags,
    weapon: { heat: 0, damage: 0, rackSize: 0, ammoType: 'NA', ranges: [0, 0, 0, 0], ...data },
  });
}
