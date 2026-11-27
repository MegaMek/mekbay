// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { WritableSignal } from '@angular/core';
import type { BaseEntity } from '../base-entity';

export interface SupportVehicle {
  readonly barRating: WritableSignal<number>;
  readonly structuralTechRating: WritableSignal<number>;
  readonly engineTechRating: WritableSignal<number>;
  readonly fuel: WritableSignal<number>;
  isSupportVehicle(): this is this & SupportVehicle;
}

/** Patchwork carries BAR on each material; uniform native files retain a separate BAR value. */
export function supportVehicleBarRating(entity: BaseEntity & SupportVehicle, location = entity.armorLocations[0]): number {
  return entity.hasPatchworkArmor() ? entity.armorAt(location).armor.bar : entity.barRating();
}
