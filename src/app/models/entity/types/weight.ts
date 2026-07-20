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

import type { MotiveType } from './motive';

/** Weight-class codes in the order defined by Java's `EntityWeightClass`. */
export const WEIGHT_CLASSES = [
  'Ultra Light',
  'Light',
  'Medium',
  'Heavy',
  'Assault',
  'Super Heavy',
  'Small Craft',
  'Small DropShip',
  'Medium DropShip',
  'Large DropShip',
  'Small Capital',
  'Large Capital',
  'Small Support',
  'Medium Support',
  'Large Support',
] as const;

export type WeightClass = typeof WEIGHT_CLASSES[number];

/** Get the numeric BLK/Java code for a weight class. */
export function weightClassCode(weightClass: WeightClass): number {
  return WEIGHT_CLASSES.indexOf(weightClass);
}

// ── Weight-class resolution tables ──────────────────────────────────────

/** An inclusive tonnage upper bound and its resulting weight class. */
export interface WeightBand<T extends WeightClass = WeightClass> {
  readonly maxInclusive: number;
  readonly weightClass: T;
}

/** Ordered weight bands with an explicit class for values beyond every band. */
export interface WeightClassTable<T extends WeightClass = WeightClass> {
  readonly bands: readonly WeightBand<T>[];
  readonly fallback: T;
}

/** Resolve tonnage using the first matching band. */
export function resolveWeightClass<T extends WeightClass>(
  tonnage: number,
  table: WeightClassTable<T>,
): T {
  for (const band of table.bands) {
    if (tonnage <= band.maxInclusive) return band.weightClass;
  }
  return table.fallback;
}

export const MEK_WEIGHT_LIMITS = {
  bands: [
    { maxInclusive: 15, weightClass: 'Ultra Light' },
    { maxInclusive: 35, weightClass: 'Light' },
    { maxInclusive: 55, weightClass: 'Medium' },
    { maxInclusive: 75, weightClass: 'Heavy' },
    { maxInclusive: 100, weightClass: 'Assault' },
  ],
  fallback: 'Super Heavy',
} as const satisfies WeightClassTable;

export const VEHICLE_WEIGHT_LIMITS = {
  bands: [
    { maxInclusive: 39, weightClass: 'Light' },
    { maxInclusive: 59, weightClass: 'Medium' },
    { maxInclusive: 79, weightClass: 'Heavy' },
    { maxInclusive: 100, weightClass: 'Assault' },
  ],
  fallback: 'Super Heavy',
} as const satisfies WeightClassTable;

export const GUN_EMPLACEMENT_WEIGHT_LIMITS = {
  bands: [
    { maxInclusive: 15, weightClass: 'Light' },
    { maxInclusive: 40, weightClass: 'Medium' },
    { maxInclusive: 90, weightClass: 'Heavy' },
  ],
  fallback: 'Assault',
} as const satisfies WeightClassTable;

export const ASF_WEIGHT_LIMITS = {
  bands: [
    { maxInclusive: 45, weightClass: 'Light' },
    { maxInclusive: 70, weightClass: 'Medium' },
  ],
  fallback: 'Heavy',
} as const satisfies WeightClassTable;

export const DROPSHIP_WEIGHT_LIMITS = {
  bands: [
    { maxInclusive: 2499, weightClass: 'Small DropShip' },
    { maxInclusive: 9999, weightClass: 'Medium DropShip' },
  ],
  fallback: 'Large DropShip',
} as const satisfies WeightClassTable;

export const CAPITAL_SHIP_WEIGHT_LIMITS = {
  bands: [
    { maxInclusive: 749999, weightClass: 'Small Capital' },
  ],
  fallback: 'Large Capital',
} as const satisfies WeightClassTable;

export const PROTOMEK_WEIGHT_LIMITS = {
  bands: [
    { maxInclusive: 3, weightClass: 'Light' },
    { maxInclusive: 5, weightClass: 'Medium' },
    { maxInclusive: 7, weightClass: 'Heavy' },
    { maxInclusive: 9, weightClass: 'Assault' },
  ],
  fallback: 'Super Heavy',
} as const satisfies WeightClassTable;

// ── Support vehicle limits by motive type ────────────────────────────────

const SUPPORT_MEDIUM_WEIGHT_LIMITS: Partial<Readonly<Record<MotiveType, number>>> = {
  'Wheeled': 80,
  'Tracked': 100,
  'Hover': 50,
  'VTOL': 30,
  'WiGE': 80,
  'Naval': 300,
  'Hydrofoil': 300,
  'Submarine': 300,
  'Rail': 300,
  'MagLev': 300,
  'Aerodyne': 100,
  'Airship': 300,
  'Station Keeping': 100,
} as const;

/** Resolve support-vehicle classes, whose small class has an exclusive 5-ton limit. */
export function resolveSupportVehicleWeightClass(
  tonnage: number,
  motiveType: MotiveType,
): WeightClass {
  const mediumLimit = SUPPORT_MEDIUM_WEIGHT_LIMITS[motiveType];
  if (mediumLimit === undefined) return 'Medium Support';
  if (tonnage < 5) return 'Small Support';
  if (tonnage <= mediumLimit) return 'Medium Support';
  return 'Large Support';
}

// ── BA BLK numeric code ↔ WeightClass mapping ───────────────────────────

export type BattleArmorWeightClass = Extract<
  WeightClass,
  'Ultra Light' | 'Light' | 'Medium' | 'Heavy' | 'Assault'
>;

/** Maps BA BLK numeric codes (0-4) to weight classes. */
export const BA_WEIGHT_CLASS_BY_CODE = [
  'Ultra Light',
  'Light',
  'Medium',
  'Heavy',
  'Assault',
] as const satisfies readonly BattleArmorWeightClass[];
