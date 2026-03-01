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

import { ArmorEquipment, EquipmentMap } from '../../equipment.model';
import { ComponentTechLevel } from './tech';

// ============================================================================
// Armor Types
//
// The ArmorType enum strings match the `armor.type` field in the equipment
// JSON (which mirrors MegaMek's ArmorType enum names).  The BLK format only
// stores a numeric code; the mapping below converts in both directions.
// ============================================================================

/**
 * Armor type identifiers.  Values are the MegaMek ArmorType enum names and
 * match the `armor.type` field in the equipment JSON, with the addition of
 * PATCHWORK which has no standalone equipment entry.
 */
export type ArmorType =
  | 'STANDARD'
  | 'FERRO_FIBROUS'
  | 'REACTIVE'
  | 'REFLECTIVE'
  | 'HARDENED'
  | 'LIGHT_FERRO'
  | 'HEAVY_FERRO'
  | 'PATCHWORK'
  | 'STEALTH'
  | 'FERRO_FIBROUS_PROTO'
  | 'COMMERCIAL'
  | 'LC_FERRO_CARBIDE'
  | 'LC_LAMELLOR_FERRO_CARBIDE'
  | 'LC_FERRO_IMP'
  | 'INDUSTRIAL'
  | 'HEAVY_INDUSTRIAL'
  | 'FERRO_LAMELLOR'
  | 'PRIMITIVE'
  | 'EDP'
  | 'ALUM'
  | 'HEAVY_ALUM'
  | 'LIGHT_ALUM'
  | 'STEALTH_VEHICLE'
  | 'ANTI_PENETRATIVE_ABLATION'
  | 'HEAT_DISSIPATING'
  | 'IMPACT_RESISTANT'
  | 'BALLISTIC_REINFORCED'
  | 'FERRO_ALUM_PROTO'
  | 'BA_STANDARD'
  | 'BA_STANDARD_PROTOTYPE'
  | 'BA_STANDARD_ADVANCED'
  | 'BA_STEALTH_BASIC'
  | 'BA_STEALTH'
  | 'BA_STEALTH_IMP'
  | 'BA_STEALTH_PROTOTYPE'
  | 'BA_FIRE_RESIST'
  | 'BA_MIMETIC'
  | 'BA_REFLECTIVE'
  | 'BA_REACTIVE'
  | 'PRIMITIVE_FIGHTER'
  | 'PRIMITIVE_AERO'
  | 'AEROSPACE'
  | 'STANDARD_PROTOMEK'
  | 'SV_BAR_2'
  | 'SV_BAR_3'
  | 'SV_BAR_4'
  | 'SV_BAR_5'
  | 'SV_BAR_6'
  | 'SV_BAR_7'
  | 'SV_BAR_8'
  | 'SV_BAR_9'
  | 'SV_BAR_10';

/** Map from BLK armor type code → ArmorType enum */
export const ARMOR_TYPE_FROM_CODE: Record<number, ArmorType> = {
  0:  'STANDARD',
  1:  'FERRO_FIBROUS',
  2:  'REACTIVE',
  3:  'REFLECTIVE',
  4:  'HARDENED',
  5:  'LIGHT_FERRO',
  6:  'HEAVY_FERRO',
  7:  'PATCHWORK',
  8:  'STEALTH',
  9:  'FERRO_FIBROUS_PROTO',
  10: 'COMMERCIAL',
  11: 'LC_FERRO_CARBIDE',
  12: 'LC_LAMELLOR_FERRO_CARBIDE',
  13: 'LC_FERRO_IMP',
  14: 'INDUSTRIAL',
  15: 'HEAVY_INDUSTRIAL',
  16: 'FERRO_LAMELLOR',
  17: 'PRIMITIVE',
  18: 'EDP',
  19: 'ALUM',
  20: 'HEAVY_ALUM',
  21: 'LIGHT_ALUM',
  22: 'STEALTH_VEHICLE',
  23: 'ANTI_PENETRATIVE_ABLATION',
  24: 'HEAT_DISSIPATING',
  25: 'IMPACT_RESISTANT',
  26: 'BALLISTIC_REINFORCED',
  27: 'FERRO_ALUM_PROTO',
  28: 'BA_STANDARD',
  29: 'BA_STANDARD_PROTOTYPE',
  30: 'BA_STANDARD_ADVANCED',
  31: 'BA_STEALTH_BASIC',
  32: 'BA_STEALTH',
  33: 'BA_STEALTH_IMP',
  34: 'BA_STEALTH_PROTOTYPE',
  35: 'BA_FIRE_RESIST',
  36: 'BA_MIMETIC',
  37: 'BA_REFLECTIVE',
  38: 'BA_REACTIVE',
  39: 'PRIMITIVE_FIGHTER',
  40: 'PRIMITIVE_AERO',
  41: 'AEROSPACE',
  42: 'STANDARD_PROTOMEK',
  43: 'SV_BAR_2',
  44: 'SV_BAR_3',
  45: 'SV_BAR_4',
  46: 'SV_BAR_5',
  47: 'SV_BAR_6',
  48: 'SV_BAR_7',
  49: 'SV_BAR_8',
  50: 'SV_BAR_9',
  51: 'SV_BAR_10',
};

/** Reverse map from ArmorType enum → BLK numeric code */
export const ARMOR_TYPE_TO_CODE: Record<string, number> = Object.fromEntries(
  Object.entries(ARMOR_TYPE_FROM_CODE).map(([code, name]) => [name, parseInt(code, 10)])
);

export function armorTypeFromCode(code: number): ArmorType {
  return ARMOR_TYPE_FROM_CODE[code] ?? 'STANDARD';
}

export function armorTypeToCode(type: ArmorType): number {
  return ARMOR_TYPE_TO_CODE[type] ?? 0;
}

// ── Armor tech helpers (derive from ArmorEquipment data) ────────────────────

/** Convert a tech rating letter (A–F) to its numeric index (0–5). */
export const TECH_RATING_TO_NUMBER: Record<string, number> = {
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5,
};

/**
 * Compound tech level as written to BLK `armor_tech_level`.
 * Mirrors `SimpleTechLevel.getCompoundTechLevel(isClan)` in MegaMek.
 *
 * | TechLevel      | IS | Clan |
 * |----------------|----|------|
 * | Introductory   |  0 |    0 |
 * | Standard       |  1 |    2 |
 * | Advanced       |  5 |    6 |
 * | Experimental   |  7 |    8 |
 */
export function compoundTechLevel(level: ComponentTechLevel | undefined, isClan: boolean): number {
  switch (level) {
    case 'Introductory':  return 0;
    case 'Standard':      return isClan ? 2 : 1;
    case 'Advanced':      return isClan ? 6 : 5;
    case 'Experimental':  return isClan ? 8 : 7;
    default:              return isClan ? 2 : 1; // safe fallback
  }
}

// ── Armor equipment resolution ──────────────────────────────────────────────

/** Lazily built index: ArmorType → { is?: ArmorEquipment, clan?: ArmorEquipment } */
let _armorIndex: Map<string, { is?: ArmorEquipment; clan?: ArmorEquipment }> | null = null;
let _armorIndexDb: EquipmentMap | null = null;

/**
 * Build (or return cached) index mapping ArmorType enum → ArmorEquipment,
 * split by tech base.  Rebuilt when the underlying equipment DB changes.
 */
export function getArmorIndex(
  equipmentDb: EquipmentMap,
): Map<string, { is?: ArmorEquipment; clan?: ArmorEquipment }> {
  if (_armorIndex && _armorIndexDb === equipmentDb) return _armorIndex;

  const idx = new Map<string, { is?: ArmorEquipment; clan?: ArmorEquipment }>();
  for (const eq of Object.values(equipmentDb)) {
    if (!(eq instanceof ArmorEquipment)) continue;
    const aType = eq.armorType; // e.g. 'ALUM', 'STANDARD'
    if (!aType) continue;
    const entry = idx.get(aType) ?? {};
    if (eq.techBase === 'Clan') entry.clan = eq;
    else entry.is = eq; // 'IS' or 'All'
    idx.set(aType, entry);
  }

  _armorIndex = idx;
  _armorIndexDb = equipmentDb;
  return idx;
}

/**
 * Resolve the ArmorEquipment for a given ArmorType + tech base.
 * Returns null for PATCHWORK or unknown types.
 */
export function resolveArmorEquipment(
  armorType: ArmorType,
  isClan: boolean,
  equipmentDb: EquipmentMap,
): ArmorEquipment | null {
  const idx = getArmorIndex(equipmentDb);
  const entry = idx.get(armorType);
  if (!entry) return null;
  if (isClan) return entry.clan ?? entry.is ?? null;
  return entry.is ?? entry.clan ?? null;
}

/**
 * Resolve ArmorEquipment by display name (e.g. "Ferro-Fibrous" from MTF).
 * Searches the equipment DB for an ArmorEquipment with a matching `name`.
 */
export function resolveArmorByName(
  displayName: string,
  isClan: boolean,
  equipmentDb: EquipmentMap,
): ArmorEquipment | null {
  const normalizedName = displayName.trim();
  let best: ArmorEquipment | null = null;
  for (const eq of Object.values(equipmentDb)) {
    if (!(eq instanceof ArmorEquipment)) continue;
    if (eq.name.trim() !== normalizedName) continue;
    // Prefer matching tech base
    if (isClan && eq.techBase === 'Clan') return eq;
    if (!isClan && eq.techBase !== 'Clan') return eq;
    best = eq; // fallback to any match
  }
  return best;
}

// ============================================================================
// Armor structured face model
// ============================================================================

/** Which face of armor we are referencing */
export type ArmorFace = 'front' | 'rear';

/** Armor values for a single location. Rear is 0 for locations without rear armor. */
export interface LocationArmor {
  readonly front: number;
  readonly rear: number;
}

/** Create a LocationArmor, defaulting rear to 0 */
export function locationArmor(front: number, rear = 0): LocationArmor {
  return { front, rear };
}
