// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { compareText } from './string.util';
import type { EntityFluff } from '../models/entity/types';
import type { UnitFluff, UnitFluffSystem } from '../models/unit-fluff.model';

const SYSTEMS = [
  ['CHASSIS', 'Chassis/Frame'],
  ['ENGINE', 'Engine'],
  ['ARMOR', 'Armor'],
  ['JUMP_JET', 'Jump Jets'],
  ['COMMUNICATIONS', 'Communications'],
  ['TARGETING', 'Targeting/Tracking'],
] as const;

const SYSTEM_LABELS = new Map<string, string>(SYSTEMS);
const SYSTEM_ORDER = new Map<string, number>(SYSTEMS.map(([key], index) => [key, index]));

/** Detached, recursively immutable presentation projection of native EntityFluff. */
export function entityFluffToUnitFluff(fluff: EntityFluff): UnitFluff | undefined {
  const result: UnitFluff = {
    ...nonBlankProperty('manufacturer', fluff.manufacturer),
    ...nonBlankProperty('primaryFactory', fluff.primaryFactory),
    ...nonBlankProperty('capabilities', fluff.capabilities),
    ...nonBlankProperty('overview', fluff.overview),
    ...nonBlankProperty('deployment', fluff.deployment),
    ...nonBlankProperty('history', fluff.history),
    ...nonBlankProperty('notes', fluff.notes),
    ...systemsProperty(fluff),
  };
  if (Object.keys(result).length === 0) return undefined;
  if (result.systems) {
    result.systems = Object.freeze(result.systems.map(system => Object.freeze({ ...system }))) as UnitFluffSystem[];
  }
  return Object.freeze(result);
}

function nonBlankProperty<TKey extends keyof UnitFluff>(
  key: TKey,
  value: string | undefined,
): Pick<UnitFluff, TKey> | Record<never, never> {
  return value === undefined || isBlank(value)
    ? {}
    : { [key]: value } as Pick<UnitFluff, TKey>;
}

function systemsProperty(fluff: EntityFluff): Pick<UnitFluff, 'systems'> | Record<never, never> {
  const manufacturers = fluff.systemManufacturers ?? {};
  const models = fluff.systemModels ?? {};
  const keys = [...new Set([...Object.keys(manufacturers), ...Object.keys(models)])]
    .sort(compareSystemKeys);
  const systems: UnitFluffSystem[] = [];
  for (const key of keys) {
    const manufacturer = nonBlank(manufacturers[key]);
    const model = nonBlank(models[key]);
    if (manufacturer === undefined && model === undefined) continue;
    systems.push({
      label: SYSTEM_LABELS.get(key) ?? key,
      ...(manufacturer !== undefined && { manufacturer }),
      ...(model !== undefined && { model }),
    });
  }
  return systems.length === 0 ? {} : { systems };
}

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || isBlank(value) ? undefined : value;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function compareSystemKeys(left: string, right: string): number {
  const leftOrder = SYSTEM_ORDER.get(left);
  const rightOrder = SYSTEM_ORDER.get(right);
  if (leftOrder !== undefined || rightOrder !== undefined) {
    if (leftOrder === undefined) return 1;
    if (rightOrder === undefined) return -1;
    return leftOrder - rightOrder;
  }
  return compareText(left, right);
}
