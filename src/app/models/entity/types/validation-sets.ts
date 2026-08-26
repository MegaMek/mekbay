// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

// ============================================================================
// Validation Sets & Constants
//
// String sets used to validate parsed values before assignment to entity
// signals. Keeps parser validation separate from entity domain types.
// ============================================================================

/** Valid fuel types for vehicles */
export const VALID_FUEL_TYPES = new Set([
  'PETROCHEMICALS', 'ALCOHOL', 'NATURAL_GAS', 'COAL', 'WOOD',
  'METHANE', 'KEROSENE', 'DIESEL', 'GASOLINE',
]);

/** Canonical system manufacturer/model keys (from MegaMek's System enum) */
export type SystemManufacturerKey = 'CHASSIS' | 'ENGINE' | 'ARMOR' | 'JUMP_JET' | 'COMMUNICATIONS' | 'TARGETING';

/** The 6 canonical keys */
export const VALID_SYSTEM_MANUFACTURER_KEYS = new Set<SystemManufacturerKey>([
  'CHASSIS', 'ENGINE', 'ARMOR', 'JUMP_JET', 'COMMUNICATIONS', 'TARGETING',
]);

/**
 * Normalize variant key forms to canonical keys.
 * MegaMek-resaved files always use the uppercase canonical form, but older
 * hand-edited files or third-party tools might use mixed-case variants.
 * Returns the canonical key, or `undefined` if unrecognized.
 */
export const SYSTEM_MANUFACTURER_KEY_ALIASES: Record<string, SystemManufacturerKey> = {
  // Canonical (identity)
  'CHASSIS':        'CHASSIS',
  'ENGINE':         'ENGINE',
  'ARMOR':          'ARMOR',
  'JUMP_JET':       'JUMP_JET',
  'COMMUNICATIONS': 'COMMUNICATIONS',
  'TARGETING':      'TARGETING',
  // Mixed-case variants
  'JUMPJET':        'JUMP_JET',
};

export function normalizeSystemManufacturerKey(raw: string): SystemManufacturerKey | undefined {
  return SYSTEM_MANUFACTURER_KEY_ALIASES[raw];
}

/**
 * BLK `type` values accepted by MegaMek's BLKFile.setTechLevel().
 *
 * Mixed-tech values use named rules-level suffixes rather than the numeric
 * `Level N` form used by IS and Clan values.
 */
export const VALID_TECH_BASE_STRINGS = new Set([
  'IS',
  'IS Level 1', 'IS Level 2', 'IS Level 3', 'IS Level 4', 'IS Level 5',
  'Clan',
  'Clan Level 2', 'Clan Level 3', 'Clan Level 4', 'Clan Level 5',
  'Mixed (IS Chassis)',
  'Mixed (IS Chassis) Advanced',
  'Mixed (IS Chassis) Experimental',
  'Mixed (IS Chassis) Unofficial',
  'Mixed (Clan Chassis)',
  'Mixed (Clan Chassis) Advanced',
  'Mixed (Clan Chassis) Experimental',
  'Mixed (Clan Chassis) Unofficial',
]);

/** Valid BA weight classes */
export const VALID_BA_WEIGHT_CLASSES = new Set([
  'PA(L)', 'Light', 'Medium', 'Heavy', 'Assault',
]);

/** Valid design type codes for DropShips */
export const VALID_DESIGN_TYPE_CODES = new Set([0, 1]);
