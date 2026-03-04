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

import type { MekLocation } from './locations';

// ============================================================================
// Mek Configuration
// ============================================================================

export type MekConfig = 'Biped' | 'Quad' | 'Tripod' | 'LAM' | 'QuadVee';

/** Mek system types that occupy critical slots */
export type MekSystemType =
  | 'Engine' | 'Gyro' | 'Sensors' | 'Life Support' | 'Cockpit'
  | 'Shoulder' | 'Upper Arm Actuator' | 'Lower Arm Actuator' | 'Hand Actuator'
  | 'Hip' | 'Upper Leg Actuator' | 'Lower Leg Actuator' | 'Foot Actuator'
  | 'Landing Gear' | 'Avionics';

/** Number of critical slots per location for all Mek types (including superheavy). */
export const MEK_SLOTS_PER_LOCATION = 12;

/** Mek locations that support rear armor */
export const MEK_REAR_ARMOR_LOCATIONS: ReadonlySet<string> = new Set(['CT', 'LT', 'RT']);

// ============================================================================
// Gyro Types (Mek)
//
// Canonical gyro type data now lives in components/gyro-data.ts.
// The GYRO_TYPE_FROM_CODE map and gyroTypeFromCode() function are
// re-exported from components/gyro.ts via the components barrel.
// ============================================================================

// ============================================================================
// Cockpit Types (Mek)
// ============================================================================

/**
 * Union of all known Mek cockpit type strings.
 * Matches MegaMek `Mek.COCKPIT_*` short strings (COCKPIT_SHORT_STRING[]).
 */
export type CockpitType =
  | 'Standard' | 'Small' | 'Command Console' | 'Torso-Mounted'
  | 'Dual' | 'Industrial' | 'Primitive' | 'Primitive Industrial'
  | 'Superheavy' | 'Superheavy Tripod' | 'Tripod'
  | 'Interface' | 'Virtual Reality Piloting Pod' | 'QuadVee'
  | 'Superheavy Industrial' | 'Superheavy Command Console'
  | 'Small Command Console' | 'Tripod Industrial'
  | 'Superheavy Tripod Industrial';

// ============================================================================
// Location Topology
//
// Defines the physical connection graph between Mek locations: which
// location damage transfers into, and which locations are destroyed as
// dependents when a parent is lost.
// ============================================================================

/**
 * Physical connection descriptor for a single Mek location.
 *
 * `transfersTo`  - next inward location for damage transfer when this
 *                  location's internal structure is destroyed.
 *                  `null` = terminal (CT destroyed → Mek destroyed).
 *
 * `dependents`   - locations physically attached to this one that are
 *                  also destroyed when it is destroyed
 *                  (e.g. losing RT also destroys RA).
 */
export interface LocTopology {
  readonly transfersTo: MekLocation | null;
  readonly dependents: readonly MekLocation[];
}

/**
 * Biped / Tripod Mek location topology.
 *
 *            HD
 *            │
 *    LA─LT──CT──RT─RA
 *        │       │
 *       LL      RL
 *       (CL)              ← Tripod only
 */
export const BIPED_TOPOLOGY: Readonly<Record<MekLocation, LocTopology>> = {
  HD:  { transfersTo: 'CT',   dependents: [] },
  CT:  { transfersTo: null,   dependents: [] },
  RT:  { transfersTo: 'CT',   dependents: ['RA'] },
  LT:  { transfersTo: 'CT',   dependents: ['LA'] },
  RA:  { transfersTo: 'RT',   dependents: [] },
  LA:  { transfersTo: 'LT',   dependents: [] },
  RL:  { transfersTo: 'RT',   dependents: [] },
  LL:  { transfersTo: 'LT',   dependents: [] },
  CL:  { transfersTo: 'CT',   dependents: [] },   // Tripod only
  // Quad keys - present but unused for bipeds
  FLL: { transfersTo: 'LT',   dependents: [] },
  FRL: { transfersTo: 'RT',   dependents: [] },
  RLL: { transfersTo: 'LT',   dependents: [] },
  RRL: { transfersTo: 'RT',   dependents: [] },
};

/**
 * Quad Mek location topology.
 *
 *             HD
 *             │
 *   FLL─LT──CT──RT─FRL
 *        │       │
 *       RLL     RRL
 */
export const QUAD_TOPOLOGY: Readonly<Record<MekLocation, LocTopology>> = {
  HD:  { transfersTo: 'CT',   dependents: [] },
  CT:  { transfersTo: null,   dependents: [] },
  RT:  { transfersTo: 'CT',   dependents: ['FRL', 'RRL'] },
  LT:  { transfersTo: 'CT',   dependents: ['FLL', 'RLL'] },
  FRL: { transfersTo: 'RT',   dependents: [] },
  FLL: { transfersTo: 'LT',   dependents: [] },
  RRL: { transfersTo: 'RT',   dependents: [] },
  RLL: { transfersTo: 'LT',   dependents: [] },
  // Biped keys - present but unused for quads
  RA:  { transfersTo: 'RT',   dependents: [] },
  LA:  { transfersTo: 'LT',   dependents: [] },
  RL:  { transfersTo: 'RT',   dependents: [] },
  LL:  { transfersTo: 'LT',   dependents: [] },
  CL:  { transfersTo: 'CT',   dependents: [] },
};

/** Set of all leg-type location codes (biped + quad + tripod) */
export const LEG_LOCATIONS: ReadonlySet<MekLocation> = new Set<MekLocation>(
  ['LL', 'RL', 'CL', 'FRL', 'FLL', 'RRL', 'RLL'],
);

/** Set of quad-only leg location codes */
export const FOUR_LEGGED_LOCATIONS: ReadonlySet<MekLocation> = new Set<MekLocation>(
  ['FRL', 'FLL', 'RRL', 'RLL'],
);

/**
 * The complete set of all canonical MekLocation values.
 * Used internally by the `isMekLocation` type guard.
 */
const ALL_MEK_LOCATIONS: ReadonlySet<string> = new Set<MekLocation>([
  'HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL',
  'CL', 'FLL', 'FRL', 'RLL', 'RRL',
]);

/** Type guard: narrows an arbitrary string to `MekLocation`. */
export function isMekLocation(s: string): s is MekLocation {
  return ALL_MEK_LOCATIONS.has(s);
}

/** Returns the appropriate topology map for a set of location keys. */
export function getTopologyFor(
  locationKeys: Iterable<string>,
): Readonly<Record<MekLocation, LocTopology>> {
  for (const key of locationKeys) {
    if (isMekLocation(key) && FOUR_LEGGED_LOCATIONS.has(key)) return QUAD_TOPOLOGY;
  }
  return BIPED_TOPOLOGY;
}

// ============================================================================
// Critical Slot View - derived, read-only grid cell
//
// The Mek crit grid is a COMPUTED view, never a writable signal.
// Writers and UI read this view; mutations go through the equipment list.
// ============================================================================

export interface CriticalSlotView {
  readonly type: 'system' | 'equipment' | 'empty';
  readonly systemType?: MekSystemType;
  /** References EntityMountedEquipment.mountId - not an array index */
  readonly mountId?: string;
  readonly armored: boolean;
  readonly omniPod: boolean;
}

// ============================================================================
// Internal Structure Lookup Tables
// ============================================================================

/**
 * Standard internal structure table for Meks, indexed by tonnage.
 * Each entry is [Head, CT, SideTorso, Arm, Leg].
 */
export const MEK_INTERNAL_STRUCTURE: Record<number, [number, number, number, number, number]> = {
  10:  [3,  4,  3,  1,  2],
  15:  [3,  5,  4,  2,  3],
  20:  [3,  6,  5,  3,  4],
  25:  [3,  8,  6,  4,  6],
  30:  [3, 10,  7,  5,  7],
  35:  [3, 11,  8,  6,  8],
  40:  [3, 12, 10,  6, 10],
  45:  [3, 14, 11,  7, 11],
  50:  [3, 16, 12,  8, 12],
  55:  [3, 18, 13,  9, 13],
  60:  [3, 20, 14, 10, 14],
  65:  [3, 21, 15, 10, 15],
  70:  [3, 22, 15, 11, 15],
  75:  [3, 23, 16, 12, 16],
  80:  [3, 25, 17, 13, 17],
  85:  [3, 27, 18, 14, 18],
  90:  [3, 29, 19, 15, 19],
  95:  [3, 30, 20, 16, 20],
  100: [3, 31, 21, 17, 21],
  105: [4, 32, 22, 17, 22],
  110: [4, 33, 23, 18, 23],
  115: [4, 35, 24, 19, 24],
  120: [4, 36, 25, 20, 25],
  125: [4, 38, 26, 20, 26],
  130: [4, 39, 27, 21, 27],
  135: [4, 41, 28, 22, 28],
  140: [4, 42, 29, 23, 29],
  145: [4, 44, 31, 24, 31],
  150: [4, 45, 32, 25, 32],
  155: [4, 47, 33, 25, 33],
  160: [4, 48, 34, 26, 34],
  165: [4, 50, 35, 27, 35],
  170: [4, 51, 36, 28, 36],
  175: [4, 53, 37, 29, 37],
  180: [4, 54, 38, 30, 38],
  185: [4, 56, 39, 30, 39],
  190: [4, 57, 40, 31, 40],
  195: [4, 59, 41, 32, 41],
  200: [4, 60, 42, 33, 42],
};
