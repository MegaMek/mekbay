// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { AeroEntity, BattleArmorEntity, JumpShipEntity, MekEntity, ProtoMekEntity, VehicleEntity } from '../../models/entity/entities';
import { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { WeaponEquipment } from '../../models/equipment.model';
import type { EntityValidationMessage } from '../../models/entity/types';
import { weaponQuirkDefinition, weaponQuirkMount } from '../../models/entity/utils/weapon-quirks';
import { constructionWeaponQuirkApplies } from './construction-weapon-quirks';
import { CONSTRUCTION_VALIDATE_QUIRKS } from './construction-config';

const MEK_EXCLUSIONS = new Set(['atmo_flyer', 'atmo_instability', 'docking_arms', 'fragile_fuel', 'internal_bomb',
  'trailer_hitch', 'large_dropper', 'weak_undercarriage', 'vtol_rotor_coaxial', 'vtol_rotor_dual', 'power_reverse', 'unstreamlined']);
const VEHICLE_QUIRKS = new Set(['anti_air', 'battle_computer', 'easy_maintain', 'fast_reload', 'good_rep_1', 'good_rep_2',
  'imp_com', 'imp_sensors', 'imp_target_short', 'searchlight', 'imp_target_med', 'imp_target_long', 'low_profile',
  'bad_rep_is', 'bad_rep_clan', 'difficult_maintain', 'non_standard', 'obsolete', 'poor_performance', 'poor_sealing',
  'hard_pilot', 'poor_target_short', 'poor_target_med', 'poor_target_long', 'poor_work', 'prototype', 'sensor_ghosts',
  'ubiquitous_is', 'ubiquitous_clan']);
const BA_PROTO_QUIRKS = new Set(['easy_maintain', 'easy_pilot', 'good_rep_1', 'good_rep_2', 'imp_com', 'rugged_1', 'rugged_2',
  'ubiquitous_is', 'ubiquitous_clan', 'bad_rep_is', 'bad_rep_clan', 'difficult_maintain', 'hard_pilot', 'illegal_design',
  'non_standard', 'obsolete', 'poor_sealing', 'poor_target_short', 'poor_target_med', 'poor_target_long', 'poor_work',
  'prototype', 'sensor_ghosts']);
const AERO_QUIRKS = new Set(['atmo_flyer', 'combat_computer', 'easy_maintain', 'easy_pilot', 'good_rep_1', 'good_rep_2',
  'imp_com', 'imp_life_support', 'imp_target_long', 'imp_target_med', 'imp_target_short', 'internal_bomb', 'rugged_1',
  'rugged_2', 'rumble_seat', 'ubiquitous_is', 'ubiquitous_clan', 'atmo_instability', 'bad_rep_is', 'bad_rep_clan',
  'cramped_cockpit', 'difficult_eject', 'difficult_maintain', 'fragile_fuel', 'hard_pilot', 'illegal_design', 'no_eject',
  'non_standard', 'obsolete', 'poor_life_support', 'poor_performance', 'poor_target_short', 'poor_target_med',
  'poor_target_long', 'poor_work', 'prototype', 'ramshackle', 'sensor_ghosts', 'unstreamlined', 'weak_undercarriage']);

/** Quirks.isQuirkLegalFor, evaluated from native chassis facts and stable OptionsConstants catalog keys. */
export function constructionQuirkApplies(entity: BaseEntity, key: string): boolean {
  const has = (key: string) => entity.quirks().some(entry => entry.quirk.key === key);
  const targeting = ['imp_target_short', 'imp_target_med', 'imp_target_long'];
  if (key === 'variable_range_targeting' && targeting.some(has) || targeting.includes(key) && has('variable_range_targeting')) return false;
  if (key === 'overhead_arms' && has('low_arms') || key === 'low_arms' && has('overhead_arms')) return false;
  if (key === 'gas_hog') return entity.mountedEngine().installed && ['ICE', 'Fuel Cell'].includes(entity.mountedEngine().type());
  if (entity instanceof MekEntity) {
    const quad = entity.chassisConfig === 'Quad' || entity.chassisConfig === 'QuadVee';
    // Battlefists requires hand actuators: BMM p. 83; Campaign Operations p. 225.
    if (key === 'battle_fists_la' || key === 'battle_fists_ra') return entity instanceof MekWithArmsEntity &&
      entity.hasHandActuator()[key.endsWith('_la') ? 'left' : 'right'];
    if (key === 'barrel_fists_la' || key === 'barrel_fists_ra') {
      const side = key.endsWith('_la') ? 'left' : 'right';
      return entity instanceof MekWithArmsEntity && entity.hasLowerArmActuator()[side] && !entity.hasHandActuator()[side];
    }
    if (key === 'oversized') return entity.tonnage() >= 60;
    if (key === 'compact_mech') return entity.tonnage() <= 55;
    if (key === 'directional_torso_mount_360') return quad;
    if (key === 'overhead_arms') return !quad && (entity.omni() || entity.equipment().some(mount =>
      ['LA', 'RA'].includes(mount.location) && mount.equipment instanceof WeaponEquipment && mount.equipment.hasFlag('F_DIRECT_FIRE')));
    return !MEK_EXCLUSIONS.has(key);
  }
  if (entity instanceof VehicleEntity) {
    const mode = entity.motiveType();
    if (key === 'power_reverse') return ['Tracked', 'Wheeled'].includes(mode) && !entity.isSupportVehicle();
    if (key === 'fragile_fuel') return entity.mountedEngine().installed && entity.mountedEngine().type() === 'ICE';
    if (key === 'trailer_hitch') return !['Hover', 'VTOL'].includes(mode);
    if (key === 'scout_bike') return ['Hover', 'Wheeled'].includes(mode) && entity.tonnage() <= 10;
    if (key === 'vtol_rotor_coaxial' || key === 'vtol_rotor_dual') return ['VTOL', 'SupportVTOL'].includes(entity.entityType);
    return VEHICLE_QUIRKS.has(key);
  }
  // CO positive quirk table permits Fast Reload for battle armor (omitted by Java Quirks).
  if (entity instanceof BattleArmorEntity && key === 'fast_reload') return true;
  if (entity instanceof BattleArmorEntity || entity instanceof ProtoMekEntity) return BA_PROTO_QUIRKS.has(key);
  if (entity instanceof AeroEntity) {
    if (AERO_QUIRKS.has(key)) return true;
    // Preserve the source's base-Aero allowance before its subtype-specific exceptions.
    if (entity.entityType === 'WarShip') return key === 'poor_performance';
    if (entity instanceof JumpShipEntity) return key === 'docking_arms';
    if (entity.entityType === 'DropShip') return ['em_inter_whole', 'large_dropper'].includes(key);
    return ['em_inter_whole', 'fast_reload'].includes(key);
  }
  return false;
}

export function constructionQuirkMessages(entity: BaseEntity): EntityValidationMessage[] {
  if (!CONSTRUCTION_VALIDATE_QUIRKS) return [];
  const messages: EntityValidationMessage[] = entity.quirks().filter(entry => !constructionQuirkApplies(entity, entry.quirk.key)).map(entry => ({
    category: 'general', code: 'QUIRK_NOT_APPLICABLE', severity: 'error',
    message: `${entry.quirk.name} is incompatible with this chassis, installed systems or selected quirks.`,
  }));
  for (const entry of entity.weaponQuirks()) {
    const mount = weaponQuirkMount(entity, entry);
    const definition = weaponQuirkDefinition(entry.name);
    if (!mount || !definition) messages.push({ category: 'general', code: 'WEAPON_QUIRK_UNMATCHED', severity: 'warning',
      message: `${definition?.name ?? entry.name}: check the assignment to ${entry.weaponName} (${entry.location}).` });
    else if (!constructionWeaponQuirkApplies(entity, mount, entry.name)) messages.push({ category: 'general', code: 'WEAPON_QUIRK_NOT_APPLICABLE', severity: 'error',
      message: `${definition.name} is incompatible with ${mount.displayName()} (${mount.location}).` });
  }
  return messages;
}
