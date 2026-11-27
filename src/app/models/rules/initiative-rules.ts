// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';

/**
 * How a side with more units than another spreads its extra selections over a phase (Unequal Numbers):
 * - 'back-loaded': act for k units once it has at least k times as many left (TW p.39, BMM p.12);
 * - 'front-loaded': act for enough units to even the counts as early as possible (Core p.41);
 * - 'spread': spread the extra units evenly over the phase.
 * 'rules' follows the ruleset: Total Warfare is back-loaded, Core front-loaded.
 */
export type InitiativeOrderMode = 'rules' | 'front-loaded' | 'back-loaded' | 'spread';

export const INITIATIVE_ORDER_MODES: readonly InitiativeOrderMode[] = Object.freeze(['rules', 'front-loaded', 'back-loaded', 'spread']);

/** Core fixes its own Unequal Numbers procedure; only Total Warfare games choose. */
export function effectiveInitiativeOrder(ruleset: CBTRuleset, mode: InitiativeOrderMode): Exclude<InitiativeOrderMode, 'rules'> {
    if (ruleset === 'core-2026') return 'front-loaded';
    return mode === 'rules' ? 'back-loaded' : mode;
}

/** One unit's place in a phase's acting order. Consecutive slots of one side in one selection share it. */
export interface InitiativeSlot {
    readonly side: string;
    readonly selection: number;
}

/**
 * The acting order of one phase: sides take selections in Initiative order (the loser first, the winner last),
 * and a side with more units left acts for several at once.
 */
export function initiativeSequence(
    order: readonly string[],
    counts: ReadonlyMap<string, number>,
    mode: Exclude<InitiativeOrderMode, 'rules'>,
): readonly InitiativeSlot[] {
    const initial = new Map(order.map(side => [side, Math.max(0, Math.trunc(counts.get(side) ?? 0))]));
    const remaining = new Map(initial);
    const rounds = Math.min(...[...initial.values()].filter(count => count > 0));
    const slots: InitiativeSlot[] = [];
    let selection = 0;
    for (let round = 0; [...remaining.values()].some(count => count > 0); round++) {
        const fewest = Math.min(...[...remaining.values()].filter(count => count > 0));
        for (const side of order) {
            const left = remaining.get(side) ?? 0;
            if (left === 0) continue;
            const total = initial.get(side)!;
            const acting = Math.min(left, Math.max(1, mode === 'front-loaded' ? Math.ceil(left / fewest)
                : mode === 'back-loaded' ? Math.floor(left / fewest)
                    // Spread: this side's share of the phase's rounds, set by its starting count.
                    : Math.floor((round + 1) * total / rounds) - Math.floor(round * total / rounds)));
            for (let unit = 0; unit < acting; unit++) slots.push(Object.freeze({ side, selection }));
            remaining.set(side, left - acting);
            selection++;
        }
    }
    return Object.freeze(slots);
}

/** One side's Initiative roll, with every tiebreak reroll it needed. */
export interface InitiativeRoll {
    readonly side: string;
    /** The first roll, then each tiebreak reroll. */
    readonly dice: readonly (readonly [number, number])[];
    /** The highest single modifier plus any Initiative Die bonus (Core p.39). */
    readonly modifier: number;
}

/**
 * A turn's Initiative: each side's roll, made by whoever controls that side, and the order when one was set by
 * hand. Without a hand-set order, the order follows from the rolls once every tie is broken.
 */
export interface InitiativeRecord {
    /** The turn it decides (the units' 0-based turn counter). */
    readonly turn: number;
    readonly rolls: readonly InitiativeRoll[];
    /** Sides in acting order (the loser first, the winner last), set by hand over the rolls. */
    readonly order?: readonly string[];
    /**
     * Initiative Die values each side brought into this turn, already in its roll modifier (optional rule);
     * absent sides have none. The next turn's follow from them with `nextInitiativeDice`.
     */
    readonly dice?: Readonly<Record<string, number>>;
}

export function initiativeRollTotal(roll: InitiativeRoll, index = roll.dice.length - 1): number {
    const dice = roll.dice[index];
    return dice ? dice[0] + dice[1] + roll.modifier : roll.modifier;
}

/**
 * Ranks the sides by their rolls, rerolling ties with the same modifiers (Core p.39; TW p.37): the lowest total
 * first, as the loser acts first. `due` collects the sides still to roll: those without a roll, and those tied on
 * every roll so far. The order is null while any side is due.
 */
function rankInitiative(sides: readonly string[], rolls: readonly InitiativeRoll[]) {
    const byside = new Map(rolls.map(roll => [roll.side, roll]));
    const due = new Set<string>();
    const rank = (group: readonly string[], depth: number): string[] | null => {
        if (group.length === 1) return [...group];
        const missing = group.filter(side => (byside.get(side)?.dice.length ?? 0) <= depth);
        if (missing.length > 0) {
            for (const side of missing) due.add(side);
            return null;
        }
        const total = (side: string) => initiativeRollTotal(byside.get(side)!, depth);
        let ranked: string[] | null = [];
        for (const value of [...new Set(group.map(total))].sort((left, right) => left - right)) {
            const tied = rank(group.filter(side => total(side) === value), depth + 1);
            ranked = tied && ranked ? [...ranked, ...tied] : null;
        }
        return ranked;
    };
    const order = sides.length === 1 && !byside.has(sides[0]!) ? (due.add(sides[0]!), null) : rank(sides, 0);
    return { order: order && Object.freeze(order), due: due as ReadonlySet<string> };
}

/** Sides that still have to roll: those without a roll, and those still tied with another side. */
export function initiativeRollsDue(sides: readonly string[], rolls: readonly InitiativeRoll[]): ReadonlySet<string> {
    return rankInitiative(sides, rolls).due;
}

/** The acting order (the loser first) once every side has rolled and every tie is broken; null until then. */
export function initiativeOrderFromRolls(sides: readonly string[], rolls: readonly InitiativeRoll[]): readonly string[] | null {
    return rankInitiative(sides, rolls).order;
}

/** A side rolls, or rerolls a tie, keeping the modifier of its first roll. */
export function withInitiativeRoll(
    rolls: readonly InitiativeRoll[],
    side: string,
    dice: readonly [number, number],
    modifier: number,
): readonly InitiativeRoll[] {
    const previous = rolls.find(roll => roll.side === side);
    const roll: InitiativeRoll = Object.freeze({
        side,
        modifier: previous?.modifier ?? modifier,
        dice: Object.freeze([...previous?.dice ?? [], Object.freeze([dice[0], dice[1]] as const)]),
    });
    return Object.freeze(previous ? rolls.map(candidate => candidate === previous ? roll : candidate) : [...rolls, roll]);
}

/**
 * The Initiative Die values after a turn (Core p.39 optional rule): a side holding a die that wins removes it;
 * the side that lost by the greatest amount gains a die or raises its die by 1, to at most 6.
 */
export function nextInitiativeDice(
    current: Readonly<Record<string, number>>,
    order: readonly string[],
    rolls: readonly InitiativeRoll[] | undefined,
): Readonly<Record<string, number>> {
    if (order.length < 2) return Object.freeze({ ...current });
    const winner = order.at(-1)!;
    const next: Record<string, number> = { ...current };
    delete next[winner];
    // Without rolls the first side in the order lost by the greatest amount.
    const winnerTotal = rolls ? firstRollTotal(rolls, winner) : 0;
    const loser = rolls
        ? order.slice(0, -1).reduce((worst, side) =>
            winnerTotal - firstRollTotal(rolls, side) > winnerTotal - firstRollTotal(rolls, worst) ? side : worst, order[0]!)
        : order[0]!;
    next[loser] = Math.min(6, (current[loser] ?? 0) + 1);
    return Object.freeze(next);
}

function firstRollTotal(rolls: readonly InitiativeRoll[], side: string): number {
    const roll = rolls.find(candidate => candidate.side === side);
    return roll ? initiativeRollTotal(roll, 0) : 0;
}

/** Reads an Initiative decision kept outside the app (this device's storage); null when it is not one. */
export function parseInitiativeRecord(value: unknown): InitiativeRecord | null {
    if (!isRecord(value)) return null;
    const { turn, order, rolls, dice } = value;
    if (!isInteger(turn, 0, 100_000) || !Array.isArray(rolls) || rolls.length > MAX_INITIATIVE_SIDES) return null;
    const parsedRolls = rolls.map(parseRoll);
    if (parsedRolls.includes(null)) return null;
    const sides = order === undefined ? undefined : Array.isArray(order) ? order : [];
    if (sides !== undefined && (sides.length === 0 || sides.length > MAX_INITIATIVE_SIDES
        || !sides.every(side => isSide(side)) || new Set(sides).size !== sides.length)) return null;
    const parsedDice = dice === undefined ? undefined : isRecord(dice) && Object.keys(dice).length <= MAX_INITIATIVE_SIDES
        && Object.values(dice).every(die => isInteger(die, 1, 6)) ? dice as Record<string, number> : null;
    if (parsedDice === null) return null;
    return Object.freeze({
        turn: turn as number,
        rolls: Object.freeze(parsedRolls as InitiativeRoll[]),
        ...(sides === undefined ? {} : { order: Object.freeze([...sides] as string[]) }),
        ...(parsedDice === undefined ? {} : { dice: Object.freeze({ ...parsedDice }) }),
    });
}

function parseRoll(value: unknown): InitiativeRoll | null {
    if (!isRecord(value)) return null;
    const { side, modifier, dice } = value;
    if (!isSide(side) || !isInteger(modifier, -20, 20) || !Array.isArray(dice)
        || dice.length < 1 || dice.length > 20
        || !dice.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(die => isInteger(die, 1, 6)))) {
        return null;
    }
    return Object.freeze({
        side,
        modifier: modifier as number,
        dice: Object.freeze(dice.map(pair => Object.freeze([pair[0], pair[1]] as const))),
    });
}

/** Sides are forces: at most this many take part. */
const MAX_INITIATIVE_SIDES = 64;

function isSide(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value: unknown, min: number, max: number): boolean {
    return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
