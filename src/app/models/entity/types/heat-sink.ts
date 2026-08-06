// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MiscEquipment } from '../../equipment.model';

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
  if (equipment.isCompactHeatSink) return 'Compact';
  if (equipment.hasFlag('F_LASER_HEAT_SINK')) return 'Laser';
  return equipment.hasAnyFlag(['F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE'])
    ? 'Double'
    : 'Single';
}
