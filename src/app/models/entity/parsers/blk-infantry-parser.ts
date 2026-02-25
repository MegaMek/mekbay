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
import { InfantryEntity } from '../entities/infantry/infantry-entity';
import {
  INFANTRY_SPECIALIZATION_FROM_BIT,
  InfantrySpecialization,
} from '../types';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk } from './blk-base-parser';
import { parseEquipmentLine, resolveEquipment } from './equipment-resolver';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a conventional Infantry platoon.
 */
export function parseBlkInfantry(bb: BuildingBlock, equipmentDb: EquipmentMap): InfantryEntity {
  resetMountIdCounter();
  const entity = new InfantryEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, equipmentDb);
  const techBase = getBlkTechBase(bb);

  // ── Motion type ──
  if (bb.exists('motion_type')) {
    entity.motionType.set(bb.getFirstString('motion_type'));
  }

  // ── Squad configuration ──
  if (bb.exists('squad_size')) entity.squadSize.set(bb.getFirstInt('squad_size'));
  if (bb.exists('squadn'))    entity.squadCount.set(bb.getFirstInt('squadn'));

  // ── Weapons ──
  if (bb.exists('Primary'))      entity.primaryWeapon.set(bb.getFirstString('Primary'));
  if (bb.exists('Secondary'))    entity.secondaryWeapon.set(bb.getFirstString('Secondary'));
  if (bb.exists('secondn'))      entity.secondaryCount.set(bb.getFirstInt('secondn'));

  // ── Armor ──
  if (bb.exists('armorDivisor')) entity.armorDivisor.set(bb.getFirstDouble('armorDivisor'));
  if (bb.exists('armorKit'))     entity.armorKit.set(bb.getFirstString('armorKit'));

  // ── Anti-mek ──
  if (bb.exists('antimek')) {
    entity.antimek.set(bb.getFirstInt('antimek') === 1 || bb.getFirstString('antimek').toLowerCase() === 'true');
  }

  // ── Specializations (bitmap) ──
  if (bb.exists('specialization')) {
    const bitmap = bb.getFirstInt('specialization');
    const specs = new Set<InfantrySpecialization>();
    for (const [bit, spec] of Object.entries(INFANTRY_SPECIALIZATION_FROM_BIT)) {
      if (bitmap & (1 << parseInt(bit, 10))) {
        specs.add(spec);
      }
    }
    entity.specializations.set(specs);
  }

  // ── Field Guns ──
  if (bb.exists('Field Guns Equipment')) {
    const lines = bb.getDataAsString('Field Guns Equipment');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = resolveEquipment(parsed.name, techBase, equipmentDb);

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: 'Field Guns',
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
