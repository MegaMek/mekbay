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

export function adjustPointValueForSkill(basePointValue: number, skill: number): number {
    if (!Number.isInteger(basePointValue) || basePointValue < 1) {
        throw new RangeError('Base point value must be a positive integer.');
    }
    if (!Number.isInteger(skill) || skill < 0) {
        throw new RangeError('Alpha Strike skill must be a non-negative integer.');
    }
    if (skill === 4) return basePointValue;
    if (skill > 4) {
        const multiplier = 1 + (basePointValue > 14 ? Math.floor((basePointValue - 5) / 10) : 0);
        return Math.max(1, basePointValue - (skill - 4) * multiplier);
    }
    const multiplier = 1 + (basePointValue > 7 ? Math.floor((basePointValue - 3) / 5) : 0);
    return Math.max(1, basePointValue + (4 - skill) * multiplier);
}