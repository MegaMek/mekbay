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

import { EntityFluff, structureTypeToCode, TECH_RATING_TO_NUMBER, compoundTechLevel } from '../types';
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
    const tLines = transporters.map(t => {
      // Bare transporter type (e.g., "dockingcollar") — no capacity/doors
      if (t.bare) return t.type;

      // Format: type:capacity:doors[:bayNumber[:platoonType[:facing[:bitmap]]]]
      // Must always write all positional fields up to the last non-default one
      // to prevent re-parse from misinterpreting shifted values.
      const hasBitmap = t.bitmap != null;
      const hasFacing = t.facing != null || hasBitmap;
      const hasPlatoon = t.platoonType != null || hasFacing;
      const hasBayNum = hasPlatoon || t.bayNumber !== -1;

      // TroopSpace uses simplified 2-part format: type:capacity
      // Java uses double for TroopSpace/Bays (prints .0) but int for BattleArmorHandles (prints -1)
      const cap = (Number.isInteger(t.capacity) && t.capacity >= 0) ? t.capacity.toFixed(1) : String(t.capacity);
      const needsDoors = t.doors > 0 || hasBayNum;
      let line = needsDoors
        ? `${t.type}:${cap}:${t.doors}`
        : `${t.type}:${cap}`;
      if (hasBayNum) line += `:${t.bayNumber}`;
      if (hasPlatoon) line += `:${t.platoonType ?? ''}`;
      if (hasFacing) line += `:${t.facing ?? -1}`;
      if (hasBitmap) line += `:${t.bitmap ?? 0}`;
      if (t.omni) line += ':omni';
      return line;
    });
    w.addBlock('transporters', ...tLines);
  }
}

/**
 * Write armor type / tech rating / tech level blocks.
 * MegaMek ALWAYS writes these for non-infantry, non-GE entities
 * (even code 0 for Standard).
 *
 * Values come from the raw signals set during parsing.  When not
 * explicitly set (-1), we derive from ArmorEquipment exactly as
 * MegaMek does.
 */
export function writeArmorBlocks(
  w: BuildingBlockWriter,
  entity: BaseEntity,
  patchworkLocs?: string[],
): void {
  w.addBlock('armor_type', entity.armorTypeCode());

  // Patchwork armor: write per-location blocks instead of global tech rating/level
  if (entity.armorType() === 'PATCHWORK' && patchworkLocs) {
    const codes = entity.patchworkArmorCodes();
    const techs = entity.patchworkArmorTech();
    const ratings = entity.patchworkArmorTechRating();
    for (const loc of patchworkLocs) {
      if (codes.has(loc)) w.addBlock(`${loc}_armor_type`, codes.get(loc)!);
      if (techs.has(loc)) w.addBlock(`${loc}_armor_tech`, techs.get(loc)!);
      if (ratings.has(loc)) w.addBlock(`${loc}_armor_tech_rating`, ratings.get(loc)!);
    }
    return;
  }

  let techRating = entity.armorTechRating();
  if (techRating < 0) {
    const eq = entity.armorEquipment();
    techRating = eq ? (TECH_RATING_TO_NUMBER[eq.rating] ?? 3) : 0;
  }
  w.addBlock('armor_tech_rating', techRating);

  let techLevel = entity.armorTechLevel();
  if (techLevel < 0) {
    const eq = entity.armorEquipment();
    techLevel = eq ? compoundTechLevel(eq.level, entity.techBase() === 'Clan') : 0;
  }
  w.addBlock('armor_tech_level', techLevel);
}

/**
 * Write internal_type block (only when NOT Standard, i.e. code != 0).
 */
export function writeInternalType(w: BuildingBlockWriter, entity: BaseEntity): void {
  // Use raw BLK code if available (supports round-trip of -1 = Unknown)
  const rawCode = entity.rawInternalTypeCode();
  if (rawCode !== 0) {
    w.addBlock('internal_type', rawCode);
  } else if (entity.structureType() !== 'STANDARD') {
    w.addBlock('internal_type', structureTypeToCode(entity.structureType()));
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
  // clan_engine: written when engine's clan flag differs from what the parser
  // would infer from the type string alone.  The parser's getBlkEngineIsClan()
  // falls back to checking whether the type string contains "clan" (case-
  // insensitive), so the writer must use the same heuristic as its default.
  const typeStr = (entity.techLevel() ?? '').toLowerCase();
  const impliedClan = typeStr.includes('clan');
  const isClanEngine = entity.clanEngine();
  if (isClanEngine !== impliedClan) {
    w.addBlock('clan_engine', isClanEngine ? 'true' : 'false');
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
  if (fluff.use)           w.addBlock('use', fluff.use);
  if (fluff.length)        w.addBlock('length', fluff.length);
  if (fluff.width)         w.addBlock('width', fluff.width);
  if (fluff.height)        w.addBlock('height', fluff.height);
}

/**
 * Write source block.
 */
export function writeSource(w: BuildingBlockWriter, entity: BaseEntity): void {
  if (entity.source()) w.addBlock('source', entity.source());
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
