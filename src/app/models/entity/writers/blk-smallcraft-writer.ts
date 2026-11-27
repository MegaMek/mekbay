// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { SmallCraftEntity } from '../entities/aero/small-craft-entity';
import {
  SMALL_CRAFT_ARMOR_LOCATIONS,
} from '../types';
import { encodeBlkAeroDesignType, encodeBlkHeatSinkType } from '../parsers/blk-codec';
import {
  BuildingBlockWriter,
  writeArmorBlocks,
  writeBlkCrew,
  writeBlkPreamble,
  writeEngine,
  writeEquipmentByLocation,
  writeEmbeddedImages,
  writeFluffBlocks,
  writeInternalType,
  writeManualBV,
  writeOmni,
  writeSource,
  writeTonnage,
  writeTransporters,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import { SC_EQUIP_TAGS } from '../parsers/blk-constants';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a SmallCraftEntity to BLK format.
 *
 * Block ordering matches MegaMek's BLKFile.getBlock() exactly.
 */
export function writeBlkSmallCraft(entity: SmallCraftEntity): string {
  const w = new BuildingBlockWriter();

  // 1-4. Identity / Year+Tech / motion_type / transporters
  writeBlkPreamble(w, entity, 'SmallCraft');
  writeTransporters(w, entity);

  // 5. SafeThrust
  w.addBlock('SafeThrust', entity.originalWalkMP());

  // 6. Heat sinks / Fuel
  w.addBlock('heatsinks', entity.heatSinkCount());
  w.addBlock('sink_type', encodeBlkHeatSinkType(entity.heatSinkType()));
  w.addBlock('fuel', entity.fuel());

  // 7. Engine: engine_type, clan_engine
  writeEngine(w, entity);

  // 8. Armor: armor_type, armor_tech_rating, armor_tech_level
  writeArmorBlocks(w, entity);

  // 9. internal_type
  writeInternalType(w, entity);

  // 10. omni
  writeOmni(w, entity);

  // 11. Armor values
  const armorLocs = [...SMALL_CRAFT_ARMOR_LOCATIONS];
  const armorMap = entity.armorValues();
  const armorInts: number[] = armorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
  w.addBlock('armor', ...armorInts);

  // 12. Equipment per location
  writeEquipmentByLocation(w, entity, SC_EQUIP_TAGS, encodeEquipmentLine, true);

  // 13. structural_integrity
  w.addBlock('structural_integrity', entity.structuralIntegrity());

  // 14-17. Fluff / source / tonnage / Manual BV
  writeFluffBlocks(w, entity.fluff());
  writeSource(w, entity);
  writeTonnage(w, entity);
  writeManualBV(w, entity);

  // 18. SmallCraft crew block
  w.addBlock('designtype', encodeBlkAeroDesignType(entity.designType()));
  writeBlkCrew(w, entity);

  writeEmbeddedImages(w, entity);

  return w.toString(entity.nativeSourceTrailingNewlines || 2);
}
