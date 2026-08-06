// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AeroEntity, ConvFighterEntity, DropShipEntity, FixedWingSupportEntity, JumpShipEntity, LamEntity, SmallCraftEntity, VtolEntity, type BaseEntity } from '../../../entities';
import type { ASUnitTypeCode } from '../../../../units.model';
import type { AlphaStrikeMovement } from '../foundation/movement';
import { LARGE_AEROSPACE_TYPES, hasAlphaStrikeVstolCapability } from '../foundation/unit-classification';

/** Converts special abilities intrinsic to a unit's chassis, class, and crew. */
export function alphaStrikeEntitySpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  size: number,
  movement?: AlphaStrikeMovement,
): string[] {
  const specials: string[] = [];
  if (entity instanceof LamEntity && movement) addLamSpecials(entity, movement, specials);
  if (entity instanceof VtolEntity) specials.push('ATMO');
  if (type === 'AF' || LARGE_AEROSPACE_TYPES.has(type)) specials.push('SPC');
  if (type === 'AF' || type === 'CF') specials.push(`BOMB${size}`);
  if (type === 'AF' && entity instanceof AeroEntity) {
    const fuel = Math.round(entity.fuel() * 0.05);
    if (fuel > 0) specials.push(`FUEL${fuel}`);
  }
  if (entity instanceof FixedWingSupportEntity) {
    const bombs = Math.ceil(entity.maxBombPoints() * 0.2);
    if (bombs > 0) specials.push(`BOMB${bombs}`);
  }
  if (type === 'SC' || type === 'DS' || type === 'DA') {
    specials.push(size === 1 ? 'LG' : size === 2 ? 'VLG' : 'SLG');
  }
  if (entity instanceof SmallCraftEntity && entity.entityType === 'SmallCraft'
    && entity.isMilitary()
    && !entity.equipment().some(mount => mount.equipment?.hasFlag('F_ECM'))) {
    specials.push('LECM');
  }
  if (entity instanceof JumpShipEntity) {
    if (entity.driveCoreType() !== 'None') specials.push('KF');
    if (entity.lithiumFusion()) specials.push('LF');
    if (entity.crew() >= 60) specials.push(`CRW${Math.round(entity.crew() / 120)}`);
  }
  if (entity instanceof DropShipEntity && entity.crew() >= 30) {
    specials.push(`CRW${Math.round(entity.crew() / 60)}`);
  }
  if (type === 'SV' && size === 3) specials.push('LG');
  else if (type === 'SV' && size === 4) specials.push('VLG');
  else if (type === 'SV' && size === 5) specials.push('SLG');
  if (entity instanceof FixedWingSupportEntity || entity instanceof ConvFighterEntity) specials.push('ATMO');
  if (hasAlphaStrikeVstolCapability(entity, type)) specials.push('VSTOL');
  return specials;
}

function addLamSpecials(
  entity: LamEntity,
  movement: AlphaStrikeMovement,
  specials: string[],
): void {
  const additionalFuelTanks = entity.equipment()
    .filter(mount => mount.equipment?.hasFlag('F_LAM_FUEL_TANK')).length;
  specials.push(`FUEL${4 * (1 + additionalFuelTanks)}`);

  const airMovement = movement.values['a'] ?? 0;
  if (entity.lamType().toLowerCase() === 'bimodal') {
    specials.push(`BIM(${airMovement}a)`);
  } else {
    specials.push(`LAM(${movement.values['g'] ?? 0}\"g/${airMovement}a)`);
  }

  const bombBays = entity.equipment()
    .filter(mount => mount.equipment?.hasFlag('F_BOMB_BAY')).length;
  if (bombBays > 0) specials.push(`BOMB${Math.ceil(bombBays / 5)}`);
}
