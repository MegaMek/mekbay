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

import { JumpShipEntity } from '../entities/largecraft/jumpship-entity';
import { WarShipEntity } from '../entities/largecraft/warship-entity';
import { SpaceStationEntity } from '../entities/largecraft/space-station-entity';
import {
  ENGINE_TYPE_TO_CODE,
  HEAT_SINK_TYPE_TO_CODE,
  HeatSinkType,
  LARGE_CRAFT_LOCATIONS,
} from '../types';
import {
  BuildingBlockWriter,
  writeIdentity,
  writeYearTechMeta,
  writeMotiveType,
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
// Equipment location tags
// ============================================================================

const JUMPSHIP_EQUIP_TAGS: [string, string][] = [
  ['Nose Equipment',                  'Nose'],
  ['Left Front Side Equipment',       'FLS'],
  ['Right Front Side Equipment',      'FRS'],
  ['Aft Equipment',                   'Aft'],
  ['Aft Left Side Equipment',         'ALS'],
  ['Aft Right Side Equipment',        'ARS'],
  ['Hull Equipment',                  'Hull'],
];

const WARSHIP_EXTRA_EQUIP_TAGS: [string, string][] = [
  ['Left Broadsides Equipment',        'Left Broadside'],
  ['Right Broadsides Equipment',       'Right Broadside'],
];

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

  // 1. Identity
  writeIdentity(w, entity, unitType);

  // 2. Year/Tech/Meta (includes quirks, weaponQuirks)
  writeYearTechMeta(w, entity);

  // 3. motion_type
  writeMotiveType(w, entity);

  // 4. transporters (includes docking collars)
  writeTransporters(w, entity);

  // 5. SafeThrust
  w.addBlock('SafeThrust', entity.walkMP());

  // 6. Heat sinks / Fuel
  w.addBlock('heatsinks', entity.heatSinkCount());
  w.addBlock('sink_type', HEAT_SINK_TYPE_TO_CODE[entity.heatSinkType() as HeatSinkType] ?? 0);
  w.addBlock('fuel', entity.fuel());

  // 7. Engine: engine_type, clan_engine
  writeEngine(w, entity, ENGINE_TYPE_TO_CODE);

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
  writeEquipmentByLocation(w, entity, equipTags, encodeEquipmentLine, true);

  // 13. structural_integrity
  w.addBlock('structural_integrity', entity.structuralIntegrity());

  // 14. Fluff
  writeFluffBlocks(w, entity.fluff());

  // 15. source
  writeSource(w, entity);

  // 16. tonnage
  writeTonnage(w, entity);

  // 17. Manual BV
  writeManualBV(w, entity);

  // 18. WarShip kf_core (between tonnage/bv and lithium-fusion)
  if (entity instanceof WarShipEntity) {
    if (entity.kfCore() > 0) w.addBlock('kf_core', entity.kfCore());
  }

  // 19. JumpShip-specific tail: lithium-fusion, jump_range, sail, grav_decks
  if (entity.lithiumFusion()) w.addBlock('lithium-fusion', 1);
  if (entity.jumpRange() >= 0) w.addBlock('jump_range', entity.jumpRange());
  w.addBlock('sail', entity.sail() ? 1 : 0);
  const gravDecks = entity.gravDecks();
  if (gravDecks.length > 0) {
    w.addBlock('grav_decks', ...gravDecks);
  }

  // 20. designtype + crew block
  w.addBlock('designtype', entity.designType());
  w.addBlock('crew', entity.crew());
  w.addBlock('officers', entity.officers());
  w.addBlock('gunners', entity.gunners());
  w.addBlock('passengers', entity.passengers());
  w.addBlock('marines', entity.marines());
  w.addBlock('battlearmor', entity.battleArmor());
  w.addBlock('life_boat', entity.lifeboats());
  w.addBlock('escape_pod', entity.escapePods());

  return w.toString();
}
