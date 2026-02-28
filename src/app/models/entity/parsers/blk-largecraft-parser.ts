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
  LARGE_CRAFT_LOCATIONS,
} from '../types';
import { resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { JUMPSHIP_EQUIP_TAGS, WARSHIP_EXTRA_EQUIP_TAGS } from './blk-constants';
import { getBlkTechBase, parseBaseBlk, parseBlkAeroEngine, parseBlkArmor, parseBlkArmorValues, parseBlkCrew, parseBlkEquipment } from './blk-base-parser';
import { ParseContext } from './parse-context';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a JumpShip, WarShip, or SpaceStation entity.
 */
export function parseBlkLargeCraft(bb: BuildingBlock, ctx: ParseContext): JumpShipEntity {
  resetMountIdCounter();

  // ── Determine entity type ──
  const unitType = bb.getFirstString('UnitType').trim();
  let entity: JumpShipEntity;

  switch (unitType.toLowerCase()) {
    case 'warship':       entity = new WarShipEntity(); break;
    case 'spacestation':  entity = new SpaceStationEntity(); break;
    default:              entity = new JumpShipEntity(); break;
  }

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Movement ──
  if (bb.exists('SafeThrust')) entity.walkMP.set(bb.getFirstInt('SafeThrust'));
  if (bb.exists('fuel'))       entity.fuel.set(bb.getFirstInt('fuel'));

  // ── Engine ──
  parseBlkAeroEngine(bb, entity, { defaultTotalHeatSinks: 0 });

  // ── Structural integrity ──
  if (bb.exists('structural_integrity')) {
    entity.structuralIntegrity.set(bb.getFirstInt('structural_integrity'));
  }

  // ── JumpShip specifics ──
  if (bb.exists('designtype'))     entity.designType.set(bb.getFirstInt('designtype'));
  if (bb.exists('sail'))           entity.sail.set(bb.getFirstInt('sail') === 1);
  if (bb.exists('docking_collar')) entity.dockingCollars.set(bb.getFirstInt('docking_collar'));
  if (bb.exists('lithium-fusion')) entity.lithiumFusion.set(bb.getFirstInt('lithium-fusion') === 1);
  if (bb.exists('hpg'))           entity.hpg.set(bb.getFirstInt('hpg') === 1);
  if (bb.exists('jump_range'))    entity.jumpRange.set(bb.getFirstInt('jump_range'));

  if (bb.exists('grav_decks')) {
    entity.gravDecks.set(bb.getDataAsInt('grav_decks'));
  }

  // ── WarShip specifics ──
  if (entity instanceof WarShipEntity) {
    if (bb.exists('kf_core')) entity.kfCore.set(bb.getFirstInt('kf_core'));
  }

  // ── Armor ──
  parseBlkArmor(bb, entity, ctx);
  parseBlkArmorValues(bb, entity, LARGE_CRAFT_LOCATIONS);

  // ── Equipment per location ──
  const equipTags = entity instanceof WarShipEntity
    ? [...JUMPSHIP_EQUIP_TAGS, ...WARSHIP_EXTRA_EQUIP_TAGS]
    : JUMPSHIP_EQUIP_TAGS;
  parseBlkEquipment(bb, entity, ctx, equipTags);

  // ── Crew ──
  parseBlkCrew(bb, entity);

  return entity;
}
