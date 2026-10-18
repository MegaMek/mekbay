// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { initiativeRollTotal } from '../../models/rules/initiative-rules';
import { TURN_PHASE_LABELS, TURN_STEPS } from '../../models/rules/turn-sequence';
import { DialogsService } from '../../services/dialogs.service';
import { GameTurnService } from '../../services/game-turn.service';
import { InitiativeService } from '../../services/initiative.service';
import { LobbyService } from '../../services/lobby.service';
import { InitiativePipsComponent } from '../initiative-pips/initiative-pips.component';

const pip = (friendly: boolean, done: boolean, next: boolean) => Object.freeze({ side: '', friendly, done, next });
/** What the pips mean. */
const PIP_LEGEND = Object.freeze([
    { label: 'friendly', pip: pip(true, false, false) },
    { label: 'opposing', pip: pip(false, false, false) },
    { label: 'acts now', pip: pip(true, false, true) },
    { label: 'acted', pip: pip(true, true, false) },
]);

/**
 * The current turn at a glance: who won Initiative and how, the order sides act in on the step under way,
 * and how many units each side still has to act with. Restarting the game lives here too.
 */
@Component({
    selector: 'turn-summary-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host glass' },
    imports: [InitiativePipsComponent],
    templateUrl: './turn-summary-dialog.component.html',
    styleUrl: './turn-summary-dialog.component.scss',
})
export class TurnSummaryDialogComponent {
    private readonly dialogRef = inject<DialogRef<void>>(DialogRef);
    private readonly dialogs = inject(DialogsService);
    private readonly gameTurn = inject(GameTurnService);
    private readonly lobby = inject(LobbyService);
    protected readonly initiative = inject(InitiativeService);

    protected readonly turnNumber = computed(() => (this.gameTurn.game()?.turn ?? 0) + 1);
    protected readonly step = computed(() => TURN_STEPS[this.gameTurn.game()?.step ?? 0]!);
    protected readonly stepName = computed(() => {
        const step = this.step();
        const phase = TURN_PHASE_LABELS[step.phase];
        return step.label === phase ? phase : `${phase} · ${step.label}`;
    });
    protected readonly pips = this.initiative.currentPips;
    protected readonly legend = PIP_LEGEND;

    /** Sides from the winner down, with their rolls when the order was rolled. */
    protected readonly ranking = computed(() => {
        const record = this.initiative.record();
        const sides = this.initiative.sides();
        const decided = this.initiative.order();
        const order = decided ? [...decided].reverse() : sides.map(side => side.id);
        return order.flatMap((id, index) => {
            const side = sides.find(candidate => candidate.id === id);
            if (!side) return [];
            const roll = record?.rolls?.find(candidate => candidate.side === id);
            const pips = this.pips().filter(pip => pip.side === id);
            return [{
                side,
                place: index,
                total: roll ? initiativeRollTotal(roll) : null,
                firstRoll: roll?.dice[0] ?? null,
                modifier: roll?.modifier ?? 0,
                ties: roll ? roll.dice.length - 1 : 0,
                acted: pips.filter(pip => pip.done).length,
                units: pips.length,
            }];
        });
    });

    /** Restarting changes everyone's game: alone, outside a lobby, or as its host. */
    protected readonly canRestart = computed(() => {
        const lobby = this.lobby.state();
        return !lobby || lobby.isHost || lobby.participants.every(player => player.self);
    });

    protected openInitiative(): void {
        this.initiative.open();
    }

    protected async restart(): Promise<void> {
        const others = this.lobby.state()?.participants.some(player => !player.self) === true;
        const confirmed = await this.dialogs.requestConfirmation(
            'Every unit you control goes back to the Movement step of turn 1. Uncommitted damage and '
                + 'this turn\'s checks are discarded, and the log, undo and redo are cleared. Committed damage stays.'
                + (others ? ' The other players\' units restart too.' : ''),
            'Restart at Turn 1?',
            'danger',
        );
        if (!confirmed) return;
        await this.gameTurn.restartGame();
        this.dialogRef.close();
    }

    protected close(): void {
        this.dialogRef.close();
    }

    protected signed(value: number): string {
        return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '';
    }
}
