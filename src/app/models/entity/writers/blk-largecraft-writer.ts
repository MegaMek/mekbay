// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { JumpShipEntity } from '../entities/largecraft/jumpship-entity';
import { WarShipEntity } from '../entities/largecraft/warship-entity';
import { SpaceStationEntity } from '../entities/largecraft/space-station-entity';
import {
  LARGE_CRAFT_LOCATIONS,
} from '../types';
import { encodeBlkAeroDesignType, encodeBlkDriveCoreType, encodeBlkHeatSinkType } from '../parsers/blk-codec';
import {
  BuildingBlockWriter,
  writeArmorBlocks,
  writeBlkCrew,
  writeBlkPreamble,
  writeEngine,
  writeEquipmentByLocation,
  writeFluffBlocks,
  writeInternalType,
  writeManualBV,
  writeOmni,
  writeSource,
  writeTonnage,
  writeTransporters,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import { JUMPSHIP_EQUIP_TAGS, WARSHIP_EXTRA_EQUIP_TAGS } from '../parsers/blk-constants';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a JumpShipEntity, WarShipEntity, or SpaceStationEntity to BLK.
 *
 * Block ordering matches MegaMek's BLKFile.getBlock() exactly.
 */
export function writeBlkLargeCraft(entity: JumpShipEntity): string {
  const w = new BuildingBlockWriter();

  // ── Determine UnitType ──
  let unitType: string;
  if (entity instanceof SpaceStationEntity) unitType = 'SpaceStation';
  else if (entity instanceof WarShipEntity) unitType = 'Warship';
  else                                      unitType = 'Jumpship';

  // 1-4. Identity / Year+Tech / motion_type / transporters
  writeBlkPreamble(w, entity, unitType);
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
  const armorLocs = [...LARGE_CRAFT_LOCATIONS];
  const armorMap = entity.armorValues();
  const armorInts: number[] = armorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
  w.addBlock('armor', ...armorInts);

  // 12. Equipment per location
  let equipTags = [...JUMPSHIP_EQUIP_TAGS];
  if (entity instanceof WarShipEntity) {
    equipTags = [...equipTags, ...WARSHIP_EXTRA_EQUIP_TAGS];
  }
  writeEquipmentByLocation(w, entity, equipTags, encodeEquipmentLine, true, {
    blkMode: true,
    shotsFormat: 'large-craft',
  });

  // 13. structural_integrity
  w.addBlock('structural_integrity', entity.structuralIntegrity());

  // 14-17. Fluff / source / tonnage / Manual BV
  writeFluffBlocks(w, entity.fluff());
  writeSource(w, entity);
  writeTonnage(w, entity);
  writeManualBV(w, entity);

  // 18. WarShip kf_core (between tonnage/bv and lithium-fusion)
  if (entity instanceof WarShipEntity) {
    const driveCoreCode = encodeBlkDriveCoreType(entity.driveCoreType());
    if (driveCoreCode > 0) w.addBlock('kf_core', driveCoreCode);
  }

  // 19. JumpShip-specific tail: lithium-fusion, jump_range, sail, grav_decks
  if (entity.lithiumFusion()) w.addBlock('lithium-fusion', 1);
  if (entity.jumpRange() !== 30) w.addBlock('jump_range', entity.jumpRange());
  w.addBlock('sail', entity.sail() ? 1 : 0);
  if (entity instanceof SpaceStationEntity && entity.modularOrKFAdapter()) {
    w.addBlock('modular', 1);
  }
  const gravDecks = entity.gravDecks();
  if (gravDecks.length > 0) {
    w.addBlock('grav_decks', ...gravDecks);
  }

  // 20. designtype + crew block
  w.addBlock('designtype', encodeBlkAeroDesignType(entity.designType()));
  writeBlkCrew(w, entity);

  return w.toString();
}
