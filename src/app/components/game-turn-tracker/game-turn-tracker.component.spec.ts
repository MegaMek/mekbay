// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { LobbyParticipant, LobbyState } from '../../models/lobby.model';
import { TURN_STEPS } from '../../models/rules/turn-sequence';
import { DialogsService } from '../../services/dialogs.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { GameTurnService } from '../../services/game-turn.service';
import { LobbyService } from '../../services/lobby.service';
import { InitiativeService, type InitiativePip, type InitiativeSide } from '../../services/initiative.service';
import { TurnSummaryDialogComponent } from '../turn-summary-dialog/turn-summary-dialog.component';
import { GameTurnTrackerComponent } from './game-turn-tracker.component';

describe('GameTurnTrackerComponent', () => {
    const player = (publicId: string, self: boolean): LobbyParticipant => ({
        publicId, displayName: publicId, self, host: false, connected: true, alignment: 'friendly', away: false, instanceIds: [],
    });
    /** Only who is in the lobby and who hosts matter to the tracker. */
    const lobby = (isHost: boolean, participants: LobbyParticipant[]): LobbyState => ({
        code: 'A', locked: false, settings: { ruleset: 'core-2026', initiativeOrder: 'rules', initiativeDie: false },
        initiative: null, isHost, participants,
    });

    function setup(lobby: LobbyState | null = null, pips: readonly InitiativePip[] = [], sides: readonly InitiativeSide[] = []) {
        // The game is on Weapons To-Hit, where the player's one unit acts.
        const unit = {};
        const gameTurn = {
            game: signal({ turn: 1, step: 2 }),
            units: signal([]),
            pendingControllableUnits: signal([{ step: TURN_STEPS[2] }]),
            stalledBy: signal([]),
            unitFor: () => null,
            restartGame: jasmine.createSpy('restartGame').and.resolveTo(),
            stepMoves: (index: number) => ({ forward: index > 2 ? [unit] : [], back: index < 2 ? [unit] : [] }),
            moveTo: jasmine.createSpy('moveTo').and.resolveTo(),
        };
        const dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['requestConfirmation', 'createDialog']);
        const workspace = { selectedUnit: signal(null), revealUnit: jasmine.createSpy('revealUnit') };
        dialogs.requestConfirmation.and.resolveTo(true);
        TestBed.configureTestingModule({
            imports: [GameTurnTrackerComponent],
            providers: [
                { provide: GameTurnService, useValue: gameTurn },
                { provide: LobbyService, useValue: { state: signal(lobby), isHost: signal(lobby?.isHost === true) } },
                { provide: DialogsService, useValue: dialogs },
                { provide: ForceWorkspaceStateService, useValue: workspace },
                {
                    provide: InitiativeService,
                    useValue: {
                        sides: signal(sides), order: signal(sides.length ? sides.map(side => side.id) : null),
                        myDue: signal([]), currentPips: signal(pips), open: jasmine.createSpy('open'),
                        firstToAct: (side: string) => ({ id: `${side}-unit` }),
                    },
                },
            ],
        });
        const fixture = TestBed.createComponent(GameTurnTrackerComponent);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        return { element, gameTurn, dialogs, workspace, turnButton: element.querySelector('.turn-label') as HTMLButtonElement };
    }

    it('opens the turn summary from the turn number', () => {
        const { turnButton, dialogs } = setup();
        expect(turnButton.textContent).toContain('2');
        turnButton.click();
        expect(dialogs.createDialog).toHaveBeenCalledOnceWith(TurnSummaryDialogComponent);
    });

    it('moves the own units to any other step of the turn after a confirmation', async () => {
        const { element, gameTurn, dialogs } = setup();
        const steps = [...element.querySelectorAll<HTMLButtonElement>('.step-label')];

        expect(steps.map(step => step.disabled)).toEqual(TURN_STEPS.map(step => step.index === 2));
        steps[1].click();
        await new Promise(resolve => setTimeout(resolve));
        expect(dialogs.requestConfirmation.calls.mostRecent().args[0])
            .toContain('Move 1 unit back to Weapons Declaration?');
        expect(gameTurn.moveTo).toHaveBeenCalledOnceWith(1);

        dialogs.requestConfirmation.and.resolveTo(false);
        steps[8].click();
        await new Promise(resolve => setTimeout(resolve));
        expect(dialogs.requestConfirmation.calls.mostRecent().args[0]).toContain('Move 1 unit forward to Physicals Cleanup?');
        expect(gameTurn.moveTo).toHaveBeenCalledTimes(1);
    });

    it('shows the pips of the current step in Initiative order with the selection to act ringed, and no Initiative chip once decided', () => {
        const sides: InitiativeSide[] = [
            { id: 'enemy', label: 'Enemy', friendly: false, mine: false },
            { id: 'friendly', label: 'Friendly', friendly: true, mine: true },
        ];
        const { element } = setup(null, [
            { side: 'enemy', friendly: false, done: true, next: false },
            { side: 'friendly', friendly: true, done: false, next: true },
            { side: 'enemy', friendly: false, done: false, next: false },
        ], sides);
        const dots = [...element.querySelectorAll('.step.current .dot')];
        expect(dots.map(dot => [dot.classList.contains('hostile'), dot.classList.contains('done'), dot.classList.contains('next')]))
            .toEqual([[true, true, false], [false, false, true], [true, false, false]]);
        expect(element.querySelectorAll('.step:not(.current) .dot').length).toBe(0);
        expect(element.querySelector('.initiative-chip')).toBeNull();
    });

    it('selects the unit that acts now, the ringed one, when the pips are clicked', () => {
        const { element, workspace } = setup(null, [
            { side: 'enemy', friendly: false, done: true, next: false },
            { side: 'friendly', friendly: true, done: false, next: true },
            { side: 'enemy', friendly: false, done: false, next: false },
        ], [
            { id: 'enemy', label: 'Enemy', friendly: false, mine: false },
            { id: 'friendly', label: 'Friendly', friendly: true, mine: true },
        ]);
        (element.querySelector('.step.current initiative-pips') as HTMLElement).click();
        expect(workspace.revealUnit).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 'friendly-unit' }));
    });
});
