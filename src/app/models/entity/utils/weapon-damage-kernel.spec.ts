// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, WeaponEquipment, resolveWeaponDamage } from '../../equipment.model';
import { buildEquipmentRegistry } from '../../../services/catalogs/equipment-catalog-builder';
import { resolveWeaponDamageFacts, type WeaponDamageFacts } from './weapon-damage-kernel';

describe('weapon damage kernel', () => {
  const fusillade: WeaponDamageFacts = {
    id: 'Fusillade', damage: 6, rackSize: 3, ammoType: 'IATM',
    flags: new Set(['F_MISSILE', 'F_DOUBLE_ONE_SHOT', 'F_ONE_SHOT', 'F_PROTO_WEAPON', 'F_INDIRECT_FIRE']),
    oneShotCount: 2, rapidFireCount: 0,
  };

  it('fires a Fusillade as three missiles of its loaded iATM munition, rolled on the Cluster Hits Table (IO:AE p. 59)', () => {
    expect(resolveWeaponDamageFacts(fusillade, { damagePerShot: 2 })).toEqual({ values: [2], maximum: 6, unit: 'missile' });
    expect(resolveWeaponDamageFacts(fusillade, { damagePerShot: 3 })).toEqual({ values: [3], maximum: 9, unit: 'missile' });
  });

  it('loads a Fusillade with the standard iATM-3 munition unless other ammunition is given', async () => {
    const registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
    const weapon = registry.equipment['Fusillade'] as WeaponEquipment;
    expect(resolveWeaponDamage(weapon, registry)).toEqual(jasmine.objectContaining({ values: [2], maximum: 6, unit: 'missile' }));
    const extendedRange = registry.equipment['Clan Ammo iATM-3 ER'] as AmmoEquipment;
    expect(resolveWeaponDamage(weapon, registry, { ammo: extendedRange }))
      .toEqual(jasmine.objectContaining({ values: [1], maximum: 3, unit: 'missile' }));
  });
});
