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

import { ForceUnit } from "../models/force-unit.model";

/*
 * Author: Drake
 */
const TAX_RATE = 0.05;
const COMPATIBLE_NETWORKS = [
    ['C3 Master', 'C3 Slave', 'C3BS (Master)', 'C3 Emergency Master', 'C3 Boosted Slave', 'BC3'],
    ['C3i', 'BC3i'],
    ['Naval C3'],
    ['Nova CEWS'],
]
    
export class C3NetworkUtil {

    public static calculateC3Tax(currentUnit: ForceUnit, units: ForceUnit[]): number {
        if (!currentUnit.c3Linked) {
            return 0;
        }
        const linkedUnits = units.filter(unit => unit === currentUnit 
            || (unit.c3Linked && this.isCompatibleForC3(currentUnit, unit)))
        if (linkedUnits.length <= 1) {
            return 0;
        }
        const totalBV = linkedUnits.reduce((sum, unit) => sum + unit.getUnit().bv, 0);
        return Math.round(totalBV * TAX_RATE);
    }

    private static isCompatibleForC3(currentUnit: ForceUnit, unit: ForceUnit): boolean {
        const currentC3 = currentUnit.getUnit().c3;
        const otherC3 = unit.getUnit().c3;
        return COMPATIBLE_NETWORKS.some(network => network.includes(currentC3) && network.includes(otherC3));
    }
}