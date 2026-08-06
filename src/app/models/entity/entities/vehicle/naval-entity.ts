// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { getCombatVehicleConstructionTech } from '../../components';
import { EntityType } from '../../types';
import { VehicleEntity } from './vehicle-entity';
import type { TechRatingSource, UnitType } from '../../types';

/**
 * Naval - combat vehicle with Naval, Submarine, or Hydrofoil motion type.
 */
export class NavalEntity extends VehicleEntity {
  override readonly entityType: EntityType = 'Naval';

  override unitType(): UnitType {
    return 'Naval';
  }

  protected override vehicleConstructionTechAdvancement(): TechRatingSource {
    return getCombatVehicleConstructionTech();
  }
}
