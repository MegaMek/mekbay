// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { isCBTForceMember } from '../../models/force-member.model';
import { TURN_PHASE_LABELS, TURN_STEPS, type TurnPhaseKey, type TurnStep, type TurnStepKind } from '../../models/rules/turn-sequence';
import type { LobbyParticipant } from '../../models/lobby.model';
import { DialogsService } from '../../services/dialogs.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { GameTurnService } from '../../services/game-turn.service';
import { InitiativeService } from '../../services/initiative.service';
import { InitiativePipsComponent } from '../initiative-pips/initiative-pips.component';
import { TurnSummaryDialogComponent } from '../turn-summary-dialog/turn-summary-dialog.component';
import { LobbyService } from '../../services/lobby.service';

interface TrackerPhase {
    readonly key: TurnPhaseKey;
    readonly label: string;
    readonly steps: readonly TurnStep[];
}

/** What completing the selected unit's step does, kept short so the actions never wrap. */
const COMPLETE_STEP_LABELS: Readonly<Record<TurnStepKind, string>> = Object.freeze({
    movement: 'Commit Move',
    declaration: 'Declare Atk',
    'to-hit': 'End To-Hit',
    damage: 'End Damage',
    cleanup: 'End Cleanup',
    heat: 'End Turn',
    end: 'End Turn',
});

/**
 * The shared real-phase clock: turn, phases and steps. The current step shows one pip per unit in Initiative
 * order, greyed as each side's units act, with the selection whose turn it is ringed.
 */
@Component({
    selector: 'game-turn-tracker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [InitiativePipsComponent],
    templateUrl: './game-turn-tracker.component.html',
    styleUrl: './game-turn-tracker.component.scss',
})
export class GameTurnTrackerComponent {
    protected readonly gameTurn = inject(GameTurnService);
    protected readonly initiative = inject(InitiativeService);
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly dialogs = inject(DialogsService);
    protected readonly lobby = inject(LobbyService);
    /** Players the host set away; their units no longer hold the turn. */
    protected readonly awayPlayers = computed(() => this.lobby.state()?.participants.filter(player => player.away) ?? []);

    protected readonly phases: readonly TrackerPhase[] = (Object.keys(TURN_PHASE_LABELS) as TurnPhaseKey[])
        .map(key => ({ key, label: TURN_PHASE_LABELS[key], steps: TURN_STEPS.filter(step => step.phase === key) }));
    protected readonly completeLabels = COMPLETE_STEP_LABELS;

    /** The game's turn number as players count it (the unit counter starts at 0). */
    protected readonly turnNumber = computed(() => (this.gameTurn.game()?.turn ?? 0) + 1);
    protected readonly gameStep = computed(() => this.gameTurn.game()?.step ?? 0);
    protected readonly selected = computed(() => {
        const member = this.workspace.selectedUnit();
        return isCBTForceMember(member) ? this.gameTurn.unitFor(member) : null;
    });
    /** How many of the player's units still act on the game's current step. */
    protected readonly mineOnCurrentStep = computed(() => this.gameTurn.pendingControllableUnits()
        .filter(unit => unit.step.index === this.gameStep()).length);
    /** Units the game waits for on the current step. */
    protected readonly waitingFor = computed(() => this.gameTurn.units()
        .filter(unit => unit.paced && !unit.destroyed && unit.status === 'acting'
            && unit.step.index === this.gameStep()).length);

    /** Steps of this turn the player's units can be moved to, forward or back. */
    protected canMoveTo(step: TurnStep): boolean {
        const { forward, back } = this.gameTurn.stepMoves(step.index);
        return forward.length + back.length > 0;
    }

    protected stepName(step: TurnStep): string {
        const phase = TURN_PHASE_LABELS[step.phase];
        return step.label === phase ? phase : `${phase} ${step.label}`;
    }

    protected async moveTo(step: TurnStep): Promise<void> {
        const { forward, back } = this.gameTurn.stepMoves(step.index);
        if (forward.length + back.length === 0) return;
        const units = (count: number) => `${count} unit${count === 1 ? '' : 's'}`;
        const moves = [
            ...(forward.length > 0 ? [`${units(forward.length)} forward`] : []),
            ...(back.length > 0 ? [`${units(back.length)} back`] : []),
        ].join(' and ');
        const confirmed = await this.dialogs.requestConfirmation(
            `Move ${moves} to ${this.stepName(step)}?`
                + (forward.length > 0 ? ' Every step on the way completes as usual.' : '')
                + (back.length > 0 ? ' Moving back only changes where units stand: nothing they did is undone.' : ''),
            `Move to ${this.stepName(step)}`,
            'info',
        );
        if (confirmed) await this.gameTurn.moveTo(step.index);
    }

    /** The pips pick the unit that acts now: the ringed force's first unit still to act, on either side of the sidebar. */
    protected selectUnitToAct(): void {
        const next = this.initiative.currentPips().find(pip => pip.next);
        const member = next ? this.initiative.firstToAct(next.side) : null;
        if (member) this.workspace.revealUnit(member);
    }

    protected openSummary(): void {
        this.dialogs.createDialog<void, TurnSummaryDialogComponent>(TurnSummaryDialogComponent);
    }


    protected completeSelected(): void {
        const unit = this.selected();
        if (unit) void this.gameTurn.completeStep(unit.member);
    }

    protected completeAllMine(): void {
        void this.gameTurn.completeStepForAll(this.gameStep());
    }

    /** Host only: stop waiting for the stalled players until the host brings them back. */
    protected async advanceWithout(players: readonly LobbyParticipant[]): Promise<void> {
        const names = players.map(player => player.displayName).join(', ');
        const confirmed = await this.dialogs.requestConfirmation(
            `Continue without ${names}? Their units stop holding the turn until you bring them back; `
                + 'they can still catch up by finishing their steps.',
            'Advance Anyway',
            'danger',
        );
        if (confirmed) for (const player of players) this.lobby.setAway(player.publicId, true);
    }

    protected resume(player: LobbyParticipant): void {
        this.lobby.setAway(player.publicId, false);
    }
}
