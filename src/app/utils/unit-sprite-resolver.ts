// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../models/entity/base-entity';
import type { SpriteAssignments } from '../services/sprite-storage.service';

export type UnitIconResolver = (entity: BaseEntity) => string;

function normalizeAssignmentKey(value: string): string {
  return value.toUpperCase();
}

function defaultMekKey(entity: BaseEntity): string {
  const chassisConfig = 'chassisConfig' in entity
    ? (entity as BaseEntity & { readonly chassisConfig: string }).chassisConfig
    : '';

  if (chassisConfig === 'Tripod') return 'default_tripod';
  if (chassisConfig === 'QuadVee') return 'default_quadvee';
  if (chassisConfig === 'LAM') return 'default_lam_mek';
  if (chassisConfig === 'Quad') return 'default_quad';

  switch (entity.weightClass()) {
    case 'Ultra Light': return 'default_ultra_light';
    case 'Light': return 'default_light';
    case 'Medium': return 'default_medium';
    case 'Heavy': return 'default_heavy';
    case 'Super Heavy': return 'default_super_heavy_mek';
    default: return 'default_assault';
  }
}

function defaultVehicleKey(entity: BaseEntity): string {
  switch (entity.motiveType()) {
    case 'Wheeled':
      return entity.weightClass() === 'Heavy' ? 'default_wheeled_heavy' : 'default_wheeled';
    case 'Hover': return 'default_hover';
    case 'VTOL': return 'default_vtol';
    case 'WiGE': return 'default_wige';
    default:
      if (entity.weightClass() === 'Heavy') return 'default_tracked_heavy';
      if (entity.weightClass() === 'Assault') return 'default_tracked_assault';
      return 'default_tracked';
  }
}

/** Mirrors MegaMek's `MekTileset.genericFor` selection for supported entities. */
export function getDefaultSpriteAssignmentKey(entity: BaseEntity): string {
  if (entity.entityType === 'BattleArmor') return 'default_ba';
  if (entity.entityType === 'Infantry') return 'default_infantry';
  if (entity.entityType === 'ProtoMek') return 'default_proto';
  if (entity.entityType === 'Mek') return defaultMekKey(entity);

  switch (entity.motiveType()) {
    case 'Naval': return 'default_naval';
    case 'Submarine': return 'default_submarine';
    case 'Hydrofoil': return 'default_hydrofoil';
  }

  if (['Tank', 'Naval', 'VTOL', 'SupportTank', 'SupportNaval', 'SupportVTOL', 'LargeSupportTank']
    .includes(entity.entityType)) {
    return defaultVehicleKey(entity);
  }

  switch (entity.entityType) {
    case 'SpaceStation': return 'default_space_station';
    case 'WarShip': return 'default_warship';
    case 'JumpShip': return 'default_jumpship';
    case 'DropShip':
      return entity.motiveType() === 'Spheroid' ? 'default_dropship_sphere' : 'default_dropship_aero';
    case 'SmallCraft':
      return entity.motiveType() === 'Spheroid' ? 'default_small_craft_sphere' : 'default_small_craft_aero';
    case 'Aero':
    case 'ConvFighter':
    case 'FixedWingSupport':
      return 'default_aero';
    case 'HandheldWeapon': return 'default_hhw';
    default: return 'default_unknown';
  }
}

/**
 * Resolves the image path selected by MegaMek's `MekTileset.entryFor`.
 * Exact unit mappings take precedence over chassis mappings and family defaults.
 */
export function resolveUnitSpritePath(entity: BaseEntity, assignments: SpriteAssignments | undefined): string {
  if (!assignments) return '';

  const exactKey = normalizeAssignmentKey(entity.displayName());
  const exactPath = assignments.exact[exactKey];
  if (exactPath) return exactPath;

  const chassisKey = normalizeAssignmentKey(entity.fullChassis());
  const chassisPath = assignments.chassis[chassisKey];
  if (chassisPath) return chassisPath;

  const defaultKey = normalizeAssignmentKey(getDefaultSpriteAssignmentKey(entity));
  return assignments.exact[defaultKey] ?? '';
}

export function createUnitIconResolver(assignments: SpriteAssignments | undefined): UnitIconResolver {
  return entity => resolveUnitSpritePath(entity, assignments);
}
