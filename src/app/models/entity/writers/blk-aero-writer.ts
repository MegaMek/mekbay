// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AeroEntity } from '../entities/aero/aero-entity';
import { ConvFighterEntity } from '../entities/aero/conv-fighter-entity';
import { FixedWingSupportEntity } from '../entities/aero/fixed-wing-support-entity';
import {
  AERO_EQUIP_LOCATIONS,
  requireArmorEquipment,
} from '../types';
import { MountedArmor } from '../components';
import { encodeBlkAeroCockpitType, encodeBlkHeatSinkType } from '../parsers/blk-codec';
import {
  BuildingBlockWriter,
  writeArmorBlocks,
  writeBlkPreamble,
  writeEngine,
  writeEquipmentByLocation,
  writeFluffBlocks,
  writeInternalType,
  writeManualBV,
  writeOmni,
  writeSource,
  writeSupportVehicleBarRating,
  writeTonnage,
  writeTransporters,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import { FIGHTER_EQUIP_TAGS, FWS_EQUIP_TAGS } from '../parsers/blk-constants';

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize an AeroEntity (ASF, ConvFighter, FixedWingSupport) to BLK format.
 *
 * Block ordering matches MegaMek's BLKFile.getBlock() exactly.
 */
export function writeBlkAero(entity: AeroEntity): string {
  const w = new BuildingBlockWriter();
  const virtualPatchworkArmor = entity.hasPatchworkArmor()
    ? new Map([
      ['Wings', new MountedArmor({
        armor: requireArmorEquipment('STANDARD', false, entity.getEquipmentRegistry()),
        techBase: 'IS',
        techRating: 'D',
      })],
      ['Fuselage', null],
    ] as const)
    : undefined;

  // ── UnitType ──
  let unitType = 'AeroSpaceFighter';
  if (entity instanceof FixedWingSupportEntity)  unitType = 'FixedWingSupport';
  else if (entity instanceof ConvFighterEntity)  unitType = 'ConvFighter';

  writeBlkPreamble(w, entity, unitType);
  writeTransporters(w, entity);

  // 5. SafeThrust
  w.addBlock('SafeThrust', entity.originalWalkMP());

  // 6. Cockpit / VSTOL
  w.addBlock('cockpit_type', encodeBlkAeroCockpitType(entity.cockpitType()));
  if (writesVstolBlock(entity)) {
    w.addBlock('vstol', 1);
  }

  // 7. Heat sinks / Fuel
  w.addBlock('heatsinks', entity.heatSinkCount());
  w.addBlock('sink_type', encodeBlkHeatSinkType(entity.heatSinkType()));
  if (entity.omnipodHeatSinkCount() > 0) {
    w.addBlock('omnipodheatsinks', entity.omnipodHeatSinkCount());
  }
  w.addBlock('fuel', entity.fuel());

  // 8. Engine: engine_type, clan_engine
  writeEngine(w, entity);

  // 9. Armor: armor_type, armor_tech_rating, armor_tech_level (or patchwork per-location)
  writeArmorBlocks(w, entity, AERO_EQUIP_LOCATIONS, virtualPatchworkArmor);

  // 10. internal_type
  writeInternalType(w, entity);

  // 11. omni
  writeOmni(w, entity);

  // 12. Armor values
  const armorMap = entity.armorValues();
  const armorLocs = ['Nose', 'Left Wing', 'Right Wing', 'Aft'];
  const armorInts: number[] = armorLocs.map(loc => armorMap.get(loc)?.front ?? 0);
  w.addBlock('armor', ...armorInts);

  // 13. Equipment per location (write empty blocks for fighters)
  const equipTags = entity instanceof FixedWingSupportEntity ? FWS_EQUIP_TAGS : FIGHTER_EQUIP_TAGS;
  writeEquipmentByLocation(w, entity, equipTags, encodeEquipmentLine, true);

  // 14. BAR / support tech ratings
  if (entity instanceof FixedWingSupportEntity) {
    writeSupportVehicleBarRating(w, entity);
    if (entity.structuralTechRating()) w.addBlock('structural_tech_rating', entity.structuralTechRating());
    if (entity.engineTechRating())     w.addBlock('engine_tech_rating', entity.engineTechRating());
  }

  // 15-18. Fluff / source / tonnage / Manual BV
    writeFluffBlocks(w, entity.fluff());
    writeSource(w, entity);
    writeTonnage(w, entity);
    writeManualBV(w, entity);

  // 20. Fire control weight (FWS omni)
  if (entity instanceof FixedWingSupportEntity && entity.omni()) {
    const fcw = entity.baseChassisFireConWeight();
    w.addBlock('baseChassisFireConWeight', Number.isInteger(fcw) ? fcw.toFixed(1) : String(fcw));
  }

  return w.toString();
}

/** Mirrors BLKFile's conventional-fighter type-flag and Aero.isVSTOL condition. */
function writesVstolBlock(entity: AeroEntity): boolean {
  if (entity instanceof ConvFighterEntity) return entity.vstol();
  return entity instanceof FixedWingSupportEntity
    && entity.equipment().some(mount => mount.equipment?.hasFlag('F_VSTOL_CHASSIS'));
}
