// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentRegistry } from '../../equipment-lookup';
import { ArmorEquipment } from '../../equipment.model';

// ============================================================================
// Armor Types
//
// The ArmorType enum strings match the `armor.type` field in the equipment
// JSON (which mirrors MegaMek's ArmorType enum names).
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

// ── Armor equipment resolution ──────────────────────────────────────────────

type ArmorIndex = Map<string, { is?: ArmorEquipment; clan?: ArmorEquipment }>;
const armorIndexes = new WeakMap<EquipmentRegistry, ArmorIndex>();

/**
 * Build (or return cached) index mapping ArmorType enum → ArmorEquipment,
 * split by tech base. Each immutable registry owns one cached index.
 */
function getArmorIndex(equipmentRegistry: EquipmentRegistry): ArmorIndex {
  const cached = armorIndexes.get(equipmentRegistry);
  if (cached) return cached;

  const idx: ArmorIndex = new Map();
  for (const eq of Object.values(equipmentRegistry.equipment)) {
    if (!(eq instanceof ArmorEquipment)) continue;
    const aType = eq.armorType; // e.g. 'ALUM', 'STANDARD'
    if (!aType) continue;
    const entry = idx.get(aType) ?? {};
    if (eq.techBase === 'Clan') entry.clan = eq;
    else entry.is = eq; // 'IS' or 'All'
    idx.set(aType, entry);
  }

  armorIndexes.set(equipmentRegistry, idx);
  return idx;
}

/**
 * Resolve the ArmorEquipment for a given ArmorType + tech base.
 * Returns null for PATCHWORK or unknown types.
 */
export function resolveArmorEquipment(
  armorType: ArmorType,
  isClan: boolean,
  equipmentRegistry: EquipmentRegistry,
): ArmorEquipment | null {
  const idx = getArmorIndex(equipmentRegistry);
  const entry = idx.get(armorType);
  if (!entry) return null;
  if (isClan) return entry.clan ?? entry.is ?? null;
  return entry.is ?? entry.clan ?? null;
}

/** Resolve mandatory catalog armor, failing when the equipment database is incomplete. */
export function requireArmorEquipment(
  armorType: ArmorType,
  isClan: boolean,
  equipmentRegistry: EquipmentRegistry,
): ArmorEquipment {
  const armor = resolveArmorEquipment(armorType, isClan, equipmentRegistry);
  if (!armor) {
    throw new Error(
      `Required ${isClan ? 'Clan' : 'Inner Sphere'} ${armorType} armor is missing from the equipment database`,
    );
  }
  return armor;
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
