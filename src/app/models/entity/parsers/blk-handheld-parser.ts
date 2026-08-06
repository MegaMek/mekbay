// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { HandheldWeaponEntity } from '../entities/misc/handheld-weapon-entity';
import { BuildingBlock } from './building-block';
import { parseBaseBlk } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';
import { locationArmor } from '../types';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a HandheldWeapon entity.
 *
 * HandheldWeapons have a single equipment location: `Gun`.
 * Equipment is listed under `Gun Equipment`.
 */
export function parseBlkHandheld(bb: BuildingBlock, ctx: ParseContext): HandheldWeaponEntity {
  const entity = new HandheldWeaponEntity(ctx.equipmentRegistry);

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);

  // Java's loader ignores armor material metadata and retains the constructor's
  // fixed Standard / IS Introductory / rating A installation.
  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');
    if (ints.length >= 1) {
      const armorMap = new Map();
      armorMap.set('Gun', locationArmor(ints[0]));
      entity.armorValues.set(armorMap);
    }
  }

  // ── Equipment ──
  if (bb.exists('Gun Equipment')) {
    const lines = bb.getDataAsString('Gun Equipment');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = ctx.resolveEquipment(parsed.name, 'Gun Equipment');

      entity.addEquipment({
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        allocation: { kind: 'location', location: 'Gun' },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
        size: parsed.size,
        shotsCount: parsed.shots,
      });
    }
  }

  return entity;
}
