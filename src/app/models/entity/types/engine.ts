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
// Engine Types
// ============================================================================

export type EngineType =
  | 'Fusion' | 'ICE' | 'XL' | 'XXL' | 'Light' | 'Compact'
  | 'Fuel Cell' | 'Fission' | 'None' | 'Maglev' | 'Steam'
  | 'Battery' | 'Solar' | 'External';

/** Engine flags — derived from entity properties, not user-set */
export type EngineFlag =
  | 'clan' | 'tank' | 'large' | 'superheavy' | 'support-vee';

export const ENGINE_TYPE_FROM_CODE: Record<number, EngineType> = {
  0: 'Fusion', 1: 'ICE', 2: 'XL', 3: 'XXL', 4: 'Light', 5: 'Compact',
  6: 'Fuel Cell', 7: 'Fission', 8: 'None', 9: 'Maglev', 10: 'Steam',
  11: 'Battery', 12: 'Solar', 13: 'External',
};

export const ENGINE_TYPE_TO_CODE: Record<EngineType, number> = {
  'Fusion': 0, 'ICE': 1, 'XL': 2, 'XXL': 3, 'Light': 4, 'Compact': 5,
  'Fuel Cell': 6, 'Fission': 7, 'None': 8, 'Maglev': 9, 'Steam': 10,
  'Battery': 11, 'Solar': 12, 'External': 13,
};

export function engineTypeFromCode(code: number): EngineType {
  return ENGINE_TYPE_FROM_CODE[code] ?? 'Fusion';
}

export function engineTypeToCode(type: EngineType): number {
  return ENGINE_TYPE_TO_CODE[type] ?? 0;
}
