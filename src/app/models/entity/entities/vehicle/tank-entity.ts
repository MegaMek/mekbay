// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { getCombatVehicleConstructionTech } from '../../components';
import { EntityType } from '../../types';
import { VehicleEntity } from './vehicle-entity';
import type { TechRatingSource, UnitType } from '../../types';

/**
 * Tank - standard ground combat vehicle (Tracked, Wheeled, Hover, WiGE).
 */
export class TankEntity extends VehicleEntity {
  override readonly entityType: EntityType = 'Tank';

  override unitType(): UnitType {
    return 'Tank';
  }

  protected override vehicleConstructionTechAdvancement(): TechRatingSource {
    return getCombatVehicleConstructionTech(this.isSuperHeavy());
  }
}
