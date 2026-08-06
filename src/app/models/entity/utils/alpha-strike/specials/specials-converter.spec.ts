// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../../../../equipment.model';
import { TestVtolEntity as VtolEntity } from '../../../testing/test-entities';
import { addTestEquipment } from '../../../testing/test-mounted-equipment';
import { alphaStrikeSpecialsForEntity } from './specials-converter';

describe('Alpha Strike special composition', () => {
  it('composes non-arced entity, core, weapon, turret, heat, and OVL specials once in sorted order', () => {
    const entity = new VtolEntity();
    addTestEquipment(entity, weapon('front-tag', ['F_TAG']), { location: 'Front' });
    addTestEquipment(entity, weapon('turret-ams', ['F_AMS']), { location: 'Turret' });

    expect(alphaStrikeSpecialsForEntity(entity, context(false))).toEqual([
      'AMS', 'ATMO', 'ENE', 'HT1/-/-', 'LTAG', 'OVL', 'SRCH', 'TUR(AMS)',
    ]);
  });

  it('suppresses global weapon and turret specials for arced entities', () => {
    const entity = new VtolEntity();
    addTestEquipment(entity, weapon('front-tag', ['F_TAG']), { location: 'Front' });
    addTestEquipment(entity, weapon('turret-ams', ['F_AMS']), { location: 'Turret' });

    expect(alphaStrikeSpecialsForEntity(entity, context(true))).toEqual([
      'ATMO', 'ENE', 'HT1/-/-', 'OVL', 'SRCH',
    ]);
  });
});

function context(usesArcs: boolean) {
  return {
    type: 'CV' as const,
    size: 2,
    movement: { values: { v: 10 }, primary: 'v' },
    usesArcs,
    usesArcedDamage: usesArcs,
    hasStandardDamage: true,
    heatSpecials: ['HT1/-/-', 'HT1/-/-'],
    overheatLong: true,
  };
}

function weapon(
  id: string,
  flags: ConstructorParameters<typeof WeaponEquipment>[0]['flags'],
): WeaponEquipment {
  return new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    flags,
    weapon: { damage: 0, ranges: [0, 0, 0, 0], ammoType: 'NA' },
  });
}