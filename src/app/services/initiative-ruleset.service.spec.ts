// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { LobbyGameSettings } from '../models/lobby.model';
import type { InitiativeRecord } from '../models/rules/initiative-rules';
import { DialogsService } from './dialogs.service';
import { GameTurnService, type GameTurnUnit } from './game-turn.service';
import { InitiativeService } from './initiative.service';
import { LobbyService } from './lobby.service';
import { OptionsService } from './options.service';

/** Initiative ordering differs by ruleset: Unequal Numbers (TW p.39, Core p.41). */
describe('InitiativeService under each ruleset', () => {
    const PILOT = 'pilot';
    let units: ReturnType<typeof signal<readonly GameTurnUnit[]>>;
    let options: ReturnType<typeof signal<{ CBTRules: string; initiativeOrder: string; initiativeDie: boolean }>>;
    let lobbySettings: ReturnType<typeof signal<LobbyGameSettings | null>>;
    let lobbyInitiative: ReturnType<typeof signal<InitiativeRecord | null>>;

    interface UnitFacts {
        readonly conditions?: readonly string[];
        readonly unconscious?: boolean;
    }

    function unit(side: 'F' | 'E', facts: UnitFacts = {}): GameTurnUnit {
        const snapshot = {
            state: { turn: {} },
            query: {
                conditions: () => facts.conditions ?? [],
                crewState: () => ({ unconscious: facts.unconscious === true }),
            },
            crewAssignment: { positions: [{ positionId: PILOT }] },
        };
        return {
            member: {
                id: `${side}:${Math.random()}`,
                force: { instanceId: () => side, displayName: () => `${side} force`, getUnitSnapshot: () => snapshot },
            },
            hostile: side === 'E',
            controllable: true,
            paced: true,
            destroyed: false,
            position: { turn: 0, step: 0 },
        } as unknown as GameTurnUnit;
    }

    /** The acting sides of one step's pips, in order. */
    function sequence(service: InitiativeService, step = 0): string {
        return service.pips(step).map(pip => pip.side).join('');
    }

    beforeEach(() => {
        localStorage.removeItem('mekbay.initiative');
        units = signal<readonly GameTurnUnit[]>([]);
        options = signal({ CBTRules: 'total-warfare', initiativeOrder: 'rules', initiativeDie: false });
        lobbySettings = signal<LobbyGameSettings | null>(null);
        lobbyInitiative = signal<InitiativeRecord | null>(null);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: GameTurnService,
                    useValue: { units, enabled: () => true, game: () => ({ turn: 0, step: 0 }) },
                },
                {
                    provide: LobbyService,
                    useValue: {
                        state: () => lobbySettings() ? { isHost: true } : null,
                        settings: lobbySettings,
                        initiative: lobbyInitiative,
                        setInitiative: (record: InitiativeRecord | null) => lobbyInitiative.set(record),
                        publisherOf: () => null,
                    },
                },
                { provide: OptionsService, useValue: { options } },
                { provide: DialogsService, useValue: { createDialog: jasmine.createSpy('createDialog') } },
            ],
        });
    });

    afterEach(() => localStorage.removeItem('mekbay.initiative'));

    it('back-loads the larger side under TW and front-loads it under Core, following a live rules change', () => {
        // F lost Initiative and acts first; 2 against 3.
        units.set([unit('F'), unit('F'), unit('E'), unit('E'), unit('E')]);
        const service = TestBed.inject(InitiativeService);
        service.setOrder(['F', 'E']);
        // TW p.39: E only doubles up once it has twice F's remaining units.
        expect(service.currentPips().map(pip => pip.side).join('')).toBe('FEFEE');

        options.set({ ...options(), CBTRules: 'core-2026' });
        // Core p.41: E acts for the surplus as soon as it has more units left.
        expect(service.currentPips().map(pip => pip.side).join('')).toBe('FEEFE');
    });

    it('ignores the Total Warfare order option under Core', () => {
        units.set([unit('F'), unit('F'), unit('E'), unit('E'), unit('E')]);
        options.set({ CBTRules: 'core-2026', initiativeOrder: 'back-loaded', initiativeDie: false });
        const service = TestBed.inject(InitiativeService);
        service.setOrder(['F', 'E']);
        expect(sequence(service)).toBe('FEEFE');

        // The same option is honored once the game plays by Total Warfare.
        options.set({ CBTRules: 'total-warfare', initiativeOrder: 'back-loaded', initiativeDie: false });
        expect(sequence(service)).toBe('FEFEE');
    });

    for (const [label, facts] of [
        ['shut down', { conditions: ['shutdown'] }],
        ['with an unconscious MechWarrior', { unconscious: true }],
    ] as const) {
        it(`leaves a Mek ${label} out of the Core tally on every step, but TW counts it`, () => {
            // E lost and acts first; E has 2 units, one of them out of the Core tally.
            units.set([unit('E'), unit('E', facts), unit('F')]);
            const service = TestBed.inject(InitiativeService);
            service.setOrder(['E', 'F']);
            // TW p.39 counts every unit: E has twice F's units and moves two at once.
            expect(sequence(service, 0)).toBe('EEF');
            expect(sequence(service, 1)).toBe('EEF');

            // Core p.41: one E unit against one F unit, then the uncounted unit acts after the order.
            options.set({ ...options(), CBTRules: 'core-2026' });
            expect(sequence(service, 0)).toBe('EFE');
            expect(sequence(service, 1)).toBe('EFE');
        });
    }

    it('leaves an immobile Mek out of the Core Movement tally only', () => {
        units.set([unit('E'), unit('E', { conditions: ['immobile'] }), unit('F')]);
        options.set({ ...options(), CBTRules: 'core-2026' });
        const service = TestBed.inject(InitiativeService);
        service.setOrder(['E', 'F']);
        // Core p.41: immobile 'Mechs are not counted for the Movement Phase...
        expect(sequence(service, 0)).toBe('EFE');
        // ...but are for the attack phases: E's surplus unit acts with its first selection.
        expect(sequence(service, 1)).toBe('EEF');
    });

    it('plays a lobby game by the lobby ruleset, not this player\'s option', () => {
        units.set([unit('F'), unit('F'), unit('E'), unit('E'), unit('E')]);
        lobbySettings.set({ ruleset: 'core-2026', initiativeOrder: 'rules', initiativeDie: false });
        const service = TestBed.inject(InitiativeService);
        service.setOrder(['F', 'E']);
        expect(options().CBTRules).toBe('total-warfare');
        expect(sequence(service)).toBe('FEEFE');

        lobbySettings.set({ ruleset: 'total-warfare', initiativeOrder: 'rules', initiativeDie: false });
        expect(sequence(service)).toBe('FEFEE');
    });
});
