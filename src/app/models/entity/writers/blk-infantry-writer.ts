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

import { InfantryEntity } from '../entities/infantry/infantry-entity';
import { INFANTRY_SPECIALIZATION_TO_BIT } from '../types';
import { BuildingBlockWriter } from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize an InfantryEntity to BLK format.
 */
export function writeBlkInfantry(entity: InfantryEntity): string {
  const w = new BuildingBlockWriter();

  // ── Header ──
  w.addBlock('BlockVersion', 1);
  w.addBlock('Version', 'MAM0');
  w.addBlock('UnitType', 'Infantry');

  // ── Identity ──
  w.addBlock('Name', entity.chassis());
  if (entity.model()) w.addBlock('Model', entity.model());
  if (entity.mulId() >= 0) w.addBlock('mul id:', entity.mulId());

  // ── Year / Tech / Meta ──
  w.addBlock('year', entity.year());
  if (entity.originalBuildYear() >= 0) w.addBlock('originalBuildYear', entity.originalBuildYear());
  if (entity.techLevel()) w.addBlock('type', entity.techLevel());
  if (entity.role()) w.addBlock('role', entity.role());

  // ── Motion type ──
  w.addBlock('motion_type', entity.motionType());

  // ── Transporters ──
  const transporters = entity.transporters();
  if (transporters.length > 0) {
    const tLines = transporters.map(t =>
      `${t.type}:${t.capacity}:${t.doors}` + (t.bayNumber ? `:${t.bayNumber}` : '')
    );
    w.addBlock('transporters', ...tLines);
  }

  // ── Squad ──
  w.addBlock('squad_size', entity.squadSize());
  w.addBlock('squadn', entity.squadCount());

  // ── Weapons ──
  if (entity.primaryWeapon())   w.addBlock('Primary', entity.primaryWeapon());
  if (entity.secondaryWeapon()) w.addBlock('Secondary', entity.secondaryWeapon());
  if (entity.secondaryCount())  w.addBlock('secondn', entity.secondaryCount());

  // ── Armor ──
  if (entity.armorDivisor() !== 1) w.addBlock('armorDivisor', entity.armorDivisor());
  if (entity.armorKit())            w.addBlock('armorKit', entity.armorKit());

  // ── Anti-mek ──
  if (entity.antimek()) w.addBlock('antimek', 1);

  // ── Specializations (bitmap) ──
  const specs = entity.specializations();
  if (specs.size > 0) {
    let bitmap = 0;
    for (const spec of specs) {
      const bit = INFANTRY_SPECIALIZATION_TO_BIT[spec];
      if (bit !== undefined) bitmap |= (1 << bit);
    }
    w.addBlock('specialization', bitmap);
  }

  // ── Field Guns ──
  const fieldGuns = entity.equipment().filter(m => m.location === 'Field Guns');
  if (fieldGuns.length > 0) {
    const lines = fieldGuns.map(m => encodeEquipmentLine(m, { blkMode: true }));
    w.addBlock('Field Guns Equipment', ...lines);
  }

  // ── Source / Tonnage ──
  if (entity.source()) w.addBlock('source', entity.source());
  w.addBlock('tonnage', entity.tonnage());

  return w.toString();
}
