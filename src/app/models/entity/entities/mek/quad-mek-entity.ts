// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { MEK_QUAD_LOCATIONS, MekConfig, MotiveType } from '../../types';
import { MekEntity } from './mek-entity';

/** Quad BattleMek - no arm actuators, uses leg-based locations. */
export class QuadMekEntity extends MekEntity {
  override motiveType = signal<MotiveType>('Quad');

  get chassisConfig(): MekConfig {
    return 'Quad';
  }

  get locationOrder(): string[] {
    return [...MEK_QUAD_LOCATIONS];
  }

  get validLocations(): Set<string> {
    return new Set([...MEK_QUAD_LOCATIONS]);
  }
}
