// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  EntityType,
  LARGE_SUPPORT_TANK_LOCATIONS,
  LARGE_SUPPORT_TANK_LOCATIONS_WITH_DUAL_TURRET,
  LARGE_SUPPORT_TANK_LOCATIONS_WITH_TURRET,
} from '../../types';
import { SupportTankEntity } from './support-tank-entity';

/**
 * Large Support Tank - up to 300 tons, uses expanded location set
 * (Front Right, Front Left, Rear Right, Rear Left).
 */
export class LargeSupportTankEntity extends SupportTankEntity {
  override readonly entityType: EntityType = 'LargeSupportTank';

  override componentLocationOrder(): readonly string[] {
    return ['Body', 'Front', 'Front Right', 'Front Left', 'Rear Right', 'Rear Left', 'Rear', 'Turret', 'Rear Turret', 'Front Turret'];
  }

  override componentLocationLabel(location: string): string {
    return ({
      'Front Right': 'FRR', 'Front Left': 'FRL', 'Rear Right': 'RRR', 'Rear Left': 'RRL',
    })[location] ?? super.componentLocationLabel(location);
  }

  protected override get minimumEngineRating(): number | null {
    return null;
  }

  protected override get zeroCruiseUsesEngineType(): boolean {
    return false;
  }

  override get locationOrder(): readonly string[] {
    if (this.hasDualTurret()) return LARGE_SUPPORT_TANK_LOCATIONS_WITH_DUAL_TURRET;
    if (this.hasTurret()) return LARGE_SUPPORT_TANK_LOCATIONS_WITH_TURRET;
    return LARGE_SUPPORT_TANK_LOCATIONS;
  }
}
