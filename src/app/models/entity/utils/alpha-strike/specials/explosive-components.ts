/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 */

import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';

const NON_EXPLOSIVE_AMMO_TYPES = new Set(['LIGHT_NGAUSS', 'MED_NGAUSS', 'HEAVY_NGAUSS']);

/** Returns whether a mounted component prevents the Alpha Strike ENE ability. */
export function blocksExplosiveNullification(
  mount: ReturnType<BaseEntity['equipment']>[number],
): boolean {
  const equipment = mount.equipment;
  if (!equipment || mount.location === 'Unallocated') return false;
  if (equipment instanceof MiscEquipment) {
    return equipment.hasAnyFlag(['F_BOMB_BAY', 'F_BOOBY_TRAP']);
  }
  if (!equipment.isExplosive()) return false;
  if (equipment instanceof WeaponEquipment) return equipment.weapon.explosionDamage > 0;
  if (equipment instanceof AmmoEquipment) {
    return !NON_EXPLOSIVE_AMMO_TYPES.has(equipment.ammoType)
      && (mount.shotsCount ?? equipment.shots) > 0 && equipment.damagePerShot > 0;
  }
  return false;
}

/** Returns whether any installed component prevents the Alpha Strike ENE ability. */
export function hasExplosiveComponent(entity: BaseEntity): boolean {
  return entity.equipment().some(blocksExplosiveNullification);
}