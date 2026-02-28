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

/**
 * Shared constants used by both BLK parsers and writers.
 *
 * Equipment location tag arrays, armor layout arrays, and crit location
 * mappings that must stay in sync between reading and writing.
 */

// ============================================================================
// Aero (ASF / ConvFighter / FixedWingSupport)
// ============================================================================

/** Standard ASF / ConvFighter equipment location blocks */
export const FIGHTER_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',       'Nose'],
  ['Left Wing Equipment',  'Left Wing'],
  ['Right Wing Equipment', 'Right Wing'],
  ['Aft Equipment',        'Aft'],
  ['Wings Equipment',      'Wings'],
  ['Fuselage Equipment',   'Fuselage'],
];

/** FixedWingSupport uses 'Body' instead of 'Fuselage' */
export const FWS_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',       'Nose'],
  ['Left Wing Equipment',  'Left Wing'],
  ['Right Wing Equipment', 'Right Wing'],
  ['Aft Equipment',        'Aft'],
  ['Wings Equipment',      'Wings'],
  ['Body Equipment',       'Body'],
];

// ============================================================================
// SmallCraft
// ============================================================================

export const SC_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',        'Nose'],
  ['Left Side Equipment',   'Left Side'],
  ['Right Side Equipment',  'Right Side'],
  ['Aft Equipment',         'Aft'],
  ['Hull Equipment',        'Hull'],
];

// ============================================================================
// DropShip
// ============================================================================

export const DS_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',        'Nose'],
  ['Left Side Equipment',   'Left Side'],
  ['Right Side Equipment',  'Right Side'],
  ['Aft Equipment',         'Aft'],
  ['Hull Equipment',        'Hull'],
];

/** DropShip BLK armor value locations (output order) */
export const DS_ARMOR_LOCS = ['Nose', 'Left Side', 'Right Side', 'Aft'] as const;

// ============================================================================
// Large Craft (JumpShip / WarShip / SpaceStation)
// ============================================================================

export const JUMPSHIP_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',                  'Nose'],
  ['Left Front Side Equipment',       'FLS'],
  ['Right Front Side Equipment',      'FRS'],
  ['Aft Equipment',                   'Aft'],
  ['Aft Left Side Equipment',         'ALS'],
  ['Aft Right Side Equipment',        'ARS'],
  ['Hull Equipment',                  'Hull'],
];

export const WARSHIP_EXTRA_EQUIP_TAGS: [string, string][] = [
  ['Left Broadsides Equipment',        'Left Broadside'],
  ['Right Broadsides Equipment',       'Right Broadside'],
];

// ============================================================================
// ProtoMek
// ============================================================================

export const PROTO_EQUIP_TAGS: [string, string][] = [
  ['Body Equipment',       'Body'],
  ['Head Equipment',       'Head'],
  ['Torso Equipment',      'Torso'],
  ['Right Arm Equipment',  'Right Arm'],
  ['Left Arm Equipment',   'Left Arm'],
  ['Legs Equipment',       'Legs'],
  ['Main Gun Equipment',   'Main Gun'],
];

// ============================================================================
// Vehicle
// ============================================================================

export const VEHICLE_EQUIP_TAGS: [string, string][] = [
  ['Body Equipment',            'Body'],
  ['Front Equipment',           'Front'],
  ['Right Equipment',           'Right'],
  ['Left Equipment',            'Left'],
  ['Rear Equipment',            'Rear'],
  ['Turret Equipment',          'Turret'],
  ['Front Turret Equipment',    'Front Turret'],
  ['Rear Turret Equipment',     'Rear Turret'],
  ['Rotor Equipment',           'Rotor'],
];

/** Large Support Tank additional locations */
export const LST_EXTRA_EQUIP_TAGS: [string, string][] = [
  ['Front Right Equipment',     'Front Right'],
  ['Front Left Equipment',      'Front Left'],
  ['Rear Right Equipment',      'Rear Right'],
  ['Rear Left Equipment',       'Rear Left'],
];

/** Gun Emplacement uses a specific tag */
export const GE_EQUIP_TAGS: [string, string][] = [
  ['Guns Equipment',  'Turret'],
  ['Body Equipment',  'Body'],
];

// ============================================================================
// Mek — Armor array order
// ============================================================================

export const BLK_ARMOR_BIPED: { loc: string; face: 'front' | 'rear' }[] = [
  { loc: 'HD',  face: 'front' },
  { loc: 'LA',  face: 'front' },
  { loc: 'LT',  face: 'front' },
  { loc: 'LT',  face: 'rear'  },
  { loc: 'CT',  face: 'front' },
  { loc: 'CT',  face: 'rear'  },
  { loc: 'RT',  face: 'front' },
  { loc: 'RT',  face: 'rear'  },
  { loc: 'RA',  face: 'front' },
  { loc: 'LL',  face: 'front' },
  { loc: 'RL',  face: 'front' },
];

export const BLK_ARMOR_QUAD: { loc: string; face: 'front' | 'rear' }[] = [
  { loc: 'HD',  face: 'front' },
  { loc: 'FLL', face: 'front' },
  { loc: 'LT',  face: 'front' },
  { loc: 'LT',  face: 'rear'  },
  { loc: 'CT',  face: 'front' },
  { loc: 'CT',  face: 'rear'  },
  { loc: 'RT',  face: 'front' },
  { loc: 'RT',  face: 'rear'  },
  { loc: 'FRL', face: 'front' },
  { loc: 'RLL', face: 'front' },
  { loc: 'RRL', face: 'front' },
];

// ============================================================================
// Mek — Crit location tags
// ============================================================================

export const BLK_CRIT_BIPED: readonly (readonly [string, string])[] = [
  ['hd', 'HD'], ['la', 'LA'], ['ra', 'RA'], ['ll', 'LL'], ['rl', 'RL'],
  ['lt', 'LT'], ['rt', 'RT'], ['ct', 'CT'],
];

export const BLK_CRIT_QUAD: readonly (readonly [string, string])[] = [
  ['hd', 'HD'], ['fll', 'FLL'], ['frl', 'FRL'], ['rll', 'RLL'], ['rrl', 'RRL'],
  ['lt', 'LT'], ['rt', 'RT'], ['ct', 'CT'],
];

// ============================================================================
// Vehicle — Armor location arrays
// ============================================================================

export const VEHICLE_ARMOR_LOCS = ['Front', 'Right', 'Left', 'Rear', 'Turret', 'Rear Turret'] as const;
export const VTOL_ARMOR_LOCS = ['Front', 'Right', 'Left', 'Rear', 'Rotor', 'Turret'] as const;
export const SUPERHEAVY_ARMOR_LOCS = ['Front', 'Front Right', 'Front Left', 'Rear Right', 'Rear Left', 'Rear', 'Turret', 'Rear Turret'] as const;
export const LST_ARMOR_LOCS = ['Front', 'Front Right', 'Front Left', 'Rear Right', 'Rear Left', 'Rear', 'Turret'] as const;
