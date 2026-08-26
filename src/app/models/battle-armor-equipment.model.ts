// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';
import { isSneakCamoArmorKit } from './infantry-equipment.model';

export function isAntiPersonnelMountEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_AP_MOUNT') === true;
}

export function isArmoredGloveEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_ARMORED_GLOVE') === true;
}

export function isBattleArmorManipulatorEquipment(
  equipment: Equipment | null | undefined,
): boolean {
  return equipment?.hasFlag('F_BA_MANIPULATOR') === true;
}

export function isBasicManipulatorEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_BASIC_MANIPULATOR') === true;
}

export function isBattleClawEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_BATTLE_CLAW') === true;
}

export function isElectronicInterfaceEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_EI_INTERFACE') === true;
}

export function isMagnetClawEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_MAGNET_CLAW') === true;
}

export function isBattleArmorMinesweeperTools(
  equipment: Equipment | null | undefined,
): boolean {
  return equipment?.hasFlag('F_TOOLS') === true && equipment.hasFlag('S_MINESWEEPER');
}

export function isParafoilEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_PARAFOIL') === true;
}

export function isBattleArmorVtolEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_BA_VTOL') === true;
}

export function isDetachableWeaponPackEquipment(
  equipment: Equipment | null | undefined,
): boolean {
  return equipment?.hasFlag('F_DETACHABLE_WEAPON_PACK') === true;
}

export function isModularWeaponMountEquipment(
  equipment: Equipment | null | undefined,
): boolean {
  return equipment?.hasFlag('F_MODULAR_WEAPON_MOUNT') === true;
}

export function battleArmorEquipmentAlphaStrikeAbility(
  equipment: Equipment | null | undefined,
): 'LMAS' | 'MSW' | 'PAR' | null {
  if (isSneakCamoArmorKit(equipment)) return 'LMAS';
  if (isBattleArmorMinesweeperTools(equipment)) return 'MSW';
  if (isParafoilEquipment(equipment)) return 'PAR';
  return null;
}
