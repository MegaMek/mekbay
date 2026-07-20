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

import { BaseEntity } from '../base-entity';
import { AmmoEquipment, WeaponEquipment } from '../../equipment.model';
import {
  MountedEngine,
  MountedArmor,
  MountedStructure,
  STANDARD_STRUCTURE_EQUIPMENT,
  getStructureByTypeId,
} from '../components';
import { AeroEntity } from '../entities/aero/aero-entity';
import { MekEntity } from '../entities/mek/mek-entity';
import type { SupportVehicle } from '../entities/support-vehicle';
import { VehicleEntity } from '../entities/vehicle/vehicle-entity';
import {
  ArmorType,
  EntityFluff,
  EntityMountedEquipment,
  EntityQuirk,
  EntityTechBase,
  EntityWeaponQuirk,
  HeatSinkType,
  LocationArmor,
  VALID_TECH_BASE_STRINGS,
  locationArmor,
  normalizeSystemManufacturerKey,
  requireArmorEquipment,
  resolveArmorEquipment,
} from '../types';
import {
  componentTechLevelFromRulesLevel,
  decodeBlkArmorType,
  decodeBlkCompoundTechBase,
  decodeBlkCompoundTechLevel,
  decodeBlkTechRating,
  decodeBlkEngineType,
  decodeBlkHeatSinkType,
  parseBlkTechLevel,
} from './blk-codec';
import { createCompoundTechLevel } from '../types/tech';
import { BuildingBlock } from './building-block';
import { parseEquipmentLine, type EquipmentLineProfile } from './equipment-resolver';
import { parseTransporterLines } from './transporter-codec';
import { ParseContext } from './parse-context';

/**
 * Common BLK parsing - reads universal blocks that apply to all unit types.
 *
 * Each type-specific parser calls `parseBaseBlk(bb, entity, ctx)` first,
 * then handles its own type-specific blocks.
 */
export function parseBaseBlk(
  bb: BuildingBlock,
  entity: BaseEntity,
  ctx: ParseContext,
): void {
  // ── Identity ──
  const uuid = bb.getFirstString('UUID');
  if (uuid) entity.uuid.set(uuid);
  entity.chassis.set(bb.getFirstString('Name'));
  entity.model.set(bb.getFirstString('Model'));

  if (bb.exists('mul id:')) {
    const mulId = bb.getFirstInt('mul id:');
    ctx.validateNonNegativeInt('mul id:', mulId);
    entity.mulId.set(mulId);
  }

  // ── Year ──
  if (bb.exists('year')) {
    const year = bb.getFirstInt('year');
    ctx.validateNumber('year', year);
    entity.year.set(year);
  }

  if (bb.exists('originalBuildYear')) {
    const oby = bb.getFirstInt('originalBuildYear');
    ctx.validateNumber('originalBuildYear', oby);
    entity.originalBuildYear.set(oby);
  }

  // ── Tech Level ──
  if (bb.exists('type')) {
    const techStr = bb.getFirstString('type');
    ctx.validateEnum('type', techStr, VALID_TECH_BASE_STRINGS, 'tech level string');
    const parsed = parseBlkTechLevel(techStr);
    entity.techBase.set(parsed.techBase);
    entity.mixedTech.set(parsed.mixedTech);
    entity.rulesLevel.set(parsed.rulesLevel);
  }

  // ── Meta ──
  if (bb.exists('role')) {
    entity.role.set(bb.getFirstString('role'));
  }
  if (bb.exists('source')) {
    entity.source.set(parseMetadataList(bb.getDataAsString('source')).map(source => ctx.resolveSourcebook(source)));
  }
  if (bb.exists('published')) {
    entity.published.set(parseMetadataList(bb.getDataAsString('published')).map(source => ctx.resolveSourcebook(source)));
  }
  if (bb.exists('omni')) {
    entity.omni.set(bb.getFirstString('omni').toLowerCase() === 'true' || bb.getFirstInt('omni') === 1);
  }

  // ── Tonnage ──
  if (bb.exists('tonnage')) {
    const tonnage = bb.getFirstDouble('tonnage');
    if (!Number.isFinite(tonnage) || tonnage <= 0) {
      ctx.warn('tonnage', `Invalid tonnage: ${tonnage}`);
    }
    entity.setTonnage(tonnage);
  }

  // ── Internal structure type ──
  if (bb.exists('internal_type')) {
    const structureCode = bb.getFirstInt('internal_type');
    if (structureCode >= 0 && !resolveBlkStructure(entity, structureCode, ctx)) {
      ctx.error('internal_type', `Invalid structure type ${structureCode} for ${entity.techBase()} technology`);
    }
  }

  // ── Quirks ──
  if (bb.exists('quirks')) {
    const quirkLines = bb.getDataAsString('quirks');
    const quirks: EntityQuirk[] = [];
    for (const line of quirkLines) {
      const trimmed = line.trim();
      if (trimmed) {
        const quirk = ctx.resolveQuirk(trimmed);
        if (quirk) quirks.push(quirk);
      }
    }
    entity.quirks.set(quirks);
  }

  if (bb.exists('weaponquirks')) {
    const wqLines = bb.getDataAsString('weaponquirks');
    const wqs: EntityWeaponQuirk[] = [];
    for (const line of wqLines) {
      // Format: name:loc:slot:weaponName
      const parts = line.split(':');
      if (parts.length >= 4) {
        wqs.push({
          name: parts[0],
          location: parts[1],
          slot: parseInt(parts[2], 10),
          weaponName: parts[3],
        });
      }
    }
    entity.weaponQuirks.set(wqs);
  }

  // ── Transporters ──
  if (bb.exists('transporters')) {
    entity.transporters.set(parseTransporterLines(bb.getDataAsString('transporters'), entity.techBase(), ctx));
  }
  if ((entity instanceof MekEntity || entity instanceof VehicleEntity) && entity.omni()) {
    entity.transporters.update(transporters => [...transporters, {
      id: `transporter-${transporters.length + 1}`,
      kind: 'battle-armor-handles',
      troopers: -1,
      omni: false,
    }]);
  }

  // ── Fluff ──
  const fluff: EntityFluff = {};
  if (bb.exists('overview')) fluff.overview = bb.getDataAsString('overview').join('\n');
  if (bb.exists('capabilities')) fluff.capabilities = bb.getDataAsString('capabilities').join('\n');
  if (bb.exists('deployment')) fluff.deployment = bb.getDataAsString('deployment').join('\n');
  if (bb.exists('history')) fluff.history = bb.getDataAsString('history').join('\n');
  if (bb.exists('manufacturer')) fluff.manufacturer = bb.getDataAsString('manufacturer').join('\n');
  if (bb.exists('primaryFactory')) fluff.primaryFactory = bb.getFirstString('primaryFactory');
  if (bb.exists('notes')) fluff.notes = bb.getDataAsString('notes').join('\n');
  if (bb.exists('fluffDate')) fluff.fluffDate = bb.getFirstString('fluffDate');
  if (bb.exists('use')) fluff.use = bb.getFirstString('use');
  if (bb.exists('length')) fluff.length = bb.getFirstString('length');
  if (bb.exists('width')) fluff.width = bb.getFirstString('width');
  if (bb.exists('height')) fluff.height = bb.getFirstString('height');

  // System manufacturers
  {
    const sysMfrs: Record<string, string> = {};
    // Format 1: unified block
    if (bb.exists('systemManufacturers')) {
      const sysLines = bb.getDataAsString('systemManufacturers');
      for (const line of sysLines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const rawKey = line.substring(0, colonIdx);
          const canonical = normalizeSystemManufacturerKey(rawKey);
          if (!canonical) {
            ctx.warn('systemManufacturers', `Unknown system manufacturer key: "${rawKey}"`);
          }
          sysMfrs[canonical ?? rawKey] = line.substring(colonIdx + 1);
        }
      }
    }
    if (Object.keys(sysMfrs).length > 0) {
      fluff.systemManufacturers = sysMfrs;
    }
  }

  {
    const sysModels: Record<string, string> = {};
    if (bb.exists('systemModels')) {
      const modelLines = bb.getDataAsString('systemModels');
      for (const line of modelLines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const rawKey = line.substring(0, colonIdx);
          const canonical = normalizeSystemManufacturerKey(rawKey);
          if (!canonical) {
            ctx.warn('systemModels', `Unknown system model key: "${rawKey}"`);
          }
          sysModels[canonical ?? rawKey] = line.substring(colonIdx + 1);
        }
      }
    }
    if (Object.keys(sysModels).length > 0) {
      fluff.systemModels = sysModels;
    }
  }

  entity.fluff.set(fluff);

  // ── BV override ──
  if (bb.exists('bv')) {
    entity.manualBV.set(bb.getFirstInt('bv'));
  }

  // ── Icon / Fluff image ──
  if (bb.exists('icon')) {
    entity.iconEncoded.set(bb.getFirstString('icon'));
  }
  if (bb.exists('fluffimage')) {
    entity.fluffImageEncoded.set(bb.getFirstString('fluffimage'));
  }
}

export function resolveBlkStructure(
  entity: BaseEntity,
  typeId: number,
  ctx: ParseContext,
): boolean {
  const structure = getStructureByTypeId(typeId, entity.techBase(), ctx.equipmentDb);
  const fallback = getStructureByTypeId(0, entity.techBase(), ctx.equipmentDb)
    ?? STANDARD_STRUCTURE_EQUIPMENT;
  entity.setUniformStructure(new MountedStructure({
    tonnage: entity.tonnage(),
    structure: structure ?? fallback,
  }));
  return structure !== null;
}

function parseMetadataList(values: readonly string[]): string[] {
  return values.flatMap(value => value.split(',').map(item => item.trim()).filter(Boolean));
}

/**
 * Parse equipment from a location block in BLK format.
 * Returns array of equipment lines (already trimmed).
 */
export function getBlkEquipmentLines(bb: BuildingBlock, locationTag: string): string[] {
  if (!bb.exists(locationTag)) return [];
  return bb.getDataAsString(locationTag).filter(l => l.trim() !== '');
}

/**
 * Parse BLK equipment blocks for a set of location tags and add them
 * to the entity.
 *
 * Covers the common equipment-loading loop shared by aero, smallcraft,
 * dropship, largecraft, protomek, and vehicle parsers.
 *
 * For vehicles, pass `computeTurretMounted` to derive the turret flag
 * from the location code, and `includeTurretType: true` to forward the
 * parsed turret-type modifier.
 */
export function parseBlkEquipment(
  bb: BuildingBlock,
  entity: BaseEntity,
  ctx: ParseContext,
  equipTags: readonly (readonly [string, string])[],
  opts?: {
    computeTurretMounted?: (locCode: string) => boolean;
    includeTurretType?: boolean;
    equipmentLineProfile?: EquipmentLineProfile;
  },
): void {
  const createsWeaponBays = opts?.equipmentLineProfile === 'large-craft'
    || opts?.equipmentLineProfile === 'dropship';
  for (const [blkTag, locCode] of equipTags) {
    if (!bb.exists(blkTag)) continue;
    let currentBay: EntityMountedEquipment[] = [];
    const finishBay = (): void => {
      if (currentBay.length === 0) return;
      entity.addEquipmentBay('weapon-bay', { mounts: currentBay });
      currentBay = [];
    };
    const lines = bb.getDataAsString(blkTag);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line, { profile: opts?.equipmentLineProfile });
      if (parsed.omniPod) entity.omni.set(true);
      const resolved = ctx.resolveEquipment(parsed.name, blkTag, entity.techBase());
      const shotsCount = opts?.equipmentLineProfile === 'large-craft'
        || opts?.equipmentLineProfile === 'dropship'
        ? resolved?.type === 'ammo' ? parsed.shots : undefined
        : parsed.shots;

      const mount = entity.addEquipment({
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        allocation: { kind: 'location', location: locCode },
        rearMounted: parsed.rearMounted,
        turretMounted: opts?.computeTurretMounted?.(locCode) ?? false,
        turretType: opts?.includeTurretType ? parsed.turretType : undefined,
        omniPodMounted: parsed.omniPod,
        armored: false,
        size: parsed.size,
        facing: parsed.facing,
        shotsCount,
      });
      if (createsWeaponBays) {
        if (resolved instanceof WeaponEquipment) {
          if (parsed.isNewBay) finishBay();
          currentBay.push(mount);
        } else if (resolved instanceof AmmoEquipment && currentBay.length > 0) {
          currentBay.push(mount);
        }
      }
    }
    if (createsWeaponBays) finishBay();
  }
}

/**
 * Extract tech base from BLK type string for equipment resolution.
 */
export function getBlkTechBase(bb: BuildingBlock): EntityTechBase {
  if (bb.exists('type')) {
    const typeStr = bb.getFirstString('type').toLowerCase();
    if (typeStr.includes('clan')) return 'Clan';
  }
  return 'IS';
}

/**
 * Resolve the engine `isClan` flag from the BLK data.
 *
 * The `clan_engine` block explicitly overrides the default (which is derived
 * from the chassis tech base). This is essential for mixed-tech units where
 * the engine tech base differs from the chassis.
 */
export function getBlkEngineIsClan(bb: BuildingBlock): EntityTechBase {
  if (bb.exists('clan_engine')) {
    const val = bb.getFirstString('clan_engine');
    return val.toLowerCase() === 'true' || val === '1' ? 'Clan' : 'IS';
  }
  return getBlkTechBase(bb);
}

// ============================================================================
// Centralized BLK engine creation
// ============================================================================

/**
 * Options controlling how `parseBlkEngine` reads the BLK data.
 *
 * Every field is optional - sensible defaults are derived from the BLK
 * blocks themselves.
 */
export interface BlkEngineOpts {
  /** Mark the engine as super-heavy (tonnage > 100).  Default: `false`. */
  isSuperHeavy?: boolean;

  /** Entity-family-specific derived engine rating. Default: walk MP x tonnage. */
  rating?: number;

  /**
   * When `true` (the default), heat-sink fields (`sink_type`, `heatsinks`,
   * `base chassis heat sinks`) are read from the BLK and forwarded to
   * `MountedEngine`.  Set to `false` for unit types that never carry
   * heat sinks (vehicles, ProtoMeks).
   */
  includeHeatSinks?: boolean;

  /**
   * Default value for `totalHeatSinks` when the `heatsinks` block is
   * absent.  Most unit types use `10`; large craft use `0`.
   */
  defaultTotalHeatSinks?: number;

  /**
   * When `true`, the engine_type block is mandatory - the function returns
   * `undefined` when it is missing.  Used by vehicles and ProtoMeks whose
   * files always specify engine_type.
   */
  engineTypeRequired?: boolean;
}

/**
 * Parsed engine result.  Includes both the `MountedEngine` (always) and
 * the heat-sink metadata that several entity types copy onto the entity
 * itself.
 */
export interface BlkEngineResult {
  mountedEngine: MountedEngine;
  heatSinkType: HeatSinkType;
  totalHeatSinks: number;
}

/**
 * Parse the engine + heat-sink blocks that are duplicated across every
 * type-specific BLK parser.
 *
 * Returns `undefined` only when `opts.engineTypeRequired` is `true` and
 * the `engine_type` block is absent.
 */
export function parseBlkEngine(
  bb: BuildingBlock,
  entity: BaseEntity,
  opts: BlkEngineOpts = {},
): BlkEngineResult | undefined {
  const {
    isSuperHeavy = false,
    rating = entity.walkMP() * entity.tonnage(),
    includeHeatSinks = true,
    defaultTotalHeatSinks = 10,
    engineTypeRequired = false,
  } = opts;

  // ── Engine type ──
  if (engineTypeRequired && !bb.exists('engine_type')) return undefined;
  const engineType = bb.exists('engine_type')
    ? decodeBlkEngineType(bb.getFirstInt('engine_type'))
    : 'Fusion' as const;

  // ── Clan flag (respects clan_engine override for mixed-tech) ──
  const engineTechBase = getBlkEngineIsClan(bb);

  // ── Heat sinks ──
  let heatSinkType: HeatSinkType = 'Single';
  let totalHeatSinks = defaultTotalHeatSinks;

  if (includeHeatSinks) {
    if (bb.exists('sink_type')) {
      heatSinkType = decodeBlkHeatSinkType(bb.getFirstInt('sink_type'));
    }
    if (bb.exists('heatsinks')) {
      totalHeatSinks = bb.getFirstInt('heatsinks');
    }
  }

  const mountedEngine = new MountedEngine({
    type: engineType,
    rating,
    techBase: engineTechBase,
    isSuperHeavy,
  });

  return { mountedEngine, heatSinkType, totalHeatSinks };
}

// ============================================================================
// Shared BLK armor parsing
// ============================================================================

/**
 * Parse BLK armor type, tech base, equipment, tech overrides, and patchwork
 * into a single MountedArmor and set it on the entity.
 *
 * Called by entity-specific BLK parsers after `parseBaseBlk()`.
 * **Not used by** BA (different compound tech encoding),
 * infantry (uses `armorDivisor` / `armorKit`), or handheld (no armor type).
 */
export function parseBlkArmor(
  bb: BuildingBlock,
  entity: BaseEntity,
  ctx: ParseContext,
  opts?: {
    patchworkLocs?: readonly string[];
    remapStandardTo?: Extract<ArmorType, 'AEROSPACE' | 'STANDARD_PROTOMEK'>;
  },
): void {
  // ── Armor type ──
  const decodedType: ArmorType = bb.exists('armor_type')
    ? decodeBlkArmorType(bb.getFirstInt('armor_type'))
    : 'STANDARD';
  const type: ArmorType = decodedType === 'STANDARD' && opts?.remapStandardTo
    ? opts.remapStandardTo
    : decodedType;

  // ── Armor-specific tech base ──
  const compoundCode = bb.exists('armor_tech_level')
    ? bb.getFirstInt('armor_tech_level')
    : bb.exists('armor_tech')
      ? bb.getFirstInt('armor_tech')
      : null;
  const techBase: EntityTechBase = compoundCode == null
    ? entity.techBase()
    : decodeBlkCompoundTechBase(compoundCode, entity.techBase());

  // ── Resolve common/default armor ──
  const resolvedArmor = resolveArmorEquipment(type, techBase === 'Clan', ctx.equipmentRegistry);
  if (type !== 'PATCHWORK' && !resolvedArmor) {
    ctx.error('armor_type', `Invalid armor type ${type} for ${techBase} technology`);
  }
  const armor = resolvedArmor ?? requireArmorEquipment(
    'STANDARD',
    techBase === 'Clan',
    ctx.equipmentRegistry,
  );
  const technology = compoundCode == null
    ? createCompoundTechLevel(componentTechLevelFromRulesLevel(entity.rulesLevel()), techBase)
    : decodeBlkCompoundTechLevel(compoundCode);
  const techRating = bb.exists('armor_tech_rating')
    ? decodeBlkTechRating(bb.getFirstInt('armor_tech_rating'))
    : null;

  if (type !== 'PATCHWORK') {
    entity.setUniformArmor(new MountedArmor({
      techBase,
      armor,
      technology,
      techRating,
    }));
    return;
  }

  // Patchwork is a wire-format marker. Domain state is effective armor at
  // every real armor location; pseudo-locations remain codec-only sentinels.
  entity.setUniformArmor(new MountedArmor({
    armor: requireArmorEquipment(
      'STANDARD',
      entity.techBase() === 'Clan',
      ctx.equipmentRegistry,
    ),
    techBase: entity.techBase(),
  }));
  if (type === 'PATCHWORK' && opts?.patchworkLocs) {
    for (const loc of opts.patchworkLocs) {
      if (!entity.armorLocations.includes(loc)) continue;
      if (!bb.exists(`${loc}_armor_type`)) continue;
      const code = bb.getFirstInt(`${loc}_armor_type`);
      if (code < 0) continue;
      const locationTech = bb.getFirstString(`${loc}_armor_tech`).toLowerCase();
      const explicitClan = locationTech.includes('clan');
      const explicitIs = locationTech.includes('inner sphere');
      const isClan = explicitClan || (!explicitIs && entity.techBase() === 'Clan');
      const locationType = decodeBlkArmorType(code);
      if (locationType === 'PATCHWORK') continue;
      const locationArmor = resolveArmorEquipment(
        locationType,
        isClan,
        ctx.equipmentRegistry,
      );
      if (!locationArmor) {
        ctx.error(`${loc}_armor_type`, `Invalid armor type ${locationType} for ${isClan ? 'Clan' : 'IS'} technology`);
      }
      entity.setArmorAt(loc, new MountedArmor({
        armor: locationArmor ?? requireArmorEquipment(
          'STANDARD',
          isClan,
          ctx.equipmentRegistry,
        ),
        techBase: explicitClan ? 'Clan' : explicitIs ? 'IS' : 'All',
        techRating: bb.exists(`${loc}_armor_tech_rating`)
          ? decodeBlkTechRating(bb.getFirstInt(`${loc}_armor_tech_rating`))
          : null,
      }));
    }
  }
}

/**
 * Parse the uniform support-vehicle armor policy from Java's `loadSVArmor()`.
 *
 * A BAR block supplies the armor material only when `armor_type` is absent;
 * an explicit armor type always wins. Location-specific support patchwork
 * requires location-specific BAR state and is rejected until that state is
 * represented by the entity model.
 */
export function parseBlkSupportArmor(
  bb: BuildingBlock,
  entity: BaseEntity & SupportVehicle,
  ctx: ParseContext,
): void {
  const hasArmorType = bb.exists('armor_type');
  const hasBarRating = bb.exists('barrating');

  if (hasArmorType && bb.getFirstInt('armor_type') === 7) {
    ctx.error('armor_type', 'Support-vehicle patchwork armor is not yet supported');
    return;
  }
  if (!hasArmorType && !hasBarRating) {
    ctx.error('armor_type', 'Could not find armor_type or barrating block');
    return;
  }

  let barType: ArmorType | null = null;
  let barRating = 0;
  if (hasBarRating) {
    barRating = bb.getFirstInt('barrating');
    if (!Number.isInteger(barRating) || barRating < 2 || barRating > 10) {
      ctx.error('barrating', `Invalid support-vehicle BAR rating ${barRating}`);
      return;
    }
    barType = `SV_BAR_${barRating}` as ArmorType;
  }

  const type = hasArmorType ? decodeBlkArmorType(bb.getFirstInt('armor_type')) : barType!;
  const compoundCode = bb.exists('armor_tech_level')
    ? bb.getFirstInt('armor_tech_level')
    : null;
  const techBase = compoundCode == null
    ? entity.techBase()
    : decodeBlkCompoundTechBase(compoundCode, entity.techBase());
  const armor = resolveArmorEquipment(type, techBase === 'Clan', ctx.equipmentRegistry);
  if (!armor) {
    ctx.error('armor_type', `Invalid armor type ${type} for ${techBase} technology`);
    return;
  }

  const technologySource = barType == null
    ? null
    : resolveArmorEquipment(barType, false, ctx.equipmentRegistry);
  if (barType != null && !technologySource) {
    ctx.error('barrating', `Could not resolve support-vehicle BAR ${barRating} armor`);
    return;
  }

  const technology = compoundCode == null
    ? technologySource == null
      ? createCompoundTechLevel(componentTechLevelFromRulesLevel(entity.rulesLevel()), techBase)
      : createCompoundTechLevel(technologySource.level, techBase)
    : decodeBlkCompoundTechLevel(compoundCode);
  const techRating = bb.exists('armor_tech_rating')
    ? decodeBlkTechRating(bb.getFirstInt('armor_tech_rating'))
    : null;

  entity.setUniformArmor(new MountedArmor({
    armor,
    techBase,
    technology,
    techRating,
  }));
  entity.barRating.set(hasBarRating ? barRating : 0);
}

// ============================================================================
// Shared BLK armor values
// ============================================================================

/**
 * Parse the `armor` BLK block into a map of location → armor points
 * and set it on the entity.
 *
 * Shared by aero, smallcraft, dropship, and largecraft parsers.
 */
export function parseBlkArmorValues(
  bb: BuildingBlock,
  entity: BaseEntity,
  locations: readonly string[],
): void {
  if (!bb.exists('armor')) return;
  const ints = bb.getDataAsInt('armor');
  const armorMap = new Map<string, LocationArmor>();
  for (let i = 0; i < locations.length && i < ints.length; i++) {
    armorMap.set(locations[i], locationArmor(ints[i]));
  }
  entity.armorValues.set(armorMap);
}

// ============================================================================
// Shared aero engine + heat-sink assignment
// ============================================================================

/**
 * Parse the engine block and assign engine, heat-sink type, and heat-sink
 * count on the entity.
 *
 * Shared by aero, smallcraft, dropship, and largecraft parsers.
 */
export function parseBlkAeroEngine(
  bb: BuildingBlock,
  entity: AeroEntity,
  opts?: BlkEngineOpts,
): void {
  const result = parseBlkEngine(bb, entity, opts);
  if (result) {
    entity.mountedEngine.set(result.mountedEngine);
    entity.heatSinkType.set(result.heatSinkType);
    if (bb.exists('heatsinks')) entity.heatSinkCount.set(result.totalHeatSinks);
  }
}

// ============================================================================
// Shared crew block parsing
// ============================================================================

/**
 * Entity with crew-related signals.
 * Covers SmallCraftEntity (+ DropShip) and JumpShipEntity (+ WarShip/SpaceStation).
 */
export interface CrewEntity extends BaseEntity {
  crew: { set(v: number): void };
  officers: { set(v: number): void };
  gunners: { set(v: number): void };
  passengers: { set(v: number): void };
  marines: { set(v: number): void };
  battleArmor: { set(v: number): void };
  otherPassenger?: { set(v: number): void };
  lifeboats: { set(v: number): void };
  escapePods: { set(v: number): void };
}

/**
 * Parse common crew blocks from BLK data and set them on the entity.
 *
 * Shared by smallcraft, dropship, and largecraft parsers.
 * `otherpassenger` is only read if the entity has that signal
 * (SmallCraft/DropShip do, JumpShip does not).
 */
export function parseBlkCrew(
  bb: BuildingBlock,
  entity: CrewEntity,
  options: { parsePassengers?: boolean } = {},
): void {
  if (bb.exists('crew'))            entity.crew.set(bb.getFirstInt('crew'));
  if (bb.exists('officers'))        entity.officers.set(bb.getFirstInt('officers'));
  if (bb.exists('gunners'))         entity.gunners.set(bb.getFirstInt('gunners'));
  if (options.parsePassengers !== false && bb.exists('passengers')) {
    entity.passengers.set(bb.getFirstInt('passengers'));
  }
  if (bb.exists('marines'))         entity.marines.set(bb.getFirstInt('marines'));
  if (bb.exists('battlearmor'))     entity.battleArmor.set(bb.getFirstInt('battlearmor'));
  if (entity.otherPassenger && bb.exists('otherpassenger')) {
    entity.otherPassenger.set(bb.getFirstInt('otherpassenger'));
  }
  if (bb.exists('life_boat'))       entity.lifeboats.set(bb.getFirstInt('life_boat'));
  if (bb.exists('escape_pod'))      entity.escapePods.set(bb.getFirstInt('escape_pod'));
}

/** Expand the legacy aggregate docking-collar block into canonical transporters. */
export function parseLegacyDockingCollars(bb: BuildingBlock, entity: BaseEntity): void {
  if (!bb.exists('docking_collar')) return;

  const count = bb.getFirstInt('docking_collar');
  if (count <= 0) return;
  entity.transporters.update(transporters => {
    const usedCollarNumbers = new Set(transporters
      .filter(transporter => transporter.kind === 'docking-collar')
      .map(transporter => transporter.collarNumber));
    const dockingCollars = Array.from({ length: count }, (_, index) => {
      let collarNumber = 1;
      while (usedCollarNumbers.has(collarNumber)) collarNumber++;
      usedCollarNumbers.add(collarNumber);
      return {
        id: `transporter-${transporters.length + index + 1}`,
        kind: 'docking-collar' as const,
        collarNumber,
        omni: false,
      };
    });
    return [...transporters, ...dockingCollars];
  });
}
