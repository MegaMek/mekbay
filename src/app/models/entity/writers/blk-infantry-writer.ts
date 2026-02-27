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
import {
  BuildingBlockWriter,
  writeIdentity,
  writeYearTechMeta,
  writeFluffBlocks,
  writeSource,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize an InfantryEntity to BLK format.
 *
 * Block ordering matches Java BLKFile.encode():
 *   identity → yearTechMeta → motion_type → Troopers Equipment →
 *   Field Guns Equipment → slotless_equipment → fluff → source →
 *   squad_size → squadn → secondn → Primary → Secondary →
 *   armordivisor → encumberingarmor → spacesuit → dest →
 *   sneakcamo → sneakir → sneakecm → specialization
 *
 * NOTE: No tonnage, no cruiseMP, no armor blocks for conventional infantry.
 */
export function writeBlkInfantry(entity: InfantryEntity): string {
  const w = new BuildingBlockWriter();

  // ── Section 1: Identity ──
  writeIdentity(w, entity, 'Infantry');

  // ── Section 2: Year / Tech / Meta (includes quirks) ──
  writeYearTechMeta(w, entity);

  // ── Section 3: Motion type ──
  if (entity.motionType()) w.addBlock('motion_type', entity.motionType());

  // ── Section 4: Equipment per location ──
  // Java iterates entity.locations() which gives LOC_INFANTRY=0 then LOC_FIELD_GUNS=1
  // producing "Troopers Equipment" and "Field Guns Equipment", always, even if empty.
  const mountsByLoc = new Map<string, string[]>();
  for (const m of entity.equipment()) {
    let lines = mountsByLoc.get(m.location);
    if (!lines) { lines = []; mountsByLoc.set(m.location, lines); }
    lines.push(encodeEquipmentLine(m, { blkMode: true }));
  }

  // Troopers Equipment (always written, even if empty)
  const trooperEquip = mountsByLoc.get('Infantry') ?? [];
  w.addBlock('Troopers Equipment', ...trooperEquip);

  // Field Guns Equipment (always written, even if empty)
  const fieldGunEquip = mountsByLoc.get('Field Guns') ?? [];
  w.addBlock('Field Guns Equipment', ...fieldGunEquip);

  // Slotless Equipment
  const slotlessEquip = mountsByLoc.get('None') ?? [];
  if (slotlessEquip.length > 0) {
    w.addBlock('slotless_equipment', ...slotlessEquip);
  }

  // ── Section 5: Fluff ──
  writeFluffBlocks(w, entity.fluff());

  // ── Section 6: Source ──
  writeSource(w, entity);

  // ── Section 7: Infantry-specific tail fields ──
  w.addBlock('squad_size', entity.squadSize());
  w.addBlock('squadn', entity.squadCount());
  if (entity.secondaryCount() > 0) w.addBlock('secondn', entity.secondaryCount());

  if (entity.primaryWeapon())   w.addBlock('Primary', entity.primaryWeapon());
  if (entity.secondaryWeapon()) w.addBlock('Secondary', entity.secondaryWeapon());

  // Armor divisor — Java uses Double.toString() which always writes ".0" for integers
  if (entity.armorDivisor() !== 1) {
    const d = entity.armorDivisor();
    w.addBlock('armordivisor', Number.isInteger(d) ? d.toFixed(1) : String(d));
  }

  // Boolean flags — only written when true, value is always "true"
  if (entity.encumberingArmor()) w.addBlock('encumberingarmor', 'true');
  if (entity.spaceSuit())        w.addBlock('spacesuit', 'true');
  if (entity.hasDEST())          w.addBlock('dest', 'true');
  if (entity.sneakCamo())        w.addBlock('sneakcamo', 'true');
  if (entity.sneakIR())          w.addBlock('sneakir', 'true');
  if (entity.sneakECM())         w.addBlock('sneakecm', 'true');

  // Specializations (bitmap)
  const specs = entity.specializations();
  if (specs.size > 0) {
    let bitmap = 0;
    for (const spec of specs) {
      const bit = INFANTRY_SPECIALIZATION_TO_BIT[spec];
      if (bit !== undefined) bitmap |= (1 << bit);
    }
    w.addBlock('specialization', bitmap);
  }

  // Augmentations (Manei Domini)
  const augs = entity.augmentations();
  if (augs.length > 0) {
    w.addBlock('augmentation', ...augs);
  }

  // Prosthetic Enhancement (Enhanced Limbs — IO p.84)
  if (entity.prostheticEnhancement1()) {
    w.addBlock('prostheticEnhancement1', entity.prostheticEnhancement1());
    if (entity.prostheticEnhancement1Count() > 0) {
      w.addBlock('prostheticEnhancement1Count', entity.prostheticEnhancement1Count());
    }
  }
  if (entity.prostheticEnhancement2()) {
    w.addBlock('prostheticEnhancement2', entity.prostheticEnhancement2());
    if (entity.prostheticEnhancement2Count() > 0) {
      w.addBlock('prostheticEnhancement2Count', entity.prostheticEnhancement2Count());
    }
  }
  if (entity.extraneousPair1()) w.addBlock('extraneousPair1', entity.extraneousPair1());
  if (entity.extraneousPair2()) w.addBlock('extraneousPair2', entity.extraneousPair2());

  // NOTE: No tonnage block for conventional infantry — matches Java reference output

  return w.toString();
}
