// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from './base-entity';
import { AeroSpaceFighterEntity } from './entities/aero/aero-space-fighter-entity';
import { ConvFighterEntity } from './entities/aero/conv-fighter-entity';
import { DropShipEntity } from './entities/aero/dropship-entity';
import { FixedWingSupportEntity } from './entities/aero/fixed-wing-support-entity';
import { SmallCraftEntity } from './entities/aero/small-craft-entity';
import { BattleArmorEntity } from './entities/infantry/battle-armor-entity';
import { InfantryEntity } from './entities/infantry/infantry-entity';
import { JumpShipEntity } from './entities/largecraft/jumpship-entity';
import { MekEntity } from './entities/mek/mek-entity';
import { HandheldWeaponEntity } from './entities/misc/handheld-weapon-entity';
import { StaticEmplacementEntity } from './entities/misc/static-emplacement-entity';
import { ProtoMekEntity } from './entities/protomek/protomek-entity';
import { VehicleEntity } from './entities/vehicle/vehicle-entity';
import { writeBlkAero } from './writers/blk-aero-writer';
import { writeBlkBA } from './writers/blk-ba-writer';
import { writeBlkDropShip } from './writers/blk-dropship-writer';
import { writeBlkHandheld } from './writers/blk-handheld-writer';
import { writeBlkInfantry } from './writers/blk-infantry-writer';
import { writeBlkLargeCraft } from './writers/blk-largecraft-writer';
import { writeBlkProtoMek } from './writers/blk-protomek-writer';
import { writeBlkSmallCraft } from './writers/blk-smallcraft-writer';
import { writeBlkStaticEmplacement } from './writers/blk-static-emplacement-writer';
import { writeBlkVehicle } from './writers/blk-vehicle-writer';
import { writeMtf } from './writers/mtf-writer';

/** Serialize an entity in its only native MegaMek format: MTF for Meks, BLK otherwise. */
export function encodeNativeEntity(entity: BaseEntity, eol: 'lf' | 'crlf' = 'lf'): string {
  const text = entity instanceof MekEntity ? writeMtf(entity) : writeBlk(entity);
  return eol === 'crlf' ? text.replace(/\r?\n/gu, '\r\n') : text.replace(/\r\n/gu, '\n');
}

function writeBlk(entity: BaseEntity): string {
  if (entity instanceof DropShipEntity) return writeBlkDropShip(entity);
  if (entity instanceof SmallCraftEntity) return writeBlkSmallCraft(entity);
  if (entity instanceof JumpShipEntity) return writeBlkLargeCraft(entity);
  if (entity instanceof VehicleEntity) return writeBlkVehicle(entity);
  if (entity instanceof BattleArmorEntity) return writeBlkBA(entity);
  if (entity instanceof InfantryEntity) return writeBlkInfantry(entity);
  if (entity instanceof ProtoMekEntity) return writeBlkProtoMek(entity);
  if (entity instanceof HandheldWeaponEntity) return writeBlkHandheld(entity);
  if (entity instanceof StaticEmplacementEntity) return writeBlkStaticEmplacement(entity);
  if (entity instanceof AeroSpaceFighterEntity
    || entity instanceof ConvFighterEntity
    || entity instanceof FixedWingSupportEntity) return writeBlkAero(entity);
  throw new Error(`Unsupported entity type for native writing: ${entity.entityType}`);
}
