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

import { EquipmentMap } from '../../equipment.model';
import { HandheldWeaponEntity } from '../entities/misc/handheld-weapon-entity';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk } from './blk-base-parser';
import { parseEquipmentLine, resolveEquipment } from './equipment-resolver';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a HandheldWeapon entity.
 *
 * HandheldWeapons have a single equipment location: `None`.
 * Equipment is listed under `Gun Equipment`.
 */
export function parseBlkHandheld(bb: BuildingBlock, equipmentDb: EquipmentMap): HandheldWeaponEntity {
  resetMountIdCounter();
  const entity = new HandheldWeaponEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, equipmentDb);
  const techBase = getBlkTechBase(bb);

  // ── Equipment ──
  if (bb.exists('Gun Equipment')) {
    const lines = bb.getDataAsString('Gun Equipment');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = resolveEquipment(parsed.name, techBase, equipmentDb);

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: 'None',
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
        size: parsed.size,
      });
    }
  }

  return entity;
}
