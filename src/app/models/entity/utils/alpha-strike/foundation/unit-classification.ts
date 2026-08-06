// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASUnitTypeCode } from '../../../../units.model';
import {
  AeroEntity,
  BattleArmorEntity,
  type BaseEntity,
  ConvFighterEntity,
  DropShipEntity,
  FixedWingSupportEntity,
  InfantryEntity,
  JumpShipEntity,
  MekEntity,
  ProtoMekEntity,
  SmallCraftEntity,
  SpaceStationEntity,
  VehicleEntity,
  WarShipEntity,
} from '../../../entities';

export const AEROSPACE_EXPORT_TYPES: ReadonlySet<ASUnitTypeCode> = new Set([
  'AF', 'CF', 'SC', 'DS', 'DA', 'SS', 'JS', 'WS',
]);

export const LARGE_AEROSPACE_TYPES: ReadonlySet<ASUnitTypeCode> = new Set([
  'SC', 'DS', 'DA', 'SS', 'JS', 'WS',
]);

export function alphaStrikeUnitType(entity: BaseEntity): ASUnitTypeCode {
  if (entity instanceof MekEntity) return entity.isIndustrial() ? 'IM' : 'BM';
  if (entity instanceof ProtoMekEntity) return 'PM';
  if (entity instanceof VehicleEntity) return entity.isSupportVehicle() ? 'SV' : 'CV';
  if (entity instanceof BattleArmorEntity) return 'BA';
  if (entity instanceof InfantryEntity) return 'CI';
  if (entity instanceof SpaceStationEntity) return 'SS';
  if (entity instanceof WarShipEntity) return 'WS';
  if (entity instanceof JumpShipEntity) return 'JS';
  if (entity instanceof DropShipEntity) return entity.motiveType() === 'Spheroid' ? 'DS' : 'DA';
  if (entity instanceof SmallCraftEntity) return 'SC';
  if (entity instanceof FixedWingSupportEntity) return 'SV';
  if (entity instanceof ConvFighterEntity) return 'CF';
  if (entity instanceof AeroEntity) return 'AF';
  return 'XX';
}

export function alphaStrikeSize(entity: BaseEntity): number {
  const tons = entity.tonnage();
  if (entity instanceof VehicleEntity && entity.isSupportVehicle()) {
    if (tons < 5) return 1;
    const limits: Partial<Record<string, readonly number[]>> = {
      Tracked: [100, 200], Wheeled: [80, 160], Hover: [50, 100],
      Naval: [300, 6000, 30000], Hydrofoil: [300, 6000, 30000],
      Submarine: [300, 6000, 30000], WiGE: [80, 240], Rail: [300, 600],
      Airship: [300, 600, 900], VTOL: [30, 60],
    };
    const [medium = 0, large = 0, veryLarge = 0] = limits[entity.motiveType()] ?? [];
    if (tons <= medium) return 2;
    if (tons <= large) return 3;
    if (veryLarge === 0 || tons <= veryLarge) return 4;
    return 5;
  }
  if (entity instanceof InfantryEntity || entity instanceof BattleArmorEntity) return 1;
  if (entity instanceof WarShipEntity) return tons < 500_000 ? 1 : tons < 800_000 ? 2 : tons < 1_200_000 ? 3 : 4;
  if (entity instanceof JumpShipEntity) return tons < 100_000 ? 1 : tons < 300_000 ? 2 : 3;
  if (entity instanceof SmallCraftEntity) return tons < 2_500 ? 1 : tons < 10_000 ? 2 : 3;
  if (entity instanceof FixedWingSupportEntity) return tons < 5 ? 1 : tons <= 100 ? 2 : 3;
  if (entity instanceof AeroEntity) return tons < 50 ? 1 : tons < 75 ? 2 : 3;
  return tons < 40 ? 1 : tons < 60 ? 2 : tons < 80 ? 3 : 4;
}

export function isAerospaceElement(entity: BaseEntity, type: ASUnitTypeCode): boolean {
  return AEROSPACE_EXPORT_TYPES.has(type) || entity instanceof FixedWingSupportEntity;
}

export function isFighter(entity: BaseEntity, type: ASUnitTypeCode): boolean {
  return type === 'AF' || type === 'CF' || entity instanceof FixedWingSupportEntity;
}

/**
 * Whether the entity receives Alpha Strike's VSTOL special ability.
 *
 * Conventional-fighter VSTOL is persisted in BLK data. Fixed-wing support
 * vehicles derive it from chassis equipment. The remaining qualifying aero
 * families have the capability intrinsically.
 */
export function hasAlphaStrikeVstolCapability(entity: BaseEntity, type: ASUnitTypeCode): boolean {
  if (entity instanceof ConvFighterEntity) return entity.vstol();
  if (entity instanceof FixedWingSupportEntity) {
    return entity.equipment().some(mount =>
      mount.equipment?.hasAnyFlag(['F_VSTOL_CHASSIS', 'F_STOL_CHASSIS']));
  }
  return type === 'AF' || type === 'SC' || type === 'DS' || type === 'DA';
}

/** Final card arc status. Damage dispatch must use conversion-phase arc status separately. */
export function usesArcs(type: ASUnitTypeCode, size: number): boolean {
  return LARGE_AEROSPACE_TYPES.has(type) || (type === 'SV' && size >= 3);
}