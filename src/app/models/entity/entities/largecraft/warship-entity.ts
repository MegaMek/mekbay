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
import {
  EntityType,
  LARGE_CRAFT_LOCATIONS,
} from '../../types';
import { JumpShipEntity } from './jumpship-entity';

/**
 * Broadside locations used by WarShips (in addition to the standard 6).
 */
const WARSHIP_EQUIP_LOCS = [
  'Nose', 'FLS', 'FRS', 'ALS', 'ARS', 'Aft',
  'Left Broadside', 'Right Broadside', 'Hull',
] as const;

// ============================================================================
// WarShipEntity — KF-drive capital warships with broadside arcs
// ============================================================================

export class WarShipEntity extends JumpShipEntity {
  override readonly entityType: EntityType = 'WarShip';

  // ── WarShip specifics ──
  kfCore = signal<number>(0);

  // ── Location overrides ──

  override get locationOrder(): readonly string[] {
    return LARGE_CRAFT_LOCATIONS;
  }

  override get equipLocations(): readonly string[] {
    return [...WARSHIP_EQUIP_LOCS];
  }

  override get validLocations(): ReadonlySet<string> {
    return new Set([...LARGE_CRAFT_LOCATIONS, 'Left Broadside', 'Right Broadside', 'Hull']);
  }
}
