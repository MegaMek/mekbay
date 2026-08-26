// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EntityType } from './types';

export type NativeSourceFormat = 'mtf' | 'blk';

export type NativeSourceDialect = 'megamek-mtf' | 'megamek-blk';

/** The dialect version is part of an encode request; it is not inferred. */
export type NativeSourceDialectVersion = 1;

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

/**
 * Auditable native-format support. False means unsupported by design, not an
 * unimplemented switch branch. The table is deliberately data-only.
 */
export interface NativeCodecCapability {
  readonly family: NativeCodecFamily;
  readonly format: NativeSourceFormat;
  readonly dialect: NativeSourceDialect;
  readonly dialectVersion: NativeSourceDialectVersion;
  readonly entityTypes: readonly EntityType[];
  readonly unitTypeAliases: readonly string[];
  readonly recognizeSyntax: boolean;
  readonly decodeEntity: boolean;
}

export const NATIVE_CODEC_CAPABILITIES: readonly NativeCodecCapability[] = [
  capability('mek', 'mtf', ['Mek'], [
    'Mek', 'BattleMek', 'BipedMek', 'TripodMek', 'QuadMek', 'QuadVee', 'LAM',
  ], {
    recognizeSyntax: true,
    decodeEntity: true,
  }),
  capability('aero', 'blk', ['Aero', 'ConvFighter', 'FixedWingSupport'], [
    'Aero', 'AeroSpaceFighter', 'ConvFighter', 'FixedWingSupport',
  ], decodedCapability()),
  capability('small-craft', 'blk', ['SmallCraft'], ['SmallCraft'], decodedCapability()),
  capability('drop-ship', 'blk', ['DropShip'], ['DropShip', 'Dropship'], decodedCapability()),
  capability('large-craft', 'blk', ['JumpShip', 'WarShip', 'SpaceStation'], [
    'JumpShip', 'Jumpship', 'WarShip', 'Warship', 'SpaceStation',
  ], decodedCapability()),
  capability('vehicle', 'blk', [
    'Tank', 'Naval', 'VTOL', 'SupportTank', 'SupportNaval', 'SupportVTOL',
    'LargeSupportTank',
  ], ['Tank', 'Naval', 'VTOL', 'SupportTank', 'SupportNaval', 'SupportVTOL', 'LargeSupportTank'], decodedCapability()),
  capability('infantry', 'blk', ['Infantry'], ['Infantry'], decodedCapability()),
  capability('battle-armor', 'blk', ['BattleArmor'], ['BattleArmor'], decodedCapability()),
  capability('protomek', 'blk', ['ProtoMek'], ['ProtoMek'], decodedCapability()),
  capability('handheld-weapon', 'blk', ['HandheldWeapon'], ['HandheldWeapon'], decodedCapability()),
  capability(
    'static-emplacement',
    'blk',
    ['GunEmplacement', 'BuildingEntity'],
    ['GunEmplacement', 'BuildingEntity'],
    decodedCapability(),
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

export function nativeCapabilityForEntityType(type: EntityType): NativeCodecCapability {
  const capability = BY_ENTITY_TYPE.get(type);
  if (!capability) throw new Error(`Missing native codec capability for entity type: ${type}`);
  return capability;
}

export function isNativeEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && BY_ENTITY_TYPE.has(value as EntityType);
}

export function nativeCapabilityForUnitTypeAlias(alias: string): NativeCodecCapability | undefined {
  return BY_UNIT_TYPE_ALIAS.get(alias);
}

export function nativeCapabilityForDialect(
  dialect: string,
  version: number,
): readonly NativeCodecCapability[] {
  return NATIVE_CODEC_CAPABILITIES.filter(capability =>
    capability.dialect === dialect && capability.dialectVersion === version
  );
}

function capability(
  family: NativeCodecFamily,
  format: NativeSourceFormat,
  entityTypes: readonly EntityType[],
  unitTypeAliases: readonly string[],
  overrides: Partial<Pick<NativeCodecCapability,
    | 'recognizeSyntax'
    | 'decodeEntity'>> = {},
): NativeCodecCapability {
  return {
    family,
    format,
    dialect: format === 'mtf' ? 'megamek-mtf' : 'megamek-blk',
    dialectVersion: 1,
    entityTypes,
    unitTypeAliases,
    recognizeSyntax: false,
    decodeEntity: false,
    ...overrides,
  };
}

function decodedCapability(): Pick<NativeCodecCapability,
  'recognizeSyntax' | 'decodeEntity'> {
  return {
    recognizeSyntax: true,
    decodeEntity: true,
  };
}
