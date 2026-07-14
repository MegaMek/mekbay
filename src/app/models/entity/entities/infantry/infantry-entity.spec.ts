import { WeaponEquipment } from '../../../equipment.model';
import { InfantryEntity } from './infantry-entity';

describe('InfantryEntity movement', () => {
  const supportWeapon = new WeaponEquipment({
    id: 'InfantrySupportTest',
    name: 'Infantry Support Test',
    type: 'weapon',
    flags: ['F_INF_SUPPORT'],
    weapon: { ammoType: 'NA' },
  });

  function createInfantry(): InfantryEntity {
    const infantry = new InfantryEntity();
    infantry.originalWalkMP.set(1);
    infantry.originalJumpMP.set(3);
    infantry.secondaryCount.set(2);
    infantry.secondaryWeaponEquipment.set(supportWeapon);
    return infantry;
  }

  it('applies the support weapon movement penalty to ordinary infantry', () => {
    const infantry = createInfantry();

    expect(infantry.walkMP()).toBe(0);
    expect(infantry.jumpMP()).toBe(2);
  });

  it('does not apply the support weapon movement penalty to TAG troops', () => {
    const infantry = createInfantry();
    infantry.specializations.set(new Set(['tag-troops']));

    expect(infantry.walkMP()).toBe(1);
    expect(infantry.jumpMP()).toBe(3);
  });
});