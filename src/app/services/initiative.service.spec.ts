// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DialogsService } from './dialogs.service';
import { GameTurnService, type GameTurnUnit } from './game-turn.service';
import { InitiativeService } from './initiative.service';
import { LobbyService } from './lobby.service';
import { OptionsService } from './options.service';

describe('InitiativeService', () => {
    let units: ReturnType<typeof signal<readonly GameTurnUnit[]>>;
    let createDialog: jasmine.Spy;

    /** A unit of force `force` ('F' friendly, 'E' enemy) at `step` of turn 0; `joinedStep` marks a late one. */
    function unit(force: 'F' | 'E', step: number, joinedStep?: number): GameTurnUnit {
        const snapshot = {
            state: { turn: joinedStep === undefined ? {} : { joinedStep } },
            query: { conditions: () => [] },
            crewAssignment: { positions: [] },
        };
        return {
            member: {
                id: `${force}:${step}:${Math.random()}`,
                force: { instanceId: () => force, displayName: () => `${force} force`, getUnitSnapshot: () => snapshot },
            },
            hostile: force === 'E',
            controllable: true,
            paced: true,
            destroyed: false,
            position: { turn: 0, step },
        } as unknown as GameTurnUnit;
    }

    beforeEach(() => {
        localStorage.removeItem('mekbay.initiative');
        units = signal<readonly GameTurnUnit[]>([]);
        createDialog = jasmine.createSpy('createDialog');
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: GameTurnService,
                    useValue: { units, enabled: () => true, game: () => ({ turn: 0, step: 0 }) },
                },
                {
                    provide: LobbyService,
                    useValue: { state: () => null, settings: () => null, initiative: () => null, publisherOf: () => null },
                },
                {
                    provide: OptionsService,
                    useValue: { options: () => ({ CBTRules: 'total-warfare', initiativeOrder: 'rules', initiativeDie: false }) },
                },
                { provide: DialogsService, useValue: { createDialog } },
            ],
        });
    });

    afterEach(() => localStorage.removeItem('mekbay.initiative'));

    it('makes every force a side and asks for its rolls once at the start of a turn', () => {
        units.set([unit('F', 0), unit('E', 0)]);
        const service = TestBed.inject(InitiativeService);
        TestBed.tick();
        expect(service.sides().map(side => [side.id, side.friendly, side.mine])).toEqual([['F', true, true], ['E', false, true]]);
        expect(service.needed()).toBeTrue();
        expect(createDialog).toHaveBeenCalledTimes(1);
        units.set([unit('F', 0), unit('E', 0), unit('E', 0)]);
        TestBed.tick();
        expect(createDialog).toHaveBeenCalledTimes(1);
    });

    it('takes the roll of each force once, rerolls only ties, and orders the forces by their rolls', () => {
        units.set([unit('F', 0), unit('E', 0)]);
        const service = TestBed.inject(InitiativeService);
        const dice = (first: number, second: number) => [(first - 0.5) / 6, (second - 0.5) / 6];
        spyOn(Math, 'random').and.returnValues(...dice(3, 3), ...dice(2, 4), ...dice(1, 1), ...dice(6, 5), ...dice(6, 6));
        service.roll('F', 0);
        service.roll('E', 0);
        // A tie on 6: both reroll.
        expect([...service.due()].sort()).toEqual(['E', 'F']);
        service.roll('F', 0);
        service.roll('E', 0);
        expect(service.order()).toEqual(['F', 'E']);
        // Rolls are final: no side is due, so no further roll is taken.
        service.roll('F', 0);
        expect(service.record()!.rolls.find(roll => roll.side === 'F')!.dice.length).toBe(2);
        // The order can still be set by hand.
        service.setOrder(['E', 'F']);
        expect(service.order()).toEqual(['E', 'F']);
        expect(JSON.parse(localStorage.getItem('mekbay.initiative')!).order).toEqual(['E', 'F']);
    });

    it('lays the pips out in Initiative order, greys acted units and rings the selection to act', () => {
        // F lost and acts first; 2 against 3 back-loaded: F, E, F, EE.
        units.set([unit('F', 1), unit('F', 0), unit('E', 0), unit('E', 0), unit('E', 0)]);
        const service = TestBed.inject(InitiativeService);
        service.setOrder(['F', 'E']);
        const pips = service.pips(0);
        expect(pips.map(pip => pip.friendly ? 'F' : 'E').join('')).toBe('FEFEE');
        expect(pips.map(pip => pip.done)).toEqual([true, false, false, false, false]);
        expect(pips.map(pip => pip.next)).toEqual([false, true, false, false, false]);
        // A selection of two still rings only its first unit; a pip picks its force's first unit still to act.
        service.setOrder(['E', 'F']);
        expect(service.pips(0).map(pip => pip.next)).toEqual([true, false, false, false, false]);
        expect(service.firstToAct('F')).toBe(units()[1].member);
    });

    it('puts units added after Movement after the order', () => {
        units.set([unit('F', 1), unit('E', 1), unit('E', 1, 1)]);
        const service = TestBed.inject(InitiativeService);
        service.setOrder(['E', 'F']);
        const pips = service.pips(1);
        expect(pips.map(pip => pip.friendly ? 'F' : 'E').join('')).toBe('EFE');
        expect(pips.map(pip => pip.next)).toEqual([true, false, false]);
    });
});
