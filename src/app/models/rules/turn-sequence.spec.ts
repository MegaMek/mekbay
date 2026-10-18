// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { END_TURN_STEP, TURN_STEPS, gameTurnPosition, historyPhaseLabel, joinTurnPosition, unitTurnStatus, type TurnPosition } from './turn-sequence';

const step = (phase: string, kind: string) => TURN_STEPS.findIndex(row => row.phase === phase && row.kind === kind);
const at = (turn: number, completed: number): TurnPosition => ({ turn, step: completed });

describe('real-phase turn sequence', () => {
    it('joins a fresh unit to a game under way, but never skips a unit that has not moved yet', () => {
        const fresh = { turn: 0, step: 0 };
        expect(joinTurnPosition(fresh, { turn: 3, step: 2 })).toEqual({ turn: 3, step: 2 });
        // Others finished Movement of turn 1 and wait: this unit simply has not moved yet.
        expect(joinTurnPosition(fresh, { turn: 0, step: 1 })).toBeNull();
        expect(joinTurnPosition(fresh, null)).toBeNull();
        expect(joinTurnPosition({ turn: 1, step: 0 }, { turn: 3, step: 2 })).toBeNull();
    });

    it('keeps the game at its slowest unit', () => {
        expect(gameTurnPosition([at(2, 0), at(1, 5), at(1, 3)])).toEqual(at(1, 3));
        expect(gameTurnPosition([])).toBeNull();
    });

    it('holds units at a barrier until every unit completed the previous step', () => {
        const declaration = step('weapons', 'declaration');
        const movedFirst = at(0, declaration);
        const stillMoving = at(0, 0);
        const game = gameTurnPosition([movedFirst, stillMoving])!;
        expect(unitTurnStatus(movedFirst, game)).toEqual({ step: 0, status: 'done' });
        expect(unitTurnStatus(stillMoving, game)).toEqual({ step: 0, status: 'acting' });
        expect(unitTurnStatus(movedFirst, at(0, declaration))).toEqual({ step: declaration, status: 'acting' });
    });

    it('lets a unit roll to hit right after its own declaration', () => {
        const declaration = step('weapons', 'declaration');
        const declared = at(0, declaration + 1);
        const game = gameTurnPosition([declared, at(0, declaration)])!;
        expect(unitTurnStatus(declared, game)).toEqual({ step: step('weapons', 'to-hit'), status: 'acting' });
    });

    it('parks units that ended their turn at End until the rest catch up', () => {
        expect(unitTurnStatus(at(3, 0), at(2, 4))).toEqual({ step: END_TURN_STEP, status: 'done' });
    });

    it('names the log phases a turn closes in order', () => {
        expect([1, 2, 3, 4, 5].map(historyPhaseLabel)).toEqual(['Movement', 'Weapons', 'Physicals', 'Heat', 'Phase 5']);
    });
});
