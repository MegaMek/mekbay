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
import { type MotiveModes } from '../motiveModes.model';
import type { TurnState } from '../turn-state.model';
import {
    getTargetMovementBracketForDistance,
    getTargetStanceModifier,
    TN_AIRBORNE_MOVE_TYPE_MODIFIER,
    TN_SKIDDING_MODIFIER,
} from '../target-number-calculator.model';
import { CBTForceUnit } from '../cbt-force-unit.model';

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

export type UnitConditionControlPlacement = 'button' | 'menu';

export interface UnitConditionDefinition {
    key: string;
    label: string;
    color: string;
    placement?: UnitConditionControlPlacement;
}

export type UnitConditionControl = UnitConditionDefinition & { placement: UnitConditionControlPlacement };

export const UNIT_CONDITION_DEFINITIONS: readonly UnitConditionDefinition[] = [
    { key: 'shutdown', label: 'SHUTDOWN', color: '#d32f2f', placement: 'button' },
    { key: 'abandoned', label: 'ABANDONED', color: '#000000' },
    { key: 'immobile', label: 'IMMOBILE', color: '#ff8800' },
    { key: 'prone', label: 'PRONE', color: '#666', placement: 'button' },
    { key: 'swarmed', label: 'SWARMED', color: '#54ffc3', placement: 'menu' },
    { key: 'tagged', label: 'TAGGED', color: '#3385d7', placement: 'menu' },
    { key: 'skidding', label: 'SKIDDING', color: '#ebdb00', placement: 'menu' },
    { key: 'jammed', label: 'JAMMED', color: '#ff6be6', placement: 'menu' },
];

const UNIT_CONDITION_BY_KEY = new Map<string, UnitConditionDefinition>(UNIT_CONDITION_DEFINITIONS.map(condition => [condition.key, condition]));
const UNIT_CONDITION_SORT_INDEX = new Map<string, number>(UNIT_CONDITION_DEFINITIONS.map((condition, index) => [condition.key, index]));

function unitConditionControls(keys: readonly string[]): readonly UnitConditionControl[] {
    return keys.map(key => {
        const condition = UNIT_CONDITION_BY_KEY.get(key);
        if (!condition?.placement) throw new Error(`Unknown controllable unit condition: ${key}`);
        return condition as UnitConditionControl;
    });
}

export function getUnitConditionDefinition(key: string): UnitConditionDefinition | undefined {
    return UNIT_CONDITION_BY_KEY.get(key);
}

export function unitConditionSortIndex(key: string): number {
    return UNIT_CONDITION_SORT_INDEX.get(key) ?? UNIT_CONDITION_DEFINITIONS.length;
}

export const MEK_UNIT_CONDITION_CONTROLS: readonly UnitConditionControl[] = unitConditionControls(['shutdown', 'prone', 'swarmed', 'tagged', 'skidding', 'jammed']);
export const VEHICLE_UNIT_CONDITION_CONTROLS: readonly UnitConditionControl[] = unitConditionControls(['swarmed', 'tagged', 'skidding', 'jammed']);

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

    /** Manual condition controls available for this unit type. */
    readonly conditionControls: readonly UnitConditionControl[];

    /** Whether a condition key is derived from rules instead of persisted unit state. */
    isComputedCondition(condition: string): boolean;

    /** Get a rule-derived condition value. Returns false for non-computed condition keys. */
    hasComputedCondition(condition: string): boolean;

    /** Rule-derived condition keys exposed through ForceUnit.getCondition/getConditions. */
    computedConditions(): readonly string[];

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
    getAttackMovementModifier(moveMode: MotiveModes | null | undefined, airborne?: boolean): number;

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
    readonly conditionControls: readonly UnitConditionControl[] = [];
    protected readonly abandoned: Signal<boolean> = signal(false);
    protected readonly immobile: Signal<boolean> = signal(false);

    abstract evaluateDestroyed(): void;

    constructor(
        protected unit: CBTForceUnit,
        controlRollShortLabel: string = 'PSR',
        controlRollFullLabel: string = 'Piloting Skill Rolls'
    ) {
        this.controlRollShortLabel = controlRollShortLabel;
        this.controlRollFullLabel = controlRollFullLabel;
    }

    isComputedCondition(condition: string): boolean {
        return condition === 'abandoned' || condition === 'immobile';
    }

    hasComputedCondition(condition: string): boolean {
        if (condition === 'abandoned') return this.abandoned();
        if (condition === 'immobile') return this.immobile();
        return false;
    }

    computedConditions(): readonly string[] {
        return ['abandoned', 'immobile'];
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

    heatSources(turnState: TurnState): UnitHeatSource[] {
        if (this.unit.getUnit().heat < 0) return []; // Does not track heat
        const firedHeat = turnState.firedHeat();
        return firedHeat > 0
            ? [{ id: 'weapons', label: 'Weapons', value: firedHeat }]
            : [];
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

    getAttackMovementModifier(_moveMode: MotiveModes | null | undefined, _airborne: boolean = false): number {
        return 0;
    }

    getAttackModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries = this.gunneryModifiers()
            .filter(modifier => modifier.modifier !== 0)
            .map(modifier => ({ label: modifier.reason, modifier: modifier.modifier }));
        const movementModifier = this.getAttackMovementModifier(turnState.moveMode(), turnState.airborne() ?? false);
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
        if (turnState.unitState.hasCondition('prone')) {
            entries.push({ label: 'Prone', modifier: getTargetStanceModifier('prone', 1) });
        }
        if (turnState.unitState.hasCondition('immobile')) {
            entries.push({ label: 'Immobile', modifier: getTargetStanceModifier('immobile', 1) });
        }
        if (turnState.unitState.hasCondition('skidding')) {
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

    protected hasFunctionalCrew(): boolean {
        const crew = this.unit.getCrewMembers();
        return crew.length > 0 && crew.some(crewMember => crewMember.getState() === 'healthy');
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
