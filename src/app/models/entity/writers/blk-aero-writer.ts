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

import { AeroEntity } from '../entities/aero/aero-entity';
import { ConvFighterEntity } from '../entities/aero/conv-fighter-entity';
import { FixedWingSupportEntity } from '../entities/aero/fixed-wing-support-entity';
import {
  ENGINE_TYPE_TO_CODE,
  HEAT_SINK_TYPE_TO_CODE,
  HeatSinkType,
} from '../types';
import {
  BuildingBlockWriter,
  writeIdentity,
  writeYearTechMeta,
  writeMotionType,
  writeTransporters,
  writeArmorBlocks,
  writeInternalType,
  writeOmni,
  writeEngine,
  writeEquipmentByLocation,
  writeFluffBlocks,
  writeSource,
  writeTonnage,
  writeManualBV,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Equipment location BLK tags
// ============================================================================

const FIGHTER_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',       'Nose'],
  ['Left Wing Equipment',  'Left Wing'],
  ['Right Wing Equipment', 'Right Wing'],
  ['Aft Equipment',        'Aft'],
  ['Wings Equipment',      'Wings'],
  ['Fuselage Equipment',   'Fuselage'],
];

const FWS_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',       'Nose'],
  ['Left Wing Equipment',  'Left Wing'],
  ['Right Wing Equipment', 'Right Wing'],
  ['Aft Equipment',        'Aft'],
  ['Wings Equipment',      'Wings'],
  ['Body Equipment',       'Body'],
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize an AeroEntity (ASF, ConvFighter, FixedWingSupport) to BLK format.
 *
 * Block ordering matches MegaMek's BLKFile.getBlock() exactly.
 */
export function writeBlkAero(entity: AeroEntity): string {
  const w = new BuildingBlockWriter();

  // ── UnitType ──
  let unitType = 'AeroSpaceFighter';
  if (entity instanceof FixedWingSupportEntity)  unitType = 'FixedWingSupport';
  else if (entity instanceof ConvFighterEntity)  unitType = 'ConvFighter';

  // 1. Identity
  writeIdentity(w, entity, unitType);

  // 2. Year/Tech/Meta (includes quirks, weaponQuirks)
  writeYearTechMeta(w, entity);

  // 3. motion_type
  writeMotionType(w, entity);

  // 4. transporters
  writeTransporters(w, entity);

  // 5. SafeThrust
  w.addBlock('SafeThrust', entity.walkMP());

  // 6. Cockpit / vstol
  if (!(entity instanceof FixedWingSupportEntity)) {
    w.addBlock('cockpit_type', 0); // TODO: map cockpit type to code
  }
  if (entity instanceof ConvFighterEntity && entity.vstol()) {
    w.addBlock('vstol', 1);
  }

  // 7. Heat sinks / Fuel
  w.addBlock('heatsinks', entity.heatSinkCount());
  w.addBlock('sink_type', HEAT_SINK_TYPE_TO_CODE[entity.heatSinkType() as HeatSinkType] ?? 0);
  w.addBlock('fuel', entity.fuel());

  // 8. Engine: engine_type, clan_engine
  writeEngine(w, entity, ENGINE_TYPE_TO_CODE);

  // 9. Armor: armor_type, armor_tech_rating, armor_tech_level
  writeArmorBlocks(w, entity);

  // 10. internal_type
  writeInternalType(w, entity);

  // 11. omni
  writeOmni(w, entity);

  // 12. Armor values
  const armorMap = entity.armorValues();
  const armorLocs = ['Nose', 'Left Wing', 'Right Wing', 'Aft'];
  const armorInts: number[] = armorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
  w.addBlock('armor', ...armorInts);

  // 13. Equipment per location (write empty blocks for fighters)
  const equipTags = entity instanceof FixedWingSupportEntity ? FWS_EQUIP_TAGS : FIGHTER_EQUIP_TAGS;
  writeEquipmentByLocation(w, entity, equipTags, encodeEquipmentLine, true);

  // 14. BAR / support tech ratings
  if (entity instanceof FixedWingSupportEntity) {
    w.addBlock('barrating', entity.barRating());
    if (entity.structuralTechRating()) w.addBlock('structural_tech_rating', entity.structuralTechRating());
    if (entity.engineTechRating())     w.addBlock('engine_tech_rating', entity.engineTechRating());
  }

  // 15. Structural integrity (if > 0)
  if (entity.structuralIntegrity() > 0) {
    w.addBlock('structural_integrity', entity.structuralIntegrity());
  }

  // 16. Fluff
  writeFluffBlocks(w, entity.fluff());

  // 17. source
  writeSource(w, entity);

  // 18. tonnage
  writeTonnage(w, entity);

  // 19. Manual BV
  writeManualBV(w, entity);

  return w.toString();
}
