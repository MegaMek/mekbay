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

// ============================================================================
// Validation Sets & Constants
//
// String sets used to validate parsed values before assignment to entity
// signals. Keeps parser validation separate from entity domain types.
// ============================================================================

/** Valid vehicle motion types — derived from SUSPENSION_FACTOR_TABLE keys */
export const VALID_VEHICLE_MOTION_TYPES = new Set([
  'Tracked', 'Wheeled', 'Hover', 'WiGE',
  'Naval', 'Submarine', 'Hydrofoil',
  'VTOL',
]);

/** Valid infantry motion types */
export const VALID_INFANTRY_MOTION_TYPES = new Set([
  'Leg', 'Motorized', 'Jump', 'Mechanized', 'Submarine',
  'Hover', 'Wheeled', 'Tracked', 'VTOL',
]);

/** Valid BA motion types */
export const VALID_BA_MOTION_TYPES = new Set([
  'Leg', 'Jump', 'VTOL', 'UMU',
]);

/** Valid aero motion types */
export const VALID_AERO_MOTION_TYPES = new Set(['Aerodyne']);

/** Valid DropShip / SmallCraft motion types */
export const VALID_SPACECRAFT_MOTION_TYPES = new Set(['Aerodyne', 'Spheroid']);

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

/** Valid BLK tech-level strings in the `type` block */
export const VALID_TECH_BASE_STRINGS = new Set([
  'IS Level 1', 'IS Level 2', 'IS Level 3', 'IS Level 4', 'IS Level 5',
  'Clan Level 1', 'Clan Level 2', 'Clan Level 3', 'Clan Level 4', 'Clan Level 5',
  'Mixed (IS Chassis) Level 1', 'Mixed (IS Chassis) Level 2', 'Mixed (IS Chassis) Level 3',
  'Mixed (IS Chassis) Level 4', 'Mixed (IS Chassis) Level 5',
  'Mixed (Clan Chassis) Level 1', 'Mixed (Clan Chassis) Level 2', 'Mixed (Clan Chassis) Level 3',
  'Mixed (Clan Chassis) Level 4', 'Mixed (Clan Chassis) Level 5',
  'IS Level 2 (Unofficial)', 'IS Level 3 (Unofficial)',
  'Clan Level 2 (Unofficial)', 'Clan Level 3 (Unofficial)',
  'Mixed (IS Chassis) Level 2 (Unofficial)', 'Mixed (IS Chassis) Level 3 (Unofficial)',
  'Mixed (Clan Chassis) Level 2 (Unofficial)', 'Mixed (Clan Chassis) Level 3 (Unofficial)',
]);

/** Valid BA weight classes */
export const VALID_BA_WEIGHT_CLASSES = new Set([
  'PA(L)', 'Light', 'Medium', 'Heavy', 'Assault',
]);

/** Valid design type codes for DropShips */
export const VALID_DESIGN_TYPE_CODES = new Set([0, 1]);
