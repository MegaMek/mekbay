// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import {
  type CriticalSlotView,
  MekConfig,
  type MekSystemType,
  MotiveType,
  type TechRatingSource,
} from '../../types';
import { getQuadVeeConstructionTech } from '../../components';
import { QuadMekEntity } from './quad-mek-entity';

function systemSlot(systemType: MekSystemType): CriticalSlotView {
  return { type: 'system', systemType, armored: false, omniPod: false };
}

/** QuadVee - a Quad Mek with a vehicle motive type (Track or Wheel). */
export class QuadVeeEntity extends QuadMekEntity {
  /** Vehicle-mode motive type: Track or Wheel */
  override motiveType = signal<MotiveType>('Track');

  protected override constructionTechAdvancement(): TechRatingSource {
    return getQuadVeeConstructionTech();
  }

  override get chassisConfig(): MekConfig {
    return 'QuadVee';
  }

  protected override getSystemSlotsForLocation(location: string): CriticalSlotView[] {
    const slots = super.getSystemSlotsForLocation(location);
    if (location === 'FLL' || location === 'FRL' || location === 'RLL' || location === 'RRL') {
      slots[4] = systemSlot('Conversion Gear');
    }
    return slots;
  }
}
