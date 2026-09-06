// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { EntityType, WeightClass, resolveSupportVehicleWeightClass } from '../../types';
import type { SupportVehicle } from '../support-vehicle';
import { VtolEntity } from './vtol-entity';
import type { TechRatingSource } from '../../types';
import { getSupportVtolConstructionTech } from '../../components';

/** Support VTOL - adds BAR rating and support vehicle tech ratings. */
export class SupportVtolEntity extends VtolEntity implements SupportVehicle {
  override readonly entityType: EntityType = 'SupportVTOL';
  readonly barRating = signal(-1);
  readonly structuralTechRating = signal(0);
  readonly engineTechRating = signal(0);
  readonly fuel = signal<number>(0);

  override isSupportVehicle(): this is this & SupportVehicle {
    return true;
  }

  protected override vehicleConstructionTechAdvancement(): TechRatingSource {
    return getSupportVtolConstructionTech(this.weightClass());
  }

  protected override get minimumEngineRating(): number | null {
    return null;
  }

  protected override get zeroCruiseUsesEngineType(): boolean {
    return false;
  }

  protected override computeWeightClass(): WeightClass {
    return resolveSupportVehicleWeightClass(this.tonnage(), 'VTOL');
  }
}
