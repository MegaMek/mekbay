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

import { DropShipEntity } from '../entities/aero/dropship-entity';
import {
  HEAT_SINK_TYPE_TO_CODE,
  HeatSinkType,
} from '../types';
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
import { DS_EQUIP_TAGS } from '../parsers/blk-constants';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a DropShipEntity to BLK format.
 *
 * Block ordering matches MegaMek's BLKFile.getBlock() exactly.
 */
export function writeBlkDropShip(entity: DropShipEntity): string {
  const w = new BuildingBlockWriter();

  // 1-4. Identity / Year+Tech / motion_type
  writeBlkPreamble(w, entity, 'Dropship');
  writeTransporters(w, entity);

  // 5. SafeThrust
  w.addBlock('SafeThrust', entity.walkMP());

  // 5a. Collar type (if present)
  if (entity.collarType() >= 0) {
    w.addBlock('collartype', entity.collarType());
  }

  // 6. Heat sinks / Fuel
  w.addBlock('heatsinks', entity.heatSinkCount());
  w.addBlock('sink_type', HEAT_SINK_TYPE_TO_CODE[entity.heatSinkType() as HeatSinkType] ?? 0);
  w.addBlock('fuel', entity.fuel());

  // 7. Engine: engine_type, clan_engine
  writeEngine(w, entity);

  // 8. Armor: armor_type, armor_tech_rating, armor_tech_level
  writeArmorBlocks(w, entity);

  // 9. internal_type
  writeInternalType(w, entity);

  // 10. omni
  writeOmni(w, entity);

  // 11. Armor values (4 locations: Nose, Left Side, Right Side, Aft)
  const armorMap = entity.armorValues();
  const dsArmorLocs = ['Nose', 'Left Side', 'Right Side', 'Aft'];
  const armorInts: number[] = dsArmorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
  w.addBlock('armor', ...armorInts);

  // 12. Equipment per location
  writeEquipmentByLocation(w, entity, DS_EQUIP_TAGS, encodeEquipmentLine, true);

  // 13. structural_integrity
  w.addBlock('structural_integrity', entity.structuralIntegrity());

  // 14-17. Fluff / source / tonnage / Manual BV
  writeFluffBlocks(w, entity.fluff());
  writeSource(w, entity);
  writeTonnage(w, entity);
  writeManualBV(w, entity);

  // 18. SmallCraft crew block
  w.addBlock('designtype', entity.designType() === 'Aerodyne' ? 1 : 0);
  writeBlkCrew(w, entity);

  return w.toString();
}
