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

import { DEFAULT_PILOTING_SKILL } from "../models/crew-member.model";
import type { Unit } from "../models/units.model";
import { canAntiMech, NO_ANTIMEK_SKILL } from "./infantry.util";

/**
 * Author: Drake
 */

/**
 * Returns the effective piloting skill for a unit, enforcing CBT skill rating rules:
 *
 * - **ProtoMek**: No Piloting Skill — always uses column 5 of the BV Skill Multiplier Table.
 * - **Mechanized Infantry**: Cannot perform anti-Mech attacks — Piloting fixed at 5
 *   (use column 5 of the BV Skill Multiplier Table).
 * - **Conventional Infantry without Anti-Mech Kit**: Default Anti-Mech Skill Rating
 *   of 8, which cannot be improved.
 * - All other units: the provided piloting skill is returned unchanged.
 *
 * @param unit - The unit to evaluate
 * @param pilotingSkill - The raw/requested piloting skill
 * @returns The effective piloting skill after applying CBT rules
 */
export function getEffectivePilotingSkill(unit: Unit, pilotingSkill: number): number {
    if (unit.type === 'ProtoMek') {
        return DEFAULT_PILOTING_SKILL;
    }
    if (unit.type === 'Infantry' && !canAntiMech(unit)) {
        if (unit.subtype.includes('Mechanized')) {
            return DEFAULT_PILOTING_SKILL;
        }
        if (unit.subtype.includes('Conventional Infantry')) {
            return NO_ANTIMEK_SKILL;
        }
        return DEFAULT_PILOTING_SKILL; // Default for other infantry types without anti-Mech capability (BA!)
    }
    return pilotingSkill;
}
