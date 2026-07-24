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
 *
 * Patchwork is deliberately not represented here. It is derived from the
 * effective armor installed at each entity location.
 */

import { ArmorEquipment } from '../../equipment.model';
import {
  ArmorType,
  CompoundTechLevel,
  EquipmentTechBase,
  TechRating,
} from '../types';

export type MountedArmorType = Exclude<ArmorType, 'PATCHWORK'>;

export interface MountedArmorOptions {
  readonly armor: ArmorEquipment;
  readonly techBase?: EquipmentTechBase;
  /** Effective rules technology of this installed armor. */
  readonly technology?: CompoundTechLevel;
  /** Explicit effective armor rating, or null when inherited by entity rules. */
  readonly techRating?: TechRating | null;
}

/** Complete immutable armor definition installed at one entity location. */
export class MountedArmor {
  readonly armor: ArmorEquipment;
  readonly techBase: EquipmentTechBase;
  readonly technology: CompoundTechLevel;
  readonly techRating: TechRating | null;

  constructor(options: MountedArmorOptions) {
    if (options.armor.armorType === 'PATCHWORK') {
      throw new Error('Patchwork is an entity layout, not an installable location armor');
    }
    this.armor = options.armor;
    this.techBase = options.techBase ?? options.armor.techBase;
    this.technology = options.technology ?? {
      level: options.armor.level,
      scope: this.techBase === 'Clan' ? 'Clan' : 'IS',
    };
    this.techRating = options.techRating ?? null;
    Object.freeze(this);
  }

  get type(): MountedArmorType {
    return this.armor.armorType as MountedArmorType;
  }

  /** Semantic equality for effective location armor; never rely on object identity. */
  equals(other: MountedArmor): boolean {
    return this.armor.id === other.armor.id
      && this.techBase === other.techBase
      && this.technology.level === other.technology.level
      && this.technology.scope === other.technology.scope
      && this.techRating === other.techRating;
  }
}
