// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';

export interface EquipmentPlatformView {
  hasFlag(flag: EquipmentFlag): boolean;
}

export type EquipmentPlatform =
  | 'mek'
  | 'tank'
  | 'protomek'
  | 'battle-armor'
  | 'fighter'
  | 'support-tank'
  | 'vtol';

const PLATFORM_FLAGS: Readonly<Record<EquipmentPlatform, EquipmentFlag>> = Object.freeze({
  mek: 'F_MEK_EQUIPMENT',
  tank: 'F_TANK_EQUIPMENT',
  protomek: 'F_PROTOMEK_EQUIPMENT',
  'battle-armor': 'F_BA_EQUIPMENT',
  fighter: 'F_FIGHTER_EQUIPMENT',
  'support-tank': 'F_SUPPORT_TANK_EQUIPMENT',
  vtol: 'F_VTOL_EQUIPMENT',
});

export function equipmentPlatformFlag(platform: EquipmentPlatform): EquipmentFlag {
  return PLATFORM_FLAGS[platform];
}

export function isEquipmentForPlatform(
  equipment: EquipmentPlatformView | null | undefined,
  platform: EquipmentPlatform,
): boolean {
  return equipment?.hasFlag(PLATFORM_FLAGS[platform]) === true;
}

export function isBattleArmorAmmo(equipment: EquipmentPlatformView | null | undefined): boolean {
  return equipment?.hasFlag('F_BATTLEARMOR') === true;
}

export function hasMekOrTankApplicability(
  equipment: EquipmentPlatformView | null | undefined,
): boolean {
  return isEquipmentForPlatform(equipment, 'mek') || isEquipmentForPlatform(equipment, 'tank');
}
