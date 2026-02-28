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

import { BaseEntity } from './base-entity';
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
import { ProtoMekEntity } from './entities/protomek/protomek-entity';
import { VehicleEntity } from './entities/vehicle/vehicle-entity';
import { writeBlkAero } from './writers/blk-aero-writer';
import { writeBlkBA } from './writers/blk-ba-writer';
import { writeBlkDropShip } from './writers/blk-dropship-writer';
import { writeBlkHandheld } from './writers/blk-handheld-writer';
import { writeBlkInfantry } from './writers/blk-infantry-writer';
import { writeBlkLargeCraft } from './writers/blk-largecraft-writer';
import { writeBlkMek } from './writers/blk-mek-writer';
import { writeBlkProtoMek } from './writers/blk-protomek-writer';
import { writeBlkSmallCraft } from './writers/blk-smallcraft-writer';
import { writeBlkVehicle } from './writers/blk-vehicle-writer';
import { writeMtf } from './writers/mtf-writer';

/**
 * Unified entry point for writing any entity to its native file format.
 *
 * Mek entities can be written as either MTF or BLK (controlled by `format`
 * parameter). All other entity types are always written as BLK.
 *
 * @param entity  The entity to serialize
 * @param format  Output formats: 'mtf' or 'blk' (default). Only Meks support MTF.
 * @returns The serialized file content as a string
 * @throws Error if the entity type is unsupported
 */
export function writeEntity(entity: BaseEntity, format: 'mtf' | 'blk' = 'blk'): string {
  // ── MTF format (Mek only) ──
  if (format === 'mtf') {
    if (entity instanceof MekEntity) {
      return writeMtf(entity);
    }
    throw new Error(`MTF format is only supported for Mek entities, got ${entity.entityType}`);
  }

  // ── BLK format (all types) ──
  return writeBlk(entity);
}

/**
 * Dispatch entity to the appropriate BLK writer based on instance type.
 */
function writeBlk(entity: BaseEntity): string {
  // Order matters: check subclasses before base classes

  if (entity instanceof MekEntity) return writeBlkMek(entity);

  // DropShip extends SmallCraft, so check first
  if (entity instanceof DropShipEntity) return writeBlkDropShip(entity);
  if (entity instanceof SmallCraftEntity) return writeBlkSmallCraft(entity);

  // JumpShip is parent of WarShip/SpaceStation
  if (entity instanceof JumpShipEntity) return writeBlkLargeCraft(entity);

  if (entity instanceof VehicleEntity) return writeBlkVehicle(entity);

  // BattleArmor extends Infantry, so check first
  if (entity instanceof BattleArmorEntity) return writeBlkBA(entity);
  if (entity instanceof InfantryEntity) return writeBlkInfantry(entity);

  if (entity instanceof ProtoMekEntity) return writeBlkProtoMek(entity);

  if (entity instanceof HandheldWeaponEntity) return writeBlkHandheld(entity);

  // Fighters
  if (entity instanceof AeroSpaceFighterEntity) return writeBlkAero(entity);
  if (entity instanceof ConvFighterEntity) return writeBlkAero(entity);
  if (entity instanceof FixedWingSupportEntity) return writeBlkAero(entity);

  throw new Error(`Unsupported entity type for BLK writing: ${entity.entityType}`);
}
