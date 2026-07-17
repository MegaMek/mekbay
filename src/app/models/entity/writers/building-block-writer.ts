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

import { EntityFluff } from '../types';
import {
  encodeBlkArmorTechLevel,
  encodeBlkArmorTechRating,
  encodeBlkArmorType,
  encodeBlkEngineType,
  encodeBlkTechLevel,
} from '../parsers/blk-codec';
import { BaseEntity } from '../base-entity';
import { serializeTransporterLines } from '../parsers/transporter-codec';

/**
 * Serialises BLK tag-based format.
 *
 * Usage:
 * ```ts
 * const writer = new BuildingBlockWriter();
 * writer.addBlock('Name', 'Ostrogoth');
 * writer.addBlock('Model', 'A');
 * writer.addBlock('armor', 77, 61, 61, 41);
 * console.log(writer.toString());
 * ```
 */
export class BuildingBlockWriter {
  private readonly lines: string[] = [];

  /**
   * Add a single block with one or more values.
   * Each value occupies its own line between the opening and closing tags.
   *
   * @param tag   The tag name (case-preserved in output)
   * @param values One or more values to write between the tags
   */
  addBlock(tag: string, ...values: (string | number)[]): void {
    this.lines.push(`<${tag}>`);
    for (const v of values) {
      this.lines.push(String(v));
    }
    this.lines.push(`</${tag}>`);
    this.lines.push('');
  }

  /**
   * Add a block only if the values array is non-empty.
   * Convenience method for optional blocks.
   */
  addBlockIfPresent(tag: string, values: (string | number)[]): void {
    if (values.length > 0) {
      this.addBlock(tag, ...values);
    }
  }

  /**
   * Add a raw line (no tags). Useful for comments or blank lines.
   */
  addRawLine(line: string): void {
    this.lines.push(line);
  }

  /**
   * Add a comment line.
   */
  addComment(text: string): void {
    this.lines.push(`#${text}`);
  }

  /**
   * Serialise all accumulated blocks to a single string.
   */
  toString(): string {
    return this.lines.join('\n');
  }
}

// ============================================================================
// Shared BLK block writers
// ============================================================================
// MegaMek outputs BLK blocks in a single canonical order defined in
// BLKFile.getBlock().  The helpers below mirror that ordering so every
// entity-type writer produces blocks in exactly the same sequence as the
// MegaMek originals (the target is 1:1 output except comments & generator).
// ============================================================================

/**
 * Write the identity header shared by all entity types:
 *   UnitType, Name, Model, mul id
 */
export function writeIdentity(w: BuildingBlockWriter, entity: BaseEntity, unitType: string): void {
  w.addBlock('UUID', entity.uuid());
  w.addBlock('UnitType', unitType);
  w.addBlock('Name', entity.chassis());
  w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id:', entity.mulId());
}

/**
 * Write year / tech / meta blocks in MegaMek order:
 *   year, originalBuildYear, type, role, quirks, weaponQuirks
 */
export function writeYearTechMeta(w: BuildingBlockWriter, entity: BaseEntity): void {
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  w.addBlock('type', encodeBlkTechLevel({
    techBase: entity.techBase(),
    rulesLevel: entity.rulesLevel(),
    mixedTech: entity.mixedTech(),
  }));
  if (entity.role()) w.addBlock('role', entity.role());

  // ── Quirks ──
  const quirks = entity.quirks();
  if (quirks.length > 0) {
    w.addBlock('quirks', ...quirks.map(q => q.name));
  }
  const wqs = entity.weaponQuirks();
  if (wqs.length > 0) {
    w.addBlock('weaponQuirks', ...wqs.map(wq =>
      `${wq.name}:${wq.location}:${wq.slot}:${wq.weaponName}`
    ));
  }
}

/**
 * Write the motion_type block (for entities that have it).
 * Uses `getMotiveTypeAsString()` which produces compound strings for infantry
 * (e.g. "Beast:Tariq", "Motorized SCUBA") and canonical MotiveType for others.
 * When `getMotiveTypeAsString()` returns `null`, the block is omitted.
 */
export function writeMotiveType(w: BuildingBlockWriter, entity: BaseEntity): void {
  const val = entity.getMotiveTypeAsString();
  if (val !== null) {
    w.addBlock('motion_type', val);
  }
}

/**
 * Write the transporters block (shared by all types that have them).
 */
export function writeTransporters(w: BuildingBlockWriter, entity: BaseEntity): void {
  const transporters = entity.transporters();
  if (transporters.length > 0) {
    w.addBlock('transporters', ...serializeTransporterLines(transporters));
  }
}

/**
 * Write armor type / tech rating / tech level blocks.
 * MegaMek ALWAYS writes these for non-infantry, non-GE entities
 * (even code 0 for Standard).
 *
 * Values come from MountedArmor. When tech rating is unresolved, derive it
 * from ArmorEquipment.
 */
export function writeArmorBlocks(
  w: BuildingBlockWriter,
  entity: BaseEntity,
  patchworkLocs?: readonly string[],
): void {
  const armor = entity.mountedArmor();
  w.addBlock('armor_type', encodeBlkArmorType(armor));

  // Patchwork armor: write per-location blocks instead of global tech rating/level
  if (armor.type === 'PATCHWORK' && patchworkLocs && armor.patchwork) {
    const { codes, techs, ratings } = armor.patchwork;
    for (const loc of patchworkLocs) {
      if (codes.has(loc)) w.addBlock(`${loc}_armor_type`, codes.get(loc)!);
      if (techs.has(loc)) w.addBlock(`${loc}_armor_tech`, techs.get(loc)!);
      if (ratings.has(loc)) w.addBlock(`${loc}_armor_tech_rating`, ratings.get(loc)!);
    }
    return;
  }

  w.addBlock('armor_tech_rating', encodeBlkArmorTechRating(armor));
  w.addBlock('armor_tech_level', encodeBlkArmorTechLevel(armor));
}

/**
 * Write internal_type block (only when NOT Standard, i.e. code != 0).
 */
export function writeInternalType(w: BuildingBlockWriter, entity: BaseEntity): void {
  const structureTypeId = entity.mountedStructure()?.structureTypeId ?? -1;
  if (structureTypeId !== 0) {
    w.addBlock('internal_type', structureTypeId);
  }
}

/**
 * Write the omni block (only when entity is OmniMek/OmniVehicle).
 */
export function writeOmni(w: BuildingBlockWriter, entity: BaseEntity): void {
  if (entity.omni()) w.addBlock('omni', 1);
}

/**
 * Write engine_type and clan_engine blocks.
 */
export function writeEngine(
  w: BuildingBlockWriter,
  entity: BaseEntity,
): void {
  const me = entity.mountedEngine();
  if (!me) {
    w.addBlock('engine_type', 0); // "None" engine type code
    return;
  }
  w.addBlock('engine_type', encodeBlkEngineType(me.type()));
  // clan_engine: written when engine's clan flag differs from what the parser
  // would infer from the entity chassis tech base.
  const impliedClan = entity.techBase() === 'Clan';
  if (me.techBase === 'Clan' !== impliedClan) {
    w.addBlock('clan_engine', me.techBase === 'Clan' ? 'true' : 'false');
  }
}

/**
 * Write equipment per location from mount list.
 * Returns the mountsByLoc map for callers that need additional processing.
 */
export function writeEquipmentByLocation(
  w: BuildingBlockWriter,
  entity: BaseEntity,
  equipTags: [string, string][],
  encodeLineFn: (m: any, opts: any) => string,
  writeEmpty = false,
): Map<string, string[]> {
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    lines.push(encodeLineFn(m, { blkMode: true }));
  }

  for (const [blkTag, locCode] of equipTags) {
    const lines = mountsByLoc.get(locCode) ?? [];
    if (writeEmpty || lines.length > 0) {
      w.addBlock(blkTag, ...lines);
    }
  }

  // Slotless/LOC_NONE equipment
  const slotless = mountsByLoc.get('None') ?? [];
  if (slotless.length > 0) {
    w.addBlock('slotless_equipment', ...slotless);
  }

  return mountsByLoc;
}

/**
 * Write fluff / lore blocks to a BLK BuildingBlockWriter.
 *
 * MegaMek outputs these blocks in a consistent order for every entity type:
 *   capabilities, overview, deployment, history, manufacturer, primaryFactory,
 *   systemManufacturers, systemModels, notes
 *
 * The systemManufacturers/systemModels use unified block format with KEY:VALUE
 * lines inside (matching MegaMek's getBlock() output).
 */
export function writeFluffBlocks(w: BuildingBlockWriter, fluff: EntityFluff): void {
  if (fluff.capabilities)  w.addBlock('capabilities', fluff.capabilities);
  if (fluff.overview)      w.addBlock('overview', fluff.overview);
  if (fluff.deployment)    w.addBlock('deployment', fluff.deployment);
  if (fluff.history)       w.addBlock('history', fluff.history);
  if (fluff.manufacturer)  w.addBlock('manufacturer', fluff.manufacturer);
  if (fluff.primaryFactory) w.addBlock('primaryFactory', fluff.primaryFactory);

  // Unified block format: <systemManufacturers>\nKEY:VALUE\n...</systemManufacturers>
  if (fluff.systemManufacturers) {
    const entries = Object.entries(fluff.systemManufacturers).filter(([, v]) => !!v);
    if (entries.length > 0) {
      w.addBlock('systemManufacturers', ...entries.map(([k, v]) => `${k}:${v}`));
    }
  }
  if (fluff.systemModels) {
    const entries = Object.entries(fluff.systemModels).filter(([, v]) => !!v);
    if (entries.length > 0) {
      w.addBlock('systemModels', ...entries.map(([k, v]) => `${k}:${v}`));
    }
  }

  if (fluff.notes)         w.addBlock('notes', fluff.notes);
  if (fluff.fluffDate)     w.addBlock('fluffDate', fluff.fluffDate);
  if (fluff.use)           w.addBlock('use', fluff.use);
  if (fluff.length)        w.addBlock('length', fluff.length);
  if (fluff.width)         w.addBlock('width', fluff.width);
  if (fluff.height)        w.addBlock('height', fluff.height);
}

/** Write source and publication blocks. */
export function writeSource(w: BuildingBlockWriter, entity: BaseEntity): void {
  if (entity.source().length > 0) w.addBlock('source', entity.source().map(source => source.abbrev).join(','));
  if (entity.published().length > 0) w.addBlock('published', entity.published().map(source => source.abbrev).join(','));
}

/**
 * Write tonnage block.  Java uses Double.toString() which always
 * includes a decimal point, so we format integer tonnages with `.0`.
 */
export function writeTonnage(w: BuildingBlockWriter, entity: BaseEntity): void {
  const t = entity.tonnage();
  w.addBlock('tonnage', Number.isInteger(t) ? t.toFixed(1) : String(t));
}

/**
 * Write manual BV block.
 */
export function writeManualBV(w: BuildingBlockWriter, entity: BaseEntity): void {
  if (entity.manualBV() > 0) w.addBlock('bv', entity.manualBV());
}

// ============================================================================
// Composite helpers - preamble / postamble / crew
// ============================================================================

/**
 * Write the standard opening blocks shared by most BLK writers:
 * identity → yearTechMeta → motiveType → transporters.
 */
export function writeBlkPreamble(w: BuildingBlockWriter, entity: BaseEntity, unitType: string): void {
  writeIdentity(w, entity, unitType);
  writeYearTechMeta(w, entity);
  writeMotiveType(w, entity);
}

/**
 * Entity with crew-related read accessors for writing.
 */
export interface CrewWriteEntity extends BaseEntity {
  crew(): number;
  officers(): number;
  gunners(): number;
  passengers(): number;
  marines(): number;
  battleArmor(): number;
  otherPassenger?: () => number;
  lifeboats(): number;
  escapePods(): number;
}

/**
 * Write crew blocks shared by smallcraft, dropship, and largecraft writers.
 *
 * `otherpassenger` is only written if the entity has that accessor
 * (SmallCraft/DropShip do, JumpShip does not).
 */
export function writeBlkCrew(w: BuildingBlockWriter, entity: CrewWriteEntity): void {
  w.addBlock('crew', entity.crew());
  w.addBlock('officers', entity.officers());
  w.addBlock('gunners', entity.gunners());
  w.addBlock('passengers', entity.passengers());
  w.addBlock('marines', entity.marines());
  w.addBlock('battlearmor', entity.battleArmor());
  if (entity.otherPassenger) w.addBlock('otherpassenger', entity.otherPassenger());
  w.addBlock('life_boat', entity.lifeboats());
  w.addBlock('escape_pod', entity.escapePods());
}
