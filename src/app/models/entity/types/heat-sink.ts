// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Equipment, MiscEquipment } from '../../equipment.model';
import {
  isCompactHeatSinkEquipment,
  isDoubleHeatSinkEquipment,
  isHeatSinkEquipment,
  isLaserHeatSinkEquipment,
  isPrototypeDoubleHeatSinkEquipment,
} from '../../heat-equipment.model';

// ============================================================================
// Heat Sink Types
// ============================================================================

export type HeatSinkType = 'Single' | 'Double' | 'Compact' | 'Laser';

/** Heat one sink of this type dissipates: laser heat sinks are double heat sinks. */
export function heatSinkTypeDissipation(type: HeatSinkType): 1 | 2 {
  return type === 'Double' || type === 'Laser' ? 2 : 1;
}

export interface IntegralHeatSinkCapability {
  readonly count: number;
  readonly equipment: MiscEquipment;
}

export function getMekHeatSinkType(equipment: Equipment | null): HeatSinkType {
  if (!equipment) return 'Single';
  if (isCompactHeatSinkEquipment(equipment)) return 'Compact';
  if (isLaserHeatSinkEquipment(equipment)) return 'Laser';
  return isDoubleHeatSinkEquipment(equipment) || isPrototypeDoubleHeatSinkEquipment(equipment)
    ? 'Double'
    : 'Single';
}

/** TechManual p. 53 and IO:AE p. 65. Prototype doubles may share a system with singles. */
export function conflictingMekHeatSinkTypes(equipment: readonly (Equipment | null | undefined)[]): readonly string[] {
  const types = new Set<string>();
  for (const item of equipment) {
    if (item?.type === 'misc' && isHeatSinkEquipment(item)) {
      types.add(isPrototypeDoubleHeatSinkEquipment(item) ? 'Prototype' : getMekHeatSinkType(item));
    }
  }
  if (types.size <= 1 || (types.size === 2 && types.has('Single') && types.has('Prototype'))) return [];
  return [...types].sort();
}
