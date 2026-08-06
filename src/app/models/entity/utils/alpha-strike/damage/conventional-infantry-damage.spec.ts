// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../../../../equipment-flags.type';
import { type InfantryWeaponEquipment, WeaponEquipment } from '../../../../equipment.model';
import { TestInfantryEntity } from '../../../testing/test-entities';
import { addTestEquipment } from '../../../testing/test-mounted-equipment';
import { calculateConventionalInfantryDamage } from './conventional-infantry-damage';

describe('Conventional infantry damage', () => {
  it('uses field guns without applying a troop factor', () => {
    const entity = new TestInfantryEntity();
    const gun = new WeaponEquipment({
      id: 'field-gun', name: 'Field Gun', type: 'weapon',
      weapon: { damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA' },
    });
    addTestEquipment(entity, gun, { location: 'Field Guns' });
    addTestEquipment(entity, gun, { location: 'Field Guns' });

    expect(calculateConventionalInfantryDamage(entity)).toEqual(jasmine.objectContaining({
      standard: { dmgS: '2', dmgM: '2', dmgL: '2', dmgE: '0' },
      overheat: 0,
      heatSpecials: [],
    }));
  });

  it('returns zero damage for infantry without a ranged infantry weapon', () => {
    const result = calculateConventionalInfantryDamage(new TestInfantryEntity());
    expect(result.standard).toEqual({ dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' });
    expect(result.heatSpecials).toEqual([]);
  });

  it('does not derive HT from a single secondary heat weapon', () => {
    const entity = new TestInfantryEntity();
    entity.primaryWeapon.set(infantryWeapon('rifle', 1));
    entity.secondaryWeapon.set(infantryWeapon('flamer', 0, ['F_FLAMER']));
    entity.secondaryCount.set(1);
    entity.squadSize.set(5);
    entity.squadCount.set(5);

    expect(calculateConventionalInfantryDamage(entity).heatSpecials).toEqual([]);
  });

  it('derives HT from the secondary when it is the combined mount range weapon', () => {
    const entity = new TestInfantryEntity();
    entity.primaryWeapon.set(infantryWeapon('rifle', 0));
    entity.secondaryWeapon.set(infantryWeapon('plasma', 2, ['F_PLASMA']));
    entity.secondaryCount.set(2);
    entity.squadSize.set(5);
    entity.squadCount.set(5);

    expect(calculateConventionalInfantryDamage(entity).heatSpecials).toEqual(['HT1/1/-']);
  });

  it('derives HT from a heat-producing primary range weapon', () => {
    const entity = new TestInfantryEntity();
    entity.primaryWeapon.set(infantryWeapon('primary-flamer', 0, ['F_FLAMER']));
    entity.secondaryWeapon.set(infantryWeapon('secondary-rifle', 0));
    entity.secondaryCount.set(1);
    entity.squadSize.set(5);
    entity.squadCount.set(5);

    expect(calculateConventionalInfantryDamage(entity).heatSpecials).toEqual(['HT1/-/-']);
  });
});

function infantryWeapon(
  id: string,
  range: number,
  flags: EquipmentFlag[] = [],
): InfantryWeaponEquipment {
  return new WeaponEquipment({
    id, name: id, type: 'weapon', flags,
    weapon: { damage: 1, ranges: [1, 2, 3, 4], ammoType: 'NA' },
    infantry: { damage: 0.6, range },
  }) as InfantryWeaponEquipment;
}