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
  switch (key) {
    case 'overview': fluff.overview = value; return true;
    case 'capabilities': fluff.capabilities = value; return true;
    case 'deployment': fluff.deployment = value; return true;
    case 'history': fluff.history = value; return true;
    case 'manufacturer': fluff.manufacturer = value; return true;
    case 'primaryfactory': fluff.primaryFactory = value; return true;
    case 'notes': fluff.notes = value; return true;
    case 'fluffdate': fluff.fluffDate = value; return true;
    case 'systemmanufacturer': {
      assignMtfSystemValue(fluff, 'systemManufacturers', value);
      return true;
    }
    case 'systemmode': {
      assignMtfSystemValue(fluff, 'systemModels', value);
      return true;
    }
    default: return false;
  }
}

export type BlkFluffWarning = (field: 'systemManufacturers' | 'systemModels', message: string) => void;

/** Shared by every full BLK parser and the fluff-only reader. */
export function parseBlkEntityFluff(bb: BuildingBlock, warn?: BlkFluffWarning): EntityFluff {
  const fluff: EntityFluff = {};
  copyMultilineBlock(bb, fluff, 'overview');
  copyMultilineBlock(bb, fluff, 'capabilities');
  copyMultilineBlock(bb, fluff, 'deployment');
  copyMultilineBlock(bb, fluff, 'history');
  copyMultilineBlock(bb, fluff, 'manufacturer');
  copyFirstBlock(bb, fluff, 'primaryFactory');
  copyMultilineBlock(bb, fluff, 'notes');
  copyFirstBlock(bb, fluff, 'fluffDate');
  copyFirstBlock(bb, fluff, 'use');
  copyFirstBlock(bb, fluff, 'length');
  copyFirstBlock(bb, fluff, 'width');
  copyFirstBlock(bb, fluff, 'height');

  const systemManufacturers = parseBlkSystems(bb, 'systemManufacturers', warn);
  if (systemManufacturers) fluff.systemManufacturers = systemManufacturers;
  const systemModels = parseBlkSystems(bb, 'systemModels', warn);
  if (systemModels) fluff.systemModels = systemModels;
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

function copyMultilineBlock<TKey extends 'overview' | 'capabilities' | 'deployment' | 'history' | 'manufacturer' | 'notes'>(
  bb: BuildingBlock,
  fluff: EntityFluff,
  key: TKey,
): void {
  if (bb.exists(key)) fluff[key] = bb.getDataAsString(key).join('\n');
}

function copyFirstBlock<TKey extends 'primaryFactory' | 'fluffDate' | 'use' | 'length' | 'width' | 'height'>(
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
