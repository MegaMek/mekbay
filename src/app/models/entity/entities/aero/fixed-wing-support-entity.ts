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

import { signal } from '@angular/core';
import { SupportVehicleData, type SupportVehicle } from '../support-vehicle';
import { AERO_LOCATIONS, EntityType, FIXED_WING_EQUIP_LOCATIONS, WeightClass } from '../../types';
import { AeroEntity } from './aero-entity';
import type { UnitSubtype } from '../../types';
import type { TechRatingSource } from '../../types';
import { getFixedWingSupportConstructionTech } from '../../components';

/** Fixed Wing Support vehicle - uses BAR rating and tech ratings. */
export class FixedWingSupportEntity extends AeroEntity implements SupportVehicle {
  override readonly entityType: EntityType = 'FixedWingSupport';

  override unitSubtype(): UnitSubtype {
    return this.withOmniSubtype('Fixed Wing Support Vehicle');
  }

  /** VSTOL (Vertical/Short Take-Off and Landing) capability */
  vstol = signal<boolean>(false);
  readonly supportVehicle = new SupportVehicleData(10);
  readonly barRating = this.supportVehicle.barRating;
  readonly structuralTechRating = this.supportVehicle.structuralTechRating;
  readonly engineTechRating = this.supportVehicle.engineTechRating;

  override isSupportVehicle(): this is this & SupportVehicle {
    return true;
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getFixedWingSupportConstructionTech(this.motiveType(), this.weightClass())];
  }

  protected override computeWeightClass(): WeightClass {
    return this.supportVehicle.resolveWeightClass(this.tonnage(), 'Aerodyne');
  }

  override autoSetStructuralIntegrity(): void {
    this.structuralIntegrity.set(this.originalWalkMP());
  }

  get locationOrder(): readonly string[] {
    return AERO_LOCATIONS;
  }

  get equipLocations(): readonly string[] {
    return [...FIXED_WING_EQUIP_LOCATIONS];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...FIXED_WING_EQUIP_LOCATIONS]);
  }
}
