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

import { DEFAULT_PILOTING_SKILL } from "../models/crew-member.model";
import { Unit, UnitComponent } from "../models/units.model";

/*
 * Author: Drake
 */
export const NO_ANTIMEK_SKILL = 8;
const ANTI_MEK_GEAR_INTERNAL_NAME = 'AntiMekGear';
const BA_FLAG_BASIC_MANIPULATOR = 'F_BASIC_MANIPULATOR';
const BA_FLAG_ARMORED_GLOVE = 'F_ARMORED_GLOVE';
const BA_FLAG_BATTLE_CLAW = 'F_BATTLE_CLAW';

export function canAntiMech(unit: Unit): boolean {
    if (unit.type !== 'Infantry') return false;

    // Conventional infantry (not mechanized/motorized)
    if (unit.subtype === 'Conventional Infantry') {
        return hasAntiMekGear(unit.comp);
    }

    // Battle Armor
    if (unit.subtype === 'Battle Armor') {
        return canBattleArmorAntiMech(unit);
    }

    return false;
}

function hasAntiMekGear(components: UnitComponent[] | undefined): boolean {
    if (!components || components.length === 0) return false;
    return components.some(c => c.eq?.internalName === ANTI_MEK_GEAR_INTERNAL_NAME);
}

function canBattleArmorAntiMech(unit: Unit): boolean {
    // Weight class restriction
    if (unit.weightClass === 'Heavy' || unit.weightClass === 'Assault') return false;
    let basicManipulatorCount = 0;
    let armoredGloveCount = 0;
    let battleClawCount = 0;
    for (const component of unit.comp) {
        if (component.eq?.hasFlag(BA_FLAG_BASIC_MANIPULATOR)) {
            basicManipulatorCount += component.q || 1;
            continue;
        }
        if (component.eq?.hasFlag(BA_FLAG_ARMORED_GLOVE)) {
            armoredGloveCount += component.q || 1;
            continue;
        }
        if (component.eq?.hasFlag(BA_FLAG_BATTLE_CLAW)) {
            battleClawCount += component.q || 1;
            continue;
        }
    }

    // - Medium BA: needs (Basic Manipulator > 1) OR (Battle Claw > 0)        
    if (unit.weightClass === 'Medium') {
        return basicManipulatorCount > 1 || battleClawCount > 0;
    }

    // - Light/Ultra-light BA: needs (Armored Glove > 1) OR (Basic Manipulator > 1) OR (Battle Claw > 0)
    return armoredGloveCount > 1 || basicManipulatorCount > 1 || battleClawCount > 0;
}