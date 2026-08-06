// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  getCombatVehicleConstructionTech,
  getVtolChinTurretTech,
} from '../../components';
import { EntityType, VTOL_LOCATIONS, VTOL_LOCATIONS_WITH_TURRET } from '../../types';
import { VehicleEntity } from './vehicle-entity';
import type { TechRatingSource, UnitType } from '../../types';

/** VTOL combat vehicle - adds Rotor location. */
export class VtolEntity extends VehicleEntity {
  override readonly entityType: EntityType = 'VTOL';

  override componentLocationOrder(): readonly string[] {
    return ['Body', 'Front', 'Right', 'Left', 'Rear', 'Turret', 'Rotor'];
  }

  override unitType(): UnitType {
    return 'VTOL';
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    const sources = [...super.entityTechAdvancements()];
    if (this.hasTurret()) sources.push(getVtolChinTurretTech());
    return sources;
  }

  protected override vehicleConstructionTechAdvancement(): TechRatingSource {
    return getCombatVehicleConstructionTech();
  }

  override get locationOrder(): readonly string[] {
    if (this.hasTurret()) {
      return VTOL_LOCATIONS_WITH_TURRET;
    }
    return VTOL_LOCATIONS;
  }

  override get validLocations(): ReadonlySet<string> {
    return new Set([...this.locationOrder, 'Body']);
  }
}
