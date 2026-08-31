// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, signal } from '@angular/core';
import { CriticalSlotView, MekConfig, type MekSystemType, type TechRatingSource } from '../../types';
import { getLamConstructionTech } from '../../components';
import { BipedMekEntity } from './biped-mek-entity';

/** Helper to create a system slot view. */
function sys(systemType: MekSystemType): CriticalSlotView {
  return { type: 'system', systemType, armored: false, omniPod: false };
}

/** Land-Air Mek - a biped Mek with LAM-specific fields. */
export class LamEntity extends BipedMekEntity {
  /** Standard or Bimodal LAM */
  lamType = signal<string>('Standard');

  override get chassisConfig(): MekConfig {
    return 'LAM';
  }

  override isLandAirMek(): boolean {
    return this.lamType().toLowerCase() !== 'bimodal';
  }

  /** Mirrors LandAirMek.getAirMekFlankMP(BV_CALCULATION). */
  readonly bvAirMekFlankMP = computed(() => Math.ceil(this.maxJumpMP() * 3 * 1.5));

  override airMekFlankMP(): number {
    return this.bvAirMekFlankMP();
  }

  protected override constructionTechAdvancement(): TechRatingSource {
    return getLamConstructionTech(
      this.lamType().toLowerCase() === 'bimodal' ? 'Bimodal' : 'Standard',
    );
  }

  protected override getSystemSlotsForLocation(loc: string): CriticalSlotView[] {
    const base = super.getSystemSlotsForLocation(loc);

    if (loc === 'HD') {
      // LAM overwrites slot 3 with Avionics. For Small Cockpit (where slot 3
      // is Sensors), relocate the displaced Sensors to the next empty slot.
      if (base[3]?.type === 'system' && base[3]?.systemType === 'Sensors') {
        const nextEmpty = base.findIndex((s, i) => i > 3 && s.type === 'empty');
        if (nextEmpty >= 0) base[nextEmpty] = sys('Sensors');
      }
      base[3] = sys('Avionics');
    } else if (loc === 'CT') {
      // Add Landing Gear after engine/gyro in CT
      const firstEmpty = base.findIndex(s => s.type === 'empty');
      if (firstEmpty >= 0) base[firstEmpty] = sys('Landing Gear');
    } else if (loc === 'LT' || loc === 'RT') {
      // Find where engine side-torso slots end, then add Landing Gear + Avionics
      let insertAt = 0;
      for (let i = 0; i < base.length; i++) {
        const slot = base[i];
        if (slot.type === 'system' && slot.systemType === 'Engine') {
          insertAt = i + 1;
        } else {
          break;
        }
      }
      // Insert Landing Gear and Avionics after engine slots
      if (insertAt + 1 < base.length) {
        base[insertAt] = sys('Landing Gear');
        base[insertAt + 1] = sys('Avionics');
      }
    }

    return base;
  }
}
