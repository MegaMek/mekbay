/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { Subscription } from 'rxjs';
import { Force } from './force.model';

/**
 * Author: Drake
 * 
 * Represents a loaded force in the multi-force manager.
 */
export type ForceAlignment = 'friendly' | 'enemy';

/**
 * Represents a loaded force in the multi-force manager.
 * Each slot wraps a Force with its per-slot state: alignment and auto-save subscription.
 */
export interface ForceSlot {
    /** The loaded force instance */
    force: Force;
    /** Whether this force is friendly or enemy (visual/filtering) */
    alignment: ForceAlignment;
    /** Per-slot subscription to force.changed for auto-save. Null if not yet subscribed. */
    changeSub: Subscription | null;
}
