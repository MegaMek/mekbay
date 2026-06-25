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

import { computed, signal, type Signal } from '@angular/core';
import type { CriticalSlot } from '../force-serialization';
import type { MotiveModes } from '../motiveModes.model';
import type { TurnState } from '../turn-state.model';
import {
    getTargetMovementBracketForDistance,
    getTargetStanceModifier,
    TN_AIRBORNE_MOVE_TYPE_MODIFIER,
    TN_SKIDDING_MODIFIER,
} from '../target-number-calculator.model';

export interface PSRCheck {
    fallCheck?: number;
    pilotCheck?: number;
    reason: string;
    loc?: string;
    legFilter?: string;
    ignorePreExistingGyro?: boolean;
}

export interface UnitSkillModifier {
    modifier: number;
    reason: string;
}

export interface UnitHeatSource {
    id: string;
    label: string;
    value: number;
}

export interface UnitModifierBreakdownEntry {
    label: string;
    modifier: number;
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

    /** Short label for required control rolls (PSR, DSR, etc.). */
    readonly controlRollShortLabel: string;

    /** Full label for required control rolls. */
    readonly controlRollFullLabel: string;

    /** Piloting Skill Roll modifiers. Non-Mek types return { modifier: 0, modifiers: [] }. */
    readonly PSRModifiers: Signal<{ modifier: number; modifiers: PSRCheck[] }>;

    /** PSR target roll number (piloting skill + modifiers). Non-Mek types return 0. */
    readonly PSRTargetRoll: Signal<number>;

    /** Gunnery modifier breakdown for UI display. */
    readonly gunneryModifiers: Signal<UnitSkillModifier[]>;

    /** Gunnery skill modifier total from unit-type-specific rules. */
    readonly gunneryModifier: Signal<number>;

    /** Piloting modifier breakdown from unit-type-specific rules. */
    readonly pilotingModifiers: Signal<UnitSkillModifier[]>;

    /** Piloting skill modifier total from unit-type-specific rules. */
    readonly pilotingModifier: Signal<number>;

    /** Whether current phase damage causes automatic falling or equivalent unit-type failure. */
    readonly autoFall: Signal<boolean>;

    /** Required control-roll checks for the current phase. */
    getPSRChecks(turnState: TurnState): PSRCheck[];

    /** Movement-mode warning roll caused by committed damage. */
    getCommittedDamageMovementModePSRCheck(moveMode: MotiveModes | null): PSRCheck | null;

    /** Evaluate whether internal damage creates unit-type-specific control-roll checks. */
    evaluateLegDestroyed(location: string, hits: number): void;

    /** Evaluate whether critical damage creates unit-type-specific control-roll checks. */
    evaluateCritSlotHit(crit: CriticalSlot): void;

    /** Heat sources produced by current phase choices and damage state. */
    heatSources(turnState: TurnState): UnitHeatSource[];

    /** Unit-type-specific movement distance override. Return null to use base unit data. */
    getMaxDistanceForMoveMode(moveMode: MotiveModes): number | null;

    /** Unit-type-specific minimum movement distance override. Return null to use 0. */
    getMinDistanceForMoveMode(moveMode: MotiveModes): number | null;

    /** Unit-type-specific movement mode availability. */
    isMotiveModeAvailable(moveMode: MotiveModes): boolean;

    /** Unit-type-specific attack movement modifier. */
    getAttackMovementModifier(moveMode: MotiveModes | null | undefined): number;

    /** Attack modifier breakdown for turn summary UI. */
    getAttackModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[];

    /** Target movement modifier breakdown for turn summary UI. */
    getDefenseModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[];
}

export abstract class UnitTypeRulesBase implements UnitTypeRules {
    readonly controlRollShortLabel: string;
    readonly controlRollFullLabel: string;
    readonly PSRModifiers: Signal<{ modifier: number; modifiers: PSRCheck[] }> = signal({ modifier: 0, modifiers: [] });
    readonly PSRTargetRoll: Signal<number> = signal(0);
    readonly gunneryModifiers: Signal<UnitSkillModifier[]> = signal([]);
    readonly gunneryModifier: Signal<number> = computed(() => this.gunneryModifiers().reduce((total, modifier) => total + modifier.modifier, 0));
    readonly pilotingModifiers: Signal<UnitSkillModifier[]> = signal([]);
    readonly pilotingModifier: Signal<number> = computed(() => this.pilotingModifiers().reduce((total, modifier) => total + modifier.modifier, 0));
    readonly autoFall: Signal<boolean> = signal(false);

    abstract evaluateDestroyed(): void;

    constructor(
        controlRollShortLabel: string = 'PSR',
        controlRollFullLabel: string = 'Piloting Skill Rolls'
    ) {
        this.controlRollShortLabel = controlRollShortLabel;
        this.controlRollFullLabel = controlRollFullLabel;
    }

    getPSRChecks(_turnState: TurnState): PSRCheck[] {
        return [];
    }

    getCommittedDamageMovementModePSRCheck(_moveMode: MotiveModes | null): PSRCheck | null {
        return null;
    }

    evaluateLegDestroyed(_location: string, _hits: number): void {
    }

    evaluateCritSlotHit(_crit: CriticalSlot): void {
    }

    heatSources(_turnState: TurnState): UnitHeatSource[] {
        return [];
    }

    getMaxDistanceForMoveMode(_moveMode: MotiveModes): number | null {
        return null;
    }

    getMinDistanceForMoveMode(_moveMode: MotiveModes): number | null {
        return null;
    }

    isMotiveModeAvailable(_moveMode: MotiveModes): boolean {
        return true;
    }

    getAttackMovementModifier(_moveMode: MotiveModes | null | undefined): number {
        return 0;
    }

    getAttackModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries = this.gunneryModifiers()
            .filter(modifier => modifier.modifier !== 0)
            .map(modifier => ({ label: modifier.reason, modifier: modifier.modifier }));
        const movementModifier = this.getAttackMovementModifier(turnState.moveMode());
        if (movementModifier !== 0) {
            entries.push({ label: 'Attacker movement', modifier: movementModifier });
        }
        const spottingModifier = turnState.spotting() ? 1 : 0;
        if (spottingModifier !== 0) {
            entries.push({ label: 'Spotting', modifier: spottingModifier });
        }
        return entries;
    }

    getDefenseModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries: UnitModifierBreakdownEntry[] = [];
        if (turnState.unitState.prone()) {
            entries.push({ label: 'Prone', modifier: getTargetStanceModifier('prone', 1) });
        }
        if (turnState.unitState.immobile()) {
            entries.push({ label: 'Immobile', modifier: getTargetStanceModifier('immobile', 1) });
        }
        if (turnState.unitState.skidding()) {
            entries.push({ label: 'Skidding', modifier: TN_SKIDDING_MODIFIER });
        }
        const moveMode = turnState.moveMode();
        if (moveMode === 'jump') {
            entries.push({ label: 'Jumped', modifier: TN_AIRBORNE_MOVE_TYPE_MODIFIER });
        } else if (turnState.airborne() === true) {
            entries.push({ label: 'Airborne', modifier: TN_AIRBORNE_MOVE_TYPE_MODIFIER });
        }
        if (moveMode !== 'stationary' && moveMode !== null) {
            const moveDistance = turnState.moveDistance() || 0;
            const movementBracket = getTargetMovementBracketForDistance(moveDistance);
            entries.push({
                label: `Moved ${movementBracket?.label ?? moveDistance} hexes`,
                modifier: movementBracket?.modifier ?? 0,
            });
        }
        entries.push(...this.getTargetUnitTypeModifierBreakdown(turnState));
        return entries;
    }

    protected getTargetUnitTypeModifierBreakdown(_turnState: TurnState): UnitModifierBreakdownEntry[] {
        return [];
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
