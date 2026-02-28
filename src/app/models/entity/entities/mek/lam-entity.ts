/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { signal } from '@angular/core';
import { CriticalSlotView, MekConfig } from '../../types';
import { BipedMekEntity } from './biped-mek-entity';

/** Helper to create a system slot view. */
function sys(systemType: string): CriticalSlotView {
  return { type: 'system', systemType: systemType as any, armored: false, omniPod: false };
}

/** Land-Air Mek - a biped Mek with LAM-specific fields. */
export class LamEntity extends BipedMekEntity {
  /** Standard or Bimodal LAM */
  lamType = signal<string>('Standard');

  override get chassisConfig(): MekConfig {
    return 'LAM';
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
        if (base[i].type === 'system' && base[i].systemType === 'Engine') {
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
