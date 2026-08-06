// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { MEK_LOCATIONS, MekConfig, MotiveType } from '../../types';
import { MekWithArmsEntity } from './mek-entity';

/** Standard biped BattleMek. */
export class BipedMekEntity extends MekWithArmsEntity {
  override motiveType = signal<MotiveType>('Biped');

  get chassisConfig(): MekConfig {
    return 'Biped';
  }

  get locationOrder(): string[] {
    return [...MEK_LOCATIONS];
  }

  get validLocations(): Set<string> {
    return new Set([...MEK_LOCATIONS]);
  }
}
