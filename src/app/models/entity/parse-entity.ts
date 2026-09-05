// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentRegistry } from '../equipment-lookup';
import { BaseEntity } from './base-entity';
import { BuildingBlock } from './parsers/building-block';
import { ParseContext, ParseContextOptions, EntityLoadIssue } from './parsers/parse-context';
import { parseMtf } from './parsers/mtf-parser';
import { parseBlkAero } from './parsers/blk-aero-parser';
import { parseBlkSmallCraft } from './parsers/blk-smallcraft-parser';
import { parseBlkVehicle } from './parsers/blk-vehicle-parser';
import { parseBlkInfantry } from './parsers/blk-infantry-parser';
import { parseBlkBA } from './parsers/blk-ba-parser';
import { parseBlkProtoMek } from './parsers/blk-protomek-parser';
import { parseBlkDropShip } from './parsers/blk-dropship-parser';
import { parseBlkLargeCraft } from './parsers/blk-largecraft-parser';
import { parseBlkHandheld } from './parsers/blk-handheld-parser';
import { parseBlkStaticEmplacement } from './parsers/blk-static-emplacement-parser';
import { nativeCapabilityForUnitTypeAlias } from './codec-capabilities';

/** Result of parsing a unit file. */
export interface ParseResult {
  entity: BaseEntity;
  diagnostics: readonly EntityLoadIssue[];
}

/** Stable failure for a unit encoded in a format its family never uses. */
export class UnsupportedNativeFormatError extends Error {
  readonly code = 'UNSUPPORTED_NATIVE_FORMAT' as const;

  constructor(
    readonly format: 'mtf' | 'blk',
    readonly unitType: string,
  ) {
    super(`${unitType} units cannot be encoded as ${format.toUpperCase()}`);
    this.name = 'UnsupportedNativeFormatError';
  }
}

/**
 * Unified entry point for parsing any MegaMek unit file (.mtf or .blk).
 *
 * Dispatches to the appropriate parser based on file extension and, for BLK
 * files, the `<UnitType>` block inside the file. Meks are categorically MTF;
 * every non-Mek family is categorically BLK.
 *
 * @param content  Raw file content as a string
 * @param fileName File name (used to determine format by extension)
 * @param equipmentRegistry Canonical equipment collection and lookup index
 * @param options Optional parsing dependencies
 * @returns Parsed entity and accumulated diagnostics
 * @throws Error if the file format or unit type is unsupported
 */
export function parseEntity(
  content: string,
  fileName: string,
  equipmentRegistry: EquipmentRegistry,
  options: ParseContextOptions = {},
): ParseResult {
  const ctx = new ParseContext(fileName, equipmentRegistry, options);
  const lowerName = fileName.toLowerCase();

  let entity: BaseEntity;

  // ── MTF format (Mek only) ──
  if (lowerName.endsWith('.mtf')) {
    entity = parseMtf(content, ctx);
  }
  // ── BLK format (non-Mek types only) ──
  else if (lowerName.endsWith('.blk')) {
    const bb = new BuildingBlock(content);
    entity = parseBlk(bb, ctx);
  } else {
    throw new Error(`Unsupported file format: ${fileName}`);
  }

  entity.nativeSourceTrailingNewlines = content.replace(/\r\n?/gu, '\n').match(/\n+$/u)?.[0].length ?? 0;
  entity.reconcileEquipmentRelationships();
  entity.setLoadIssues(ctx.diagnostics);
  return { entity, diagnostics: entity.loadIssues() };
}

/**
 * Dispatch a parsed BuildingBlock to the appropriate type-specific parser
 * based on the `<UnitType>` block.
 */
function parseBlk(bb: BuildingBlock, ctx: ParseContext): BaseEntity {
  const unitType = bb.getFirstString('UnitType').trim();
  const capability = nativeCapabilityForUnitTypeAlias(unitType);

  if (!capability) {
    throw new Error(`Unsupported BLK UnitType: "${unitType}"`);
  }
  if (capability.format !== 'blk') {
    throw new UnsupportedNativeFormatError('blk', unitType);
  }

  switch (capability.family) {
    case 'aero':
      return parseBlkAero(bb, ctx);
    case 'small-craft':
      return parseBlkSmallCraft(bb, ctx);
    case 'drop-ship':
      return parseBlkDropShip(bb, ctx);
    case 'vehicle':
      return parseBlkVehicle(bb, ctx);
    case 'infantry':
      return parseBlkInfantry(bb, ctx);
    case 'battle-armor':
      return parseBlkBA(bb, ctx);
    case 'protomek':
      return parseBlkProtoMek(bb, ctx);
    case 'large-craft':
      return parseBlkLargeCraft(bb, ctx);
    case 'handheld-weapon':
      return parseBlkHandheld(bb, ctx);
    case 'static-emplacement':
      return parseBlkStaticEmplacement(
        bb,
        ctx,
        unitType === 'BuildingEntity' ? 'BuildingEntity' : 'GunEmplacement',
      );
    case 'mek':
      // Guarded above by the categorical format check.
      throw new UnsupportedNativeFormatError('blk', unitType);
  }
}
