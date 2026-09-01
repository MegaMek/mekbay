// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import {
  ArmorType,
  BA_WEIGHT_CLASS_BY_CODE,
  EquipmentTechBase,
  LocationArmor,
  locationArmor,
  requireArmorEquipment,
  resolveArmorEquipment,
} from '../types';
import {
  componentTechLevelFromRulesLevel,
  decodeBlkArmorType,
  decodeBlkCompoundTechBase,
  decodeBlkCompoundTechLevel,
} from './blk-codec';
import { decodeMotiveType } from './motive-type-codec';
import { createCompoundTechLevel } from '../types/tech';
import {
  MountedArmor,
} from '../components';
import { BuildingBlock } from './building-block';
import { parseBaseBlk } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a BattleArmor entity.
 *
 * BLK layout for BA:
 *   - `Squad Equipment` (or legacy `Point Equipment`) → Squad location (shared equipment)
 *   - `Trooper 1 Equipment` … `Trooper N Equipment` → per-trooper equipment
 *   - Equipment lines may have `:Body`, `:LA`, `:RA`, `:TU` suffixes for BA mount location
 */
export function parseBlkBA(bb: BuildingBlock, ctx: ParseContext): BattleArmorEntity {
  const entity = new BattleArmorEntity(ctx.equipmentRegistry);

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);

  // ── BA-specific fields ──
  // Trooper Count can appear as 'Trooper Count' (with space) or 'troopercount'
  if (bb.exists('Trooper Count'))       entity.trooperCount.set(bb.getFirstInt('Trooper Count'));
  else if (bb.exists('troopercount'))   entity.trooperCount.set(bb.getFirstInt('troopercount'));

  if (bb.exists('weightclass'))    entity.declaredWeightClass.set(BA_WEIGHT_CLASS_BY_CODE[bb.getFirstInt('weightclass')] ?? 'Medium');
  if (bb.exists('chassis'))        entity.chassisType.set(bb.getFirstString('chassis'));
  if (bb.exists('turret'))         entity.turretConfig.set(bb.getFirstString('turret'));
  if (bb.exists('exoskeleton'))    entity.isExoskeleton.set(bb.getFirstString('exoskeleton') === 'true');
  if (bb.exists('clan_exo_without_harjel')) {
    entity.clanExoWithoutHarJel.set(bb.getFirstString('clan_exo_without_harjel') === 'true');
  }
  if (bb.exists('jumpingMP'))      entity.propulsionMP.set(bb.getFirstInt('jumpingMP'));
  if (bb.exists('motion_type'))    entity.motiveType.set(decodeMotiveType(bb.getFirstString('motion_type')));

  // cruiseMP → walkMP (BA movement)
  if (bb.exists('cruiseMP'))       entity.originalWalkMP.set(bb.getFirstInt('cruiseMP'));

  // ── Armor ──
  {
    const type: ArmorType = bb.exists('armor_type')
      ? decodeBlkArmorType(bb.getFirstInt('armor_type'))
      : 'BA_STANDARD';
    const compoundCode = bb.exists('armor_tech') ? bb.getFirstInt('armor_tech') : null;
    const techBase: EquipmentTechBase = compoundCode != null
      ? decodeBlkCompoundTechBase(compoundCode, entity.techBase())
      : entity.techBase();
    const armor = resolveArmorEquipment(type, techBase === 'Clan', ctx.equipmentRegistry);
    if (type !== 'PATCHWORK' && !armor) {
      ctx.error('armor_type', `Invalid armor type ${type} for ${techBase} technology`);
    }
    const technology = compoundCode == null
      ? createCompoundTechLevel(componentTechLevelFromRulesLevel(entity.rulesLevel()), techBase)
      : decodeBlkCompoundTechLevel(compoundCode);
    if (type !== 'PATCHWORK') {
      entity.setUniformArmor(new MountedArmor({
        techBase,
        armor: armor ?? requireArmorEquipment(
          'BA_STANDARD',
          techBase === 'Clan',
          ctx.equipmentRegistry,
        ),
        technology,
      }));
    }
  }

  if (bb.exists('armor')) {
    const ints = bb.getDataAsInt('armor');
    const armorMap = new Map<string, LocationArmor>();
    // BA armor: single value = squad armor (same for all troopers)
    if (ints.length === 1) {
      armorMap.set('Squad', locationArmor(ints[0]));
    } else {
      for (let i = 0; i < ints.length; i++) {
        const loc = i === 0 ? 'Squad' : `Trooper ${i}`;
        armorMap.set(loc, locationArmor(ints[i]));
      }
    }
    entity.armorValues.set(armorMap);
  }

  // ── Squad / Trooper Equipment ──
  parseBaEquipment(bb, entity, ctx);
  // Fallback from BLKBattleArmorFile.java:168 to add slotless equipment for movement
  addMissingMovementEquipment(entity, ctx);

  return entity;
}

// Fallback from BLKBattleArmorFile.java:168 to add slotless equipment for movement
function addMissingMovementEquipment(entity: BattleArmorEntity, ctx: ParseContext): void {
  const equipmentId = new Map([
    ['Jump', 'BAJumpJet'],
    ['VTOL', 'BAVTOL'],
    ['UMU', 'BAUMU'],
  ]).get(entity.motiveType());
  if (!equipmentId) return;

  const resolved = ctx.resolveEquipment(equipmentId, 'motion_type');
  const alreadyPresent = entity.equipment().some(mount =>
    mount.equipmentId === equipmentId || mount.equipment === resolved
  );
  if (alreadyPresent) return;

  entity.addEquipment({
    equipmentId,
    equipment: resolved ?? undefined,
    allocation: { kind: 'location', location: 'None' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}

/**
 * Parse BA squad and trooper equipment blocks.
 */
function parseBaEquipment(
  bb: BuildingBlock,
  entity: BattleArmorEntity,
  ctx: ParseContext,
): void {
  // Squad Equipment (or legacy Point Equipment) → Squad
  if (bb.exists('Squad Equipment')) {
    parseLocationEquipment(bb, entity, 'Squad Equipment', 'Squad', ctx);
  } else if (bb.exists('Point Equipment')) {
    entity.squadEquipmentTag.set('Point');
    parseLocationEquipment(bb, entity, 'Point Equipment', 'Squad', ctx);
  }

  // Trooper N Equipment
  for (let i = 1; i <= 6; i++) {
    const tag = `Trooper ${i} Equipment`;
    parseLocationEquipment(bb, entity, tag, `Trooper ${i}`, ctx);
  }

  // Slotless equipment → location 'None' (equipment not assigned to a specific trooper)
  parseLocationEquipment(bb, entity, 'slotless_equipment', 'None', ctx);
}

function parseLocationEquipment(
  bb: BuildingBlock,
  entity: BattleArmorEntity,
  blkTag: string,
  location: string,
  ctx: ParseContext,
): void {
  if (!bb.exists(blkTag)) return;
  const lines = bb.getDataAsString(blkTag);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // parseEquipmentLine handles all colon-separated suffixes in any order:
    // :DWP, :SSWM, :APM, :OMNI, :Body, :LA, :RA, :TU, :ShotsN#, :SIZE:N
    const parsed = parseEquipmentLine(line);
    const resolved = ctx.resolveEquipment(parsed.name, blkTag);

    entity.addEquipment({
      equipmentId: parsed.name,
      equipment: resolved ?? undefined,
      allocation: { kind: 'location', location },
      rearMounted: parsed.rearMounted,
      turretMounted: false,
      omniPodMounted: parsed.omniPod,
      armored: false,
      size: parsed.size,
      baMountLocation: parsed.baMountLocation,
      isDWP: parsed.isDWP,
      isSSWM: parsed.isSSWM,
      isAPM: parsed.isAPM,
      shotsCount: parsed.shots,
    });
  }
}
