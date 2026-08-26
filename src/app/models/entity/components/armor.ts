// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
import { equipmentPlatformFlag } from '../../equipment-platform.model';
import {
  ArmorType,
  CompoundTechLevel,
  EquipmentTechBase,
  TechRating,
} from '../types';

/**
 * Canonical Standard armor used by the compiler when a deliberately minimal
 * registry omits aggregate construction records.
 */
export const STANDARD_ARMOR_EQUIPMENT = new ArmorEquipment({
  version: '1.0',
  id: 'Standard Armor',
  name: 'Standard',
  type: 'armor',
  aliases: ['IS Standard Armor', 'Clan Standard Armor', 'Regular Armor'],
  stats: {
    tonnage: 0,
    cost: 10000,
    bv: 0,
    criticalSlots: 0,
    hittable: false,
    spreadable: true,
    tankSlots: 0,
    svSlots: 0,
    omniFixedOnly: true,
  },
  tech: {
    base: 'All',
    rating: 'D',
    level: 'Introductory',
    availability: { sl: 'C', sw: 'C', clan: 'C', da: 'B' },
    advancement: {
      is: { prototype: '~2460', production: '2470', common: '2470' },
      clan: { prototype: '~2460', production: '2470', common: '2470' },
    },
  },
  flags: [
    equipmentPlatformFlag('mek'),
    equipmentPlatformFlag('tank'),
    equipmentPlatformFlag('fighter'),
    equipmentPlatformFlag('support-tank'),
    equipmentPlatformFlag('vtol'),
  ],
  armor: { type: 'STANDARD', weightPerPoint: 0.05 },
});

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
