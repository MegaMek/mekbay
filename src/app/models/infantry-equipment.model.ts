// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';

export interface InfantryArmorKitProfile {
  readonly encumbering: boolean;
  readonly spaceSuit: boolean;
  readonly dest: boolean;
  readonly sneakCamo: boolean;
  readonly sneakIr: boolean;
  readonly sneakEcm: boolean;
}

export function isAntiMekGearEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_ANTI_MEK_GEAR') === true;
}

export function isArmorKitEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_ARMOR_KIT') === true;
}

export function infantryArmorKitProfile(
  equipment: Equipment | null | undefined,
): InfantryArmorKitProfile | null {
  if (!isArmorKitEquipment(equipment)) return null;
  return Object.freeze({
    encumbering: equipment!.hasFlag('S_ENCUMBERING'),
    spaceSuit: equipment!.hasFlag('S_SPACE_SUIT'),
    dest: equipment!.hasFlag('S_DEST'),
    sneakCamo: equipment!.hasFlag('S_SNEAK_CAMO'),
    sneakIr: equipment!.hasFlag('S_SNEAK_IR'),
    sneakEcm: equipment!.hasFlag('S_SNEAK_ECM'),
  });
}

export function isSneakCamoArmorKit(equipment: Equipment | null | undefined): boolean {
  return infantryArmorKitProfile(equipment)?.sneakCamo === true;
}

export function isSpaceAdaptationEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_SPACE_ADAPTATION') === true;
}
