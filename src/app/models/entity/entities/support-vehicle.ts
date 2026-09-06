// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { WritableSignal } from '@angular/core';

export interface SupportVehicle {
  readonly barRating: WritableSignal<number>;
  readonly structuralTechRating: WritableSignal<number>;
  readonly engineTechRating: WritableSignal<number>;
  readonly fuel: WritableSignal<number>;
  isSupportVehicle(): this is this & SupportVehicle;
}
