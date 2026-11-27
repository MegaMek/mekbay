// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DialogRef } from '@angular/cdk/dialog';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, inject, signal, untracked, viewChildren } from '@angular/core';

import { initiativeRollTotal } from '../../models/rules/initiative-rules';
import { InitiativeService, type InitiativeSide } from '../../services/initiative.service';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';
import { InitiativePipsComponent } from '../initiative-pips/initiative-pips.component';

const MODIFIER_RANGE = 10;

/**
 * This turn's Initiative. Each force rolls once, by its owner's hand, and rolls again only while tied; the order
 * follows from the rolls. The lobby host (or the player of a game played here) may also set the order by hand.
 */
@Component({
    selector: 'initiative-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DiceRollerComponent, InitiativePipsComponent],
    host: { class: 'fullscreen-dialog-host glass' },
    templateUrl: './initiative-dialog.component.html',
    styleUrl: './initiative-dialog.component.scss',
})
export class InitiativeDialogComponent {
    private readonly dialogRef = inject<DialogRef<void>>(DialogRef);
    protected readonly initiative = inject(InitiativeService);
    private readonly rollers = viewChildren(DiceRollerComponent);

    protected readonly turnNumber = computed(() => (this.initiative.currentTurn() ?? 0) + 1);
    /** Modifiers chosen for this player's sides before their first roll: the side's highest Initiative modifier. */
    protected readonly modifiers = signal<Readonly<Record<string, number>>>({});

    /** Sides from the winner down once the order is known; before that, as listed. */
    protected readonly rows = computed(() => {
        const sides = this.initiative.sides();
        const order = this.initiative.order();
        const ranked = order ? [...order].reverse().flatMap(id => sides.filter(side => side.id === id)) : sides;
        const rolls = this.initiative.record()?.rolls ?? [];
        const due = this.initiative.due();
        const dice = this.initiative.carriedDice();
        return ranked.map(side => {
            const roll = rolls.find(candidate => candidate.side === side.id) ?? null;
            return {
                side,
                roll,
                latest: roll?.dice.at(-1) ?? null,
                earlier: roll ? roll.dice.slice(0, -1).map((_, index) => initiativeRollTotal(roll, index)) : [],
                due: due.has(side.id),
                tied: due.has(side.id) && roll !== null,
                die: dice[side.id] ?? 0,
                modifier: roll?.modifier ?? (this.modifiers()[side.id] ?? 0) + (dice[side.id] ?? 0),
            };
        });
    });
    protected readonly ranked = computed(() => this.initiative.order() !== null);
    protected readonly myDue = this.initiative.myDue;

    /** Rolls already on screen, by side, so only new ones roll out: those made before opening show as they are. */
    private readonly shown = new Map(this.rows().map(row => [row.side.id, row.roll?.dice.length ?? 0]));

    constructor() {
        // Each new roll, this player's or another's as it arrives, rolls out on its row. After render, so the
        // rollers are in the rows' order when a decided order moves the winner up.
        afterRenderEffect(() => {
            const rows = this.rows();
            const rollers = this.rollers();
            untracked(() => rows.forEach((row, index) => {
                const count = row.roll?.dice.length ?? 0;
                if (count > (this.shown.get(row.side.id) ?? 0) && row.latest) rollers[index]?.roll([row.latest[0], row.latest[1]]);
                this.shown.set(row.side.id, count);
            }));
        });
    }

    protected setModifier(side: InitiativeSide, delta: number): void {
        const current = this.modifiers()[side.id] ?? 0;
        const next = Math.max(-MODIFIER_RANGE, Math.min(MODIFIER_RANGE, current + delta));
        this.modifiers.update(modifiers => ({ ...modifiers, [side.id]: next }));
    }

    protected roll(side: InitiativeSide): void {
        this.initiative.roll(side.id, this.modifiers()[side.id] ?? 0);
    }

    protected rollAllMine(): void {
        for (const side of this.myDue()) this.roll(side);
    }

    /** Moves a side up (towards winning) or down by hand: the host's order replaces the rolled one. */
    protected move(index: number, delta: -1 | 1): void {
        const ranking = this.rows().map(row => row.side.id);
        const target = index + delta;
        if (target < 0 || target >= ranking.length) return;
        [ranking[index], ranking[target]] = [ranking[target]!, ranking[index]!];
        this.initiative.setOrder([...ranking].reverse());
    }

    /** Drops the order set by hand: the rolls decide again. */
    protected useRolledOrder(): void {
        this.initiative.setOrder(null);
    }

    protected close(): void {
        this.dialogRef.close();
    }

    protected signed(value: number): string {
        return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '±0';
    }
}
