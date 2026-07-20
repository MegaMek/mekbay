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

  it('derives UMU movement from aquatic infantry motive configurations', () => {
    const infantry = new InfantryEntity();
    infantry.motiveType.set('UMU');
    expect(infantry.umuMP()).toBe(1);

    infantry.isMotorizedScuba.set(true);
    expect(infantry.umuMP()).toBe(2);

    infantry.motiveType.set('Submarine');
    expect(infantry.umuMP()).toBe(3);

    infantry.motiveType.set('Beast');
    infantry.mount.set({
      name: 'Aquatic Test Mount',
      size: 'Very Large',
      weight: 1,
      movementPoints: 5,
      movementMode: 'Submarine',
      burstDamage: 0,
      vehicleDamage: 0,
      damageDivisor: 1,
      maxWaterDepth: -1,
      secondaryGroundMP: 0,
      uwEndurance: 1,
    });
    expect(infantry.umuMP()).toBe(5);

    infantry.mount.update(mount => mount && { ...mount, movementMode: 'Leg' });
    expect(infantry.umuMP()).toBe(0);
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