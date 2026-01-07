
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

/*
 * Author: Drake
 */
export class PVCalculatorUtil {
    /**
     * Calculates the adjusted PV based on the unit's base PV and pilot skill rating.
     * Skill 4 is the default baseline with no adjustment.
     * 
     * @param basePV The base Point Value at skill 4
     * @param skill The pilot's skill rating (0-8)
     * @returns The adjusted PV (minimum 1)
     */
    static calculateAdjustedPV(basePV: number, skill: number): number {
        if (skill === 4) {
            return basePV;
        }

        const skillDiff = skill - 4;
        let pvChange: number;

        if (skillDiff > 0) {
            // Less experienced (skill 5+): decrease PV
            pvChange = -this.getPVModifierPerRating(basePV, 10) * skillDiff;
        } else {
            // More experienced (skill 3-): increase PV
            pvChange = this.getPVModifierPerRating(basePV, 5) * Math.abs(skillDiff);
        }

        const adjustedPV = basePV + pvChange;
        return Math.max(1, adjustedPV); // Minimum PV is always 1
    }

    /**
     * Determines the PV modifier per rating based on base PV and bracket size.
     * 
     * @param basePV The base Point Value
     * @param bracketSize The PV bracket size (10 for decreases, 5 for increases)
     * @returns The modifier per skill rating point
     */
    private static getPVModifierPerRating(basePV: number, bracketSize: number): number {
        if (bracketSize === 10) {
            // Low-skill decrease: 0-14=1, 15-24=2, 25-34=3, etc.
            if (basePV <= 14) return 1;
            return Math.floor((basePV - 15) / 10) + 2;
        } else {
            // Improved-skill increase: 0-7=1, 8-12=2, 13-17=3, etc.
            if (basePV <= 7) return 1;
            return Math.floor((basePV - 8) / 5) + 2;
        }
    }
}