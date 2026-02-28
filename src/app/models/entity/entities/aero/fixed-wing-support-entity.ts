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
import { AERO_LOCATIONS, EntityType, FIXED_WING_EQUIP_LOCATIONS } from '../../types';
import { AeroEntity } from './aero-entity';

/** Fixed Wing Support vehicle — uses BAR rating and tech ratings. */
export class FixedWingSupportEntity extends AeroEntity {
  override readonly entityType: EntityType = 'FixedWingSupport';

  /** VSTOL (Vertical/Short Take-Off and Landing) capability */
  vstol = signal<boolean>(false);

  /** Battle Armor Rating */
  barRating = signal<number>(10);

  /** Tech ratings for support vehicle construction */
  structuralTechRating = signal<number>(0);
  engineTechRating = signal<number>(0);
  baseChassisFireConWeight = signal<number>(0);

  get locationOrder(): readonly string[] {
    return AERO_LOCATIONS;
  }

  get equipLocations(): readonly string[] {
    return [...FIXED_WING_EQUIP_LOCATIONS];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...FIXED_WING_EQUIP_LOCATIONS]);
  }
}
