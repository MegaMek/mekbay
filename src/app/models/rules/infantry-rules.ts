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

import { signal } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import type { UnitTypeRules } from './unit-type-rules';
import type { PSRCheck } from '../turn-state.model';

/**
 * Author: Drake
 * 
 * Infantry / Battle Armor game rules.
 */
export class InfantryRules implements UnitTypeRules {

    constructor(private unit: CBTForceUnit) {}

    evaluateDestroyed(): void {
        this.evaluateInventoryDestruction();

        let allDestroyed = true;

        // Unit destroyed when all troop armor+internal locations are committed-destroyed.
        for (const loc of this.unit.locations?.armor?.keys() ?? []) {
            if (!this.unit.isArmorLocCommittedDestroyed(loc)) {
                allDestroyed = false;
                break;
            }
        }
        if (allDestroyed) {
            for (const loc of this.unit.locations?.internal?.keys() ?? []) {
                if (!this.unit.isInternalLocCommittedDestroyed(loc)) {
                    allDestroyed = false;
                    break;
                }
            }
        }

        if (this.unit.destroyed !== allDestroyed) {
            this.unit.setDestroyed(allDestroyed);
        }
    }

    /** Mark inventory entries as destroyed when the T1 armor location is gone. */
    evaluateInventoryDestruction(): void {
        const t1Destroyed = this.unit.isArmorLocDestroyed('T1');
        for (const entry of this.unit.getInventory()) {
            if (entry.equipment) {
                entry.destroyed = t1Destroyed;
            }
        }
    }

    /** Infantry does not support PSR. */
    readonly PSRModifiers = signal<{ modifier: number; modifiers: PSRCheck[] }>({ modifier: 0, modifiers: [] });
    readonly PSRTargetRoll = signal<number>(0);
}
