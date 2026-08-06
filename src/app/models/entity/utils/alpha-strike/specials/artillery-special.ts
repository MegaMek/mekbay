// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { WeaponEquipment } from '../../../../equipment.model';

const ARTILLERY_ABILITIES: Readonly<Partial<Record<WeaponEquipment['ammoType'], string>>> = {
  LONG_TOM: 'ARTLT',
  SNIPER: 'ARTS',
  THUMPER: 'ARTT',
  LONG_TOM_CANNON: 'ARTLTC',
  SNIPER_CANNON: 'ARTSC',
  THUMPER_CANNON: 'ARTTC',
  BA_TUBE: 'ARTBA',
};

/** Returns the Alpha Strike artillery SUA associated with a weapon type. */
export function alphaStrikeArtilleryAbility(weapon: WeaponEquipment): string | null {
  if (weapon.ammoType === 'ARROW_IV') return weapon.techBase === 'Clan' ? 'ARTAC' : 'ARTAIS';
  if (weapon.ammoType === 'CRUISE_MISSILE') {
    return weapon.rackSize === 50 ? 'ARTCM5' : weapon.rackSize === 70 ? 'ARTCM7'
      : weapon.rackSize === 90 ? 'ARTCM9' : 'ARTCM12';
  }
  return ARTILLERY_ABILITIES[weapon.ammoType] ?? null;
}