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
 * Armor system component & MountedArmor wrapper.
 *
 * **MountedArmor** consolidates all armor-type metadata into a single
 * immutable object, following the MountedEngine pattern.  Armor *point
 * values* per location remain a separate signal on BaseEntity because
 * they are mutated independently (e.g. by the designer).
 *
 * The interface covers:
 * - The armor type (ArmorType enum)
 * - Armor-specific tech base (may differ from entity tech base in mixed-tech)
 * - Resolved ArmorEquipment from the equipment database
 * - Tech rating override for BLK output
 * - Patchwork sub-data (per-location type codes, tech, ratings)
 */

import { ArmorEquipment } from '../../equipment.model';
import {
  ArmorType,
  CompoundTechLevel,
  EquipmentTechBase,
} from '../types';

// ============================================================================
// Patchwork armor sub-data
// ============================================================================

/**
 * Per-location armor data for PATCHWORK armor.  BLK and MTF store this
 * information differently, so we carry both representations:
 *
 * - **BLK** uses numeric codes + tech strings + tech rating integers
 * - **MTF** uses display-name strings like `"Reactive(Inner Sphere)"`
 */
export interface PatchworkArmor {
  /** BLK: per-location armor type code (e.g. `{ 'Nose': 2, 'Left Wing': 1 }`) */
  readonly codes: Map<string, number>;
  /** BLK: per-location armor tech string (e.g. `{ 'Nose': 'IS' }`) */
  readonly techs: Map<string, string>;
  /** BLK: per-location armor tech rating (A=0 … F=5) */
  readonly ratings: Map<string, number>;
  /** MTF: per-location armor type display string (e.g. `{ 'CT': 'Reactive(Inner Sphere)' }`) */
  readonly types: Map<string, string>;
}

// ============================================================================
// MountedArmor - interface
// ============================================================================

/**
 * MountedArmor wraps all armor-type configuration for an entity.
 *
 * This does NOT include per-location armor point values (`armorValues`),
 * which remain a separate signal on BaseEntity.
 */
export interface MountedArmor {
  /** ArmorType enum value (e.g. 'STANDARD', 'FERRO_FIBROUS', 'PATCHWORK') */
  readonly type: ArmorType;

  /** Armor-specific tech base (may differ from entity tech base in mixed-tech) */
  readonly techBase: EquipmentTechBase;

  /** Resolved ArmorEquipment from the equipment DB, or null for PATCHWORK / unknown */
  readonly armor: ArmorEquipment | null;

  /** Effective armor technology stored independently of the equipment definition. */
  readonly technology: CompoundTechLevel;

  /**
   * Explicit tech rating override (A=0 … F=5).
   * -1 means not explicitly set - writer derives from equipment.
   */
  readonly techRating: number;

  /** Patchwork armor data; null when armor type is not PATCHWORK */
  readonly patchwork: PatchworkArmor | null;
}

// ============================================================================
// MountedArmor - factory
// ============================================================================

/**
 * Create a MountedArmor with sensible defaults.
 * All fields can be overridden via the `opts` parameter.
 */
export function createMountedArmor(
  opts?: Partial<MountedArmor>,
): MountedArmor {
  return {
    type: opts?.type ?? 'STANDARD',
    techBase: opts?.techBase ?? 'IS',
    armor: opts?.armor ?? null,
    technology: opts?.technology ?? { level: 'Introductory', scope: 'IS' },
    techRating: opts?.techRating ?? -1,
    patchwork: opts?.patchwork ?? null,
  };
}
/**
 * Create empty PatchworkArmor data.
 */
export function createPatchworkArmor(
  opts?: Partial<PatchworkArmor>,
): PatchworkArmor {
  return {
    codes: opts?.codes ?? new Map(),
    techs: opts?.techs ?? new Map(),
    ratings: opts?.ratings ?? new Map(),
    types: opts?.types ?? new Map(),
  };
}
