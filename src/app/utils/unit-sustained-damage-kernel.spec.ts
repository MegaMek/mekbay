// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { maximumGroundSustainedWeaponDamage } from './unit-sustained-damage-kernel';

describe('unit sustained-damage kernel', () => {
  it('does not count a machine-gun array as another weapon', () => {
    expect(maximumGroundSustainedWeaponDamage({
      id: 'ISMGA', damage: 2, rackSize: 0, ammoType: 'NA', flags: new Set(['F_MGA']),
    })).toBe(0);
  });

  it('uses the strongest installed ATM munition and the canonical fallback', () => {
    const profile = {
      id: 'CLATM6', damage: 'cluster' as const, rackSize: 6, ammoType: 'ATM', flags: new Set<string>(),
    };
    expect(maximumGroundSustainedWeaponDamage(profile)).toBe(12);
    expect(maximumGroundSustainedWeaponDamage({ ...profile, ammoDamagePerShot: 3 })).toBe(18);
  });

  it('does not invent damage for unresolved variable profiles', () => {
    expect(maximumGroundSustainedWeaponDamage({
      id: 'ISMediumVSPLaser', damage: 'variable', rackSize: 9, ammoType: 'NA', flags: new Set(),
    })).toBe(0);
  });
});
