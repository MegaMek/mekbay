// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { CBTForce } from '../models/cbt-force.model';
import type { LobbyState } from '../models/lobby.model';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameEventsService, type ReceivedGameEvent } from './game-events.service';
import { GameTurnService } from './game-turn.service';
import { InitiativeService } from './initiative.service';
import { LobbyService } from './lobby.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';

describe('GameTurnService', () => {
    /** A loaded force whose units stand at the given turn positions. */
    function force(id: string, readOnly: boolean, positions: readonly Readonly<{ turn: number; step: number }>[]) {
        const changed = new Subject<void>();
        const live = positions.map(position => ({ ...position }));
        const loaded = Object.assign(Object.create(CBTForce.prototype) as Record<string, unknown>, {
            instanceId: () => id, readOnly: () => readOnly, changed, sessionChanged: new Subject<void>(),
        });
        const members = live.map((_, index) => ({ kind: 'cbt', id: `${id}:${index}`, force: loaded }));
        loaded['members'] = () => members;
        loaded['getRuntimeInstanceIds'] = () => members.map(member => member.id);
        loaded['restartGame'] = jasmine.createSpy('restartGame').and.callFake(async () => {
            for (const position of live) Object.assign(position, { turn: 0, step: 0 });
            changed.next();
            return true;
        });
        loaded['dispatchUnitCommand'] = jasmine.createSpy('dispatchUnitCommand').and.callFake(
            async (memberId: string, command: { type: string; step?: number }) => {
                // Completing or rewinding a step moves the unit, as the unit reducers do.
                if (command.type === 'complete-turn-step' || command.type === 'rewind-turn-step') {
                    live[members.findIndex(member => member.id === memberId)].step = command.step!
                        + (command.type === 'complete-turn-step' ? 1 : 0);
                    changed.next();
                }
                return { accepted: true, changed: true };
            });
        loaded['getUnitSnapshot'] = (memberId: string) => {
            const position = live[members.findIndex(member => member.id === memberId)];
            return { query: { destroyed: () => false }, state: { turn: { turnCounter: position.turn, turnStep: position.step } } };
        };
        return loaded;
    }

    let events: { readonly received: Subject<ReceivedGameEvent>; readonly send: jasmine.Spy };
    beforeEach(() => {
        events = { received: new Subject<ReceivedGameEvent>(), send: jasmine.createSpy('send').and.resolveTo(true) };
    });

    function setup(
        forces: readonly Record<string, unknown>[],
        publishedByLobbyPlayers: readonly string[] = [],
        away = false,
        lobby: LobbyState | null = null,
    ) {
        TestBed.configureTestingModule({
            providers: [
                GameTurnService,
                { provide: OptionsService, useValue: { options: () => ({ realPhases: true, trackPhaseAndTurn: true }) } },
                { provide: ForceWorkspaceStateService, useValue: {
                    loadedForces: signal(forces.map((loaded, index) => ({
                        force: loaded, alignment: index === 0 ? 'friendly' : 'enemy',
                    }))),
                } },
                { provide: LobbyService, useValue: {
                    publisherOf: (id: string) => publishedByLobbyPlayers.includes(id)
                        ? { publicId: 'opponent', displayName: 'Opponent', away }
                        : null,
                    state: () => lobby,
                } },
                { provide: GameEventsService, useValue: events },
                { provide: InitiativeService, useValue: { clear: () => undefined } },
                { provide: ToastService, useValue: { showToast: () => '' } },
            ],
        });
        return TestBed.inject(GameTurnService);
    }

    it('does not hold the game for a viewed force that nobody acts for', () => {
        const service = setup([force('mine', false, [{ turn: 0, step: 1 }]), force('viewed', true, [{ turn: 0, step: 0 }])]);

        expect(service.game()).toEqual({ turn: 0, step: 1 });
        // The viewed unit is still shown on the tracker.
        expect(service.units().map(unit => unit.paced)).toEqual([true, false]);
    });

    it('waits for an opposing force while a lobby player publishes it', () => {
        const service = setup(
            [force('mine', false, [{ turn: 0, step: 1 }]), force('theirs', true, [{ turn: 0, step: 0 }])],
            ['theirs'],
        );

        expect(service.game()).toEqual({ turn: 0, step: 0 });
        expect(service.stalledBy().map(player => player.publicId)).toEqual(['opponent']);
    });

    it('joins a unit added to a game under way where the units in play are', async () => {
        const mine = force('mine', false, [{ turn: 2, step: 3 }, { turn: 0, step: 0 }]);
        setup([mine]);
        TestBed.flushEffects();
        await Promise.resolve();

        expect(mine['dispatchUnitCommand']).toHaveBeenCalledOnceWith('mine:1', { type: 'join-turn', turn: 2, step: 3 });
    });

    it('stops waiting for a player the host marked away', () => {
        const service = setup(
            [force('mine', false, [{ turn: 0, step: 1 }]), force('theirs', true, [{ turn: 0, step: 0 }])],
            ['theirs'],
            true,
        );

        expect(service.game()).toEqual({ turn: 0, step: 1 });
        expect(service.stalledBy()).toEqual([]);
    });

    it('moves the own units forward step by step to a later step, then waits for the other players', async () => {
        const mine = force('mine', false, [{ turn: 0, step: 1 }, { turn: 0, step: 1 }]);
        const service = setup([mine, force('theirs', true, [{ turn: 0, step: 1 }])], ['theirs']);
        TestBed.flushEffects();

        await service.moveTo(3);

        const completed = (mine['dispatchUnitCommand'] as jasmine.Spy).calls.allArgs()
            .map(([id, command]) => `${id}:${command.step}`);
        expect(completed).toEqual(['mine:0:1', 'mine:1:1', 'mine:0:2', 'mine:1:2']);
        // Damage waits for every unit: the opponent still declares.
        expect(service.units().slice(0, 2).map(unit => [unit.position.step, unit.status])).toEqual([[3, 'done'], [3, 'done']]);

        await service.moveTo(3);
        expect((mine['dispatchUnitCommand'] as jasmine.Spy).calls.count()).toBe(4);
    });

    it('moves the own units, an owned enemy force included, back without joining the turn others show', async () => {
        const mine = force('mine', false, [{ turn: 0, step: 3 }]);
        const ownedEnemy = force('enemy', false, [{ turn: 0, step: 2 }]);
        const service = setup([mine, ownedEnemy, force('theirs', true, [{ turn: 0, step: 3 }])], ['theirs']);
        TestBed.flushEffects();

        expect(service.stepMoves(0).back.map(unit => unit.member.id)).toEqual(['mine:0', 'enemy:0']);
        await service.moveTo(0);
        TestBed.flushEffects();
        await Promise.resolve();

        expect(mine['dispatchUnitCommand']).toHaveBeenCalledOnceWith('mine:0', { type: 'rewind-turn-step', step: 0 });
        expect(ownedEnemy['dispatchUnitCommand']).toHaveBeenCalledOnceWith('enemy:0', { type: 'rewind-turn-step', step: 0 });
        // The other player's unit stays; the game waits for the units moved back.
        expect(service.game()).toEqual({ turn: 0, step: 0 });
        expect(service.units()[2].position).toEqual({ turn: 0, step: 3 });
    });

    it('restarts the own forces and, as host, the forces of the other players through the relay', async () => {
        const mine = force('mine', false, [{ turn: 2, step: 3 }]);
        const service = setup([mine, force('theirs', true, [{ turn: 2, step: 3 }])], ['theirs'], false, {
            code: 'ABCD', locked: false, settings: { ruleset: 'core-2026', initiativeOrder: 'rules', initiativeDie: false },
            initiative: null, isHost: true, participants: [
                { publicId: 'me', displayName: 'Me', self: true, host: true, connected: true, alignment: 'friendly', away: false, instanceIds: ['mine'] },
                { publicId: 'guest', displayName: 'Guest', self: false, host: false, connected: true, alignment: 'enemy', away: false, instanceIds: ['theirs', 'reserve'] },
            ],
        });
        TestBed.flushEffects();

        await service.restartGame();
        TestBed.flushEffects();
        await Promise.resolve();

        expect(mine['restartGame']).toHaveBeenCalledTimes(1);
        expect(events.send.calls.allArgs()).toEqual([['theirs', { kind: 'restart' }], ['reserve', { kind: 'restart' }]]);
        // The opponent still shows the old turn until it restarts too: the restarted unit does not join it.
        expect(mine['dispatchUnitCommand']).not.toHaveBeenCalled();
        expect(service.game()).toEqual({ turn: 0, step: 0 });
    });

    it('restarts the owned force a relayed restart addresses', () => {
        const mine = force('mine', false, [{ turn: 2, step: 3 }]);
        setup([mine]);

        events.received.next({ toForce: 'elsewhere', event: { kind: 'restart' }, fromDisplayName: 'Host' });
        expect(mine['restartGame']).not.toHaveBeenCalled();
        events.received.next({ toForce: 'mine', event: { kind: 'restart' }, fromDisplayName: 'Host' });
        expect(mine['restartGame']).toHaveBeenCalledTimes(1);
    });
});
