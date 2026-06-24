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

import { signal, type Signal } from '@angular/core';
import type { MotiveModes } from '../motiveModes.model';
import type { PSRCheck } from '../turn-state.model';

export interface UnitSkillModifier {
    modifier: number;
    reason: string;
}

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

    /** Gunnery skill modifiers from unit-type-specific rules. */
    readonly gunneryModifier: Signal<number>;

    /** Piloting skill modifiers from unit-type-specific rules. */
    readonly pilotingModifier: Signal<number>;

    /** Gunnery modifier breakdown for UI display. */
    readonly gunneryModifiers: Signal<UnitSkillModifier[]>;

    /** Unit-type-specific movement distance override. Return null to use base unit data. */
    getMaxDistanceForMoveMode(moveMode: MotiveModes): number | null;

    /** Unit-type-specific movement mode availability. */
    isMotiveModeAvailable(moveMode: MotiveModes): boolean;

    /** Unit-type-specific attack movement modifier. */
    getAttackMovementModifier(moveMode: MotiveModes | null | undefined): number;
}

export abstract class UnitTypeRulesBase implements UnitTypeRules {
    readonly PSRModifiers: Signal<{ modifier: number; modifiers: PSRCheck[] }> = signal({ modifier: 0, modifiers: [] });
    readonly PSRTargetRoll: Signal<number> = signal(0);
    readonly gunneryModifier: Signal<number> = signal(0);
    readonly pilotingModifier: Signal<number> = signal(0);
    readonly gunneryModifiers: Signal<UnitSkillModifier[]> = signal([]);

    abstract evaluateDestroyed(): void;

    getMaxDistanceForMoveMode(_moveMode: MotiveModes): number | null {
        return null;
    }

    isMotiveModeAvailable(_moveMode: MotiveModes): boolean {
        return true;
    }

    getAttackMovementModifier(_moveMode: MotiveModes | null | undefined): number {
        return 0;
    }
}

/**
 * Format a piloting skill value for display, applying PSR modifiers.
 * Encapsulates the BattleTech rule: PSR target > 12 = automatic failure.
 */
export function formatPilotingDisplay(pilotingSkill: number, psrModifier: number): string {
    if (!psrModifier) return pilotingSkill.toString();
    const sign = psrModifier > 0 ? '+' : '';
    return `${pilotingSkill}${sign}${psrModifier}`;
}

/** Format a gunnery skill value for display, applying the unit's own attack modifier. */
export function formatGunneryDisplay(gunnerySkill: number, attackerModifier: number): string {
    if (!attackerModifier) return gunnerySkill.toString();
    const sign = attackerModifier > 0 ? '+' : '';
    return `${gunnerySkill}${sign}${attackerModifier}`;
}
