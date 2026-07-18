import { InfantryWeaponEquipment, WeaponEquipment } from '../../../equipment.model';
import { TestInfantryEntity as InfantryEntity } from '../../testing/test-entities';

describe('InfantryEntity movement', () => {
  const supportWeapon = infantryWeapon('InfantrySupportTest', ['F_INF_SUPPORT']);

  function createInfantry(): InfantryEntity {
    const infantry = new InfantryEntity();
    infantry.originalWalkMP.set(1);
    infantry.motiveType.set('Jump');
    infantry.secondaryCount.set(2);
    infantry.secondaryWeapon.set(supportWeapon);
    return infantry;
  }

  it('applies the support weapon movement penalty to ordinary infantry', () => {
    const infantry = createInfantry();

    expect(infantry.walkMP()).toBe(1);
    expect(infantry.jumpMP()).toBe(2);
  });

  it('does not apply the support weapon movement penalty to TAG troops', () => {
    const infantry = createInfantry();
    infantry.specializations.set(new Set(['tag-troops']));

    expect(infantry.walkMP()).toBe(1);
    expect(infantry.jumpMP()).toBe(3);
  });
});

function infantryWeapon(id: string, extraFlags: string[] = []): InfantryWeaponEquipment {
  const weapon = new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    flags: ['F_INFANTRY', ...extraFlags],
    weapon: { ammoType: 'NA' },
    infantry: {},
  });
  if (!weapon.isInfantryWeapon()) throw new Error(`${id} is not an infantry weapon`);
  return weapon;
}