// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASUnitTypeCode } from '../../../../unit-summary.model';
import {
  AeroEntity,
  BattleArmorEntity,
  type BaseEntity,
  InfantryEntity,
  JumpShipEntity,
  LamEntity,
  MekEntity,
  ProtoMekEntity,
  QuadVeeEntity,
  WarShipEntity,
} from '../../../entities';
import { AS_MOVEMENT_CALCULATION } from '../../../types';
import { resolveShieldSize } from '../../physical-weapon';
import {
  isJetBoosterEquipment,
  isMascEquipment,
  isSuperchargerEquipment,
} from '../../../../escalating-equipment.model';
import { modularArmorMovementPenalty } from '../../../../modular-armor.model';

export type MovementMap = Record<string, number>;

export interface AlphaStrikeMovement {
  readonly values: MovementMap;
  readonly primary: string;
}

export function alphaStrikeMovement(entity: BaseEntity): AlphaStrikeMovement {
  if (entity instanceof AeroEntity) {
    if (entity instanceof WarShipEntity) return { values: { '': entity.walkMP() }, primary: '' };
    if (entity instanceof JumpShipEntity) return { values: { k: 2 }, primary: 'k' };
    const primary = movementCode(entity);
    return { values: { [primary]: entity.walkMP() }, primary };
  }

  if (entity instanceof InfantryEntity || entity instanceof BattleArmorEntity) {
    return infantryMovement(entity);
  }

  let walk = entity.originalWalkMP();
  const equipment = entity.equipment();
  const hasSupercharger = equipment.some(mount => isSuperchargerEquipment(mount.equipment));
  const hasMasc = entity instanceof MekEntity && equipment.some(mount =>
    isMascEquipment(mount.equipment) && !isSuperchargerEquipment(mount.equipment));
  const hasSingleBooster = hasSupercharger || hasMasc
    || equipment.some(mount => isJetBoosterEquipment(mount.equipment))
    || (entity instanceof ProtoMekEntity && equipment.some(mount => isMascEquipment(mount.equipment)));
  if (hasSupercharger && hasMasc) walk *= 1.5;
  else if (hasSingleBooster) walk *= 1.25;
  walk = Math.round(walk);
  if (entity instanceof MekEntity && entity.locationOrder.some(location =>
    entity.locationIsLeg(location) && entity.armorAt(location).type === 'HARDENED')) walk--;
  walk -= modularArmorMovementPenalty(equipment);
  if (equipment.some(mount => {
    const size = resolveShieldSize(mount.equipment);
    return size === 'large' || size === 'medium';
  })) walk--;

  const baseMove = Math.max(0, Math.round(walk) * 2);
  const jumpMove = entity.computeJumpMP({
    ...AS_MOVEMENT_CALCULATION,
    includeAlternateJumpSystems: true,
  }) * 2;
  const code = movementCode(entity);
  const values: MovementMap = {};
  let primary = code;
  if (jumpMove === baseMove && jumpMove > 0 && code === '') {
    values['j'] = baseMove;
    primary = 'j';
  } else {
    values[code] = baseMove;
    if (jumpMove > 0) values['j'] = jumpMove;
  }
  addUmuMovement(values, entity);
  if (Object.keys(values).length > 1) primary = code;
  addLamMovement(values, entity);
  return { values, primary };
}

function infantryMovement(entity: InfantryEntity | BattleArmorEntity): AlphaStrikeMovement {
  const walk = entity.computeWalkMP(AS_MOVEMENT_CALCULATION);
  const jump = entity.computeJumpMP(AS_MOVEMENT_CALCULATION);
  const code = movementCode(entity);
  const values: MovementMap = {};
  const minimalWalk = entity instanceof InfantryEntity && walk === 0;
  const walkMove = minimalWalk ? 2 : minimumConvertedMovement(walk * 2);
  const jumpMove = minimumConvertedMovement(jump * 2);
  let primary = code;
  if (walk > jump || jump === 0) values[code] = walkMove;
  else {
    primary = code === 'v' ? code : 'j';
    values[primary] = jumpMove;
  }
  addUmuMovement(values, entity);
  return { values, primary };
}

function addLamMovement(values: MovementMap, entity: BaseEntity): void {
  if (!(entity instanceof LamEntity)) return;
  values['a'] = entity.computeJumpMP(AS_MOVEMENT_CALCULATION);
  if (entity.lamType().toLowerCase() !== 'bimodal') {
    values['g'] = entity.computeJumpMP(AS_MOVEMENT_CALCULATION) * 6;
  }
}

export function movementCode(entity: BaseEntity): string {
  if (entity instanceof QuadVeeEntity) return entity.motiveType() === 'Track' ? 'qt' : 'qw';
  const motiveType = entity instanceof InfantryEntity && entity.mount()
    ? entity.mount()!.movementMode
    : entity.motiveType();
  switch (motiveType) {
    case 'None': case 'Biped': case 'Quad': case 'Tripod': return '';
    case 'Track': case 'Tracked': return 't';
    case 'Wheel': case 'Wheeled': return 'w';
    case 'Hover': return 'h';
    case 'VTOL': return 'v';
    case 'Naval': case 'Hydrofoil': return 'n';
    case 'Submarine': case 'UMU': return 's';
    case 'Leg': return 'f';
    case 'Motorized': return 'm';
    case 'Jump': return entity.jumpMP() > 0 ? 'j' : 'f';
    case 'WiGE': return 'g';
    case 'Rail': return 'r';
    case 'Aerodyne': case 'Aerospace': return 'a';
    case 'Spheroid': return 'p';
    default: return 'ERROR';
  }
}

function addUmuMovement(values: MovementMap, entity: BaseEntity): void {
  if (entity.umuMP() > 0) values['s'] = entity.umuMP() * 2;
}

function minimumConvertedMovement(value: number): number {
  return value > 0 ? Math.max(value, 2) : value;
}

export function primaryTmmMovement(entity: BaseEntity, movement: AlphaStrikeMovement): number {
  let value = movement.values[movement.primary] ?? 0;
  if (entity instanceof InfantryEntity || entity instanceof BattleArmorEntity) {
    const alternative = Object.entries(movement.values).find(([mode]) => mode !== 'f');
    if (alternative) value = alternative[1];
  }
  return value;
}

export function tmmForMovement(movement: number): number {
  return movement > 34 ? 5 : movement > 18 ? 4 : movement > 12 ? 3 : movement > 8 ? 2 : movement > 4 ? 1 : 0;
}

export function movementString(type: ASUnitTypeCode, movement: Readonly<MovementMap>): string {
  return Object.entries(movement)
    .filter(([mode]) => type !== 'BM' || (mode !== 'a' && mode !== 'g'))
    .map(([mode, value]) => {
      if (mode === 'k') return `0.${value}k`;
      if (mode === 'a' || mode === 'p') return `${value}${mode}`;
      if (['DS', 'WS', 'DA', 'JS', 'SS'].includes(type) && mode === '') return String(value);
      return `${value}\"${mode}`;
    }).join('/');
}
