// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { BaseEntity } from '../models/entity/base-entity';
import { InfantryBaseEntity } from '../models/entity/entities/infantry/infantry-base-entity';
import { InfantryEntity } from '../models/entity/entities/infantry/infantry-entity';
import { JumpShipEntity } from '../models/entity/entities/largecraft/jumpship-entity';
import { UnitSummary } from '../models/unit-summary.model';
import { EntityType, MoveType } from '../models/entity/types';
import { buildUnitCargoMetadata } from './unit-cargo-metadata-builder';
import { buildUnitComponentMetadata } from './unit-component-metadata-builder';
import { convertEntityToAlphaStrike } from '../models/entity/utils/alpha-strike/alpha-strike-converter';
import { alphaStrikeUnitType } from '../models/entity/utils/alpha-strike/foundation/unit-classification';
import type { UnitIconResolver } from './unit-sprite-resolver';
import {
  armorTypeDisplayName,
  equipmentFireControlFeature,
} from './unit-summary-display-facts';
import { buildUnitRulesRefs } from './unit-rules-ref-builder';

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
  constructor(private readonly resolveIcon: UnitIconResolver = () => '') {}

  /**
   * Build metadata for a single entity.
   *
   * Returns only the fields that are currently implemented.
   * Use the compare-unit-output script to validate against units.json.
   */
  build(entity: BaseEntity, unitFile?: string): Partial<UnitSummary> {
    const me = entity.mountedEngine();
    const alphaStrikeUnitStats = convertEntityToAlphaStrike(entity);
    return {
      // ── Phase 0: Identity ──────────────────────────────────────────
      uuid: entity.uuid() as UnitSummary['uuid'],
      name: this.buildName(entity),
      icon: this.resolveIcon(entity),
      chassis: entity.fullChassis(),
      model: entity.model(),
      year: entity.year(),
      tons: entity.tonnage(),
      loadoutTons: this.buildLoadoutTons(entity),
      omni: entity.omni() ? 1 : 0,
      role: entity.role() || 'None',
      source: entity.source().map(source => source.abbrev),
      published: entity.published().map(source => source.abbrev),
      rulesRefs: buildUnitRulesRefs(entity),
      type: entity.unitType(),
      id: entity.mulId(),
      canon: entity.canon(),
      canAntiMech: this.buildCanAntiMech(entity),
      unitFile: unitFile,

      // ── Phase 0: Direct signals ────────────────────────────────────
      techBase: entity.techBase() === 'IS' ? 'Inner Sphere' : 'Clan',
      mixed: entity.mixedTech(),
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
      as: alphaStrikeUnitStats,
    };
  }

  private buildLoadoutTons(entity: BaseEntity): number {
    try {
      return entity.loadoutTonnage();
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Effective tonnage is not implemented for ')) {
        return 0;
      }
      throw error;
    }
  }

  private buildCanAntiMech(entity: BaseEntity): boolean {
    return entity instanceof InfantryBaseEntity ? entity.canAntiMech() : false;
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
    const tp = alphaStrikeUnitType(entity);
    const raw = `${tp!=='XX'?tp:''}${entity.chassis()}_${entity.model()}`;
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
    const features: string[] = [...entity.entityFeatures()];

    const fireControl = equipmentFireControlFeature(flag => entity.equipment().some(
      mount => mount.equipment?.hasFlag(flag),
    ));
    if (fireControl) features.push(fireControl);

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

  private buildWeightClass(entity: BaseEntity): UnitSummary['weightClass'] {
    switch (entity.weightClass()) {
      case 'Ultra Light': return 'Ultra Light/PA(L)/Exoskeleton';
      case 'Light': return 'Light';
      case 'Medium': return 'Medium';
      case 'Heavy': return 'Heavy';
      case 'Assault': return 'Assault';
      case 'Super Heavy': return 'Colossal/Super-Heavy';
      case 'Small Craft': return 'Small Craft';
      case 'Small DropShip': return 'Small DropShip';
      case 'Medium DropShip': return 'Medium DropShip';
      case 'Large DropShip': return 'Large DropShip';
      case 'Small Support': return 'Small Support Vehicle';
      case 'Medium Support': return 'Medium Support Vehicle';
      case 'Large Support': return 'Large Support Vehicle';
      case 'Small Capital': return this.buildCapitalWeightClass(entity, 'Small');
      case 'Large Capital': return this.buildCapitalWeightClass(entity, 'Large');
    }
  }

  private buildCapitalWeightClass(entity: BaseEntity, size: 'Small' | 'Large'): UnitSummary['weightClass'] {
    switch (entity.entityType) {
      case 'WarShip': return `${size} WarShip`;
      case 'SpaceStation': return `${size} Space Station`;
      default: return `${size} JumpShip`;
    }
  }

  private buildCapitalData(entity: BaseEntity): UnitSummary['capital'] {
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

    if (entity.hasPatchworkArmor()) return armorTypeDisplayName('PATCHWORK', 'Patchwork');
    const armorType = entity.uniformArmor()?.type ?? 'STANDARD';
    return armorTypeDisplayName(armorType, armorType);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Static data
// ═══════════════════════════════════════════════════════════════════════════

const ENGINELESS_EXPORT_TYPES: ReadonlySet<EntityType> = new Set([
  'SmallCraft', 'DropShip', 'JumpShip', 'WarShip', 'SpaceStation',
]);
