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
// Weight Class
// ============================================================================

/**
 * Weight-class categories for all entity types.
 *
 * Mirrors Java's `EntityWeightClass` constants as self-documenting strings.
 * Use {@link weightClassOrdinal} when numeric comparison is needed.
 */
export type WeightClass =
  // Generic (Mek, Vehicle, BA, ProtoMek, Aero, Infantry, GunEmplacement)
  | 'Ultra Light'       // Java ordinal 0
  | 'Light'             // 1
  | 'Medium'            // 2
  | 'Heavy'             // 3
  | 'Assault'           // 4
  | 'Super Heavy'       // 5
  // Small Craft
  | 'Small Craft'       // 6
  // DropShip
  | 'Small DropShip'    // 7
  | 'Medium DropShip'   // 8
  | 'Large DropShip'    // 9
  // Capital ships (JumpShip, WarShip, SpaceStation)
  | 'Small Capital'     // 10
  | 'Large Capital'     // 11
  // Support vehicles
  | 'Small Support'     // 12
  | 'Medium Support'    // 13
  | 'Large Support';    // 14

// ── Ordinal map (mirrors Java EntityWeightClass int constants) ────────────

const WEIGHT_CLASS_ORDINAL: Readonly<Record<WeightClass, number>> = {
  'Ultra Light': 0,
  'Light': 1,
  'Medium': 2,
  'Heavy': 3,
  'Assault': 4,
  'Super Heavy': 5,
  'Small Craft': 6,
  'Small DropShip': 7,
  'Medium DropShip': 8,
  'Large DropShip': 9,
  'Small Capital': 10,
  'Large Capital': 11,
  'Small Support': 12,
  'Medium Support': 13,
  'Large Support': 14,
};

/** Get the ordinal value for a weight class (matches Java int constants). */
export function weightClassOrdinal(wc: WeightClass): number {
  return WEIGHT_CLASS_ORDINAL[wc];
}

/** Returns `true` if `wc` is at least as heavy as `threshold`. */
export function weightClassAtLeast(wc: WeightClass, threshold: WeightClass): boolean {
  return WEIGHT_CLASS_ORDINAL[wc] >= WEIGHT_CLASS_ORDINAL[threshold];
}

/** Returns `true` if `wc` is strictly lighter than `threshold`. */
export function weightClassBelow(wc: WeightClass, threshold: WeightClass): boolean {
  return WEIGHT_CLASS_ORDINAL[wc] < WEIGHT_CLASS_ORDINAL[threshold];
}

// ── Weight-class resolution tables ──────────────────────────────────────

/** Tonnage upper limit → weight class.  Checked in order; first match wins. */
export type WeightClassLimit = readonly [number, WeightClass];

/** Resolve tonnage to a weight class using a limit table. */
export function resolveWeightClass(
  tonnage: number,
  limits: readonly WeightClassLimit[],
): WeightClass {
  for (const [limit, wc] of limits) {
    if (tonnage <= limit) return wc;
  }
  return limits[limits.length - 1][1];
}

export const MEK_WEIGHT_LIMITS: readonly WeightClassLimit[] = [
  [15,  'Ultra Light'],
  [35,  'Light'],
  [55,  'Medium'],
  [75,  'Heavy'],
  [100, 'Assault'],
  [135, 'Super Heavy'],
];

export const VEHICLE_WEIGHT_LIMITS: readonly WeightClassLimit[] = [
  [39,  'Light'],
  [59,  'Medium'],
  [79,  'Heavy'],
  [100, 'Assault'],
  [300, 'Super Heavy'],
];

export const GUN_EMPLACEMENT_WEIGHT_LIMITS: readonly WeightClassLimit[] = [
  [15,  'Light'],
  [40,  'Medium'],
  [90,  'Heavy'],
  [150, 'Assault'],
];

export const ASF_WEIGHT_LIMITS: readonly WeightClassLimit[] = [
  [45,  'Light'],
  [70,  'Medium'],
  [100, 'Heavy'],
];

export const DROPSHIP_WEIGHT_LIMITS: readonly WeightClassLimit[] = [
  [2499,   'Small DropShip'],
  [9999,   'Medium DropShip'],
  [100000, 'Large DropShip'],
];

export const CAPITAL_SHIP_WEIGHT_LIMITS: readonly WeightClassLimit[] = [
  [749999,  'Small Capital'],
  [2500000, 'Large Capital'],
];

export const PROTOMEK_WEIGHT_LIMITS: readonly WeightClassLimit[] = [
  [3,  'Light'],
  [5,  'Medium'],
  [7,  'Heavy'],
  [9,  'Assault'],
  [10, 'Super Heavy'],
];

export const BA_WEIGHT_LIMITS: readonly WeightClassLimit[] = [
  [0.4,  'Ultra Light'],
  [0.75, 'Light'],
  [1,    'Medium'],
  [1.5,  'Heavy'],
  [2,    'Assault'],
];

// ── Support vehicle limits by motive type ────────────────────────────────

const LESS_THAN_5 = 5 - Number.EPSILON;

export const SUPPORT_VEHICLE_WEIGHT_LIMITS: Readonly<Record<string, readonly WeightClassLimit[]>> = {
  'Wheeled':         [[LESS_THAN_5, 'Small Support'], [80,     'Medium Support'], [160,    'Large Support']],
  'Tracked':         [[LESS_THAN_5, 'Small Support'], [100,    'Medium Support'], [200,    'Large Support']],
  'Hover':           [[LESS_THAN_5, 'Small Support'], [50,     'Medium Support'], [100,    'Large Support']],
  'VTOL':            [[LESS_THAN_5, 'Small Support'], [30,     'Medium Support'], [60,     'Large Support']],
  'WiGE':            [[LESS_THAN_5, 'Small Support'], [80,     'Medium Support'], [160,    'Large Support']],
  'Naval':           [[LESS_THAN_5, 'Small Support'], [300,    'Medium Support'], [100000, 'Large Support']],
  'Hydrofoil':       [[LESS_THAN_5, 'Small Support'], [300,    'Medium Support'], [100000, 'Large Support']],
  'Submarine':       [[LESS_THAN_5, 'Small Support'], [300,    'Medium Support'], [100000, 'Large Support']],
  'Rail':            [[LESS_THAN_5, 'Small Support'], [300,    'Medium Support'], [600,    'Large Support']],
  'MagLev':          [[LESS_THAN_5, 'Small Support'], [300,    'Medium Support'], [600,    'Large Support']],
  'Aerodyne':        [[LESS_THAN_5, 'Small Support'], [100,    'Medium Support'], [200,    'Large Support']],
  'Airship':         [[LESS_THAN_5, 'Small Support'], [300,    'Medium Support'], [1000,   'Large Support']],
  'Station Keeping': [[LESS_THAN_5, 'Small Support'], [100,    'Medium Support'], [300,    'Large Support']],
};

// ── BA BLK numeric code ↔ WeightClass mapping ───────────────────────────

/** Maps BA BLK numeric codes (0–4) to WeightClass values. */
export const BA_WEIGHT_CLASS_BY_CODE: readonly WeightClass[] = [
  'Ultra Light', 'Light', 'Medium', 'Heavy', 'Assault',
];
