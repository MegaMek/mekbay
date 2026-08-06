// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { MEK_TRIPOD_LOCATIONS, MekConfig, MotiveType } from '../../types';
import { MekWithArmsEntity } from './mek-entity';

/** Tripod BattleMek - adds Center Leg location. */
export class TripodMekEntity extends MekWithArmsEntity {
  override motiveType = signal<MotiveType>('Tripod');

  get chassisConfig(): MekConfig {
    return 'Tripod';
  }

  get locationOrder(): string[] {
    return [...MEK_TRIPOD_LOCATIONS];
  }

  get validLocations(): Set<string> {
    return new Set([...MEK_TRIPOD_LOCATIONS]);
  }
}
