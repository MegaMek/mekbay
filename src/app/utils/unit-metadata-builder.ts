/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { BaseEntity } from '../models/entity/base-entity';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import { ASUnitTypeCode, Unit } from '../models/units.model';
import { EntityType, STRUCTURE_TYPE_DISPLAY_NAME } from '../models/entity/types';

/**
 * Builds a `Partial<Unit>` metadata object from a parsed entity.
 *
 * Fields are added incrementally — the builder starts with trivial identity
 * fields and grows as more entity computeds are implemented and validated
 * against the Java-generated `units.json` oracle.
 *
 * This is an external utility, NOT on the entity class, because the `Unit`
 * interface is a metadata/export concern, not a game-mechanics concern.
 */
export class UnitMetadataBuilder {

  /**
   * Build metadata for a single entity.
   *
   * Returns only the fields that are currently implemented.
   * Use the compare-unit-output script to validate against units.json.
   */
  build(entity: BaseEntity): Partial<Unit> {
    return {
      // ── Phase 0: Identity ──────────────────────────────────────────
      name: this.buildName(entity),
      chassis: entity.fullChassis(),
      model: entity.model(),
      year: entity.year(),
      tons: entity.tonnage(),
      omni: entity.omni() ? 1 : 0,
      role: entity.role(),
      source: this.buildSource(entity),
      type: this.mapUnitType(entity),
      id: entity.mulId(),

      // ── Phase 0: Direct signals ────────────────────────────────────
      techBase: this.buildTechBase(entity),
      engine: entity.engineType() || null as any,
      engineRating: entity.engineRating(),
      armorType: this.buildArmorType(entity),
      structureType: STRUCTURE_TYPE_DISPLAY_NAME[entity.structureType()] ?? entity.structureType(),
      armor: entity.totalArmor(),

      // ── Phase 1: Movement (implement on entity first) ──────────────
      walk: entity.walkMP(),
      run: entity.runMP(),
      jump: entity.jumpMP(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Name / ID generation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generates the sanitized unique name/ID used as the key in units.json.
   *
   * Format: `{ASUnitTypePrefix}{chassis}_{model}` → sanitized.
   *
   * Mirrors Java's `SVGMassPrinter.generateName()`:
   *  1. Concatenate `prefix + chassis + "_" + model`
   *  2. Strip everything except `[a-zA-Z0-9_]`
   *  3. Collapse multiple underscores
   *  4. Trim leading/trailing underscores
   */
  buildName(entity: BaseEntity): string {
    const prefix = this.getASUnitTypePrefix(entity);
    const raw = `${prefix}${entity.chassis()}_${entity.model()}`;
    return raw
      .replace(/[^a-zA-Z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private field helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Returns the Alpha Strike unit type prefix code for name generation.
   *
   * This is a simplified mapping based on entityType. The full Java logic
   * inspects subclass (industrial, support, spheroid, etc.) but we handle
   * the common cases here and refine incrementally.
   *
   * TODO: Detect industrial meks (IM), support vehicles (SV),
   *       aerodyne vs spheroid dropships (DA vs DS), etc.
   */
  private getASUnitTypePrefix(entity: BaseEntity): ASUnitTypeCode | '' {
    // Industrial Meks use 'IM' prefix instead of 'BM'
    if (entity instanceof MekEntity) {
      if (entity.isIndustrial()) {
        return 'IM';
      }
    }

    const ENTITY_TO_AS_PREFIX: Partial<Record<EntityType, ASUnitTypeCode>> = {
      'Mek': 'BM',
      'Tank': 'CV',               // TODO: SV for support
      'Naval': 'CV',
      'VTOL': 'CV',
      'SupportTank': 'SV',
      'SupportVTOL': 'SV',
      'LargeSupportTank': 'SV',
      'Infantry': 'CI',
      'BattleArmor': 'BA',
      'ProtoMek': 'PM',
      'Aero': 'AF',               // TODO: CF for conventional
      'ConvFighter': 'CF',
      'FixedWingSupport': 'SV',
      'SmallCraft': 'SC',
      'DropShip': 'DS',           // TODO: DA for aerodyne
      'JumpShip': 'JS',
      'WarShip': 'WS',
      'SpaceStation': 'SS',
      'HandheldWeapon': 'BD',
    };
    return ENTITY_TO_AS_PREFIX[entity.entityType] ?? '';
  }

  /**
   * Maps EntityType ('Mek', 'Tank', etc.) to the UnitType in units.json.
   * EntityType has more granularity (DropShip, JumpShip, etc.) while UnitType
   * collapses many into 'Aero'.
   */
  private mapUnitType(entity: BaseEntity): any {
    const mapping: Partial<Record<EntityType, string>> = {
      'Mek': 'Mek',
      'Tank': 'Tank',
      'Naval': 'Naval',
      'VTOL': 'VTOL',
      'SupportTank': 'Tank',
      'SupportVTOL': 'VTOL',
      'LargeSupportTank': 'Tank',
      'Infantry': 'Infantry',
      'BattleArmor': 'Infantry',
      'ProtoMek': 'ProtoMek',
      'Aero': 'Aero',
      'ConvFighter': 'Aero',
      'FixedWingSupport': 'Aero',
      'SmallCraft': 'Aero',
      'DropShip': 'Aero',
      'JumpShip': 'Aero',
      'WarShip': 'Aero',
      'SpaceStation': 'Aero',
      'HandheldWeapon': 'Handheld Weapon',
    };
    return mapping[entity.entityType] ?? entity.entityType;
  }

  /** Source is stored as a string signal but units.json has string[]. */
  private buildSource(entity: BaseEntity): string[] {
    const raw = entity.source();
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  /** TechBase: 'Inner Sphere', 'Clan', or 'Mixed'. */
  private buildTechBase(entity: BaseEntity): any {
    if (entity.mixedTech()) return 'Mixed';
    return entity.techBase();
  }

  /** Armor type string as it appears in units.json. */
  private buildArmorType(entity: BaseEntity): string {
    // TODO: handle patchwork armor
    const armorType = entity.armorType();
    return ARMOR_TYPE_DISPLAY_NAME[armorType] ?? armorType;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Static data
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map internal ArmorType codes to display names used in units.json.
 * These match the names from Java's `EquipmentType.getArmorTypeName()`.
 */
const ARMOR_TYPE_DISPLAY_NAME: Partial<Record<string, string>> = {
  'STANDARD': 'Standard Armor',
  'FERRO_FIBROUS': 'Ferro-Fibrous',
  'REACTIVE': 'Reactive',
  'REFLECTIVE': 'Reflective',
  'HARDENED': 'Hardened',
  'LIGHT_FERRO': 'Light Ferro-Fibrous',
  'HEAVY_FERRO': 'Heavy Ferro-Fibrous',
  'PATCHWORK': 'Patchwork',
  'STEALTH': 'Stealth',
  'FERRO_FIBROUS_PROTO': 'Ferro-Fibrous Prototype',
  'COMMERCIAL': 'Commercial, BAR: 5',
  'INDUSTRIAL': 'Industrial',
  'HEAVY_INDUSTRIAL': 'Heavy Industrial',
  'FERRO_LAMELLOR': 'Ferro-Lamellor',
  'PRIMITIVE': 'Primitive',
  'EDP': 'Electric Discharge ProtoMek',
  'ANTI_PENETRATIVE_ABLATION': 'Anti-Penetrative Ablation',
  'HEAT_DISSIPATING': 'Heat-Dissipating',
  'IMPACT_RESISTANT': 'Impact-Resistant',
  'BALLISTIC_REINFORCED': 'Ballistic-Reinforced',
  'ALUM': 'Ferro-Aluminum',
  'HEAVY_ALUM': 'Heavy Ferro-Aluminum',
  'LIGHT_ALUM': 'Light Ferro-Aluminum',
  'FERRO_ALUM_PROTO': 'Ferro-Aluminum Prototype',
  'STEALTH_VEHICLE': 'Stealth Vehicle',
  'LC_FERRO_CARBIDE': 'Ferro-Carbide',
  'LC_LAMELLOR_FERRO_CARBIDE': 'Lamellor Ferro-Carbide',
  'LC_FERRO_IMP': 'Improved Ferro-Aluminum',
  'AEROSPACE': 'Standard Armor',
  'STANDARD_PROTOMEK': 'Standard ProtoMek',
  'PRIMITIVE_FIGHTER': 'Primitive Fighter',
  'PRIMITIVE_AERO': 'Primitive Aero',
  'BA_STANDARD': 'BA Standard',
  'BA_STANDARD_PROTOTYPE': 'BA Standard (Prototype)',
  'BA_STANDARD_ADVANCED': 'BA Advanced',
  'BA_STEALTH_BASIC': 'BA Stealth (Basic)',
  'BA_STEALTH': 'BA Stealth',
  'BA_STEALTH_IMP': 'BA Stealth (Improved)',
  'BA_STEALTH_PROTOTYPE': 'BA Stealth (Prototype)',
  'BA_FIRE_RESIST': 'BA Fire Resistant',
  'BA_MIMETIC': 'BA Mimetic',
  'BA_REFLECTIVE': 'BA Reflective (Blazer)',
  'BA_REACTIVE': 'BA Reactive (Deflective)',
  'SV_BAR_2': 'BAR 2',
  'SV_BAR_3': 'BAR 3',
  'SV_BAR_4': 'BAR 4',
  'SV_BAR_5': 'BAR 5',
  'SV_BAR_6': 'BAR 6',
  'SV_BAR_7': 'BAR 7',
  'SV_BAR_8': 'BAR 8',
  'SV_BAR_9': 'BAR 9',
  'SV_BAR_10': 'BAR 10',
};
