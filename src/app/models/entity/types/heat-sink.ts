/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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
