
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
    private static readonly SKILL_MODIFIERS: Record<number, number> = {
        0: 2.4,
        1: 1.9,
        2: 1.5,
        3: 1.2,
        4: 1.0,
        5: 0.9,
        6: 0.8,
        7: 0.7,
        8: 0.6
    };

    static calculateAdjustedPV(basePV: number, skill: number): number {
        // PV adjustment based on skill (skill 4 is baseline)
        const modifier = this.SKILL_MODIFIERS[skill] ?? 1.0;
        if (modifier === 1.0) {
            return basePV;
        }
        return Math.round(basePV * modifier);
    }
}