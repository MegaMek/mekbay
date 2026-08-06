// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { EntityType, WeightClass } from '../../types';
import { SupportVehicleData, type SupportVehicle } from '../support-vehicle';
import { TankEntity } from './tank-entity';
import type { TechRatingSource } from '../../types';
import { getSupportTankConstructionTech } from '../../components';

/** Support Tank - adds BAR rating and support vehicle tech ratings. */
export class SupportTankEntity extends TankEntity implements SupportVehicle {
  override readonly entityType: EntityType = 'SupportTank';
  readonly supportVehicle = new SupportVehicleData(-1);
  readonly barRating = this.supportVehicle.barRating;
  readonly structuralTechRating = this.supportVehicle.structuralTechRating;
  readonly engineTechRating = this.supportVehicle.engineTechRating;
  readonly fuel = signal<number>(0);

  override isSupportVehicle(): this is this & SupportVehicle {
    return true;
  }

  protected override vehicleConstructionTechAdvancement(): TechRatingSource {
    return getSupportTankConstructionTech(this.motiveType(), this.weightClass());
  }

  protected override computeWeightClass(): WeightClass {
    return this.supportVehicle.resolveWeightClass(this.tonnage(), this.motiveType());
  }
}
