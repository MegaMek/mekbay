// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';
import type { EquipmentFlagsSource } from './weapon-traits-kernel';

const WEAPON_ENHANCEMENT_FLAG = 'F_WEAPON_ENHANCEMENT' as const;

export function isWeaponEnhancementEquipment(
  source: EquipmentFlagsSource | null | undefined,
): boolean {
  if (source == null) return false;
  if ('flags' in source) return source.flags.has(WEAPON_ENHANCEMENT_FLAG);
  if ('hasFlag' in source) return source.hasFlag(WEAPON_ENHANCEMENT_FLAG);
  return source.has(WEAPON_ENHANCEMENT_FLAG);
}

/** Catalog-construction boundary; rule consumers should use the semantic predicate. */
export function weaponEnhancementFlag(): EquipmentFlag {
  return WEAPON_ENHANCEMENT_FLAG;
}
