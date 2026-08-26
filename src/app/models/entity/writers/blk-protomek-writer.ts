// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ProtoMekEntity } from '../entities/protomek/protomek-entity';

import {
  BuildingBlockWriter,
  writeArmorBlocks,
  writeBlkPreamble,
  writeEngine,
  writeEquipmentByLocation,
  writeEmbeddedImages,
  writeFluffBlocks,
  writeInternalType,
  writeSource,
  writeTonnage,
  writeTransporters,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import { PROTO_EQUIP_TAGS } from '../parsers/blk-constants';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a ProtoMekEntity to BLK format.
 *
 * Block ordering matches Java BLKFile.encode():
 *   identity → yearTechMeta → motion_type → cruiseMP → jumpingMP →
 *   interface_cockpit → engine_type → clan_engine → armor_type →
 *   armor_tech_rating → armor_tech_level → internal_type →
 *   armor → Equipment per location → slotless_equipment →
 *   fluff → source → tonnage
 */
export function writeBlkProtoMek(entity: ProtoMekEntity): string {
  const w = new BuildingBlockWriter();

  // ── Section 1-4: Identity / Year+Tech / Motion type / Transporters ──
  writeBlkPreamble(w, entity, 'ProtoMek');
  writeTransporters(w, entity);

  // ── Section 5: Movement ──
  w.addBlock('cruiseMP', entity.originalWalkMP());
  // ProtoMeks always write jumpingMP (even 0)
  w.addBlock('jumpingMP', Math.max(entity.installedJumpJetMP(), entity.installedUmuMP()));
  // ProtoMeks always write interface_cockpit as string
  w.addBlock('interface_cockpit', entity.interfaceCockpit() ? 'true' : 'false');

  // ── Section 6: Engine ──
  writeEngine(w, entity);

  // ── Section 7: Armor ──
  writeArmorBlocks(w, entity);

  // ── Section 8: Internal type ──
  writeInternalType(w, entity);

  // ── Section 9: Armor values array ──
  const armorMap = entity.armorValues();
  // ProtoMek armor order: Head, Torso, RA, LA, Legs, [MainGun]  (NO rear armor)
  const armorInts: number[] = [
    armorMap.get('Head')?.front ?? 0,
    armorMap.get('Torso')?.front ?? 0,
    armorMap.get('Right Arm')?.front ?? 0,
    armorMap.get('Left Arm')?.front ?? 0,
    armorMap.get('Legs')?.front ?? 0,
  ];
  if (entity.hasMainGun()) {
    armorInts.push(armorMap.get('Main Gun')?.front ?? 0);
  }
  w.addBlock('armor', ...armorInts);

  // ── Section 10: Equipment per location (always write all, even empty) ──
  const equipTags = entity.hasMainGun()
    ? PROTO_EQUIP_TAGS
    : PROTO_EQUIP_TAGS.filter(([tag]) => tag !== 'Main Gun Equipment');
  writeEquipmentByLocation(w, entity, equipTags, encodeEquipmentLine, true, {
    blkMode: true,
    shotsFormat: 'protomek',
  });

  // ── Section 11-13: Fluff / Source / Tonnage ──
  writeFluffBlocks(w, entity.fluff());
  writeSource(w, entity);
  writeTonnage(w, entity);

  writeEmbeddedImages(w, entity);
  
  return w.toString(entity.nativeSourceTrailingNewlines || 2);
}
