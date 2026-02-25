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
import { BaseEntity } from '../base-entity';
import { APP_VERSION_STRING } from '../../../build-meta';

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
  if (entity.techLevel()) w.addBlock('type', entity.techLevel());
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
 */
export function writeMotionType(w: BuildingBlockWriter, entity: { motionType?: () => string }): void {
  if (entity.motionType?.()) {
    w.addBlock('motion_type', entity.motionType!());
  }
}

/**
 * Write the transporters block (shared by all types that have them).
 */
export function writeTransporters(w: BuildingBlockWriter, entity: BaseEntity): void {
  const transporters = entity.transporters();
  if (transporters.length > 0) {
    const tLines = transporters.map(t => {
      let line = `${t.type}:${t.capacity}:${t.doors}`;
      if (t.bayNumber >= 0) line += `:${t.bayNumber}`;
      if (t.platoonType != null) line += `:${t.platoonType}`;
      if (t.facing != null) line += `:${t.facing}`;
      if (t.bitmap != null) line += `:${t.bitmap}`;
      return line;
    });
    w.addBlock('transporters', ...tLines);
  }
}

/**
 * Write armor type / tech rating / tech level blocks.
 * MegaMek ALWAYS writes these for non-infantry, non-GE entities
 * (even code 0 for Standard).
 */
export function writeArmorBlocks(w: BuildingBlockWriter, entity: BaseEntity): void {
  w.addBlock('armor_type', entity.armorTypeCode());
  w.addBlock('armor_tech_rating', entity.armorTechRating());
  w.addBlock('armor_tech_level', entity.armorTechLevel());
}

/**
 * Write internal_type block (only when NOT Standard, i.e. code != 0).
 */
export function writeInternalType(w: BuildingBlockWriter, entity: BaseEntity): void {
  if (entity.structureType() !== 'Standard') {
    let code = 0;
    if (entity.structureType() === 'Endo Steel') code = 1;
    else if (entity.structureType() === 'Composite') code = 2;
    else if (entity.structureType() === 'Reinforced') code = 3;
    w.addBlock('internal_type', code);
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
  engineTypeToCode: Record<string, number>,
): void {
  w.addBlock('engine_type', engineTypeToCode[entity.engineType()] ?? 0);
  // clan_engine: written when engine's clan flag differs from entity's clan flag
  const isClanEntity = entity.techBase() === 'Clan';
  const isClanEngine = entity.clanEngine();
  if (isClanEngine !== isClanEntity) {
    w.addBlock('clan_engine', isClanEngine);
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
}

/**
 * Write source block.
 */
export function writeSource(w: BuildingBlockWriter, entity: BaseEntity): void {
  if (entity.source()) w.addBlock('source', entity.source());
}

/**
 * Write tonnage block.
 */
export function writeTonnage(w: BuildingBlockWriter, entity: BaseEntity): void {
  w.addBlock('tonnage', entity.tonnage());
}

/**
 * Write manual BV block.
 */
export function writeManualBV(w: BuildingBlockWriter, entity: BaseEntity): void {
  if (entity.manualBV() > 0) w.addBlock('bv', entity.manualBV());
}
