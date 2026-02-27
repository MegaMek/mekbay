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
// Typed Location IDs
//
// Canonical identifiers for every location family. Parser normalization maps
// convert raw MTF/BLK strings to these IDs at ingress — the rest of the
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
  'Right', 'Left',
  'Rear', 'Rear Right', 'Rear Left',
] as const;
export const LARGE_SUPPORT_TANK_LOCATIONS_WITH_TURRET = [...LARGE_SUPPORT_TANK_LOCATIONS, 'Turret'] as const;

export const BA_LOCATIONS = ['Squad'] as const;
export const PROTO_LOCATIONS = ['Head', 'Torso', 'Right Arm', 'Left Arm', 'Legs'] as const;
export const PROTO_LOCATIONS_WITH_MAIN_GUN = [...PROTO_LOCATIONS, 'Main Gun'] as const;

export const LARGE_CRAFT_LOCATIONS = ['Nose', 'FLS', 'FRS', 'ALS', 'ARS', 'Aft'] as const;
export const SMALL_CRAFT_EQUIP_LOCATIONS = ['Nose', 'Left Side', 'Right Side', 'Aft', 'Hull'] as const;
export const SMALL_CRAFT_ARMOR_LOCATIONS = ['Nose', 'Left Side', 'Right Side', 'Aft'] as const;
export const DROPSHIP_LOCATIONS = ['Nose', 'LF', 'RF', 'LBS', 'RBS', 'Aft'] as const;
