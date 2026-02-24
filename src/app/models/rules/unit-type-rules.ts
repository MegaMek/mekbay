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

import { Signal } from '@angular/core';
import { PSRCheck } from '../turn-state.model';

/**
 * Author: Drake
 * 
 * Strategy interface for unit-type-specific game rules.
 * Each CBTForceUnit holds a `rules` instance matching its unit type.
 */
export interface UnitTypeRules {
    /** Evaluate whether the unit should be marked destroyed based on current state. Idempotent. */
    evaluateDestroyed(): void;

    /** Piloting Skill Roll modifiers. Non-Mek types return { modifier: 0, modifiers: [] }. */
    readonly PSRModifiers: Signal<{ modifier: number; modifiers: PSRCheck[] }>;

    /** PSR target roll number (piloting skill + modifiers). Non-Mek types return 0. */
    readonly PSRTargetRoll: Signal<number>;
}

/**
 * Format a piloting skill value for display, applying PSR modifiers.
 * Encapsulates the BattleTech rule: PSR target > 12 = automatic failure.
 */
export function formatPilotingDisplay(pilotingSkill: number, psrModifier: number): string {
    if (!psrModifier) return pilotingSkill.toString();
    const target = pilotingSkill + psrModifier;
    if (target > 12) return 'FAIL';
    const sign = psrModifier > 0 ? '+' : '';
    return `${pilotingSkill}${sign}${psrModifier}`;
}
