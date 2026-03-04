/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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
 * Gyro type descriptor data.
 *
 * All static, per-gyro-type data lives in `GYRO_DATA`, a
 * `Record<GyroType, GyroTypeDescriptor>`.  Gyro-type-dependent logic
 * elsewhere should derive from this map instead of ad-hoc if/else chains.
 *
 * Data sourced from MegaMek Mek.java, MekCostCalculator.java,
 * TechConstants.java, and BattleTech TM / TO rules.
 */

import { approx, DATE_NONE, type TechAdvancement } from '../types';

// ============================================================================
// GyroType union
// ============================================================================

/**
 * Union of all known Mek gyro type strings.
 * Matches MegaMek `Mek.GYRO_SHORT_STRING[]`.
 */
export type GyroType =
  | 'Standard' | 'XL' | 'Compact' | 'Heavy Duty' | 'None' | 'Superheavy';

// ============================================================================
// Gyro type descriptor interface
// ============================================================================

/**
 * Complete static data for one gyro type.
 */
export interface GyroTypeDescriptor {
  // ── Identity ──

  /** Numeric type code matching MegaMek `Mek.GYRO_*` constants. */
  readonly code: number;
  /** Full display name (e.g. "Standard Gyro", "XL Gyro"). */
  readonly fullName: string;
  /** Short display name (e.g. "Standard", "XL"). */
  readonly shortName: string;

  // ── Slots ──

  /** Number of critical slots the gyro occupies in the Center Torso. */
  readonly criticalSlots: number;

  // ── Cost ──

  /**
   * Base cost multiplier in C-bills.
   *
   * The actual gyro cost is:
   *   `baseCost * gyroTonnage * costMultiplier`
   * where `gyroTonnage = ceil(walkMP * tonnage / 100)`.
   *
   * For most types the formula is `baseCost * gyroTonnage`.
   * See `costMultiplier` for types that scale differently.
   */
  readonly baseCost: number;

  /**
   * Additional multiplier applied after `baseCost * gyroTonnage`.
   *
   * - Standard: 1.0  =>  300,000 x tonnage x 1.0
   * - XL:       0.5  =>  750,000 x tonnage x 0.5
   * - Compact:  1.5  =>  400,000 x tonnage x 1.5
   * - Heavy Duty: 2  =>  500,000 x tonnage x 2.0
   * - Superheavy: 2  =>  500,000 x tonnage x 2.0
   * - None:     0    =>  no cost
   */
  readonly costMultiplier: number;

  // ── BV ──

  /**
   * Defensive BV multiplier for the gyro, applied as:
   *   `tonnage * bvMultiplier`
   * added to defensive equipment BV.
   *
   * From MegaMek `Mek.getGyroMultiplier()`.
   * - Heavy Duty: 1.0
   * - None: 0.0 (but 0.5 if paired with Interface cockpit — handled at calc time)
   * - All others: 0.5
   */
  readonly bvMultiplier: number;

  // ── Tech advancement ──

  /** Technology advancement data. */
  readonly tech: TechAdvancement;
}

// ============================================================================
// GYRO_DATA - Record<GyroType, GyroTypeDescriptor>
// ============================================================================

/**
 * The master gyro-type lookup.
 *
 * Order follows the `GyroType` union / MegaMek numeric type codes.
 * Tech advancement data transcribed from MegaMek `Mek.java` (GYRO_TA[]),
 * costs from `MekCostCalculator`, slot counts from `Mek.java`.
 */
export const GYRO_DATA: Readonly<Record<GyroType, GyroTypeDescriptor>> = {

  // ────────────────────────────────────────────────────────────────────────
  // 0 - Standard
  // ────────────────────────────────────────────────────────────────────────
  'Standard': {
    code: 0,
    fullName: 'Standard Gyro',
    shortName: 'Standard',
    criticalSlots: 4,
    baseCost: 300_000,
    costMultiplier: 1.0,
    bvMultiplier: 0.5,
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['C', 'C', 'C', 'C'],
      level: 'Introductory',
      dates: { prototype: approx(2300), production: 2350, common: 2505 },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 1 - XL
  // ────────────────────────────────────────────────────────────────────────
  'XL': {
    code: 1,
    fullName: 'XL Gyro',
    shortName: 'XL',
    criticalSlots: 6,
    baseCost: 750_000,
    costMultiplier: 0.5,
    bvMultiplier: 0.5,
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'X', 'E', 'D'],
      level: 'Standard',
      dates: { prototype: approx(3055), production: 3067, common: 3072 },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 2 - Compact
  // ────────────────────────────────────────────────────────────────────────
  'Compact': {
    code: 2,
    fullName: 'Compact Gyro',
    shortName: 'Compact',
    criticalSlots: 2,
    baseCost: 400_000,
    costMultiplier: 1.5,
    bvMultiplier: 0.5,
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'X', 'E', 'D'],
      level: 'Standard',
      dates: { prototype: approx(3055), production: 3068, common: 3072 },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 3 - Heavy Duty
  // ────────────────────────────────────────────────────────────────────────
  'Heavy Duty': {
    code: 3,
    fullName: 'Heavy Duty Gyro',
    shortName: 'Heavy Duty',
    criticalSlots: 4,
    baseCost: 500_000,
    costMultiplier: 2.0,
    bvMultiplier: 1.0,
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'X', 'E', 'D'],
      level: 'Standard',
      dates: { prototype: approx(3055), production: 3067, common: 3072 },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 4 - None
  // ────────────────────────────────────────────────────────────────────────
  'None': {
    code: 4,
    fullName: 'None',
    shortName: 'None',
    criticalSlots: 0,
    baseCost: 0,
    costMultiplier: 0,
    bvMultiplier: 0.0, //This is 0, but if paired with an Interface cockpit it provides a BV multiplier of 0.5 (must be handled at calc time)
    tech: {
      techBase: 'All', rating: 'A',
      availability: ['A', 'A', 'A', 'A'],
      level: 'Advanced',
      dates: { prototype: DATE_NONE, production: DATE_NONE, common: DATE_NONE },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 5 - Superheavy
  // ────────────────────────────────────────────────────────────────────────
  'Superheavy': {
    code: 5,
    fullName: 'Superheavy Gyro',
    shortName: 'Superheavy',
    criticalSlots: 4,
    baseCost: 500_000,
    costMultiplier: 2.0,
    bvMultiplier: 0.5,
    tech: {
      techBase: 'IS', rating: 'D',
      availability: ['X', 'F', 'F', 'F'],
      level: 'Advanced',
      dates: { prototype: approx(2905), production: 2940, common: DATE_NONE },
    },
  },
};

// ============================================================================
// Descriptor lookup helpers
// ============================================================================

/**
 * Resolve the `TechAdvancement` for a gyro type.
 */
export function getGyroTechAdvancement(type: GyroType): TechAdvancement {
  return GYRO_DATA[type].tech;
}

// ============================================================================
// Derived code maps (built from GYRO_DATA at module load)
// ============================================================================

/**
 * Reverse lookup: numeric code => GyroType string.
 * Derived from the `code` field on each `GyroTypeDescriptor`.
 */
export const GYRO_TYPE_FROM_CODE: Record<number, GyroType> =
  Object.fromEntries(
    (Object.entries(GYRO_DATA) as [GyroType, GyroTypeDescriptor][])
      .map(([name, desc]) => [desc.code, name]),
  ) as Record<number, GyroType>;

/** Convert a numeric gyro code (from BLK files) to a GyroType string. */
export function gyroTypeFromCode(code: number): GyroType {
  return GYRO_TYPE_FROM_CODE[code] ?? 'Standard';
}
