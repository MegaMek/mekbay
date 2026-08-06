// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment, type AmmoType } from '../../../../equipment.model';
import { alphaStrikeArtilleryAbility } from './artillery-special';

describe('Alpha Strike artillery ability', () => {
  it('distinguishes Clan and Inner Sphere Arrow IV', () => {
    expect(alphaStrikeArtilleryAbility(weapon('arrow-is', 'ARROW_IV', 20, 'IS'))).toBe('ARTAIS');
    expect(alphaStrikeArtilleryAbility(weapon('arrow-clan', 'ARROW_IV', 20, 'Clan'))).toBe('ARTAC');
  });

  it('maps cruise missile rack sizes', () => {
    expect([50, 70, 90, 120].map(rackSize =>
      alphaStrikeArtilleryAbility(weapon(`cruise-${rackSize}`, 'CRUISE_MISSILE', rackSize))))
      .toEqual(['ARTCM5', 'ARTCM7', 'ARTCM9', 'ARTCM12']);
  });

  it('returns null for non-artillery ammunition', () => {
    expect(alphaStrikeArtilleryAbility(weapon('laser', 'NA'))).toBeNull();
  });
});

function weapon(
  id: string,
  ammoType: AmmoType,
  rackSize = 0,
  techBase: 'IS' | 'Clan' = 'IS',
): WeaponEquipment {
  return new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    tech: { base: techBase },
    weapon: { damage: 'artillery', ammoType, rackSize },
  });
}
