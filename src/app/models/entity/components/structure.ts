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
 * Internal Structure system component.
 *
 * Structures are fundamental structural elements of every Mek, with statically
 * known properties (crit slot count, weight multiplier, etc.) initialised at
 * runtime.  They are NOT equipment from equipment2.json.
 */

// ============================================================================
// Types
// ============================================================================

export type StructureType =
  | 'Standard' | 'Endo Steel' | 'Endo Steel Prototype'
  | 'Reinforced' | 'Composite' | 'Industrial' | 'Endo-Composite';

// ============================================================================
// Structure Component
// ============================================================================

export interface StructureComponent {
  readonly type: string;
  /** Whether this is a Clan variant (affects crit slot count) */
  readonly isClan: boolean;
  /** Number of critical slots that structure occupies across all locations */
  readonly criticalSlots: number;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Resolve a StructureComponent from type name and clan flag.
 * Critical slot counts are derived from the structure type and tech base.
 */
export function getStructure(type: string, isClan: boolean): StructureComponent {
  let critSlots = 0;
  switch (type) {
    case 'Endo Steel':
      critSlots = isClan ? 7 : 14;
      break;
    case 'Endo Steel Prototype':
      critSlots = 16;
      break;
    case 'Endo-Composite':
      critSlots = isClan ? 4 : 7;
      break;
    case 'Composite':
    case 'Reinforced':
    case 'Industrial':
    case 'Standard':
    default:
      critSlots = 0;
      break;
  }
  return { type, isClan, criticalSlots: critSlots };
}
