// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ProtoMekEntity } from '../entities/protomek/protomek-entity';
import {
  LocationArmor,
  locationArmor,
} from '../types';
import { BuildingBlock } from './building-block';
import { PROTO_EQUIP_TAGS } from './blk-constants';
import { getBlkTechBase, parseBaseBlk, parseBlkArmor, parseBlkEngine, parseBlkEquipment } from './blk-base-parser';
import { ParseContext } from './parse-context';
import { decodeMotiveType } from './motive-type-codec';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a ProtoMek entity.
 */
export function parseBlkProtoMek(bb: BuildingBlock, ctx: ParseContext): ProtoMekEntity {
  const entity = new ProtoMekEntity(ctx.equipmentRegistry);

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Motive type ──
  if (bb.exists('motion_type')) {
    const motiveType = decodeMotiveType(bb.getFirstString('motion_type'));
    entity.motiveType.set(motiveType);
    entity.isQuad.set(motiveType === 'Quad');
    entity.isGlider.set(motiveType === 'WiGE');
  }

  // ── Movement ──
  if (bb.exists('cruiseMP'))  entity.originalWalkMP.set(bb.getFirstInt('cruiseMP'));

  // ── ProtoMek-specific flags ──
  if (bb.exists('interface_cockpit')) {
    const val = bb.getFirstString('interface_cockpit');
    entity.interfaceCockpit.set(val.toLowerCase() === 'true' || val === '1');
  }
  if (bb.exists('isQuad'))   entity.isQuad.set(bb.getFirstInt('isQuad') === 1);
  if (bb.exists('isGlider')) entity.isGlider.set(bb.getFirstInt('isGlider') === 1);

  // ── Engine ──
  {
    const result = parseBlkEngine(bb, entity, {
      engineTypeRequired: true,
      includeHeatSinks: false,
      rating: entity.calculatedEngineRating(),
    });
    if (result) entity.mountedEngine.set(result.mountedEngine);
  }

  // ── Armor ──
  parseBlkArmor(bb, entity, ctx, { remapStandardTo: 'STANDARD_PROTOMEK' });

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
  parseBlkEquipment(bb, entity, ctx, PROTO_EQUIP_TAGS, {
    equipmentLineProfile: 'protomek',
  });

  return entity;
}
