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
import {
  MountedEngine,
  createMountedArmor,
  createPatchworkArmor,
  engineTypeFromCode,
} from '../components';
import { AeroEntity } from '../entities/aero/aero-entity';
import {
  ArmorType,
  EntityFluff,
  EntityQuirk,
  EntityTechBase,
  EntityTransporter,
  EntityWeaponQuirk,
  HEAT_SINK_TYPE_FROM_CODE,
  HeatSinkType,
  LocationArmor,
  VALID_TECH_BASE_STRINGS,
  armorTypeFromCode,
  locationArmor,
  normalizeSystemManufacturerKey,
  resolveArmorEquipment,
} from '../types';
import { generateMountId } from '../utils/signal-helpers';
import { parseTechLevel } from '../utils/tech-level-parser';
import { BuildingBlock } from './building-block';
import { parseEquipmentLine } from './equipment-resolver';
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
    const parsed = parseTechLevel(techStr);
    entity.techBase.set(parsed.techBase);
    entity.techLevel.set(techStr);
    entity.rulesLevel.set(parsed.rulesLevel);
  }

  // ── Meta ──
  if (bb.exists('role')) {
    entity.role.set(bb.getFirstString('role'));
  }
  if (bb.exists('source')) {
    entity.source.set(bb.getFirstString('source'));
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
    entity.tonnage.set(tonnage);
  }

  // ── Internal structure type ──
  if (bb.exists('internal_type')) {
    entity.rawInternalTypeCode.set(bb.getFirstInt('internal_type'));
  }

  // ── Quirks ──
  if (bb.exists('quirks')) {
    const quirkLines = bb.getDataAsString('quirks');
    const quirks: EntityQuirk[] = [];
    for (const line of quirkLines) {
      const trimmed = line.trim();
      if (trimmed) {
        quirks.push({ name: trimmed });
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
    const tLines = bb.getDataAsString('transporters');
    const transporters: EntityTransporter[] = [];
    for (const line of tLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Format: baytype:size[:doors[:bayNumber[:platoonType[:facing[:bitmap]]]]][:omni]
      let parts = trimmed.split(':');
      // Check for :omni suffix
      let isOmni = false;
      if (parts[parts.length - 1].toLowerCase() === 'omni') {
        isOmni = true;
        parts = parts.slice(0, -1);
      }
      if (parts.length >= 2) {
        transporters.push({
          type: parts[0],
          capacity: parseFloat(parts[1]),
          doors: parts.length >= 3 ? parseInt(parts[2], 10) : 0,
          bayNumber: parts.length >= 4 ? parseInt(parts[3], 10) : -1,
          platoonType: parts[4] || undefined,
          facing: parts[5] ? parseInt(parts[5], 10) : undefined,
          bitmap: parts[6] ? parseInt(parts[6], 10) : undefined,
          omni: isOmni || undefined,
        });
      } else if (parts.length === 1) {
        // Bare transporter type (e.g., "dockingcollar") - no capacity/doors
        transporters.push({
          type: parts[0],
          capacity: 0,
          doors: 0,
          bayNumber: -1,
          bare: true,
        });
      }
    }
    entity.transporters.set(transporters);
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
  },
): void {
  for (const [blkTag, locCode] of equipTags) {
    if (!bb.exists(blkTag)) continue;
    const lines = bb.getDataAsString(blkTag);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = ctx.resolveEquipment(parsed.name, blkTag);

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: locCode,
        rearMounted: parsed.rearMounted,
        turretMounted: opts?.computeTurretMounted?.(locCode) ?? false,
        turretType: opts?.includeTurretType ? parsed.turretType : undefined,
        omniPodMounted: parsed.omniPod,
        isNewBay: parsed.isNewBay,
        armored: false,
        size: parsed.size,
        facing: parsed.facing,
      });
    }
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
    includeHeatSinks = true,
    defaultTotalHeatSinks = 10,
    engineTypeRequired = false,
  } = opts;

  // ── Engine type ──
  if (engineTypeRequired && !bb.exists('engine_type')) return undefined;
  const engineType = bb.exists('engine_type')
    ? engineTypeFromCode(bb.getFirstInt('engine_type'))
    : 'Fusion' as const;

  // ── Rating (always walkMP × tonnage - callers must set walkMP first) ──
  const rating = entity.walkMP() * entity.tonnage();

  // ── Clan flag (respects clan_engine override for mixed-tech) ──
  const engineTechBase = getBlkEngineIsClan(bb);

  // ── Heat sinks ──
  let heatSinkType: HeatSinkType = 'Single';
  let totalHeatSinks = defaultTotalHeatSinks;
  let baseChassisHeatSinks = -1;

  if (includeHeatSinks) {
    if (bb.exists('sink_type')) {
      heatSinkType = HEAT_SINK_TYPE_FROM_CODE[bb.getFirstInt('sink_type')] ?? 'Single';
    }
    if (bb.exists('heatsinks')) {
      totalHeatSinks = bb.getFirstInt('heatsinks');
    }
    if (bb.exists('base chassis heat sinks')) {
      baseChassisHeatSinks = bb.getFirstInt('base chassis heat sinks');
    }
  }

  const mountedEngine = new MountedEngine({
    type: engineType,
    rating,
    techBase: engineTechBase,
    isSuperHeavy,
    ...(includeHeatSinks ? {
      heatSinkType,
      totalHeatSinks,
      rawHeatSinkLabel: heatSinkType,
      baseChassisHeatSinks,
    } : {}),
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
 * **Not used by** BA (different tech-code thresholds + `rawTechCode`),
 * infantry (uses `armorDivisor` / `armorKit`), or handheld (no armor type).
 */
export function parseBlkArmor(
  bb: BuildingBlock,
  entity: BaseEntity,
  ctx: ParseContext,
  opts?: { patchworkLocs?: readonly string[] },
): void {
  // ── Armor type ──
  const type: ArmorType = bb.exists('armor_type')
    ? armorTypeFromCode(bb.getFirstInt('armor_type'))
    : 'STANDARD';

  // ── Armor-specific tech base ──
  let techBase: EntityTechBase = 'IS';
  if (bb.exists('armor_tech')) {
    const code = bb.getFirstInt('armor_tech');
    if (code === 1 || code === 2) techBase = 'Clan';
  }

  // ── Patchwork per-location data ──
  let patchwork = null;
  if (type === 'PATCHWORK' && opts?.patchworkLocs) {
    const codes = new Map<string, number>();
    const techs = new Map<string, string>();
    const ratings = new Map<string, number>();
    for (const loc of opts.patchworkLocs) {
      if (bb.exists(`${loc}_armor_type`))        codes.set(loc, bb.getFirstInt(`${loc}_armor_type`));
      if (bb.exists(`${loc}_armor_tech`))         techs.set(loc, bb.getFirstString(`${loc}_armor_tech`));
      if (bb.exists(`${loc}_armor_tech_rating`))  ratings.set(loc, bb.getFirstInt(`${loc}_armor_tech_rating`));
    }
    patchwork = createPatchworkArmor({ codes, techs, ratings });
  }

  // ── Tech rating / level overrides (round-trip fidelity) ──
  const techRating = bb.exists('armor_tech_rating') ? bb.getFirstInt('armor_tech_rating') : -1;
  const techLevel  = bb.exists('armor_tech_level')  ? bb.getFirstInt('armor_tech_level')  : -1;

  // ── Resolve armor from DB ──
  const armor = resolveArmorEquipment(type, techBase === 'Clan', ctx.equipmentDb);

  entity.mountedArmor.set(createMountedArmor({
    type, techBase, armor, patchwork, techRating, techLevel,
  }));
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
export function parseBlkCrew(bb: BuildingBlock, entity: CrewEntity): void {
  if (bb.exists('crew'))            entity.crew.set(bb.getFirstInt('crew'));
  if (bb.exists('officers'))        entity.officers.set(bb.getFirstInt('officers'));
  if (bb.exists('gunners'))         entity.gunners.set(bb.getFirstInt('gunners'));
  if (bb.exists('passengers'))      entity.passengers.set(bb.getFirstInt('passengers'));
  if (bb.exists('marines'))         entity.marines.set(bb.getFirstInt('marines'));
  if (bb.exists('battlearmor'))     entity.battleArmor.set(bb.getFirstInt('battlearmor'));
  if (entity.otherPassenger && bb.exists('otherpassenger')) {
    entity.otherPassenger.set(bb.getFirstInt('otherpassenger'));
  }
  if (bb.exists('life_boat'))       entity.lifeboats.set(bb.getFirstInt('life_boat'));
  if (bb.exists('escape_pod'))      entity.escapePods.set(bb.getFirstInt('escape_pod'));
}
