// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

// ============================================================================
// Typed Location IDs
//
// Canonical identifiers for every location family. Parser normalization maps
// convert raw MTF/BLK strings to these IDs at ingress - the rest of the
// codebase ONLY uses these canonical IDs.
// ============================================================================

/** Canonical Mek location codes */
export type MekLocation =
  | 'HD' | 'CT' | 'LT' | 'RT' | 'LA' | 'RA' | 'LL' | 'RL'   // biped
  | 'CL'                                                    // tripod extra
  | 'FLL' | 'FRL' | 'RLL' | 'RRL';                          // quad

/** Canonical Aero armor/structure locations */
export type AeroArmorLocation = 'Nose' | 'Left Wing' | 'Right Wing' | 'Aft';

/** Canonical Aero equipment locations (include stowage) */
export type AeroEquipLocation =
  | 'Nose' | 'Left Wing' | 'Right Wing' | 'Aft' | 'Wings'
  | 'Fuselage' | 'Body';

/** Canonical Tank location codes */
export type TankLocation =
  | 'Front' | 'Right' | 'Left' | 'Rear'
  | 'Turret' | 'Front Turret' | 'Rear Turret' | 'Rotor';

/** Canonical SmallCraft / DropShip equipment locations */
export type SmallCraftEquipLocation =
  | 'Nose' | 'Left Side' | 'Right Side' | 'Aft' | 'Hull';

/** Canonical JumpShip / WarShip / SpaceStation locations */
export type LargeCraftLocation = 'Nose' | 'FLS' | 'FRS' | 'ALS' | 'ARS' | 'Aft';

export type Location = MekLocation | AeroArmorLocation | AeroEquipLocation | TankLocation | SmallCraftEquipLocation | LargeCraftLocation;

// ============================================================================
// Location Constant Arrays
// ============================================================================

export const MEK_LOCATIONS = ['HD', 'LA', 'LT', 'CT', 'RT', 'RA', 'LL', 'RL'] as const;
export const MEK_TRIPOD_LOCATIONS = [...MEK_LOCATIONS, 'CL'] as const;
export const MEK_QUAD_LOCATIONS = ['HD', 'FLL', 'LT', 'CT', 'RT', 'FRL', 'RLL', 'RRL'] as const;

export const AERO_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft'] as const;
export const AERO_EQUIP_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Fuselage'] as const;
export const FIXED_WING_EQUIP_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Body'] as const;

export const TANK_LOCATIONS = ['Front', 'Right', 'Left', 'Rear'] as const;
export const VTOL_LOCATIONS = ['Front', 'Right', 'Left', 'Rear', 'Rotor'] as const;
export const TANK_LOCATIONS_WITH_TURRET = [...TANK_LOCATIONS, 'Turret'] as const;
export const TANK_LOCATIONS_WITH_DUAL_TURRET = [...TANK_LOCATIONS, 'Front Turret', 'Rear Turret'] as const;
export const VTOL_LOCATIONS_WITH_TURRET = ['Front', 'Right', 'Left', 'Rear', 'Turret', 'Rotor'] as const;
export const LARGE_SUPPORT_TANK_LOCATIONS = [
  'Front', 'Front Right', 'Front Left',
  'Rear Right', 'Rear Left', 'Rear',
] as const;
export const LARGE_SUPPORT_TANK_LOCATIONS_WITH_TURRET = [...LARGE_SUPPORT_TANK_LOCATIONS, 'Turret'] as const;
export const LARGE_SUPPORT_TANK_LOCATIONS_WITH_DUAL_TURRET = [
  ...LARGE_SUPPORT_TANK_LOCATIONS,
  'Rear Turret', 'Front Turret',
] as const;

export const BA_LOCATIONS = ['Squad'] as const;
export const PROTO_LOCATIONS = ['Head', 'Torso', 'Right Arm', 'Left Arm', 'Legs'] as const;
export const PROTO_LOCATIONS_WITH_MAIN_GUN = [...PROTO_LOCATIONS, 'Main Gun'] as const;

export const LARGE_CRAFT_LOCATIONS = ['Nose', 'FLS', 'FRS', 'ALS', 'ARS', 'Aft'] as const;
export const SMALL_CRAFT_EQUIP_LOCATIONS = ['Nose', 'Left Side', 'Right Side', 'Aft', 'Hull'] as const;
export const SMALL_CRAFT_ARMOR_LOCATIONS = ['Nose', 'Left Side', 'Right Side', 'Aft'] as const;
export const DROPSHIP_LOCATIONS = ['Nose', 'LF', 'RF', 'LBS', 'RBS', 'Aft'] as const;

/** Properties attached to a canonical entity location. */
export interface EntityLocationMetadata {
  readonly clanCaseOptOut?: boolean;
}