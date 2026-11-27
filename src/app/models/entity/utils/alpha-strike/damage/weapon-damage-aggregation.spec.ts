// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../../../../equipment.model';
import { TestBipedMekEntity } from '../../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../testing/test-mounted-equipment';
import type { EntityMountedWeapon } from '../../../types';
import { alphaStrikeWeaponDamageModifier } from './weapon-damage-aggregation';

describe('Alpha Strike weapon damage aggregation', () => {
  it('applies the actuator enhancement modifier only to weapons in the matching arm', () => {
    const entity = new TestBipedMekEntity();
    const left = weapon(entity, 'LA');
    const right = weapon(entity, 'RA');
    addTestEquipmentWithFlags(entity, 'F_ACTUATOR_ENHANCEMENT_SYSTEM', { location: 'LA' });

    expect(alphaStrikeWeaponDamageModifier(entity, left, [left, right], [], false)).toBe(1.05);
    expect(alphaStrikeWeaponDamageModifier(entity, right, [left, right], [], false)).toBe(1);
  });
});

function weapon(entity: TestBipedMekEntity, location: 'LA' | 'RA'): EntityMountedWeapon {
  return addTestEquipment(entity, new WeaponEquipment({
    id: `laser-${location}`,
    name: `Laser ${location}`,
    type: 'weapon',
    weapon: { damage: 5, rackSize: 0, ranges: [5, 10, 15, 20], ammoType: 'NA' },
  }), { location }) as EntityMountedWeapon;
}
