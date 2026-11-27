// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag, EquipmentFlagsSource } from './equipment-flags.type';

export type EquipmentVariant = 'improved' | 'prototype-subtype' | 'prototype';

const VARIANT_FLAGS: Readonly<Record<EquipmentVariant, EquipmentFlag>> = Object.freeze({
  improved: 'S_IMPROVED',
  'prototype-subtype': 'S_PROTOTYPE',
  prototype: 'F_PROTOTYPE',
});

export function hasEquipmentVariant(
  source: EquipmentFlagsSource | null | undefined,
  variant: EquipmentVariant,
): boolean {
  if (source == null) return false;
  const flag = VARIANT_FLAGS[variant];
  if ('flags' in source) return source.flags.has(flag);
  if ('hasFlag' in source) return source.hasFlag(flag);
  return source.has(flag);
}

export function hasAnyPrototypeVariant(source: EquipmentFlagsSource | null | undefined): boolean {
  return hasEquipmentVariant(source, 'prototype')
    || hasEquipmentVariant(source, 'prototype-subtype');
}
