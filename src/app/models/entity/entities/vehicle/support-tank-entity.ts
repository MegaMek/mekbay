// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { EntityType, WeightClass, resolveSupportVehicleWeightClass } from '../../types';
import type { SupportVehicle } from '../support-vehicle';
import { TankEntity } from './tank-entity';
import type { TechRatingSource } from '../../types';
import { getSupportTankConstructionTech } from '../../components';

/** Support Tank - adds BAR rating and support vehicle tech ratings. */
export class SupportTankEntity extends TankEntity implements SupportVehicle {
  override readonly entityType: EntityType = 'SupportTank';
  readonly barRating = signal(-1);
  readonly structuralTechRating = signal(0);
  readonly engineTechRating = signal(0);
  readonly fuel = signal<number>(0);

  override isSupportVehicle(): this is this & SupportVehicle {
    return true;
  }

  protected override vehicleConstructionTechAdvancement(): TechRatingSource {
    return getSupportTankConstructionTech(this.motiveType(), this.weightClass());
  }

  protected override computeWeightClass(): WeightClass {
    return resolveSupportVehicleWeightClass(this.tonnage(), this.motiveType());
  }
}
