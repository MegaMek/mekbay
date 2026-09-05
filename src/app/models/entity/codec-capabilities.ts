// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EntityType } from './types';

export type NativeSourceFormat = 'mtf' | 'blk';

export type NativeCodecFamily =
  | 'mek'
  | 'aero'
  | 'small-craft'
  | 'drop-ship'
  | 'large-craft'
  | 'vehicle'
  | 'infantry'
  | 'battle-armor'
  | 'protomek'
  | 'handheld-weapon'
  | 'static-emplacement';

/** Supported native families and the source aliases accepted by their parser. */
export interface NativeCodecCapability {
  readonly family: NativeCodecFamily;
  readonly format: NativeSourceFormat;
  readonly entityTypes: readonly EntityType[];
  readonly unitTypeAliases: readonly string[];
}

const NATIVE_CODEC_CAPABILITIES: readonly NativeCodecCapability[] = [
  capability('mek', 'mtf', ['Mek'], [
    'Mek', 'BattleMek', 'BipedMek', 'TripodMek', 'QuadMek', 'QuadVee', 'LAM',
  ]),
  capability('aero', 'blk', ['Aero', 'ConvFighter', 'FixedWingSupport'], [
    'Aero', 'AeroSpaceFighter', 'ConvFighter', 'FixedWingSupport',
  ]),
  capability('small-craft', 'blk', ['SmallCraft'], ['SmallCraft']),
  capability('drop-ship', 'blk', ['DropShip'], ['DropShip', 'Dropship']),
  capability('large-craft', 'blk', ['JumpShip', 'WarShip', 'SpaceStation'], [
    'JumpShip', 'Jumpship', 'WarShip', 'Warship', 'SpaceStation',
  ]),
  capability('vehicle', 'blk', [
    'Tank', 'Naval', 'VTOL', 'SupportTank', 'SupportNaval', 'SupportVTOL',
    'LargeSupportTank',
  ], ['Tank', 'Naval', 'VTOL', 'SupportTank', 'SupportNaval', 'SupportVTOL', 'LargeSupportTank']),
  capability('infantry', 'blk', ['Infantry'], ['Infantry']),
  capability('battle-armor', 'blk', ['BattleArmor'], ['BattleArmor']),
  capability('protomek', 'blk', ['ProtoMek'], ['ProtoMek']),
  capability('handheld-weapon', 'blk', ['HandheldWeapon'], ['HandheldWeapon']),
  capability(
    'static-emplacement',
    'blk',
    ['GunEmplacement', 'BuildingEntity'],
    ['GunEmplacement', 'BuildingEntity'],
  ),
] as const;

const BY_ENTITY_TYPE = new Map<EntityType, NativeCodecCapability>();
const BY_UNIT_TYPE_ALIAS = new Map<string, NativeCodecCapability>();

for (const row of NATIVE_CODEC_CAPABILITIES) {
  for (const type of row.entityTypes) {
    if (BY_ENTITY_TYPE.has(type)) throw new Error(`Duplicate native codec entity type: ${type}`);
    BY_ENTITY_TYPE.set(type, row);
  }
  for (const alias of row.unitTypeAliases) {
    if (BY_UNIT_TYPE_ALIAS.has(alias)) throw new Error(`Duplicate native codec UnitType alias: ${alias}`);
    BY_UNIT_TYPE_ALIAS.set(alias, row);
  }
}

export function isNativeEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && BY_ENTITY_TYPE.has(value as EntityType);
}

export function nativeCapabilityForUnitTypeAlias(alias: string): NativeCodecCapability | undefined {
  return BY_UNIT_TYPE_ALIAS.get(alias);
}

function capability(
  family: NativeCodecFamily,
  format: NativeSourceFormat,
  entityTypes: readonly EntityType[],
  unitTypeAliases: readonly string[],
): NativeCodecCapability {
  return {
    family,
    format,
    entityTypes,
    unitTypeAliases,
  };
}
