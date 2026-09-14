// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EntityFluff } from '../types';
import { normalizeSystemManufacturerKey } from '../types/validation-sets';
import { BuildingBlock } from './building-block';

const MTF_LOCATION_HEADERS = new Set([
  'Left Arm:', 'Right Arm:', 'Left Torso:', 'Right Torso:', 'Center Torso:',
  'Head:', 'Left Leg:', 'Right Leg:', 'Center Leg:',
  'Front Left Leg:', 'Front Right Leg:', 'Rear Left Leg:', 'Rear Right Leg:',
]);

const MULTILINE_FLUFF_FIELDS = ['overview', 'capabilities', 'deployment', 'history', 'manufacturer', 'notes'] as const;
const COMMON_SINGLE_FLUFF_FIELDS = ['primaryFactory', 'fluffDate'] as const;
const MTF_TEXT_FLUFF_FIELDS = [...MULTILINE_FLUFF_FIELDS, ...COMMON_SINGLE_FLUFF_FIELDS] as const;
const BLK_SINGLE_FLUFF_FIELDS = [...COMMON_SINGLE_FLUFF_FIELDS, 'use', 'length', 'width', 'height'] as const;
// MegaMek's native MTF spelling is "systemmode", without a trailing l.
const MTF_SYSTEM_FLUFF_FIELDS = { systemmanufacturer: 'systemManufacturers', systemmode: 'systemModels' } as const;
const SYSTEM_FLUFF_FIELDS = Object.values(MTF_SYSTEM_FLUFF_FIELDS);

/** Uses the same native field definitions as both fluff readers. */
export function isNativeFluffField(key: string, format: 'mtf' | 'blk'): boolean {
  return MULTILINE_FLUFF_FIELDS.some(field => field.toLowerCase() === key)
    || (format === 'blk' ? BLK_SINGLE_FLUFF_FIELDS : COMMON_SINGLE_FLUFF_FIELDS).some(field => field.toLowerCase() === key)
    || (format === 'blk' ? SYSTEM_FLUFF_FIELDS.some(field => field.toLowerCase() === key) : Object.hasOwn(MTF_SYSTEM_FLUFF_FIELDS, key));
}

export function isMtfLocationHeader(value: string): boolean {
  return MTF_LOCATION_HEADERS.has(value);
}

/**
 * Parse only the lore fields from a native source. This deliberately avoids
 * constructing an Entity or resolving equipment: Intel is presentation data,
 * and opening the tab must not retain the native source or a gameplay graph.
 */
export function parseNativeEntityFluff(content: string, format: 'mtf' | 'blk'): EntityFluff {
  return format === 'mtf'
    ? parseMtfEntityFluff(content)
    : parseBlkEntityFluff(new BuildingBlock(content));
}

export function parseMtfEntityFluff(content: string): EntityFluff {
  const fluff: EntityFluff = {};
  let inLocationSection = false;
  let inWeaponsSection = false;

  for (const rawLine of content.split(/\r\n|\n|\r/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      inLocationSection = false;
      inWeaponsSection = false;
      continue;
    }
    if (isMtfLocationHeader(line)) {
      inLocationSection = true;
      inWeaponsSection = false;
      continue;
    }
    if (inLocationSection || inWeaponsSection) continue;

    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'weapons') {
      inWeaponsSection = true;
      continue;
    }
    applyMtfFluffField(fluff, key, value);
  }

  return fluff;
}

/** Shared by the full MTF parser and the fluff-only reader. */
export function applyMtfFluffField(fluff: EntityFluff, key: string, value: string): boolean {
  const field = MTF_TEXT_FLUFF_FIELDS.find(field => field.toLowerCase() === key);
  if (field) {
    fluff[field] = value;
    return true;
  }
  const system = MTF_SYSTEM_FLUFF_FIELDS[key as keyof typeof MTF_SYSTEM_FLUFF_FIELDS];
  if (system) {
    assignMtfSystemValue(fluff, system, value);
    return true;
  }
  return false;
}

export type BlkFluffWarning = (field: 'systemManufacturers' | 'systemModels', message: string) => void;

/** Shared by every full BLK parser and the fluff-only reader. */
export function parseBlkEntityFluff(bb: BuildingBlock, warn?: BlkFluffWarning): EntityFluff {
  const fluff: EntityFluff = {};
  for (const field of MULTILINE_FLUFF_FIELDS) copyMultilineBlock(bb, fluff, field);
  for (const field of BLK_SINGLE_FLUFF_FIELDS) copyFirstBlock(bb, fluff, field);
  for (const field of SYSTEM_FLUFF_FIELDS) {
    const systems = parseBlkSystems(bb, field, warn);
    if (systems) fluff[field] = systems;
  }
  return fluff;
}

function assignMtfSystemValue(
  fluff: EntityFluff,
  field: 'systemManufacturers' | 'systemModels',
  value: string,
): void {
  const separator = value.indexOf(':');
  if (separator <= 0) return;
  const rawKey = value.slice(0, separator);
  const systems = fluff[field] ??= {};
  systems[normalizeSystemManufacturerKey(rawKey) ?? rawKey] = value.slice(separator + 1);
}

function copyMultilineBlock<TKey extends typeof MULTILINE_FLUFF_FIELDS[number]>(
  bb: BuildingBlock,
  fluff: EntityFluff,
  key: TKey,
): void {
  if (bb.exists(key)) fluff[key] = bb.getDataAsString(key).join('\n');
}

function copyFirstBlock<TKey extends typeof BLK_SINGLE_FLUFF_FIELDS[number]>(
  bb: BuildingBlock,
  fluff: EntityFluff,
  key: TKey,
): void {
  if (bb.exists(key)) fluff[key] = bb.getFirstString(key);
}

function parseBlkSystems(
  bb: BuildingBlock,
  field: 'systemManufacturers' | 'systemModels',
  warn?: BlkFluffWarning,
): Record<string, string> | undefined {
  if (!bb.exists(field)) return undefined;
  const systems: Record<string, string> = {};
  for (const line of bb.getDataAsString(field)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const rawKey = line.slice(0, separator);
    const canonical = normalizeSystemManufacturerKey(rawKey);
    if (!canonical) warn?.(field, `Unknown system ${field === 'systemModels' ? 'model' : 'manufacturer'} key: "${rawKey}"`);
    systems[canonical ?? rawKey] = line.slice(separator + 1);
  }
  return Object.keys(systems).length > 0 ? systems : undefined;
}
