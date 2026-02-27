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
import { createEngine, createMountedEngine, type MountedEngine } from '../components';
import {
  EntityFluff,
  EntityQuirk,
  EntityTechBase,
  EntityTransporter,
  EntityWeaponQuirk,
  HEAT_SINK_TYPE_FROM_CODE,
  HeatSinkType,
  VALID_TECH_BASE_STRINGS,
  engineTypeFromCode,
  normalizeSystemManufacturerKey,
} from '../types';
import { parseTechLevel } from '../utils/tech-level-parser';
import { BuildingBlock } from './building-block';
import { ParseContext } from './parse-context';

/**
 * Common BLK parsing — reads universal blocks that apply to all unit types.
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
    entity.mixedTech.set(parsed.mixedTech);
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

  // ── Armor type / tech rating / tech level ──
  // Store raw values from BLK for round-trip fidelity.  When absent,
  // the writer derives them from ArmorEquipment.
  if (bb.exists('armor_tech_rating')) {
    entity.armorTechRating.set(bb.getFirstInt('armor_tech_rating'));
  }
  if (bb.exists('armor_tech_level')) {
    entity.armorTechLevel.set(bb.getFirstInt('armor_tech_level'));
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
 * Extract tech base from BLK type string for equipment resolution.
 */
export function getBlkTechBase(bb: BuildingBlock): EntityTechBase {
  if (bb.exists('type')) {
    const typeStr = bb.getFirstString('type').toLowerCase();
    if (typeStr.includes('clan')) return 'Clan';
    if (typeStr.includes('mixed')) return 'Mixed';
  }
  return 'Inner Sphere';
}

/**
 * Resolve the engine `isClan` flag from the BLK data.
 *
 * The `clan_engine` block explicitly overrides the default (which is derived
 * from the chassis tech base). This is essential for mixed-tech units where
 * the engine tech base differs from the chassis.
 */
export function getBlkEngineIsClan(bb: BuildingBlock): boolean {
  if (bb.exists('clan_engine')) {
    const val = bb.getFirstString('clan_engine');
    return val.toLowerCase() === 'true' || val === '1';
  }
  return getBlkTechBase(bb) === 'Clan';
}

// ============================================================================
// Centralized BLK engine creation
// ============================================================================

/**
 * Options controlling how `parseBlkEngine` reads the BLK data.
 *
 * Every field is optional — sensible defaults are derived from the BLK
 * blocks themselves.
 */
export interface BlkEngineOpts {
  /** Mark the engine as super-heavy (tonnage > 100).  Default: `false`. */
  isSuperHeavy?: boolean;

  /**
   * When `true` (the default), heat-sink fields (`sink_type`, `heatsinks`,
   * `base chassis heat sinks`) are read from the BLK and forwarded to
   * `createMountedEngine`.  Set to `false` for unit types that never carry
   * heat sinks (vehicles, ProtoMeks).
   */
  includeHeatSinks?: boolean;

  /**
   * Default value for `totalHeatSinks` when the `heatsinks` block is
   * absent.  Most unit types use `10`; large craft use `0`.
   */
  defaultTotalHeatSinks?: number;

  /**
   * When `true`, the engine_type block is mandatory — the function returns
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

  // ── Rating (always walkMP × tonnage — callers must set walkMP first) ──
  const rating = entity.walkMP() * entity.tonnage();

  // ── Clan flag (respects clan_engine override for mixed-tech) ──
  const isClan = getBlkEngineIsClan(bb);

  const engine = createEngine(engineType, rating, isClan, isSuperHeavy);

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

  const mountedEngine = includeHeatSinks
    ? createMountedEngine(engine, {
        heatSinkType,
        totalHeatSinks,
        rawHeatSinkLabel: heatSinkType,
        baseChassisHeatSinks,
      })
    : createMountedEngine(engine);

  return { mountedEngine, heatSinkType, totalHeatSinks };
}
