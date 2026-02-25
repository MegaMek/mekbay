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

// ── Types & Constants ──
export * from './types';

// ── Base Entity ──
export { BaseEntity } from './base-entity';

// ── Parsers ──
export { BuildingBlock } from './parsers/building-block';
export { resolveEquipment, parseEquipmentLine } from './parsers/equipment-resolver';
export type { EquipmentLineModifiers } from './parsers/equipment-resolver';

// ── Writers ──
export { BuildingBlockWriter } from './writers/building-block-writer';
export { encodeEquipmentLine } from './writers/equipment-encoder';

// ── Utils ──
export {
  generateMountId,
  resetMountIdCounter,
  updateMap,
  updateArray,
  upsertMount,
  removeMountById,
} from './utils/signal-helpers';
export { parseTechLevel, encodeTechLevel } from './utils/tech-level-parser';
export type { ParsedTechLevel } from './utils/tech-level-parser';
export { engineTypeFromCode, engineTypeToCode, parseMtfEngine, formatMtfEngine } from './utils/engine-type-parser';
export type { MtfEngineInfo } from './utils/engine-type-parser';
export { parseMtfArmor, formatMtfArmor } from './utils/armor-type-parser';
export type { MtfArmorInfo } from './utils/armor-type-parser';

// ── Mek Entities ──
export { MekEntity, MekWithArmsEntity } from './entities/mek/mek-entity';
export { BipedMekEntity } from './entities/mek/biped-mek-entity';
export { TripodMekEntity } from './entities/mek/tripod-mek-entity';
export { QuadMekEntity } from './entities/mek/quad-mek-entity';
export { QuadVeeEntity } from './entities/mek/quad-vee-entity';
export { LamEntity } from './entities/mek/lam-entity';

// ── Mek Parsers ──
export { parseMtf } from './parsers/mtf-parser';
export { parseBlkMek } from './parsers/blk-mek-parser';
export { parseBaseBlk, getBlkEquipmentLines, getBlkTechBase } from './parsers/blk-base-parser';

// ── Mek Writers ──
export { writeMtf } from './writers/mtf-writer';
export { writeBlkMek } from './writers/blk-mek-writer';

// ── Aero Entities ──
export { AeroEntity } from './entities/aero/aero-entity';
export { AeroSpaceFighterEntity } from './entities/aero/aero-space-fighter-entity';
export { ConvFighterEntity } from './entities/aero/conv-fighter-entity';
export { FixedWingSupportEntity } from './entities/aero/fixed-wing-support-entity';
export { SmallCraftEntity } from './entities/aero/small-craft-entity';

// ── Aero Parsers ──
export { parseBlkAero } from './parsers/blk-aero-parser';
export { parseBlkSmallCraft } from './parsers/blk-smallcraft-parser';

// ── Aero Writers ──
export { writeBlkAero } from './writers/blk-aero-writer';
export { writeBlkSmallCraft } from './writers/blk-smallcraft-writer';

// ── Vehicle Entities ──
export { VehicleEntity } from './entities/vehicle/vehicle-entity';
export { TankEntity } from './entities/vehicle/tank-entity';
export { NavalEntity } from './entities/vehicle/naval-entity';
export { VtolEntity } from './entities/vehicle/vtol-entity';
export { SupportTankEntity } from './entities/vehicle/support-tank-entity';
export { SupportVtolEntity } from './entities/vehicle/support-vtol-entity';
export { LargeSupportTankEntity } from './entities/vehicle/large-support-tank-entity';
export { GunEmplacementEntity } from './entities/vehicle/gun-emplacement-entity';

// ── Vehicle Parsers ──
export { parseBlkVehicle } from './parsers/blk-vehicle-parser';

// ── Vehicle Writers ──
export { writeBlkVehicle } from './writers/blk-vehicle-writer';

// ── Infantry Entities ──
export { InfantryEntity } from './entities/infantry/infantry-entity';
export { BattleArmorEntity } from './entities/infantry/battle-armor-entity';

// ── Infantry Parsers ──
export { parseBlkInfantry } from './parsers/blk-infantry-parser';
export { parseBlkBA } from './parsers/blk-ba-parser';

// ── Infantry Writers ──
export { writeBlkInfantry } from './writers/blk-infantry-writer';
export { writeBlkBA } from './writers/blk-ba-writer';

// ── ProtoMek Entities ──
export { ProtoMekEntity } from './entities/protomek/protomek-entity';

// ── ProtoMek Parsers ──
export { parseBlkProtoMek } from './parsers/blk-protomek-parser';

// ── ProtoMek Writers ──
export { writeBlkProtoMek } from './writers/blk-protomek-writer';

// ── Large Craft Entities ──
export { DropShipEntity } from './entities/aero/dropship-entity';
export { JumpShipEntity } from './entities/largecraft/jumpship-entity';
export { WarShipEntity } from './entities/largecraft/warship-entity';
export { SpaceStationEntity } from './entities/largecraft/space-station-entity';

// ── Large Craft Parsers ──
export { parseBlkDropShip } from './parsers/blk-dropship-parser';
export { parseBlkLargeCraft } from './parsers/blk-largecraft-parser';

// ── Large Craft Writers ──
export { writeBlkDropShip } from './writers/blk-dropship-writer';
export { writeBlkLargeCraft } from './writers/blk-largecraft-writer';

// ── Misc Entities ──
export { HandheldWeaponEntity } from './entities/misc/handheld-weapon-entity';

// ── Misc Parsers ──
export { parseBlkHandheld } from './parsers/blk-handheld-parser';

// ── Misc Writers ──
export { writeBlkHandheld } from './writers/blk-handheld-writer';

// ── Dispatch Entry Points ──
export { parseEntity } from './parse-entity';
export type { ParseResult } from './parse-entity';
export { writeEntity } from './write-entity';

// ── Parse Context ──
export { ParseContext } from './parsers/parse-context';
export type { ParseDiagnostic, ParseSeverity, EquipmentFallbackFn } from './parsers/parse-context';
