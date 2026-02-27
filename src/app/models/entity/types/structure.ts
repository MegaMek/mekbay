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
 * Internal structure type, using display-name values directly.
 *
 * Corresponds to Java's `EquipmentType.T_STRUCTURE_*` constants:
 *   Standard=0, Industrial=1, Endo Steel=2, Endo Steel Prototype=3,
 *   Reinforced=4, Composite=5, Endo-Composite=6
 */
export type StructureType =
  | 'Standard'
  | 'Industrial'
  | 'Endo Steel'
  | 'Endo Steel Prototype'
  | 'Reinforced'
  | 'Composite'
  | 'Endo-Composite';

/** Map from BLK internal_type code → StructureType */
export const STRUCTURE_TYPE_FROM_CODE: Record<number, StructureType> = {
  0: 'Standard',
  1: 'Industrial',
  2: 'Endo Steel',
  3: 'Endo Steel Prototype',
  4: 'Reinforced',
  5: 'Composite',
  6: 'Endo-Composite',
};

/** Reverse map from StructureType → BLK numeric code */
export const STRUCTURE_TYPE_TO_CODE: Record<StructureType, number> = {
  'Standard': 0,
  'Industrial': 1,
  'Endo Steel': 2,
  'Endo Steel Prototype': 3,
  'Reinforced': 4,
  'Composite': 5,
  'Endo-Composite': 6,
};

export function structureTypeFromCode(code: number): StructureType {
  return STRUCTURE_TYPE_FROM_CODE[code] ?? 'Standard';
}

export function structureTypeToCode(type: StructureType): number {
  return STRUCTURE_TYPE_TO_CODE[type] ?? 0;
}

/**
 * Parse a display name string (e.g. from MTF header after stripping IS/Clan
 * prefix) into a StructureType.  Since StructureType values ARE the display
 * names, this is a validated cast.
 */
export function parseStructureType(displayName: string): StructureType {
  if ((displayName as StructureType) in STRUCTURE_TYPE_TO_CODE) {
    return displayName as StructureType;
  }
  return 'Standard';
}
