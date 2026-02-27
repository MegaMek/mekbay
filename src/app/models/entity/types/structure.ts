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
// Internal Structure Types
// ============================================================================

/**
 * Internal structure type enum, following the ArmorType pattern.
 *
 * Matches Java's `EquipmentType.T_STRUCTURE_*` constants:
 *   STANDARD=0, INDUSTRIAL=1, ENDO_STEEL=2, ENDO_PROTOTYPE=3,
 *   REINFORCED=4, COMPOSITE=5, ENDO_COMPOSITE=6
 */
export type StructureType =
  | 'STANDARD'
  | 'INDUSTRIAL'
  | 'ENDO_STEEL'
  | 'ENDO_PROTOTYPE'
  | 'REINFORCED'
  | 'COMPOSITE'
  | 'ENDO_COMPOSITE';

/** Map from BLK internal_type code → StructureType enum */
export const STRUCTURE_TYPE_FROM_CODE: Record<number, StructureType> = {
  0: 'STANDARD',
  1: 'INDUSTRIAL',
  2: 'ENDO_STEEL',
  3: 'ENDO_PROTOTYPE',
  4: 'REINFORCED',
  5: 'COMPOSITE',
  6: 'ENDO_COMPOSITE',
};

/** Reverse map from StructureType enum → BLK numeric code */
export const STRUCTURE_TYPE_TO_CODE: Record<StructureType, number> = {
  'STANDARD': 0,
  'INDUSTRIAL': 1,
  'ENDO_STEEL': 2,
  'ENDO_PROTOTYPE': 3,
  'REINFORCED': 4,
  'COMPOSITE': 5,
  'ENDO_COMPOSITE': 6,
};

/** Map from display name (as used in MTF files) → StructureType enum */
export const STRUCTURE_TYPE_BY_DISPLAY_NAME: Record<string, StructureType> = {
  'Standard': 'STANDARD',
  'Industrial': 'INDUSTRIAL',
  'Endo Steel': 'ENDO_STEEL',
  'Endo-Steel': 'ENDO_STEEL',
  'Endo Steel Prototype': 'ENDO_PROTOTYPE',
  'Reinforced': 'REINFORCED',
  'Composite': 'COMPOSITE',
  'Endo-Composite': 'ENDO_COMPOSITE',
};

/** Map from StructureType enum → display name string */
export const STRUCTURE_TYPE_DISPLAY_NAME: Record<StructureType, string> = {
  'STANDARD': 'Standard',
  'INDUSTRIAL': 'Industrial',
  'ENDO_STEEL': 'Endo Steel',
  'ENDO_PROTOTYPE': 'Endo Steel Prototype',
  'REINFORCED': 'Reinforced',
  'COMPOSITE': 'Composite',
  'ENDO_COMPOSITE': 'Endo-Composite',
};

export function structureTypeFromCode(code: number): StructureType {
  return STRUCTURE_TYPE_FROM_CODE[code] ?? 'STANDARD';
}

export function structureTypeToCode(type: StructureType): number {
  return STRUCTURE_TYPE_TO_CODE[type] ?? 0;
}

/**
 * Convert a display name (e.g. from MTF header after stripping IS/Clan prefix)
 * to a StructureType enum value.
 */
export function structureTypeFromDisplayName(displayName: string): StructureType {
  return STRUCTURE_TYPE_BY_DISPLAY_NAME[displayName] ?? 'STANDARD';
}
