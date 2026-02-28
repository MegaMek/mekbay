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
// Quirks
// ============================================================================

export interface EntityQuirk {
  name: string;
}

export interface EntityWeaponQuirk {
  name: string;
  weaponName: string;
  location: string;
  slot: number;
}

// ============================================================================
// Fluff
// ============================================================================

export interface EntityFluff {
  overview?: string;
  capabilities?: string;
  deployment?: string;
  history?: string;
  manufacturer?: string;
  primaryFactory?: string;
  systemManufacturers?: Record<string, string>;
  systemModels?: Record<string, string>;
  notes?: string;
  /** Spacecraft-specific fluff fields */
  use?: string;
  length?: string;
  width?: string;
  height?: string;
}

// ============================================================================
// Validation - tiered slices
//
// Validation is split into independent computed slices (engine, armor,
// equipment, type-specific) so that changing armour doesn't recompute the
// engine check, and vice-versa.  A single aggregate computed collects them.
// ============================================================================

export type ValidationCategory =
  | 'engine' | 'armor' | 'weight' | 'equipment' | 'structure'
  | 'movement' | 'heat' | 'tech' | 'crit' | 'general';

export interface EntityValidationMessage {
  severity: 'error' | 'warning' | 'info';
  category: ValidationCategory;
  code: string;
  message: string;
  location?: string;
}

export interface EntityValidationResult {
  valid: boolean;
  messages: EntityValidationMessage[];
}
