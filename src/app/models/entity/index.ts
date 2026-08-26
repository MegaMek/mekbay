// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

// ── Types & Constants ──
export * from './types';
export * from './codec-capabilities';
export * from './entity-state-view';

// ── Base Entity ──
export { BaseEntity } from './base-entity';

// ── Parsers ──
export { BuildingBlock } from './parsers/building-block';
export { parseEquipmentLine } from './parsers/equipment-resolver';
export type { EquipmentLineModifiers } from './parsers/equipment-resolver';

// ── Writers ──
export { BuildingBlockWriter } from './writers/building-block-writer';
export { encodeEquipmentLine } from './writers/equipment-encoder';

// ── Utils ──
export { parseBlkTechLevel, encodeBlkTechLevel } from './parsers/blk-codec';
export type { BlkTechLevel } from './parsers/blk-codec';
export {
  decodeMtfArmor,
  decodeMtfEngine,
  decodeMtfHeatSinks,
  encodeMtfArmor,
  encodeMtfEngine,
  encodeMtfHeatSinkType,
} from './parsers/mtf-codec';
export type {
  MtfArmorInfo,
  MtfEngineEncoding,
  MtfEngineInfo,
  MtfHeatSinkConfiguration,
} from './parsers/mtf-codec';

// ── Mek Entities ──
export { MekEntity, MekWithArmsEntity } from './entities/mek/mek-entity';
export { BipedMekEntity } from './entities/mek/biped-mek-entity';
export { TripodMekEntity } from './entities/mek/tripod-mek-entity';
export { QuadMekEntity } from './entities/mek/quad-mek-entity';
export { QuadVeeEntity } from './entities/mek/quad-vee-entity';
export { LamEntity } from './entities/mek/lam-entity';

// ── Mek Parsers ──
export { parseMtf } from './parsers/mtf-parser';
export { parseBaseBlk, getBlkEquipmentLines, getBlkTechBase } from './parsers/blk-base-parser';

// ── Mek Writers ──
export { writeMtf } from './writers/mtf-writer';

// ── Aero Entities ──
export { AeroEntity } from './entities/aero/aero-entity';
export { LargeAeroEntity } from './entities/aero/large-aero-entity';
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
export { SupportNavalEntity } from './entities/vehicle/support-naval-entity';
export { SupportVtolEntity } from './entities/vehicle/support-vtol-entity';
export { LargeSupportTankEntity } from './entities/vehicle/large-support-tank-entity';

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
export { StaticEmplacementEntity } from './entities/misc/static-emplacement-entity';

// ── Misc Parsers ──
export { parseBlkHandheld } from './parsers/blk-handheld-parser';
export { parseBlkStaticEmplacement } from './parsers/blk-static-emplacement-parser';

// ── Misc Writers ──
export { writeBlkHandheld } from './writers/blk-handheld-writer';

// ── Dispatch Entry Points ──
export { parseEntity } from './parse-entity';
export { UnsupportedNativeFormatError } from './parse-entity';
export type { ParseResult } from './parse-entity';
export { encodeNativeEntity } from './write-entity';

// ── Parse Context ──
export { ParseContext, isEntityLoadIssueArray } from './parsers/parse-context';
export type { EntityLoadIssue, ParseSeverity, EquipmentFallbackFn } from './parsers/parse-context';
