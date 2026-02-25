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

import { EquipmentMap } from '../equipment.model';
import { BaseEntity } from './base-entity';
import { BuildingBlock } from './parsers/building-block';
import { parseMtf } from './parsers/mtf-parser';
import { parseBlkMek } from './parsers/blk-mek-parser';
import { parseBlkAero } from './parsers/blk-aero-parser';
import { parseBlkSmallCraft } from './parsers/blk-smallcraft-parser';
import { parseBlkVehicle } from './parsers/blk-vehicle-parser';
import { parseBlkInfantry } from './parsers/blk-infantry-parser';
import { parseBlkBA } from './parsers/blk-ba-parser';
import { parseBlkProtoMek } from './parsers/blk-protomek-parser';
import { parseBlkDropShip } from './parsers/blk-dropship-parser';
import { parseBlkLargeCraft } from './parsers/blk-largecraft-parser';
import { parseBlkHandheld } from './parsers/blk-handheld-parser';

/**
 * Unified entry point for parsing any MegaMek unit file (.mtf or .blk).
 *
 * Dispatches to the appropriate parser based on file extension and, for BLK
 * files, the `<UnitType>` block inside the file.
 *
 * @param content  Raw file content as a string
 * @param fileName File name (used to determine format by extension)
 * @param equipmentDb Equipment lookup map for name resolution
 * @returns Fully-hydrated entity subclass instance
 * @throws Error if the file format or unit type is unsupported
 */
export function parseEntity(
  content: string,
  fileName: string,
  equipmentDb: EquipmentMap,
): BaseEntity {
  const lowerName = fileName.toLowerCase();

  // ── MTF format (Mek only) ──
  if (lowerName.endsWith('.mtf')) {
    return parseMtf(content, equipmentDb);
  }

  // ── BLK format (all types) ──
  if (lowerName.endsWith('.blk')) {
    const bb = new BuildingBlock(content);
    return parseBlk(bb, equipmentDb);
  }

  throw new Error(`Unsupported file format: ${fileName}`);
}

/**
 * Dispatch a parsed BuildingBlock to the appropriate type-specific parser
 * based on the `<UnitType>` block.
 */
function parseBlk(bb: BuildingBlock, equipmentDb: EquipmentMap): BaseEntity {
  const unitType = bb.getFirstString('UnitType').trim();

  switch (unitType) {
    // ── Mek ──
    case 'BipedMek':
    case 'TripodMek':
    case 'QuadMek':
    case 'QuadVee':
    case 'LAM':
      return parseBlkMek(bb, equipmentDb);

    // ── Aero fighters ──
    case 'Aero':
    case 'AeroSpaceFighter':
    case 'ConvFighter':
    case 'FixedWingSupport':
      return parseBlkAero(bb, equipmentDb);

    // ── SmallCraft ──
    case 'SmallCraft':
      return parseBlkSmallCraft(bb, equipmentDb);

    // ── DropShip ──
    case 'DropShip':
    case 'Dropship':
      return parseBlkDropShip(bb, equipmentDb);

    // ── Vehicle family ──
    case 'Tank':
    case 'Naval':
    case 'VTOL':
    case 'SupportTank':
    case 'SupportVTOL':
    case 'LargeSupportTank':
    case 'GunEmplacement':
      return parseBlkVehicle(bb, equipmentDb);

    // ── Infantry ──
    case 'Infantry':
      return parseBlkInfantry(bb, equipmentDb);

    // ── BattleArmor ──
    case 'BattleArmor':
      return parseBlkBA(bb, equipmentDb);

    // ── ProtoMek ──
    case 'ProtoMek':
      return parseBlkProtoMek(bb, equipmentDb);

    // ── JumpShip / WarShip / SpaceStation ──
    case 'JumpShip':
    case 'Jumpship':
    case 'WarShip':
    case 'Warship':
    case 'SpaceStation':
      return parseBlkLargeCraft(bb, equipmentDb);

    // ── HandheldWeapon ──
    case 'HandheldWeapon':
      return parseBlkHandheld(bb, equipmentDb);

    default:
      throw new Error(`Unsupported BLK UnitType: "${unitType}"`);
  }
}
