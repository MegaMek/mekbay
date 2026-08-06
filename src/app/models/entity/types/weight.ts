// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
