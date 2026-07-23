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
import { AeroEntity } from '../models/entity/entities/aero/aero-entity';
import { ConvFighterEntity } from '../models/entity/entities/aero/conv-fighter-entity';
import { DropShipEntity } from '../models/entity/entities/aero/dropship-entity';
import { FixedWingSupportEntity } from '../models/entity/entities/aero/fixed-wing-support-entity';
import { InfantryBaseEntity } from '../models/entity/entities/infantry/infantry-base-entity';
import { InfantryEntity } from '../models/entity/entities/infantry/infantry-entity';
import { JumpShipEntity } from '../models/entity/entities/largecraft/jumpship-entity';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import { VehicleEntity } from '../models/entity/entities/vehicle/vehicle-entity';
import { ASUnitTypeCode, Unit } from '../models/units.model';
import { EntityType, MoveType } from '../models/entity/types';
import { getBayTransporterType, isQuartersBay } from '../models/entity/bays/bay-definitions';
import { buildUnitCargoMetadata } from './unit-cargo-metadata-builder';
import { buildUnitComponentMetadata } from './unit-component-metadata-builder';

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
  build(entity: BaseEntity, unitFile?: string): Partial<Unit> {
    const me = entity.mountedEngine();
    return {
      // ── Phase 0: Identity ──────────────────────────────────────────
      name: this.buildName(entity),
      chassis: entity.fullChassis(),
      model: entity.model(),
      year: entity.year(),
      tons: entity.tonnage(),
      loadoutTons: this.buildLoadoutTons(entity),
      omni: entity.omni() ? 1 : 0,
      role: entity.role() || 'None',
      source: entity.source().map(source => source.abbrev),
      published: entity.published().map(source => source.abbrev),
      type: entity.unitType(),
      id: entity.mulId(),
      canon: entity.canon(),
      unitFile: unitFile,

      // ── Phase 0: Direct signals ────────────────────────────────────
      techBase: this.buildTechBase(entity),
      engine: this.buildEngineName(entity),
      engineRating: this.exportsEngine(entity) ? me.rating : 0,
      armorType: this.buildArmorType(entity),
      structureType: entity.uniformStructureMaterial()?.structure.name
        ?? (entity.structureByLocation().size > 0 ? 'Standard' : null),
      armor: entity.totalArmorPoints(),
      internal: entity.totalInternalPoints(),
      armorPer: entity.maximumArmorPoints() > 0
        ? Math.round(entity.totalArmorPoints() / entity.maximumArmorPoints() * 100)
        : 0,
      c3: entity.c3System(),
      weightClass: this.buildWeightClass(entity),
      capital: this.buildCapitalData(entity),
      cargo: buildUnitCargoMetadata(entity.transporters()),
      comp: buildUnitComponentMetadata(entity),
      su: entity.entityType === 'BattleArmor'
        || entity.entityType === 'Infantry'
        || entity.entityType === 'ProtoMek' ? 1 : 0,
      subtype: entity.unitSubtype(),
      level: entity.staticTechLevel(),
      techRating: entity.techRating(),

      walk: entity.walkMP(),
      walk2: entity.maxWalkMP(),
      run: entity.runMP(),
      run2: entity.maxRunMP(),
      jump: entity.jumpMP(),
      jump2: entity.maxJumpMP(),
      umu: entity.umuMP(),
      squads: this.buildSquadCount(entity),
      squadSize: this.buildSquadSize(entity),      
      
      heat: entity.heatGeneration(),
      dissipation: entity.heatDissipation(),
      diss: entity.heatDissipationRange() ? [...entity.heatDissipationRange()!] : undefined,
      engineHS: entity.engineHeatSinks(),
      engineHSType: entity.engineHeatSinkType(),
      moveType: this.buildMoveType(entity),
      quirks: entity.quirks().map(({ quirk }) => quirk.name),
      crewSize: entity.crewSlotCount(),
      features: this.buildFeatures(entity),
      cost: Math.round(entity.cost()),
      bv: entity.battleValue(),
      offSpeedFactor: entity.offensiveSpeedFactor(),
    };
  }

  private buildLoadoutTons(entity: BaseEntity): number {
    try {
      return entity.effectiveTonnage();
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Effective tonnage is not implemented for ')) {
        return 0;
      }
      throw error;
    }
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

  /** Mirrors SVGMassPrinter.UnitData.getFeatures(). */
  private buildFeatures(entity: BaseEntity): string[] {
    const features: string[] = [];

    if (entity instanceof AeroEntity) {
      if (entity.cockpitType() === 'Small') features.push('Small Cockpit');
      else if (entity.cockpitType() === 'Command Console') features.push('Command Console');
      if ((entity instanceof ConvFighterEntity || entity instanceof FixedWingSupportEntity)
        && entity.vstol()) features.push('VSTOL Equipment');
      if (entity instanceof JumpShipEntity && entity.lithiumFusion()) features.push('LF Battery');
    }

    if (entity instanceof MekEntity) {
      const featuredCockpits = new Set([
        'Small',
        'Command Console',
        'Torso-Mounted',
        'Dual',
        'Interface',
        'Virtual Reality Piloting Pod',
        'Superheavy Command Console',
        'Small Command Console',
      ]);
      if (featuredCockpits.has(entity.cockpitType())) {
        features.push(entity.mountedCockpit().fullName);
      }
      if (entity.gyroType() !== 'Standard' && entity.gyroType() !== 'None') {
        features.push(entity.mountedGyro().fullName);
      }
      if (entity.hasFullHeadEjectionSystem()) features.push('Full Head Ejection System');
      if (entity.hasRiscHeatSinkOverrideKit()) features.push('RISC Heat Sink Override Kit');
      if (entity.hasHybridStructure()) features.push('FrankenMek');
    }

    if (entity.isSupportVehicle() || entity instanceof VehicleEntity) {
      const chassisMods = new Set<string>();
      for (const mount of entity.equipment()) {
        if (mount.equipment?.hasFlag('F_CHASSIS_MODIFICATION')) {
          chassisMods.add(`Chassis Mod: ${mount.equipment.shortName}`);
        }
      }
      features.push(...chassisMods);
    }

    const hasEquipmentFlag = (flag: string): boolean => entity.equipment().some(
      mount => mount.equipment?.hasFlag(flag),
    );
    if (hasEquipmentFlag('F_ADVANCED_FIRE_CONTROL')) features.push('Advanced Fire Control');
    else if (hasEquipmentFlag('F_BASIC_FIRE_CONTROL')) features.push('Basic Fire Control');

    const transportTypes = new Set<string>();
    for (const transporter of entity.transporters()) {
      if (transporter.kind === 'troop-space') {
        transportTypes.add('Infantry Compartment');
      } else if (transporter.kind === 'bay' && !isQuartersBay(transporter)) {
        transportTypes.add(`Bay: ${getBayTransporterType(transporter.configuration)}`);
      }
    }
    features.push(...transportTypes);
    return features;
  }

  /** Translate canonical entity movement into MegaMek's exported movement name. */
  private buildMoveType(entity: BaseEntity): MoveType {
    if (entity instanceof InfantryEntity) {
      const mount = entity.mount();
      if (mount) return mount.movementMode as MoveType;
      if (entity.motiveType() === 'VTOL') {
        return entity.isMicrolite() ? 'Microlite' : 'Microcopter';
      }
      if (entity.motiveType() === 'UMU') {
        return entity.isMotorizedScuba() ? 'Motorized SCUBA' : 'SCUBA';
      }
    }

    switch (entity.motiveType()) {
      case 'Track':
      case 'Wheel':
        return 'Quad';
      case 'Station Keeping':
        return 'Station-Keeping';
      case 'Aerospace':
        return 'Aerodyne';
      case 'Beast':
      case 'Airship':
        return 'ERROR';
      default:
        return entity.motiveType() as MoveType;
    }
  }

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
    if (entity instanceof DropShipEntity) {
      return entity.motiveType() === 'Spheroid' ? 'DS' : 'DA';
    }

    const ENTITY_TO_AS_PREFIX: Partial<Record<EntityType, ASUnitTypeCode>> = {
      'Mek': 'BM',
      'Tank': 'CV',               // TODO: SV for support
      'Naval': 'CV',
      'VTOL': 'CV',
      'SupportTank': 'SV',
      'SupportNaval': 'SV',
      'SupportVTOL': 'SV',
      'LargeSupportTank': 'SV',
      'Infantry': 'CI',
      'BattleArmor': 'BA',
      'ProtoMek': 'PM',
      'Aero': 'AF',               // TODO: CF for conventional
      'ConvFighter': 'CF',
      'FixedWingSupport': 'SV',
      'SmallCraft': 'SC',
      'DropShip': 'DS',
      'JumpShip': 'JS',
      'WarShip': 'WS',
      'SpaceStation': 'SS',
    };
    return ENTITY_TO_AS_PREFIX[entity.entityType] ?? '';
  }

  /** Unit metadata tech-base description. */
  private buildTechBase(entity: BaseEntity): any {
    if (entity.mixedTech()) return 'Mixed';
    return entity.techBase() === 'IS' ? 'Inner Sphere' : 'Clan';
  }

  private buildEngineName(entity: BaseEntity): any {
    if (!this.exportsEngine(entity)) return null;

    const engine = entity.mountedEngine();
    const type = engine.type();
    return type === 'XL' || type === 'XXL' ? `${type} (${engine.techBase})` : type;
  }

  private exportsEngine(entity: BaseEntity): boolean {
    if (!entity.mountedEngine().installed) return false;
    return !ENGINELESS_EXPORT_TYPES.has(entity.entityType);
  }

  private buildWeightClass(entity: BaseEntity): Unit['weightClass'] {
    switch (entity.weightClass()) {
      case 'Ultra Light': return 'Ultra Light/PA(L)/Exoskeleton';
      case 'Light': return 'Light';
      case 'Medium': return 'Medium';
      case 'Heavy': return 'Heavy';
      case 'Assault': return 'Assault';
      case 'Super Heavy': return 'Colossal/Super-Heavy';
      case 'Small Craft': return 'Small Craft';
      case 'Small DropShip': return 'Small Dropship';
      case 'Medium DropShip': return 'Medium Dropship';
      case 'Large DropShip': return 'Large Dropship';
      case 'Small Support': return 'Small Support Vehicle';
      case 'Medium Support': return 'Medium Support Vehicle';
      case 'Large Support': return 'Large Support Vehicle';
      case 'Small Capital': return this.buildCapitalWeightClass(entity, 'Small');
      case 'Large Capital': return this.buildCapitalWeightClass(entity, 'Large');
    }
  }

  private buildCapitalWeightClass(entity: BaseEntity, size: 'Small' | 'Large'): Unit['weightClass'] {
    switch (entity.entityType) {
      case 'WarShip': return `${size} Warship`;
      case 'SpaceStation': return `${size} Space Station`;
      default: return `${size} Jumpship`;
    }
  }

  private buildCapitalData(entity: BaseEntity): Unit['capital'] {
    if (!(entity instanceof JumpShipEntity)) return undefined;
    return {
      dropshipCapacity: entity.dockingCollarCount(),
      escapePods: entity.escapePods(),
      lifeBoats: entity.lifeboats(),
      gravDecks: entity.gravDecks(),
      sailIntegrity: entity.sail() ? entity.sailIntegrity() : 0,
      kfIntegrity: entity.driveCoreType() === 'None' ? 0 : entity.kfIntegrity(),
    };
  }

  private buildSquadCount(entity: BaseEntity): number {
    return entity instanceof InfantryBaseEntity ? entity.squadCount() : 0;
  }

  private buildSquadSize(entity: BaseEntity): number {
    return entity instanceof InfantryBaseEntity ? entity.squadSize() : 0;
  }

  /** Armor type string as it appears in units.json. */
  private buildArmorType(entity: BaseEntity): string {
    if (entity instanceof InfantryEntity) {
      const armorKit = entity.armorKit();
      if (armorKit) return armorKit.name;
      if (entity.hasDEST()) return 'Custom DEST';

      const sneakSystems = [
        entity.sneakCamo() ? 'Camo' : '',
        entity.sneakIR() ? 'IR' : '',
        entity.sneakECM() ? 'ECM' : '',
      ].filter(Boolean);
      if (sneakSystems.length > 0) return `Custom Sneak(${sneakSystems.join('/')})`;
      return entity.armorDivisor() !== 1 ? 'Custom' : '';
    }

    if (entity.hasPatchworkArmor()) return ARMOR_TYPE_DISPLAY_NAME['PATCHWORK'] ?? 'Patchwork';
    const armorType = entity.uniformArmor()?.type ?? 'STANDARD';
    return ARMOR_TYPE_DISPLAY_NAME[armorType] ?? armorType;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Static data
// ═══════════════════════════════════════════════════════════════════════════

const ENGINELESS_EXPORT_TYPES: ReadonlySet<EntityType> = new Set([
  'SmallCraft', 'DropShip', 'JumpShip', 'WarShip', 'SpaceStation',
]);

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
  'EDP': 'Electric Discharge ProtoMech',
  'ANTI_PENETRATIVE_ABLATION': 'Anti-Penetrative Ablation',
  'HEAT_DISSIPATING': 'Heat-Dissipating',
  'IMPACT_RESISTANT': 'Impact-Resistant',
  'BALLISTIC_REINFORCED': 'Ballistic-Reinforced',
  'ALUM': 'Ferro-Aluminum',
  'HEAVY_ALUM': 'Heavy Ferro-Aluminum',
  'LIGHT_ALUM': 'Light Ferro-Aluminum',
  'FERRO_ALUM_PROTO': 'Prototype Ferro-Aluminum',
  'STEALTH_VEHICLE': 'Vehicular Stealth',
  'LC_FERRO_CARBIDE': 'Ferro-Carbide',
  'LC_LAMELLOR_FERRO_CARBIDE': 'Lamellor Ferro-Carbide',
  'LC_FERRO_IMP': 'Improved Ferro-Aluminum',
  'AEROSPACE': 'Standard Aerospace',
  'STANDARD_PROTOMEK': 'Standard ProtoMech',
  'PRIMITIVE_FIGHTER': 'Primitive Fighter',
  'PRIMITIVE_AERO': 'Primitive Aerospace',
  'BA_STANDARD': 'BA Standard (Basic)',
  'BA_STANDARD_PROTOTYPE': 'BA Standard (Prototype)',
  'BA_STANDARD_ADVANCED': 'BA Advanced',
  'BA_STEALTH_BASIC': 'BA Stealth (Basic)',
  'BA_STEALTH': 'BA Stealth (Standard)',
  'BA_STEALTH_IMP': 'BA Stealth (Improved)',
  'BA_STEALTH_PROTOTYPE': 'BA Stealth (Prototype)',
  'BA_FIRE_RESIST': 'BA Fire Resistant',
  'BA_MIMETIC': 'BA Mimetic',
  'BA_REFLECTIVE': 'BA Laser Reflective (Reflec/Glazed)',
  'BA_REACTIVE': 'BA Reactive (Blazer)',
  'SV_BAR_2': 'BAR: 2',
  'SV_BAR_3': 'BAR: 3',
  'SV_BAR_4': 'BAR: 4',
  'SV_BAR_5': 'BAR: 5',
  'SV_BAR_6': 'BAR: 6',
  'SV_BAR_7': 'BAR: 7',
  'SV_BAR_8': 'BAR: 8',
  'SV_BAR_9': 'BAR: 9',
  'SV_BAR_10': 'BAR: 10',
};
