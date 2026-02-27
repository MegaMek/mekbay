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
// Motive Type
//
// Canonical entity movement mode, mirroring MegaMek's EntityMovementMode enum.
// Every entity subclass has a `motiveType` signal using this type.
//
// Notes on aliases:
// - "Foot" is stored as "Leg" (infantry foot movement)
// - "Microcopter", "Micro-Copter", "Microlite" → all map to "VTOL"
// - "Glider" → maps to "WiGE"
// - "SCUBA", "Motorized SCUBA" → all map to "UMU"
// - "Satellite", "Station", "Station_Keeping" → all map to "Station Keeping"
// ============================================================================

/**
 * Canonical motive type identifiers.
 *
 * Based on MegaMek's `EntityMovementMode` enum (25 values).
 * These are the primary movement modes / chassis configurations:
 *
 * | Value            | Used By                                     |
 * |------------------|---------------------------------------------|
 * | None             | Handheld weapons, buildings, immobile units  |
 * | Biped            | Biped Meks                                  |
 * | Tripod           | Tripod Meks                                 |
 * | Quad             | Quad Meks                                   |
 * | Tracked          | Tracked vehicles                            |
 * | Wheeled          | Wheeled vehicles                            |
 * | Hover            | Hovercraft                                  |
 * | VTOL             | VTOL vehicles (+ Microcopter alias)         |
 * | Naval            | Naval vessels                               |
 * | Hydrofoil        | Hydrofoil vessels                           |
 * | Submarine        | Submarine vessels                           |
 * | WiGE             | Wing-in-Ground-Effect vehicles (+ Glider)   |
 * | Leg              | Foot infantry                               |
 * | Motorized        | Motorized infantry                          |
 * | Jump             | Jump infantry                               |
 * | UMU              | BA/infantry UMU, SCUBA, Motorized SCUBA     |
 * | Aerodyne         | Aerodyne ASF, SmallCraft, DropShips         |
 * | Spheroid         | Spheroid SmallCraft, DropShips               |
 * | Aerospace        | Alternate aerospace designation             |
 * | Airship          | Airship support vehicles                    |
 * | Station Keeping  | Satellites, space stations                  |
 * | Rail             | Rail vehicles                               |
 * | MagLev           | MagLev rail vehicles                        |
 * | Track            | QuadVee vehicle-mode track motive            |
 * | Wheel            | QuadVee vehicle-mode wheel motive            |
 * | Beast            | Beast-mounted infantry (TO:AU&E p.106)       |
 */
export type MotiveType =
  | 'None'
  | 'Biped'
  | 'Tripod'
  | 'Quad'
  | 'Tracked'
  | 'Wheeled'
  | 'Hover'
  | 'VTOL'
  | 'Naval'
  | 'Hydrofoil'
  | 'Submarine'
  | 'WiGE'
  | 'Leg'
  | 'Motorized'
  | 'Jump'
  | 'UMU'
  | 'Aerodyne'
  | 'Spheroid'
  | 'Aerospace'
  | 'Airship'
  | 'Station Keeping'
  | 'Rail'
  | 'MagLev'
  | 'Track'
  | 'Wheel'
  | 'Beast';

/**
 * Parse a raw motive-type string (from BLK `motion_type` or MTF headers)
 * to a canonical `MotiveType`.  Handles legacy aliases and case variations.
 *
 * Returns `'None'` for unrecognized strings.
 */
export function parseMotiveType(raw: string): MotiveType {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // ── Direct canonical matches (case-insensitive) ─────────────────────
  const canonical = MOTIVE_TYPE_BY_LOWERCASE.get(lower);
  if (canonical) return canonical;

  // ── Legacy aliases ──────────────────────────────────────────────────
  const alias = MOTIVE_TYPE_ALIASES.get(lower);
  if (alias) return alias;

  return 'None';
}

// ── Lookup maps (built once) ────────────────────────────────────────────────

/** All canonical MotiveType values */
export const ALL_MOTIVE_TYPES: readonly MotiveType[] = [
  'None', 'Biped', 'Tripod', 'Quad',
  'Tracked', 'Wheeled', 'Hover', 'VTOL',
  'Naval', 'Hydrofoil', 'Submarine', 'WiGE',
  'Leg', 'Motorized', 'Jump', 'UMU',
  'Aerodyne', 'Spheroid', 'Aerospace',
  'Airship', 'Station Keeping', 'Rail', 'MagLev',
  'Track', 'Wheel', 'Beast',
];

/** Lowercase canonical name → MotiveType */
const MOTIVE_TYPE_BY_LOWERCASE = new Map<string, MotiveType>(
  ALL_MOTIVE_TYPES.map(mt => [mt.toLowerCase(), mt]),
);

/** Legacy/alternate string → canonical MotiveType */
const MOTIVE_TYPE_ALIASES = new Map<string, MotiveType>([
  // MegaMek parseFromString aliases
  ['building',        'None'],
  ['microcopter',     'VTOL'],
  ['micro-copter',    'VTOL'],
  ['microlite',       'VTOL'],
  ['glider',          'WiGE'],
  ['scuba',           'UMU'],
  ['motorized scuba', 'UMU'],
  ['foot',            'Leg'],
  ['foot infantry',   'Leg'],
  ['motorized infantry', 'Motorized'],
  ['jump infantry',   'Jump'],
  ['inf_leg',         'Leg'],
  ['inf_motorized',   'Motorized'],
  ['inf_jump',        'Jump'],
  ['inf_umu',         'UMU'],
  ['biped_swim',      'UMU'],
  ['quad_swim',       'UMU'],
  ['station',         'Station Keeping'],
  ['station_keeping', 'Station Keeping'],
  ['station-keeping', 'Station Keeping'],
  ['satellite',       'Station Keeping'],
  ['maglev',          'MagLev'],
  ['wige',            'WiGE'],
]);

// ============================================================================
// Motive Type Validation Sets
//
// Category-specific sets for parser validation. Each set contains only the
// motive types valid for that entity family.
// ============================================================================

/** Valid motive types for combat vehicles */
export const VALID_VEHICLE_MOTIVE_TYPES: ReadonlySet<MotiveType> = new Set<MotiveType>([
  'Tracked', 'Wheeled', 'Hover', 'WiGE',
  'Naval', 'Submarine', 'Hydrofoil',
  'VTOL',
]);

/** Valid motive types for conventional infantry */
export const VALID_INFANTRY_MOTIVE_TYPES: ReadonlySet<MotiveType> = new Set<MotiveType>([
  'Leg', 'Motorized', 'Jump', 'UMU',
  'Hover', 'Wheeled', 'Tracked', 'VTOL',
  'Submarine', 'Beast',
]);

/** Valid motive types for battle armor */
export const VALID_BA_MOTIVE_TYPES: ReadonlySet<MotiveType> = new Set<MotiveType>([
  'Leg', 'Jump', 'VTOL', 'UMU',
]);

/** Valid motive types for conventional / aerospace fighters */
export const VALID_AERO_MOTIVE_TYPES: ReadonlySet<MotiveType> = new Set<MotiveType>([
  'Aerodyne',
]);

/** Valid motive types for DropShips / SmallCraft */
export const VALID_SPACECRAFT_MOTIVE_TYPES: ReadonlySet<MotiveType> = new Set<MotiveType>([
  'Aerodyne', 'Spheroid',
]);

/** Valid motive types for Meks (derived from chassis config) */
export const VALID_MEK_MOTIVE_TYPES: ReadonlySet<MotiveType> = new Set<MotiveType>([
  'Biped', 'Quad', 'Tripod',
]);

/** Valid motive types for ProtoMeks */
export const VALID_PROTOMEK_MOTIVE_TYPES: ReadonlySet<MotiveType> = new Set<MotiveType>([
  'Biped', 'Quad',
]);

/** Valid vehicle motive types for QuadVee vehicle mode */
export const VALID_QUADVEE_MOTIVE_TYPES: ReadonlySet<MotiveType> = new Set<MotiveType>([
  'Track', 'Wheel',
]);

// ============================================================================
// Narrowed Motive Type Aliases & Type Guards
//
// These allow consumers to narrow from the broad `MotiveType` union to a
// specific subset when working with a known entity family.  The signal stays
// `signal<MotiveType>` (invariant), but downstream code can narrow via guards.
// ============================================================================

/** Motive types valid for combat vehicles */
export type VehicleMotiveType = Extract<MotiveType, 'Tracked' | 'Wheeled' | 'Hover' | 'WiGE' | 'Naval' | 'Submarine' | 'Hydrofoil' | 'VTOL'>;

/** Motive types valid for conventional infantry */
export type InfantryMotiveType = Extract<MotiveType, 'Leg' | 'Motorized' | 'Jump' | 'UMU' | 'Hover' | 'Wheeled' | 'Tracked' | 'VTOL' | 'Submarine' | 'Beast'>;

/** Motive types valid for battle armor */
export type BattleArmorMotiveType = Extract<MotiveType, 'Leg' | 'Jump' | 'VTOL' | 'UMU'>;

/** Motive types valid for aerospace fighters */
export type AeroMotiveType = Extract<MotiveType, 'Aerodyne'>;

/** Motive types valid for DropShips / SmallCraft */
export type SpacecraftMotiveType = Extract<MotiveType, 'Aerodyne' | 'Spheroid'>;

/** Motive types valid for BattleMeks */
export type MekMotiveType = Extract<MotiveType, 'Biped' | 'Quad' | 'Tripod'>;

/** Motive types valid for ProtoMeks */
export type ProtoMekMotiveType = Extract<MotiveType, 'Biped' | 'Quad'>;

/** Motive types valid for QuadVee vehicle mode */
export type QuadVeeMotiveType = Extract<MotiveType, 'Track' | 'Wheel'>;

// ── Type guards ─────────────────────────────────────────────────────────────

export function isVehicleMotiveType(m: MotiveType): m is VehicleMotiveType {
  return VALID_VEHICLE_MOTIVE_TYPES.has(m);
}

export function isInfantryMotiveType(m: MotiveType): m is InfantryMotiveType {
  return VALID_INFANTRY_MOTIVE_TYPES.has(m);
}

export function isBattleArmorMotiveType(m: MotiveType): m is BattleArmorMotiveType {
  return VALID_BA_MOTIVE_TYPES.has(m);
}

export function isAeroMotiveType(m: MotiveType): m is AeroMotiveType {
  return VALID_AERO_MOTIVE_TYPES.has(m);
}

export function isSpacecraftMotiveType(m: MotiveType): m is SpacecraftMotiveType {
  return VALID_SPACECRAFT_MOTIVE_TYPES.has(m);
}

export function isMekMotiveType(m: MotiveType): m is MekMotiveType {
  return VALID_MEK_MOTIVE_TYPES.has(m);
}

export function isProtoMekMotiveType(m: MotiveType): m is ProtoMekMotiveType {
  return VALID_PROTOMEK_MOTIVE_TYPES.has(m);
}

export function isQuadVeeMotiveType(m: MotiveType): m is QuadVeeMotiveType {
  return VALID_QUADVEE_MOTIVE_TYPES.has(m);
}
