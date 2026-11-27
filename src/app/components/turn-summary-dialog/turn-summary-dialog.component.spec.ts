// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DialogRef } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { LobbyParticipant, LobbyState } from '../../models/lobby.model';
import { DialogsService } from '../../services/dialogs.service';
import { GameTurnService } from '../../services/game-turn.service';
import { InitiativeService } from '../../services/initiative.service';
import { LobbyService } from '../../services/lobby.service';
import { TurnSummaryDialogComponent } from './turn-summary-dialog.component';

describe('TurnSummaryDialogComponent', () => {
    const player = (publicId: string, self: boolean): LobbyParticipant => ({
        publicId, displayName: publicId, self, host: false, connected: true, alignment: 'friendly', away: false, instanceIds: [],
    });
    const lobby = (isHost: boolean, participants: LobbyParticipant[]): LobbyState => ({
        code: 'A', locked: false, settings: { ruleset: 'core-2026', initiativeOrder: 'rules', initiativeDie: false },
        initiative: null, isHost, participants,
    });

    function setup(state: LobbyState | null = null) {
        const gameTurn = { game: signal({ turn: 2, step: 0 }), restartGame: jasmine.createSpy('restartGame').and.resolveTo() };
        const dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['requestConfirmation']);
        dialogs.requestConfirmation.and.resolveTo(true);
        TestBed.configureTestingModule({
            imports: [TurnSummaryDialogComponent],
            providers: [
                { provide: GameTurnService, useValue: gameTurn },
                { provide: LobbyService, useValue: { state: signal(state) } },
                { provide: DialogsService, useValue: dialogs },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                {
                    provide: InitiativeService,
                    useValue: {
                        sides: signal([
                            { id: 'friendly', label: 'Friendly', friendly: true, mine: true },
                            { id: 'enemy', label: 'Enemy', friendly: false, mine: false },
                        ]),
                        record: signal({
                            turn: 2,
                            rolls: [
                                { side: 'friendly', modifier: 0, dice: [[2, 3]] },
                                { side: 'enemy', modifier: 1, dice: [[4, 4]] },
                            ],
                        }),
                        order: signal(['friendly', 'enemy']),
                        due: signal(new Set()),
                        myDue: signal([]),
                        canReorder: signal(true),
                        currentPips: signal([
                            { side: 'friendly', friendly: true, done: true, next: false },
                            { side: 'enemy', friendly: false, done: false, next: true },
                        ]),
                        open: jasmine.createSpy('open'),
                    },
                },
            ],
        });
        const fixture = TestBed.createComponent(TurnSummaryDialogComponent);
        fixture.detectChanges();
        return { element: fixture.nativeElement as HTMLElement, gameTurn, dialogs };
    }

    it('shows the winner first with the rolls, and the acting order of the step under way', () => {
        const { element } = setup();
        expect(element.querySelector('h2')?.textContent).toContain('TURN 3');
        const sides = [...element.querySelectorAll('.side')].map(side => side.textContent!.replace(/\s+/g, ' ').trim());
        expect(sides[0]).toContain('Enemy');
        expect(sides[0]).toContain('9');
        expect(sides[1]).toContain('Friendly');
        expect(sides[1]).toContain('acts first');
        expect(element.querySelectorAll('.order initiative-pips[size="large"] .dot').length).toBe(2);
    });

    it('restarts after a danger confirmation, alone, outside a lobby or as its host', async () => {
        const { element, gameTurn, dialogs } = setup();
        (element.querySelector('.bt-button.danger') as HTMLButtonElement).click();
        await new Promise(resolve => setTimeout(resolve));
        expect(dialogs.requestConfirmation).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(String), 'danger');
        expect(gameTurn.restartGame).toHaveBeenCalledTimes(1);

        const canRestart = (state: LobbyState) => {
            TestBed.resetTestingModule();
            return setup(state).element.querySelector('.bt-button.danger') !== null;
        };
        expect(canRestart(lobby(false, [player('me', true)]))).toBeTrue();
        expect(canRestart(lobby(true, [player('me', true), player('guest', false)]))).toBeTrue();
        expect(canRestart(lobby(false, [player('me', true), player('host', false)]))).toBeFalse();
    });
});
