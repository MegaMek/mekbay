/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

/**
 * Armor type encoding/decoding for BLK and MTF formats.
 *
 * BLK stores armor type as an integer code, MTF stores it as a string.
 * Both formats also need tech-base-aware resolution.
 */

/** Map from BLK armor type code → armor name */
export const ARMOR_TYPE_FROM_CODE: Record<number, string> = {
  0: 'Standard',
  1: 'Ferro-Fibrous',
  2: 'Reactive',
  3: 'Reflective',
  4: 'Hardened',
  5: 'Light Ferro-Fibrous',
  6: 'Heavy Ferro-Fibrous',
  7: 'Patchwork',
  8: 'Stealth',
  9: 'Ferro-Lamellor',
  10: 'Primitive',
  11: 'Commercial',
  12: 'Industrial',
  13: 'Heavy Industrial',
  14: 'Ferro-Fibrous Prototype',
  15: 'Impact-Resistant',
  16: 'Heat-Dissipating',
  17: 'Anti-Penetrative Ablation',
  18: 'Ballistic-Reinforced',
  19: 'Ferro-Aluminum',
  20: 'Ferro-Aluminum Prototype',
};

/** Reverse map from armor name → BLK code */
export const ARMOR_TYPE_TO_CODE: Record<string, number> = {};

// Build reverse mapping (initialised once at module load)
for (const [code, name] of Object.entries(ARMOR_TYPE_FROM_CODE)) {
  ARMOR_TYPE_TO_CODE[name] = parseInt(code, 10);
}

/**
 * Convert a BLK armor type integer code to a type name.
 *
 * @param code Integer armor code (0–20+)
 * @returns Armor type name, or 'Standard' for unknown codes
 */
export function armorTypeFromCode(code: number): string {
  return ARMOR_TYPE_FROM_CODE[code] ?? 'Standard';
}

/**
 * Convert an armor type name to a BLK integer code.
 *
 * @param name Armor type name
 * @returns Integer code, or 0 for unknown names
 */
export function armorTypeToCode(name: string): number {
  return ARMOR_TYPE_TO_CODE[name] ?? 0;
}

/** Internal structure type codes (BLK) */
export const STRUCTURE_TYPE_FROM_CODE: Record<number, string> = {
  0: 'Standard',
  1: 'Endo Steel',
  2: 'Endo Steel Prototype',
  3: 'Reinforced',
  4: 'Composite',
  5: 'Industrial',
  6: 'Endo-Composite',
};

export const STRUCTURE_TYPE_TO_CODE: Record<string, number> = {};

for (const [code, name] of Object.entries(STRUCTURE_TYPE_FROM_CODE)) {
  STRUCTURE_TYPE_TO_CODE[name] = parseInt(code, 10);
}

/**
 * Convert a BLK structure type code to name.
 */
export function structureTypeFromCode(code: number): string {
  return STRUCTURE_TYPE_FROM_CODE[code] ?? 'Standard';
}

/**
 * Convert a structure type name to BLK code.
 */
export function structureTypeToCode(name: string): number {
  return STRUCTURE_TYPE_TO_CODE[name] ?? 0;
}

/**
 * Parse an MTF armor string.
 *
 * MTF format: "Standard Armor" or "Ferro-Fibrous Armor (Clan)" or
 * "Patchwork Armor" with per-location types on subsequent lines.
 */
export interface MtfArmorInfo {
  type: string;
  clanTech: boolean;
  patchwork: boolean;
}

export function parseMtfArmor(mtfArmor: string): MtfArmorInfo {
  const result: MtfArmorInfo = {
    type: 'Standard',
    clanTech: false,
    patchwork: false,
  };

  const trimmed = mtfArmor.trim();

  // Check for (Clan) or (Inner Sphere) suffix
  if (trimmed.includes('(Clan)')) {
    result.clanTech = true;
  }

  // Check for patchwork
  if (trimmed.toLowerCase().includes('patchwork')) {
    result.type = 'Patchwork';
    result.patchwork = true;
    return result;
  }

  // Remove " Armor" suffix and tech base parenthetical
  let typeName = trimmed
    .replace(/\s*\(Clan\)/i, '')
    .replace(/\s*\(Inner Sphere\)/i, '')
    .replace(/\s*\(IS\)/i, '')
    .replace(/\s*Armor$/i, '')
    .trim();

  if (!typeName) {
    typeName = 'Standard';
  }

  result.type = typeName;
  return result;
}

/**
 * Format armor info into an MTF armor string.
 */
export function formatMtfArmor(type: string, clanTech: boolean): string {
  let result = type;
  // Ensure "Armor" suffix
  if (!result.toLowerCase().endsWith('armor')) {
    result += ' Armor';
  }
  if (clanTech) {
    result += ' (Clan)';
  }
  return result;
}
