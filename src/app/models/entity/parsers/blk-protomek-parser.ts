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

import { ProtoMekEntity } from '../entities/protomek/protomek-entity';
import {
  LocationArmor,
  locationArmor,
  parseMotiveType,
} from '../types';
import { resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { PROTO_EQUIP_TAGS } from './blk-constants';
import { getBlkTechBase, parseBaseBlk, parseBlkArmor, parseBlkEngine, parseBlkEquipment } from './blk-base-parser';
import { ParseContext } from './parse-context';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a ProtoMek entity.
 */
export function parseBlkProtoMek(bb: BuildingBlock, ctx: ParseContext): ProtoMekEntity {
  resetMountIdCounter();
  const entity = new ProtoMekEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Motive type ──
  if (bb.exists('motion_type')) entity.motiveType.set(parseMotiveType(bb.getFirstString('motion_type')));

  // ── Movement ──
  if (bb.exists('cruiseMP'))  entity.walkMP.set(bb.getFirstInt('cruiseMP'));
  if (bb.exists('jumpingMP')) entity.jumpingMP.set(bb.getFirstInt('jumpingMP'));

  // ── Engine ──
  {
    const result = parseBlkEngine(bb, entity, {
      engineTypeRequired: true,
      includeHeatSinks: false,
    });
    if (result) entity.mountedEngine.set(result.mountedEngine);
  }

  // ── ProtoMek-specific flags ──
  if (bb.exists('interface_cockpit')) {
    const val = bb.getFirstString('interface_cockpit');
    entity.interfaceCockpit.set(val.toLowerCase() === 'true' || val === '1');
  }
  if (bb.exists('isQuad'))   entity.isQuad.set(bb.getFirstInt('isQuad') === 1);
  if (bb.exists('isGlider')) entity.isGlider.set(bb.getFirstInt('isGlider') === 1);

  // ── Armor ──
  parseBlkArmor(bb, entity, ctx);

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');

    // Determine hasMainGun from armor array length (Java approach).
    // ProtoMek has 7 locations (Body..MainGun); armor skips Body.
    // 6 values = has Main Gun, 5 values = no Main Gun.
    entity.hasMainGun.set(ints.length >= 6);

    const armorMap = new Map<string, LocationArmor>();

    // ProtoMek armor: Head, Torso, RA, LA, Legs, [MainGun]  (NO rear armor)
    if (ints.length >= 1) armorMap.set('Head', locationArmor(ints[0]));
    if (ints.length >= 2) armorMap.set('Torso', locationArmor(ints[1]));
    if (ints.length >= 3) armorMap.set('Right Arm', locationArmor(ints[2]));
    if (ints.length >= 4) armorMap.set('Left Arm', locationArmor(ints[3]));
    if (ints.length >= 5) armorMap.set('Legs', locationArmor(ints[4]));
    if (ints.length >= 6) armorMap.set('Main Gun', locationArmor(ints[5]));

    entity.armorValues.set(armorMap);
  } else {
    // Fallback: detect Main Gun from equipment blocks
    if (bb.exists('Main Gun Equipment')) {
      entity.hasMainGun.set(true);
    }
  }

  // ── Equipment per location ──
  parseBlkEquipment(bb, entity, ctx, PROTO_EQUIP_TAGS);

  return entity;
}
