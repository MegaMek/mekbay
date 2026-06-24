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

import type { CBTForceUnit } from '../cbt-force-unit.model';
import { UnitTypeRulesBase } from './unit-type-rules';

/**
 * Author: Drake
 * 
 * Infantry / Battle Armor game rules.
 */
export class InfantryRules extends UnitTypeRulesBase {

    constructor(private unit: CBTForceUnit) {
        super();
    }

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
        const squadSize = this.unit.getUnit().squadSize ?? 1;
        let allSquadsDestroyed = true;
        for (let i = 1; i <= squadSize; i++) {
            if (!this.unit.isArmorLocCommittedDestroyed(`T${i}`)) {
                allSquadsDestroyed = false;
                break;
            }
        }
        const t1Destroyed = this.unit.isArmorLocDestroyed('T1');
        for (const entry of this.unit.getInventory()) {
            if (!entry.equipment) continue;
            entry.destroyed = allSquadsDestroyed;
            if (allSquadsDestroyed) continue;
            
            // TODO: not working, locations is empty for Infantry!!!! FIX ME!
            if (entry.locations?.has('SSW')) { 
                entry.destroyed = t1Destroyed;
            }
        }
    }

}
