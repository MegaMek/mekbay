// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The real-phase turn sequence (Total Warfare turn: Movement, Weapon Attack, Physical Attack, Heat, End).
 * Attack phases are split into the steps players resolve in order: everyone declares, rolls to hit,
 * applies the damage they received, then cleans up (the existing End Phase boundary).
 */
export type TurnPhaseKey = 'movement' | 'weapons' | 'physical' | 'heat' | 'end';
export type TurnStepKind = 'movement' | 'declaration' | 'to-hit' | 'damage' | 'cleanup' | 'heat' | 'end';

export interface TurnStep {
    readonly index: number;
    readonly phase: TurnPhaseKey;
    readonly kind: TurnStepKind;
    readonly label: string;
    /** Entering this step waits until every live unit has completed the previous one. */
    readonly waitsForAll: boolean;
    /** Completing this step closes its phase: the End Phase boundary resolves its PSRs, falls and damage. */
    readonly endsPhase: boolean;
}

const STEP_ROWS: readonly Omit<TurnStep, 'index'>[] = [
    { phase: 'movement', kind: 'movement', label: 'Movement', waitsForAll: true, endsPhase: true },
    { phase: 'weapons', kind: 'declaration', label: 'Declaration', waitsForAll: true, endsPhase: false },
    // A unit rolls its own attacks as soon as it has declared them.
    { phase: 'weapons', kind: 'to-hit', label: 'To-Hit', waitsForAll: false, endsPhase: false },
    { phase: 'weapons', kind: 'damage', label: 'Damage', waitsForAll: true, endsPhase: false },
    { phase: 'weapons', kind: 'cleanup', label: 'Cleanup', waitsForAll: true, endsPhase: true },
    { phase: 'physical', kind: 'declaration', label: 'Declaration', waitsForAll: true, endsPhase: false },
    { phase: 'physical', kind: 'to-hit', label: 'To-Hit', waitsForAll: false, endsPhase: false },
    { phase: 'physical', kind: 'damage', label: 'Damage', waitsForAll: true, endsPhase: false },
    { phase: 'physical', kind: 'cleanup', label: 'Cleanup', waitsForAll: true, endsPhase: true },
    { phase: 'heat', kind: 'heat', label: 'Heat', waitsForAll: true, endsPhase: false },
    // End is where units that resolved heat (and ended their turn) wait for the rest.
    { phase: 'end', kind: 'end', label: 'End', waitsForAll: true, endsPhase: false },
];

export const TURN_STEPS: readonly TurnStep[] = Object.freeze(STEP_ROWS.map((row, index) => Object.freeze({ ...row, index })));
export const TURN_PHASE_LABELS: Readonly<Record<TurnPhaseKey, string>> = Object.freeze({
    movement: 'Movement', weapons: 'Weapons', physical: 'Physicals', heat: 'Heat', end: 'End',
});
export const HEAT_TURN_STEP = TURN_STEPS.findIndex(step => step.kind === 'heat');

/** The phases a unit closes in a turn: each End Phase boundary, then the End Turn at Heat. */
const CLOSED_PHASE_LABELS = TURN_STEPS.filter(step => step.endsPhase || step.kind === 'heat')
    .map(step => TURN_PHASE_LABELS[step.phase]);

/**
 * Names the log's phase `phase` of a turn. The log numbers phases from 1 and moves on at each End Phase
 * boundary, so a turn played in sequence reads Movement, Weapons, Physicals, Heat.
 */
export function historyPhaseLabel(phase: number): string {
    return CLOSED_PHASE_LABELS[phase - 1] ?? `Phase ${phase}`;
}
export const END_TURN_STEP = TURN_STEPS.length - 1;

/** Steps completed by marking them done; Heat completes by ending the unit's turn. */
export function isMarkableTurnStep(step: number): boolean {
    return Number.isSafeInteger(step) && step >= 0 && step < HEAT_TURN_STEP;
}

/** Completed-step counts a unit can hold within a turn (Heat ends the turn and resets it). */
export function isStoredTurnStep(step: number): boolean {
    return Number.isSafeInteger(step) && step >= 0 && step <= HEAT_TURN_STEP;
}

/** Where a unit stands: its turn counter and how many steps of that turn it has completed. */
export interface TurnPosition {
    readonly turn: number;
    readonly step: number;
}

export function compareTurnPositions(left: TurnPosition, right: TurnPosition): number {
    return left.turn - right.turn || left.step - right.step;
}

/** The game is wherever its slowest live unit is. Null when no unit is still in play. */
export function gameTurnPosition(units: readonly TurnPosition[]): TurnPosition | null {
    return units.reduce<TurnPosition | null>((slowest, unit) =>
        slowest === null || compareTurnPositions(unit, slowest) < 0 ? unit : slowest, null);
}

/**
 * Where a fresh unit (one that has not finished the first Movement) joins a game already under way: the
 * position of the units in play, once they are past where a unit that simply has not moved yet could hold
 * them. Null when the unit plays from where it is.
 */
export function joinTurnPosition(unit: TurnPosition, inPlay: TurnPosition | null): TurnPosition | null {
    const fresh = unit.turn === 0 && unit.step === 0;
    return fresh && inPlay && compareTurnPositions(inPlay, { turn: 0, step: 1 }) > 0 ? inPlay : null;
}

export type UnitTurnStatus =
    /** The unit is working on `step` and may complete it. */
    | 'acting'
    /** The unit completed `step` and waits for the other units. */
    | 'done';

/** The step to show a unit at, and whether it is still acting there or waiting for the rest. */
export function unitTurnStatus(unit: TurnPosition, game: TurnPosition): { readonly step: number; readonly status: UnitTurnStatus } {
    if (unit.turn > game.turn) return { step: END_TURN_STEP, status: 'done' };
    const next = TURN_STEPS[unit.step] ?? TURN_STEPS[END_TURN_STEP];
    const canEnter = !next.waitsForAll || compareTurnPositions(game, unit) >= 0;
    return canEnter ? { step: next.index, status: 'acting' } : { step: Math.max(0, next.index - 1), status: 'done' };
}
