// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MiscEquipment } from '../../equipment.model';
import {
  isCompactHeatSinkEquipment,
  isDoubleHeatSinkEquipment,
  isLaserHeatSinkEquipment,
  isPrototypeDoubleHeatSinkEquipment,
} from '../../heat-equipment.model';

// ============================================================================
// Heat Sink Types
// ============================================================================

export type HeatSinkType = 'Single' | 'Double' | 'Compact' | 'Laser';

export interface IntegralHeatSinkCapability {
  readonly count: number;
  readonly equipment: MiscEquipment;
}

export function getMekHeatSinkType(equipment: MiscEquipment | null): HeatSinkType {
  if (!equipment) return 'Single';
  if (isCompactHeatSinkEquipment(equipment)) return 'Compact';
  if (isLaserHeatSinkEquipment(equipment)) return 'Laser';
  return isDoubleHeatSinkEquipment(equipment) || isPrototypeDoubleHeatSinkEquipment(equipment)
    ? 'Double'
    : 'Single';
}
