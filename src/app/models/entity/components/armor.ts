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
 * - Patchwork armor composition by location
 */

import { ArmorEquipment } from '../../equipment.model';
import {
  ArmorType,
  CompoundTechLevel,
  EquipmentTechBase,
  TechRating,
} from '../types';

// ============================================================================
// Patchwork armor sub-data
// ============================================================================

export type UniformArmorType = Exclude<ArmorType, 'PATCHWORK'>;

/** A single armor definition installed uniformly or at one patchwork location. */
export interface UniformMountedArmor {
  readonly type: UniformArmorType;
  readonly techBase: EquipmentTechBase;
  readonly armor: ArmorEquipment | null;
  /** Effective rules technology of this installed armor. */
  readonly technology: CompoundTechLevel;
  /** Explicit effective armor rating, or null when inherited by entity rules. */
  readonly techRating: TechRating | null;
  readonly patchwork: null;
}

/** Canonical patchwork composition: entity location → non-patchwork mounted armor. */
export type PatchworkArmor = ReadonlyMap<string, UniformMountedArmor>;

export interface PatchworkMountedArmor {
  readonly type: 'PATCHWORK';
  readonly armor: null;
  readonly patchwork: PatchworkArmor;
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
export type MountedArmor = UniformMountedArmor | PatchworkMountedArmor;

// ============================================================================
// MountedArmor - factory
// ============================================================================

/**
 * Create a MountedArmor with sensible defaults.
 * All fields can be overridden via the `opts` parameter.
 */
export function createMountedArmor(
  opts?: Partial<Omit<UniformMountedArmor, 'type' | 'patchwork'>> & { type?: UniformArmorType },
): UniformMountedArmor {
  if (opts?.armor?.armorType === 'PATCHWORK') {
    throw new Error('Patchwork armor cannot be installed inside patchwork armor');
  }
  return {
    type: opts?.type ?? 'STANDARD',
    techBase: opts?.techBase ?? 'IS',
    armor: opts?.armor ?? null,
    technology: opts?.technology ?? {
      level: opts?.armor?.level ?? 'Introductory',
      scope: opts?.techBase === 'Clan' ? 'Clan' : 'IS',
    },
    techRating: opts?.techRating ?? null,
    patchwork: null,
  };
}
/**
 * Create patchwork armor composition from location/armor pairs.
 */
export function createPatchworkArmor(
  armors?: ReadonlyMap<string, UniformMountedArmor>
    | Iterable<readonly [string, UniformMountedArmor]>,
): PatchworkArmor {
  const result = new Map(armors);
  for (const armor of result.values()) {
    if (armor.type === ('PATCHWORK' as ArmorType)) {
      throw new Error('Patchwork armor cannot contain patchwork armor');
    }
  }
  return result;
}

export function createPatchworkMountedArmor(
  armors?: ReadonlyMap<string, UniformMountedArmor>
    | Iterable<readonly [string, UniformMountedArmor]>,
): PatchworkMountedArmor {
  return { type: 'PATCHWORK', armor: null, patchwork: createPatchworkArmor(armors) };
}
