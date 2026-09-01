// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
  it('uses exported Alpha Strike heat damage without CBT weapon inference', () => {
    expect(alphaStrikeHeatDamageForWeapon(weapon('flamer', ['F_FLAMER'], {
      alphaStrike: { heatDamage: [2, 0, 0, 0] },
    }))).toEqual([2, 0, 0]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('plasma', ['F_PLASMA'], {
      alphaStrike: { heatDamage: [7, 7, 7, 0] },
    }))).toEqual([7, 7, 7]);
  });

  it('returns no heat damage when no Alpha Strike override is exported', () => {
    expect(alphaStrikeHeatDamageForWeapon(weapon('laser'))).toEqual([0, 0, 0]);
    expect(alphaStrikeHeatDamageForWeapon(weapon('flamer', ['F_FLAMER']))).toEqual([0, 0, 0]);
  });

  it('sums eligible mounts and excludes other locations', () => {
    const entity = new BipedMekEntity();
    const heatDamage = { alphaStrike: { heatDamage: [2, 0, 0, 0] as [number, number, number, number] } };
    const front = addTestEquipment(entity, weapon('flamer', ['F_FLAMER'], heatDamage), { location: 'RA' });
    addTestEquipment(entity, weapon('rear-flamer', ['F_FLAMER'], heatDamage), { location: 'RT', rearMounted: true });

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
