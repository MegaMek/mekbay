// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';

import { InitiativeDialogComponent } from '../components/initiative-dialog/initiative-dialog.component';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import type { LobbyGameSettings } from '../models/lobby.model';
import {
    effectiveInitiativeOrder,
    initiativeOrderFromRolls,
    initiativeRollsDue,
    initiativeSequence,
    nextInitiativeDice,
    parseInitiativeRecord,
    withInitiativeRoll,
    type InitiativeRecord,
} from '../models/rules/initiative-rules';
import { roll2D6 } from '../models/runtime/mek-automation-rules';
import { compareTurnPositions, TURN_STEPS } from '../models/rules/turn-sequence';
import { DialogsService } from './dialogs.service';
import { GameTurnService, type GameTurnUnit } from './game-turn.service';
import { LobbyService } from './lobby.service';
import { OptionsService } from './options.service';

const SOLO_RECORD_KEY = 'mekbay.initiative';

/** One side of the Initiative roll: a force in play. */
export interface InitiativeSide {
    /** The force's instance id. */
    readonly id: string;
    readonly label: string;
    readonly friendly: boolean;
    /** This player rolls for it: a force they own, or any force in a game played here. */
    readonly mine: boolean;
}

/** One unit's place on a tracker step: the side that acts, not which of its units does. */
export interface InitiativePip {
    readonly side: string;
    readonly friendly: boolean;
    readonly done: boolean;
    /** Part of the selection whose turn it is to act. */
    readonly next: boolean;
}

/**
 * The real-phase Initiative: every force rolls by its owner's hand, once, and again only to break a tie; the order
 * sides act in on each step follows from the rolls, unless the host sets it by hand. The rolls are the only stored
 * fact: the lobby's in a lobby game, this device's otherwise.
 */
@Injectable({ providedIn: 'root' })
export class InitiativeService {
    private readonly gameTurn = inject(GameTurnService);
    private readonly options = inject(OptionsService);
    private readonly injector = inject(Injector);
    private readonly soloRecord = signal<InitiativeRecord | null>(readSoloRecord());
    /** The turn the Initiative was last offered for. */
    private offeredTurn: number | null = null;

    constructor() {
        // Everyone with a roll to make, or the order to set, is asked once per turn; LATER leaves it on the tracker.
        effect(() => {
            const turn = this.currentTurn();
            if (!this.needed() || turn === null || this.offeredTurn === turn
                || (this.myDue().length === 0 && !this.canReorder())) return;
            this.offeredTurn = turn;
            untracked(() => this.open());
        });
    }

    /** The lobby is resolved on use: it depends on the force builder. */
    private lobby(): LobbyService {
        return this.injector.get(LobbyService);
    }

    /** The lobby's rules in a lobby game, this player's options otherwise. */
    readonly settings = computed<LobbyGameSettings>(() => {
        const lobby = this.lobby().settings();
        if (lobby) return lobby;
        const options = this.options.options();
        return { ruleset: options.CBTRules, initiativeOrder: options.initiativeOrder, initiativeDie: options.initiativeDie };
    });

    /** Whether this player may set the order by hand: the host in a lobby game. */
    readonly canReorder = computed(() => {
        const lobby = this.lobby().state();
        return !lobby || lobby.isHost;
    });

    /** The game's current 0-based turn; null before any unit is in play. */
    readonly currentTurn = computed(() => this.gameTurn.game()?.turn ?? null);
    /** The step under way and its acting order. */
    readonly currentStep = computed(() => this.gameTurn.game()?.step ?? 0);
    readonly currentPips = computed(() => this.pips(this.currentStep()));

    private readonly storedRecord = computed(() => this.lobby().state() ? this.lobby().initiative() : this.soloRecord());

    /** Units in play, each with the force it acts for. */
    private readonly sidedUnits = computed(() => this.gameTurn.units().flatMap(unit => {
        const side = unit.member.force.instanceId();
        return side && !unit.destroyed && this.inGame(unit) ? [{ unit, side }] : [];
    }));

    /** Forces with units in play: this player's first. */
    readonly sides = computed<readonly InitiativeSide[]>(() => {
        const lobby = this.lobby().state();
        const sides = new Map<string, InitiativeSide>();
        for (const { unit, side } of this.sidedUnits()) {
            if (sides.has(side)) continue;
            const publisher = lobby ? this.lobby().publisherOf(side) : null;
            sides.set(side, Object.freeze({
                id: side,
                label: unit.member.force.displayName() || 'Force',
                friendly: !lobby ? !unit.hostile : unit.controllable || publisher?.alignment === 'friendly',
                mine: !lobby || unit.controllable,
            }));
        }
        return [...sides.values()].sort((left, right) => Number(right.mine) - Number(left.mine));
    });

    /** This turn's rolls and any order set by hand; null before anyone rolls. */
    readonly record = computed<InitiativeRecord | null>(() => {
        const record = this.storedRecord();
        return record && record.turn === this.currentTurn() ? record : null;
    });

    /** Sides still to roll this turn: no roll yet, or tied. A roll that is not tied is final. */
    readonly due = computed(() => this.sides().length < 2
        ? new Set<string>()
        : initiativeRollsDue(this.sides().map(side => side.id), this.record()?.rolls ?? []));

    /** This player's sides still to roll. */
    readonly myDue = computed(() => this.sides().filter(side => side.mine && this.due().has(side.id)));

    /** The acting order (the loser first): set by hand, or once every side has rolled; null until then. */
    readonly order = computed<readonly string[] | null>(() => {
        const record = this.record();
        const ids = this.sides().map(side => side.id);
        const manual = record?.order;
        if (manual) return [...manual.filter(id => ids.includes(id)), ...ids.filter(id => !manual.includes(id))];
        return ids.length < 2 ? ids : initiativeOrderFromRolls(ids, record?.rolls ?? []);
    });

    /** The game waits for this turn's Initiative before its units move. */
    readonly needed = computed(() => this.gameTurn.enabled() && this.sides().length >= 2 && this.order() === null
        && this.gameTurn.game()?.step === 0);

    /**
     * Initiative Die bonuses each side brings into the current turn (optional rule): this turn's, or those
     * following the previous turn's result.
     */
    readonly carriedDice = computed<Readonly<Record<string, number>>>(() => {
        const record = this.storedRecord();
        const turn = this.currentTurn();
        if (!this.settings().initiativeDie || !record || turn === null) return {};
        if (record.turn === turn) return record.dice ?? {};
        if (record.turn !== turn - 1) return {};
        const order = record.order ?? initiativeOrderFromRolls(record.rolls.map(roll => roll.side), record.rolls);
        return order ? nextInitiativeDice(record.dice ?? {}, order, record.rolls) : record.dice ?? {};
    });

    /** Rolls 2D6 for one of this player's sides that is due: its first roll, or a tie reroll. */
    roll(side: string, modifier: number): void {
        const turn = this.currentTurn();
        if (turn === null || !this.myDue().some(candidate => candidate.id === side)) return;
        const dice = roll2D6();
        const carried = this.carriedDice();
        const total = modifier + (carried[side] ?? 0);
        const withDice = Object.keys(carried).length > 0;
        if (this.lobby().state()) {
            this.lobby().rollInitiative({ turn, side, dice, modifier: total, ...(withDice ? { carriedDice: carried } : {}) });
            return;
        }
        const record = this.record();
        this.storeSolo(Object.freeze({
            turn,
            rolls: withInitiativeRoll(record?.rolls ?? [], side, dice, total),
            ...(record?.order ? { order: record.order } : {}),
            ...(withDice ? { dice: carried } : {}),
        }));
    }

    /** Sets the order by hand (the loser first) over whatever was rolled; null returns to the rolls. */
    setOrder(order: readonly string[] | null): void {
        const turn = this.currentTurn();
        if (turn === null || !this.canReorder()) return;
        const record = this.record();
        const carried = this.carriedDice();
        const next: InitiativeRecord = Object.freeze({
            turn,
            rolls: record?.rolls ?? [],
            ...(order ? { order: Object.freeze([...order]) } : {}),
            ...(Object.keys(carried).length > 0 ? { dice: carried } : {}),
        });
        if (this.lobby().state()) this.lobby().setInitiative(next);
        else this.storeSolo(next);
    }

    /** Forgets every roll: the game starts over. */
    clear(): void {
        if (!this.canReorder()) return;
        if (this.lobby().state()) this.lobby().setInitiative(null);
        else this.storeSolo(null);
    }

    /** Opens this turn's Initiative. */
    open(): void {
        this.injector.get(DialogsService).createDialog<void, InitiativeDialogComponent>(InitiativeDialogComponent);
    }

    /**
     * One tracker step's pips: the acting order of the units counted for Initiative, then the units that act
     * after it (added after Movement, or not counted under Core). Done pips are greyed side by side in order.
     */
    pips(stepIndex: number): readonly InitiativePip[] {
        const game = this.gameTurn.game();
        const step = TURN_STEPS[stepIndex];
        if (!game || !step) return [];
        const friendly = new Map(this.sides().map(side => [side.id, side.friendly]));
        const ruleset = this.settings().ruleset;
        const done = (unit: GameTurnUnit) => compareTurnPositions(unit.position, { turn: game.turn, step: stepIndex }) > 0;
        const units = this.sidedUnits();
        const ordered = units.filter(({ unit }) => countsForInitiative(unit, ruleset, step.kind === 'movement'));
        const unordered = units.filter(entry => !ordered.includes(entry));
        const decided = this.order();
        const order = decided ?? [...friendly.keys()];
        const counts = new Map(order.map(side => [side, ordered.filter(entry => entry.side === side).length]));
        const doneLeft = new Map(order.map(side => [side, ordered.filter(entry => entry.side === side && done(entry.unit)).length]));
        const slots = initiativeSequence(order, counts, effectiveInitiativeOrder(ruleset, this.settings().initiativeOrder))
            .map(slot => {
                const left = doneLeft.get(slot.side)!;
                doneLeft.set(slot.side, Math.max(0, left - 1));
                return { ...slot, done: left > 0 };
            });
        const pips = [
            ...slots.map(slot => ({ side: slot.side, done: slot.done })),
            ...unordered.map(({ unit, side }) => ({ side, done: done(unit) })),
        ];
        // Without an order there is no turn to act yet; with one, the first unit still to act is next.
        const next = decided ? pips.findIndex(pip => !pip.done) : -1;
        return Object.freeze(pips.map((pip, index) => Object.freeze({
            ...pip,
            friendly: friendly.get(pip.side) ?? false,
            next: index === next,
        })));
    }

    /** The first unit of a force still to act on the step under way, in the force's order. */
    firstToAct(side: string): GameTurnUnit['member'] | null {
        const game = this.gameTurn.game();
        if (!game) return null;
        return this.sidedUnits().find(({ unit, side: candidate }) => candidate === side
            && compareTurnPositions(unit.position, game) <= 0)?.unit.member ?? null;
    }

    /** In a lobby game only the player's own forces and those the other players publish take part. */
    private inGame(unit: GameTurnUnit): boolean {
        const forceId = unit.member.force.instanceId();
        return !this.lobby().state() || unit.controllable || (forceId !== null && this.lobby().publisherOf(forceId) !== null);
    }

    private storeSolo(record: InitiativeRecord | null): void {
        this.soloRecord.set(record);
        try {
            if (record) localStorage.setItem(SOLO_RECORD_KEY, JSON.stringify(record));
            else localStorage.removeItem(SOLO_RECORD_KEY);
        } catch {
            // Storage unavailable: the rolls last until the page reloads.
        }
    }
}

/**
 * Whether a unit takes a place in the Initiative order on a step: a unit added after Movement acts after it, and
 * Core leaves out shut-down units, unconscious warriors and, for Movement, immobile units (Core p.41).
 */
function countsForInitiative(unit: GameTurnUnit, ruleset: CBTRuleset, movement: boolean): boolean {
    const snapshot = unit.member.force.getUnitSnapshot(unit.member.id);
    if (!snapshot || snapshot.state.turn.joinedStep !== undefined) return false;
    if (ruleset !== 'core-2026') return true;
    const conditions = snapshot.query.conditions();
    const pilot = snapshot.crewAssignment.positions[0];
    return !conditions.includes('shutdown')
        && !(pilot && snapshot.query.crewState(pilot.positionId).unconscious)
        && !(movement && conditions.includes('immobile'));
}

/** This device's rolls for a game played here: local data, read once and checked. */
function readSoloRecord(): InitiativeRecord | null {
    try {
        return parseInitiativeRecord(JSON.parse(localStorage.getItem(SOLO_RECORD_KEY) ?? 'null'));
    } catch {
        return null;
    }
}
