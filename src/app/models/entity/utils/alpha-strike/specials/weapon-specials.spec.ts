import { AmmoEquipment, WeaponEquipment } from '../../../../equipment.model';
import {
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestInfantryEntity as InfantryEntity,
  TestTankEntity as TankEntity,
} from '../../../testing/test-entities';
import { addTestEquipment } from '../../../testing/test-mounted-equipment';
import { alphaStrikeWeaponSpecials } from './weapon-specials';

describe('Alpha Strike weapon specials', () => {
  it('converts canonical discrete weapon abilities without equipment-name lookup', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('tag', ['F_TAG'], { ranges: [6, 12, 18, 24] }));
    addTestEquipment(entity, weapon('ams', ['F_AMS']));
    addTestEquipment(entity, weapon('inarc', [], { ammoType: 'INARC' }));
    addTestEquipment(entity, weapon('artillery', ['F_ARTILLERY'], {
      ammoType: 'SNIPER', damage: 'artillery', rackSize: 0,
    }));

    expect(alphaStrikeWeaponSpecials(entity)).toEqual(['AMS', 'ARTS-1', 'INARC1', 'TAG']);
  });

  it('derives LRM, IF, and rear damage from canonical ammo, range, and mount orientation', () => {
    const entity = new BipedMekEntity();
    const lrm = weapon('lrm20', ['F_LRM', 'F_MISSILE'], {
      ammoType: 'LRM', damage: 'cluster', rackSize: 20, ranges: [7, 14, 21, 28],
    });
    addTestEquipment(entity, lrm, { location: 'RA' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'lrm-ammo', name: 'LRM Ammo', type: 'ammo', ammo: { type: 'LRM', rackSize: 20, shots: 20 },
    }), { location: 'RT', shotsCount: 20 });
    addTestEquipment(entity, weapon('rear-laser', [], {
      damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA',
    }), { location: 'RT', rearMounted: true });

    expect(alphaStrikeWeaponSpecials(entity)).toEqual(['IF1', 'LRM1/1/1', 'REAR1/1/1']);
  });

  it('uses dashes, rather than zeroes or minimum damage, in ordinary special vectors', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('ac10', ['F_BALLISTIC'], {
      ammoType: 'AC', damage: 10, rackSize: 10, ranges: [5, 10, 10, 10],
    }), { location: 'RA' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'ac-ammo', name: 'AC Ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 10, shots: 10 },
    }), { location: 'RT', shotsCount: 10 });

    expect(alphaStrikeWeaponSpecials(entity)).toEqual(['AC1/1/-']);
  });

  it('scopes damage and discrete abilities to the vehicle turret', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, weapon('turret-lrm', ['F_LRM', 'F_MISSILE', 'F_TAG'], {
      ammoType: 'LRM', damage: 'cluster', rackSize: 20, ranges: [7, 14, 21, 28],
    }), { location: 'Turret' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'turret-lrm-ammo', name: 'Turret LRM Ammo', type: 'ammo',
      ammo: { type: 'LRM', rackSize: 20, shots: 20 },
    }), { location: 'Body', shotsCount: 20 });

    expect(alphaStrikeWeaponSpecials(entity, 'turret')).toEqual(['IF1', 'LRM1/1/1', 'TAG']);
  });

  it('uses physical vehicle rear locations when constructing REAR', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, weapon('rear-laser', [], {
      damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA',
    }), { location: 'Rear' });

    expect(alphaStrikeWeaponSpecials(entity)).toContain('REAR1/1/1');
  });

  it('emits AM only for canonical InfantryAttack-equivalent weapons', () => {
    const battleArmor = new BattleArmorEntity();
    const infantry = new InfantryEntity();
    const rifle = new WeaponEquipment({
      id: 'rifle', name: 'Rifle', type: 'weapon', flags: ['F_INFANTRY'],
      weapon: { damage: 0, rackSize: 0, ranges: [0, 0, 0, 0], ammoType: 'NA' },
      infantry: { damage: 0.2, range: 1 },
    });
    addTestEquipment(battleArmor, rifle, { location: 'Squad' });
    addTestEquipment(infantry, rifle, { location: 'Field Guns' });

    expect(alphaStrikeWeaponSpecials(battleArmor)).toContain('AM');
    expect(alphaStrikeWeaponSpecials(infantry)).toContain('AM');

    const vehicle = new TankEntity();
    addTestEquipment(vehicle, rifle, { location: 'Front' });
    expect(alphaStrikeWeaponSpecials(vehicle)).not.toContain('AM');
  });

  it('aggregates artillery counts with Alpha Strike hyphenated notation', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('sniper-1', ['F_ARTILLERY'], {
      ammoType: 'SNIPER', damage: 'artillery', rackSize: 0,
    }));
    addTestEquipment(entity, weapon('sniper-2', ['F_ARTILLERY'], {
      ammoType: 'SNIPER', damage: 'artillery', rackSize: 0,
    }));

    expect(alphaStrikeWeaponSpecials(entity)).toContain('ARTS-2');
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
    weapon: { damage: 0, rackSize: 0, ranges: [0, 0, 0, 0], ammoType: 'NA', ...data },
  });
}
